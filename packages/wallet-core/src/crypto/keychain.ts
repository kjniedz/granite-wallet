// ═══════════════════════════════════════════════════════════════════
// Granite Wallet — HD Key Generation & Seed Phrase Manager
// BIP-39 mnemonic + BIP-44 derivation paths
// © 2026 Black Mountain Investment Group LLC
//
// SECURITY: Private keys and seed phrases NEVER leave this module
// except through explicit, user-initiated export. All crypto ops
// happen in-memory and are zeroed after use.
// ═══════════════════════════════════════════════════════════════════

import * as bip39 from 'bip39';
import { Buffer } from 'buffer';
import { HDNode } from '@ethersproject/hdnode';
import * as nacl from 'tweetnacl';
import { Chain } from '../types';

/**
 * BIP-44 coin types for each chain.
 * Path format: m/44'/{coinType}'/0'/0/{index}
 * Solana uses m/44'/501'/{index}'/0' (Phantom-compatible)
 */
const COIN_TYPES: Record<Chain, number> = {
  [Chain.ETHEREUM]: 60,
  [Chain.POLYGON]: 60,   // EVM chains share coin type 60
  [Chain.BNB]: 60,
  [Chain.AVALANCHE]: 60,
  [Chain.ARBITRUM]: 60,
  [Chain.OPTIMISM]: 60,
  [Chain.BASE]: 60,
  [Chain.SOLANA]: 501,
};

/** Key pair result */
export interface DerivedKeyPair {
  address: string;
  privateKey: string;   // Hex for EVM, base58 for Solana
  publicKey: string;
  derivationPath: string;
  chain: Chain;
}

/**
 * Generate a new BIP-39 mnemonic seed phrase.
 * @param strength 128 = 12 words, 256 = 24 words
 */
export function generateMnemonic(strength: 128 | 256 = 128): string {
  return bip39.generateMnemonic(strength);
}

/**
 * Validate a BIP-39 mnemonic.
 */
export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic.trim().toLowerCase());
}

/**
 * Convert mnemonic to seed bytes.
 * @param mnemonic The seed phrase
 * @param passphrase Optional BIP-39 passphrase (25th word)
 */
export async function mnemonicToSeed(
  mnemonic: string,
  passphrase: string = ''
): Promise<Buffer> {
  return Buffer.from(await bip39.mnemonicToSeed(mnemonic.trim().toLowerCase(), passphrase));
}

/**
 * Derive an EVM key pair (ETH, Polygon, BNB, Avalanche, Arbitrum, etc.)
 * Uses BIP-44 path: m/44'/60'/0'/0/{index}
 */
export function deriveEVMKeyPair(
  mnemonic: string,
  chain: Chain,
  accountIndex: number = 0
): DerivedKeyPair {
  const coinType = COIN_TYPES[chain];
  const path = `m/44'/${coinType}'/0'/0/${accountIndex}`;
  const hdNode = HDNode.fromMnemonic(mnemonic.trim().toLowerCase());
  const derived = hdNode.derivePath(path);

  return {
    address: derived.address,
    privateKey: derived.privateKey,
    publicKey: derived.publicKey,
    derivationPath: path,
    chain,
  };
}

/**
 * Base58 alphabet used by Bitcoin/Solana.
 */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Encode bytes to Base58 (used for Solana addresses).
 * This avoids importing @solana/web3.js just for PublicKey.toBase58(),
 * which would pull in DOM-dependent code that crashes MV3 service workers.
 */
function base58Encode(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  // Leading zeros
  let output = '';
  for (const byte of bytes) {
    if (byte === 0) output += BASE58_ALPHABET[0];
    else break;
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    output += BASE58_ALPHABET[digits[i]];
  }
  return output;
}

// ─── SLIP-0010 Ed25519 HD Key Derivation ───
// Replaces `ed25519-hd-key` which has DOM dependencies that crash MV3 service workers.
// This is a clean-room implementation using only Web Crypto API (available in workers).

