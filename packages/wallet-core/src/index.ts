// ═══════════════════════════════════════════════════════════════════
// @granite/wallet-core — Public API
// © 2026 Black Mountain Investment Group LLC
// ═══════════════════════════════════════════════════════════════════

// Main engine
export { GraniteWallet } from './engine';

// Types
export * from './types';

// Crypto utilities
export {
  generateMnemonic,
  validateMnemonic,
  deriveEVMKeyPair,
  deriveSolanaKeyPair,
  deriveAllChains,
} from './crypto/keychain';
export type { DerivedKeyPair } from './crypto/keychain';
export { encrypt, decrypt, verifyPassword } from './crypto/encryption';

// Chain providers & config
export { EVMProvider } from './chains/evm-provider';
export { SolanaProvider } from './chains/solana-provider';
export { PriceService } from './chains/price-service';
export { CHAIN_CONFIGS, DEFAULT_TOKENS, getChainByChainId, getEVMChains } from './chains/config';

// Storage
export { VaultManager, ChromeStorageBackend, ChromeSessionBackend, MemoryStorageBackend } from './storage/vault';
export type { StorageBackend } from './storage/vault';
