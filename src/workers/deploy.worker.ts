import { Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { DeployJobData } from '../@types';
import { logger } from '../logger';
import { metrics } from '../metrics';
import {
  createDeployment,
  updateDeployment,
  getLatestSuccessfulDeployment,
} from '../models/deployment.model';
import {
  projectExists,
  getCurrentImage,
  updateComposeImage,
  composePull,
  composeUp,
} from './docker.service';
import { backupVolumes, restoreVolumes } from './backup.service';
import { waitForHealthy } from './health-check';
import { env } from '../env';

export const DEPLOY_QUEUE = 'deploy';

let connection: IORedis;

function getRedis(): IORedis {
  if (!connection) {
    connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  }
  return connection;
}

export function getDeployQueue(): Queue<DeployJobData> {
  return new Queue<DeployJobData>(DEPLOY_QUEUE, { connection: getRedis() });
}

export function startDeployWorker(): Worker<DeployJobData> {
  const worker = new Worker<DeployJobData>(
    DEPLOY_QUEUE,
    async (job) => {
      const data = job.data;
      const startTime = Date.now();

      logger.info(
        { jobId: data.jobId, project: data.project, environment: data.environment, image: data.image },
        'Processing deploy job',
      );

      // 1. Record as "running"
      await updateDeployment(data.jobId, { status: 'running' });

      // 2. Validate project exists
      if (!projectExists(data.project)) {
        const error = `Project not found: ${data.project}`;
        await updateDeployment(data.jobId, { status: 'failed', error });
        metrics.deployments.inc({ project: data.project, environment: data.environment, status: 'failed' });
        throw new Error(error);
      }

      const previousImage = getCurrentImage(data.project);
      await updateDeployment(data.jobId, { previousImage });

      let backupPath: string | null = null;

      // 3. Backup if requested
      if (data.backup) {
        try {
          backupPath = await backupVolumes(data.project, data.environment, data.jobId);
          await updateDeployment(data.jobId, { backupPath });
        } catch (err) {
          logger.error({ err, project: data.project }, 'Backup failed');
          // Non-fatal: continue with deploy
        }
      }

      // 4. Update image in compose file and pull
      try {
        updateComposeImage(data.project, data.image);
        await composePull(data.project, { ENVIRONMENT: data.environment });
        await composeUp(data.project, { ENVIRONMENT: data.environment });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error({ err, project: data.project }, 'docker compose failed');
        await handleRollback(data, previousImage, backupPath, error);
        metrics.deployments.inc({ project: data.project, environment: data.environment, status: 'failed' });
        throw err;
      }

      // 5. Health check
      let healthCheckPassed = false;
      if (data.health_check_path) {
        // We use host-level curl; the project must expose its port to the host
        const healthUrl = buildHealthUrl(data.project, data.health_check_path);
        healthCheckPassed = await waitForHealthy({
          url: healthUrl,
          timeoutSeconds: data.health_check_timeout ?? env.DEFAULT_HEALTH_CHECK_TIMEOUT,
        });

        metrics[healthCheckPassed ? 'healthChecksPassed' : 'healthChecksFailed'].inc({
          project: data.project,
          environment: data.environment,
        });

        if (!healthCheckPassed) {
          const error = `Health check failed after ${data.health_check_timeout ?? env.DEFAULT_HEALTH_CHECK_TIMEOUT}s`;
          logger.error({ project: data.project, environment: data.environment }, error);

          if (data.rollback_on_failure) {
            await handleRollback(data, previousImage, backupPath, error);
            metrics.rollbacks.inc({ project: data.project, environment: data.environment });
          } else {
            await updateDeployment(data.jobId, {
              status: 'failed',
              healthCheckPassed: false,
              durationMs: Date.now() - startTime,
              error,
            });
          }
          metrics.deployments.inc({ project: data.project, environment: data.environment, status: 'failed' });
          throw new Error(error);
        }
      } else {
        // No health check configured → assume healthy
        healthCheckPassed = true;
      }

      // 6. Success
      const durationMs = Date.now() - startTime;
      await updateDeployment(data.jobId, {
        status: 'success',
        healthCheckPassed,
        durationMs,
        backupPath,
      });

      metrics.deployments.inc({ project: data.project, environment: data.environment, status: 'success' });
      metrics.deploymentDuration.observe(
        { project: data.project, environment: data.environment },
        durationMs / 1000,
      );

      logger.info(
        { jobId: data.jobId, project: data.project, environment: data.environment, durationMs },
        'Deploy completed successfully',
      );
    },
    { connection: getRedis(), concurrency: 3 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.data.jobId, err }, 'Deploy job failed');
  });

  return worker;
}

async function handleRollback(
  data: DeployJobData,
  previousImage: string | null,
  backupPath: string | null,
  error: string,
): Promise<void> {
  if (!data.rollback_on_failure || !previousImage) {
    await updateDeployment(data.jobId, {
      status: 'failed',
      error,
    });
    return;
  }

  logger.warn(
    { project: data.project, previousImage },
    'Rolling back to previous image',
  );

  try {
    // Restore backup if available
    if (backupPath) {
      await restoreVolumes(data.project, backupPath);
    }

    updateComposeImage(data.project, previousImage);
    await composePull(data.project, { ENVIRONMENT: data.environment });
    await composeUp(data.project, { ENVIRONMENT: data.environment });

    await updateDeployment(data.jobId, {
      status: 'rolled_back',
      error,
    });

    logger.info({ project: data.project, previousImage }, 'Rollback complete');
  } catch (rollbackErr) {
    logger.error({ rollbackErr, project: data.project }, 'Rollback itself failed');
    await updateDeployment(data.jobId, {
      status: 'failed',
      error: `${error} | Rollback also failed: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
    });
  }
}

/**
 * Builds the health check URL. In a typical VPS setup, the project exposes
 * a port on the host (e.g. 3001), so we probe localhost:<port><path>.
 * If the path already contains http:// we use it as-is.
 */
function buildHealthUrl(project: string, path: string): string {
  if (path.startsWith('http')) return path;
  // Default: use port mapping from compose — caller must override via full URL
  // For a simple default we probe on localhost without a specific port.
  // Production usage should pass the full URL or configure per-project.
  return `http://localhost${path.startsWith('/') ? path : `/${path}`}`;
}
