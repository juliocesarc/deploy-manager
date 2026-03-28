import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../logger';
import { env } from '../env';

const execFileAsync = promisify(execFile);

interface ExecResult {
  stdout: string;
  stderr: string;
}

async function runCompose(
  projectDir: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<ExecResult> {
  const composeFile = join(projectDir, 'docker-compose.yaml');
  const fullArgs = ['-f', composeFile, ...args];

  logger.debug({ projectDir, args }, 'Running docker compose');

  const result = await execFileAsync('docker', ['compose', ...fullArgs], {
    env: { ...process.env, ...env },
    timeout: 10 * 60 * 1000, // 10 min hard limit
  });

  return result;
}

export function getProjectDir(project: string): string {
  return join(env.PROJECTS_DIR, project);
}

export function projectExists(project: string): boolean {
  const dir = getProjectDir(project);
  return existsSync(join(dir, 'docker-compose.yaml'));
}

/**
 * Reads the current image from docker-compose.yaml for the first service
 * that matches the new image name (same registry+repo prefix).
 */
export function getCurrentImage(project: string): string | null {
  const composePath = join(getProjectDir(project), 'docker-compose.yaml');
  try {
    const content = readFileSync(composePath, 'utf-8');
    const match = content.match(/image:\s*(\S+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Updates the `image:` field in docker-compose.yaml for the given project.
 * Replaces ALL image: lines that share the same repository (ignores tag).
 */
export function updateComposeImage(project: string, newImage: string): void {
  const composePath = join(getProjectDir(project), 'docker-compose.yaml');
  const content = readFileSync(composePath, 'utf-8');

  // Extract repo part (without tag): ghcr.io/user/repo
  const newRepo = newImage.split(':')[0];

  const updated = content.replace(
    /^(\s*image:\s*)(\S+)$/gm,
    (_, prefix, current: string) => {
      if (current.split(':')[0] === newRepo) {
        return `${prefix}${newImage}`;
      }
      return `${prefix}${current}`;
    },
  );

  writeFileSync(composePath, updated, 'utf-8');
}

export async function composePull(
  project: string,
  env?: NodeJS.ProcessEnv,
): Promise<ExecResult> {
  logger.info({ project }, 'Running docker compose pull');
  return runCompose(getProjectDir(project), ['pull'], env);
}

export async function composeUp(
  project: string,
  env?: NodeJS.ProcessEnv,
): Promise<ExecResult> {
  logger.info({ project }, 'Running docker compose up -d');
  return runCompose(getProjectDir(project), ['up', '-d', '--remove-orphans'], env);
}

export async function composeDown(
  project: string,
  env?: NodeJS.ProcessEnv,
): Promise<ExecResult> {
  logger.info({ project }, 'Running docker compose down');
  return runCompose(getProjectDir(project), ['down'], env);
}

export async function listProjects(): Promise<string[]> {
  const { readdirSync, statSync } = await import('fs');
  try {
    return readdirSync(env.PROJECTS_DIR).filter((name) => {
      const dir = join(env.PROJECTS_DIR, name);
      return (
        statSync(dir).isDirectory() &&
        existsSync(join(dir, 'docker-compose.yaml'))
      );
    });
  } catch {
    return [];
  }
}
