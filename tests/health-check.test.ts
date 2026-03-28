import { waitForHealthy } from '../src/workers/health-check';
import { execFile } from 'child_process';

// Mock child_process.execFile
jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

const mockExecFile = execFile as unknown as jest.Mock;

// Also mock the logger to avoid noise
jest.mock('../src/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock config
jest.mock('../src/config/env', () => ({
  config: {
    defaultHealthCheckTimeout: 2,
    defaultHealthCheckInterval: 100,
  },
}));

function promisifiedExecFile(
  _file: string,
  _args: string[],
  _opts: unknown,
  callback: (err: Error | null, result: { stdout: string; stderr: string }) => void,
): void {
  callback(null, { stdout: '200', stderr: '' });
}

describe('waitForHealthy', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns true when curl returns 200', async () => {
    mockExecFile.mockImplementation(
      (_f: string, _a: string[], _o: unknown, cb: Function) =>
        cb(null, { stdout: '200', stderr: '' }),
    );

    const result = await waitForHealthy({
      url: 'http://localhost:3000/health',
      timeoutSeconds: 2,
      intervalMs: 50,
    });

    expect(result).toBe(true);
  });

  it('returns false when service never becomes healthy within timeout', async () => {
    mockExecFile.mockImplementation(
      (_f: string, _a: string[], _o: unknown, cb: Function) =>
        cb(new Error('connection refused'), { stdout: '', stderr: '' }),
    );

    const result = await waitForHealthy({
      url: 'http://localhost:9999/health',
      timeoutSeconds: 1,
      intervalMs: 200,
    });

    expect(result).toBe(false);
  });

  it('returns true on second attempt after initial failure', async () => {
    let calls = 0;
    mockExecFile.mockImplementation(
      (_f: string, _a: string[], _o: unknown, cb: Function) => {
        calls++;
        if (calls === 1) {
          cb(new Error('not ready'), null);
        } else {
          cb(null, { stdout: '200', stderr: '' });
        }
      },
    );

    const result = await waitForHealthy({
      url: 'http://localhost:3000/health',
      timeoutSeconds: 3,
      intervalMs: 50,
    });

    expect(result).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
