// ═══════════════════════════════════════════════════════════════════
// Granite Wallet — Vault Encryption (AES-256-GCM + PBKDF2)
// © 2026 Black Mountain Investment Group LLC
//
// All seed phrases are encrypted before storage using the user's
// password. We use PBKDF2 for key derivation and AES-256-GCM
// for authenticated encryption.
//
// Web Crypto only: browsers, extension service workers and Node 20+.
// ═══════════════════════════════════════════════════════════════════

/** Number of PBKDF2 iterations — higher = slower brute-force */
const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 32;
const IV_LENGTH = 12; // 96 bits for AES-GCM
const KEY_LENGTH = 256; // bits

/**
 * Web Crypto is available as globalThis.crypto in browsers, extension
 * service workers and Node 20+, so there is one code path.
 */
function getCrypto(): Crypto {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error('Web Crypto API not available. Granite Wallet needs a modern browser or Node 20+.');
  }
  return c;
}

/**
 * Derive an AES-256 key from a password using PBKDF2.
 */
async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS
): Promise<CryptoKey> {
  const { subtle } = getCrypto();

  const passwordKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    passwordKey,
    {
      name: 'AES-GCM',
      length: KEY_LENGTH,
    },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns { ciphertext, iv, salt, iterations } as hex strings.
 */
export async function encrypt(
  plaintext: string,
  password: string,
  iterations: number = PBKDF2_ITERATIONS
): Promise<{
  ciphertext: string;
  iv: string;
  salt: string;
  iterations: number;
}> {
  const { subtle } = getCrypto();

  const salt = getCrypto().getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = getCrypto().getRandomValues(new Uint8Array(IV_LENGTH));

  const key = await deriveKey(password, salt, iterations);

  const encoded = new TextEncoder().encode(plaintext);
  const ciphertextBuffer = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  return {
    ciphertext: bufferToHex(new Uint8Array(ciphertextBuffer)),
    iv: bufferToHex(iv),
    salt: bufferToHex(salt),
    iterations,
  };
}

/**
 * Decrypt AES-256-GCM ciphertext.
 * Throws if password is wrong or data is tampered with.
 */
export async function decrypt(
  ciphertextHex: string,
  ivHex: string,
  saltHex: string,
  password: string,
  iterations: number = PBKDF2_ITERATIONS
): Promise<string> {
  const { subtle } = getCrypto();

  const salt = hexToBuffer(saltHex);
  const iv = hexToBuffer(ivHex);
  const ciphertext = hexToBuffer(ciphertextHex);

  const key = await deriveKey(password, salt, iterations);

  try {
    const decrypted = await subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  } catch (error) {
    throw new Error('Decryption failed. Wrong password or corrupted vault.');
  }
}

/**
 * Verify a password against an existing vault without fully decrypting.
 * Returns true if the password is correct.
 */
export async function verifyPassword(
  ciphertextHex: string,
  ivHex: string,
  saltHex: string,
  password: string,
  iterations: number = PBKDF2_ITERATIONS
): Promise<boolean> {
  try {
    await decrypt(ciphertextHex, ivHex, saltHex, password, iterations);
    return true;
  } catch {
    return false;
  }
}

// ─── Hex Utilities ───

function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuffer(hex: string): Uint8Array {
  const bytes = hex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? [];
  return new Uint8Array(bytes);
}
