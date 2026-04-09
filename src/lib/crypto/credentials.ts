/**
 * Credentials Encryption Module
 *
 * Uses AES-256-CBC for encrypting sensitive credentials like API keys.
 * The encryption key should be set via CREDENTIALS_ENCRYPTION_KEY environment variable.
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.CREDENTIALS_ENCRYPTION_KEY ?? 'dev-key-change-in-production-32c';
  // Ensure key is exactly 32 bytes for AES-256
  return Buffer.from(key.padEnd(32, '0').slice(0, 32));
}

/**
 * Encrypt a plaintext string.
 * Returns format: iv:encryptedData (both hex encoded)
 */
export function encrypt(text: string): string {
  if (!text) return '';

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt an encrypted string.
 * Expects format: iv:encryptedData (both hex encoded)
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText?.includes(':')) return '';
  const parts = encryptedText.split(':');
  if (parts.length < 2 || !parts[0] || !parts[1]) return '';

  try {
    const [ivHex, encryptedHex] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);

    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
  } catch {
    // Return empty string on decryption failure
    return '';
  }
}

/**
 * Check if the encryption key is properly configured (not using default).
 */
export function isEncryptionConfigured(): boolean {
  const key = process.env.CREDENTIALS_ENCRYPTION_KEY;
  return Boolean(key && key.length >= 16);
}

/**
 * Mask a credential for display (show first and last 2 chars).
 */
export function maskCredential(credential: string): string {
  if (!credential || credential.length < 8) {
    return '****';
  }
  return `${credential.slice(0, 2)}${'*'.repeat(Math.min(8, credential.length - 4))}${credential.slice(-2)}`;
}