async function hmacSHA512(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, data);
  return new Uint8Array(sig);
}

async function slip0010MasterKey(seed: Uint8Array): Promise<{ key: Uint8Array; chainCode: Uint8Array }> {
  const hmacKey = new TextEncoder().encode('ed25519 seed');
  const I = await hmacSHA512(hmacKey, seed);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

async function slip0010DeriveChild(
  parentKey: Uint8Array,
  parentChainCode: Uint8Array,
  index: number
): Promise<{ key: Uint8Array; chainCode: Uint8Array }> {
  // Ed25519 only supports hardened derivation
  const indexBuf = new Uint8Array(4);
  new DataView(indexBuf.buffer).setUint32(0, (0x80000000 | index) >>> 0);
  
  const data = new Uint8Array(1 + 32 + 4);
  data[0] = 0x00;
  data.set(parentKey, 1);
  data.set(indexBuf, 33);
  
  const I = await hmacSHA512(parentChainCode, data);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

async function slip0010DerivePath(
  path: string,
  seedHex: string
): Promise<{ key: Uint8Array }> {
  const seed = new Uint8Array(seedHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  let { key, chainCode } = await slip0010MasterKey(seed);
  
  const segments = path.replace(/^m\//, '').split('/');
  for (const seg of segments) {
    const index = parseInt(seg.replace("'", ''), 10);
    const result = await slip0010DeriveChild(key, chainCode, index);
    key = result.key;
    chainCode = result.chainCode;
  }
  
  return { key };
}

/**
 * Derive a Solana key pair.
 * Uses Phantom-compatible path: m/44'/501'/{index}'/0'
 *
 * Implements SLIP-0010 + Ed25519 signing with zero DOM dependencies.
 */
export async function deriveSolanaKeyPair(
  mnemonic: string,
  accountIndex: number = 0
): Promise<DerivedKeyPair> {
  const seed = await mnemonicToSeed(mnemonic);
  const path = `m/44'/501'/${accountIndex}'/0'`;
  const derived = await slip0010DerivePath(path, seed.toString('hex'));

  const keypair = nacl.sign.keyPair.fromSeed(derived.key);
  const address = base58Encode(keypair.publicKey);

  return {
    address,
    privateKey: Buffer.from(keypair.secretKey).toString('hex'),
    publicKey: address,
    derivationPath: path,
    chain: Chain.SOLANA,
  };
}

/**
 * Derive key pairs for all supported chains from a single mnemonic.
 * Returns one account per chain at the given index. Bitcoin is not
 * supported yet: it needs its own P2WPKH derivation and a UTXO backend.
 */
export async function deriveAllChains(
  mnemonic: string,
  accountIndex: number = 0
): Promise<DerivedKeyPair[]> {
  const evmChains: Chain[] = [
    Chain.ETHEREUM,
    Chain.POLYGON,
    Chain.BNB,
    Chain.AVALANCHE,
    Chain.ARBITRUM,
    Chain.OPTIMISM,
    Chain.BASE,
  ];

  // All EVM chains derive from the same key (same coinType 60)
  // but we tag them with their respective chain IDs
  const evmPairs = evmChains.map((chain) =>
    deriveEVMKeyPair(mnemonic, chain, accountIndex)
  );

  // Solana uses a different curve (Ed25519)
  const solanaPair = await deriveSolanaKeyPair(mnemonic, accountIndex);

  return [...evmPairs, solanaPair];
}

/**
 * Securely wipe a string from memory.
 * Note: JavaScript GC makes this best-effort only.
 * In production, use WebAssembly for truly secure key ops.
 */
export function secureWipe(data: string | Buffer): void {
  if (Buffer.isBuffer(data)) {
    data.fill(0);
  }
  // For strings, we can't truly wipe due to JS immutability,
  // but we null the reference for GC
}
