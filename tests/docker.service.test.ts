import { jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

// We test the pure functions that don't exec docker
import { getCurrentImage, updateComposeImage, projectExists } from '../src/workers/docker.service';

jest.mock('../src/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

jest.mock('../src/config/env', () => ({
  config: {
    projectsDir: '/tmp/test-projects',
    backupsDir: '/tmp/test-backups',
    defaultHealthCheckTimeout: 60,
    defaultHealthCheckInterval: 2000,
  },
}));

const TEST_PROJECTS_DIR = '/tmp/test-projects';

function createTestProject(name: string, composeContent: string): string {
  const dir = path.join(TEST_PROJECTS_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'docker-compose.yaml'), composeContent);
  return dir;
}

afterEach(() => {
  fs.rmSync(TEST_PROJECTS_DIR, { recursive: true, force: true });
});

describe('projectExists', () => {
  it('returns true when docker-compose.yaml exists', () => {
    createTestProject('my-app', 'services:\n  app:\n    image: ghcr.io/org/app:v1\n');
    expect(projectExists('my-app')).toBe(true);
  });

  it('returns false when project directory is absent', () => {
    expect(projectExists('nonexistent')).toBe(false);
  });

  it('returns false when directory exists but has no docker-compose.yaml', () => {
    fs.mkdirSync(path.join(TEST_PROJECTS_DIR, 'no-compose'), { recursive: true });
    expect(projectExists('no-compose')).toBe(false);
  });
});

describe('getCurrentImage', () => {
  it('returns the first image found in compose file', () => {
    createTestProject('my-app', 'services:\n  app:\n    image: ghcr.io/org/app:v1.2.3\n');
    expect(getCurrentImage('my-app')).toBe('ghcr.io/org/app:v1.2.3');
  });

  it('returns null when project does not exist', () => {
    expect(getCurrentImage('missing')).toBeNull();
  });
});

describe('updateComposeImage', () => {
  it('replaces the image tag for matching repository', () => {
    createTestProject(
      'my-app',
      'services:\n  app:\n    image: ghcr.io/org/app:v1.0.0\n',
    );

    updateComposeImage('my-app', 'ghcr.io/org/app:sha-newsha');

    const content = fs.readFileSync(
      path.join(TEST_PROJECTS_DIR, 'my-app', 'docker-compose.yaml'),
      'utf-8',
    );
    expect(content).toContain('image: ghcr.io/org/app:sha-newsha');
    expect(content).not.toContain('v1.0.0');
  });

  it('does not replace image with a different repository', () => {
    const original = 'services:\n  app:\n    image: ghcr.io/org/other-app:v1.0.0\n';
    createTestProject('my-app', original);

    updateComposeImage('my-app', 'ghcr.io/org/app:sha-newsha');

    const content = fs.readFileSync(
      path.join(TEST_PROJECTS_DIR, 'my-app', 'docker-compose.yaml'),
      'utf-8',
    );
    expect(content).toContain('ghcr.io/org/other-app:v1.0.0');
  });

  it('handles multiple services replacing only the matching one', () => {
    const compose = [
      'services:',
      '  app:',
      '    image: ghcr.io/org/app:v1',
      '  sidecar:',
      '    image: ghcr.io/org/sidecar:latest',
    ].join('\n');

    createTestProject('multi', compose);
    updateComposeImage('multi', 'ghcr.io/org/app:v2');

    const content = fs.readFileSync(
      path.join(TEST_PROJECTS_DIR, 'multi', 'docker-compose.yaml'),
      'utf-8',
    );
    expect(content).toContain('image: ghcr.io/org/app:v2');
    expect(content).toContain('image: ghcr.io/org/sidecar:latest');
  });
});
