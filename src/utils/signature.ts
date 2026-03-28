import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Validates a GitHub-style HMAC-SHA256 webhook signature.
 * The header value must be in the format: sha256=<hex-digest>
 */
export function validateSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;

  const expected = `sha256=${computeHmac(rawBody, secret)}`;

  try {
    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    // Must be same length before timingSafeEqual
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function computeHmac(data: string | Buffer, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}
