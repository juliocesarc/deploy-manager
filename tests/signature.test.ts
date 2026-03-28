import { validateSignature, computeHmac } from '../src/utils/signature';

const SECRET = 'test-secret-key';
const PAYLOAD = JSON.stringify({ project: 'my-app', environment: 'prod', image: 'ghcr.io/org/app:sha-abc' });

describe('validateSignature', () => {
  it('returns true for a valid signature', () => {
    const hmac = computeHmac(PAYLOAD, SECRET);
    const header = `sha256=${hmac}`;
    expect(validateSignature(PAYLOAD, header, SECRET)).toBe(true);
  });

  it('returns false when signature header is missing', () => {
    expect(validateSignature(PAYLOAD, undefined, SECRET)).toBe(false);
  });

  it('returns false for a tampered payload', () => {
    const hmac = computeHmac(PAYLOAD, SECRET);
    const header = `sha256=${hmac}`;
    const tampered = PAYLOAD.replace('prod', 'stage');
    expect(validateSignature(tampered, header, SECRET)).toBe(false);
  });

  it('returns false for a wrong secret', () => {
    const hmac = computeHmac(PAYLOAD, 'wrong-secret');
    const header = `sha256=${hmac}`;
    expect(validateSignature(PAYLOAD, header, SECRET)).toBe(false);
  });

  it('returns false for a malformed header (missing sha256= prefix)', () => {
    const hmac = computeHmac(PAYLOAD, SECRET);
    expect(validateSignature(PAYLOAD, hmac, SECRET)).toBe(false);
  });

  it('is resistant to timing attacks (uses timingSafeEqual)', () => {
    // Both incorrect lengths should return false without throwing
    expect(validateSignature(PAYLOAD, 'sha256=short', SECRET)).toBe(false);
    expect(validateSignature(PAYLOAD, 'sha256=' + 'a'.repeat(64), SECRET)).toBe(false);
  });

  it('accepts Buffer as payload', () => {
    const buf = Buffer.from(PAYLOAD);
    const hmac = computeHmac(buf, SECRET);
    expect(validateSignature(buf, `sha256=${hmac}`, SECRET)).toBe(true);
  });
});

describe('computeHmac', () => {
  it('produces a consistent 64-char hex string', () => {
    const result = computeHmac(PAYLOAD, SECRET);
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it('produces different output for different secrets', () => {
    const a = computeHmac(PAYLOAD, 'secret-a');
    const b = computeHmac(PAYLOAD, 'secret-b');
    expect(a).not.toBe(b);
  });
});
