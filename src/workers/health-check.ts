import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../logger';
import { env } from '../env';

const execFileAsync = promisify(execFile);

interface HealthCheckOptions {
  /** e.g. "http://localhost:3001/health" — resolved inside the container */
  url: string;
  timeoutSeconds?: number;
  intervalMs?: number;
  /** Container name to exec into; if absent, uses host-level curl */
  containerName?: string;
}

/**
 * Polls a health endpoint until it returns HTTP 2xx or the timeout is reached.
 * Returns true on success, false on timeout.
 */
export async function waitForHealthy(options: HealthCheckOptions): Promise<boolean> {
  const {
    url,
    timeoutSeconds = env.DEFAULT_HEALTH_CHECK_TIMEOUT,
    intervalMs = env.DEFAULT_HEALTH_CHECK_INTERVAL,
    containerName,
  } = options;

  const deadline = Date.now() + timeoutSeconds * 1000;
  let attempt = 0;

  logger.info({ url, timeoutSeconds }, 'Starting health check');

  while (Date.now() < deadline) {
    attempt++;
    try {
      const ok = containerName
        ? await checkViaExec(containerName, url)
        : await checkViaHost(url);

      if (ok) {
        logger.info({ url, attempt }, 'Health check passed');
        return true;
      }
    } catch (err) {
      logger.debug({ url, attempt, err }, 'Health check attempt failed');
    }

    await sleep(intervalMs);
  }

  logger.warn({ url, attempt }, 'Health check timed out');
  return false;
}

async function checkViaHost(url: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('curl', [
      '-sf',
      '--max-time', '5',
      '-o', '/dev/null',
      '-w', '%{http_code}',
      url,
    ]);
    const code = parseInt(stdout.trim(), 10);
    return code >= 200 && code < 300;
  } catch {
    return false;
  }
}

async function checkViaExec(containerName: string, url: string): Promise<boolean> {
  try {
    await execFileAsync('docker', [
      'exec', containerName,
      'curl', '-sf', '--max-time', '5', url,
    ]);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
