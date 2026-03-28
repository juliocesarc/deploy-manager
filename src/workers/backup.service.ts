import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../logger';
import { env } from '../env';

const execFileAsync = promisify(execFile);

/**
 * Creates a tar.gz backup of all named Docker volumes used by the project's
 * docker-compose stack. Returns the path to the backup archive.
 *
 * Strategy:
 *   1. docker compose config --format json → list volume names
 *   2. For each volume, run a temporary alpine container that tars the data
 *   3. Store all tars in a single directory named after job_id
 */
export async function backupVolumes(
  project: string,
  environment: string,
  jobId: string,
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `${project}-${environment}-${timestamp}`;
  const backupDir = join(env.BACKUPS_DIR, backupName);

  mkdirSync(backupDir, { recursive: true });
  logger.info({ project, environment, jobId, backupDir }, 'Starting volume backup');

  const volumes = await getProjectVolumes(project);

  if (volumes.length === 0) {
    logger.warn({ project }, 'No named volumes found; skipping backup');
    return backupDir;
  }

  for (const volume of volumes) {
    const archivePath = join(backupDir, `${volume}.tar.gz`);
    logger.info({ volume, archivePath }, 'Backing up volume');

    await execFileAsync('docker', [
      'run',
      '--rm',
      '-v', `${volume}:/data:ro`,
      '-v', `${backupDir}:/backup`,
      'alpine:3',
      'tar', '-czf', `/backup/${volume}.tar.gz`, '-C', '/data', '.',
    ]);
  }

  logger.info({ project, backupDir, volumes }, 'Volume backup complete');
  return backupDir;
}

/**
 * Restores volumes from a backup directory.
 */
export async function restoreVolumes(
  project: string,
  backupDir: string,
): Promise<void> {
  if (!existsSync(backupDir)) {
    throw new Error(`Backup directory not found: ${backupDir}`);
  }

  const volumes = await getProjectVolumes(project);
  logger.info({ project, backupDir, volumes }, 'Restoring volumes from backup');

  for (const volume of volumes) {
    const archivePath = `/backup/${volume}.tar.gz`;
    logger.info({ volume }, 'Restoring volume');

    await execFileAsync('docker', [
      'run',
      '--rm',
      '-v', `${volume}:/data`,
      '-v', `${backupDir}:/backup:ro`,
      'alpine:3',
      'sh', '-c', `rm -rf /data/* && tar -xzf ${archivePath} -C /data`,
    ]);
  }

  logger.info({ project, backupDir }, 'Volume restore complete');
}

async function getProjectVolumes(project: string): Promise<string[]> {
  const composePath = join(env.PROJECTS_DIR, project, 'docker-compose.yaml');

  try {
    const { stdout } = await execFileAsync('docker', [
      'compose', '-f', composePath, 'config', '--volumes',
    ]);
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (err) {
    logger.warn({ project, err }, 'Failed to list volumes; assuming none');
    return [];
  }
}
