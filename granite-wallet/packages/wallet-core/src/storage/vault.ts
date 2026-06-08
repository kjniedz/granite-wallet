// ═══════════════════════════════════════════════════════════════════
// Granite Wallet — Vault Storage
// Encrypted seed phrase persistence using browser or Node storage
// © 2026 Black Mountain Investment Group LLC
//
// The vault stores encrypted seed phrases and unencrypted wallet
// metadata (addresses, names). Private keys are NEVER stored —
// they're derived on-the-fly from the decrypted seed phrase.
// ═══════════════════════════════════════════════════════════════════

import { encrypt, decrypt, verifyPassword } from '../crypto/encryption';
import { EncryptedVault, Wallet } from '../types';

const VAULT_STORAGE_KEY = 'granite_vault';
const VAULT_VERSION = 1;

/** Storage backend interface */
export interface StorageBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * Chrome Extension storage backend (chrome.storage.local).
 */
export class ChromeStorageBackend implements StorageBackend {
  async get(key: string): Promise<string | null> {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get([key], (result) => {
          resolve(result[key] || null);
        });
      } else {
        // Fallback to localStorage
        resolve(localStorage.getItem(key));
      }
    });
  }

  async set(key: string, value: string): Promise<void> {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ [key]: value }, resolve);
      } else {
        localStorage.setItem(key, value);
        resolve();
      }
    });
  }

  async remove(key: string): Promise<void> {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.remove([key], resolve);
      } else {
        localStorage.removeItem(key);
        resolve();
      }
    });
  }
}

/**
 * In-memory storage backend (for testing).
 */
export class MemoryStorageBackend implements StorageBackend {
  private store: Map<string, string> = new Map();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) || null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }
}

/**
 * Vault Manager — handles encrypted storage of seed phrases.
 *
 * Architecture:
 * - Seed phrases are encrypted with AES-256-GCM using the user's password
 * - Wallet metadata (addresses, names) is stored in plaintext
 * - Private keys are NEVER stored — derived from decrypted seed on demand
 * - The vault auto-locks after a configurable timeout
 */
export class VaultManager {
  private storage: StorageBackend;
  private decryptedSeeds: Map<string, string> | null = null; // walletId -> mnemonic
  private lockTimeout: ReturnType<typeof setTimeout> | null = null;
  private lockTimeoutMs: number;

  constructor(
    storage: StorageBackend = new ChromeStorageBackend(),
    lockTimeoutMs: number = 5 * 60 * 1000 // 5 minutes default
  ) {
    this.storage = storage;
    this.lockTimeoutMs = lockTimeoutMs;
  }

  /**
   * Check if a vault exists.
   */
  async hasVault(): Promise<boolean> {
    const raw = await this.storage.get(VAULT_STORAGE_KEY);
    return raw !== null;
  }

  /**
   * Check if the vault is currently unlocked.
   */
  isUnlocked(): boolean {
    return this.decryptedSeeds !== null;
  }

  /**
   * Create a new vault with an initial seed phrase.
   */
  async createVault(
    password: string,
    walletId: string,
    walletName: string,
    mnemonic: string,
    wallets: Wallet[]
  ): Promise<void> {
    // Encrypt the seed phrases
    const seedMap: Record<string, string> = { [walletId]: mnemonic };
    const { ciphertext, iv, salt, iterations } = await encrypt(
      JSON.stringify(seedMap),
      password
    );

    const vault: EncryptedVault = {
      version: VAULT_VERSION,
      ciphertext,
      iv,
      salt,
      iterations,
      wallets,
    };

    await this.storage.set(VAULT_STORAGE_KEY, JSON.stringify(vault));

    // Keep unlocked in memory
    this.decryptedSeeds = new Map([[walletId, mnemonic]]);
    this.resetLockTimer();
  }

  /**
   * Unlock the vault with a password.
   */
  async unlock(password: string): Promise<Wallet[]> {
    const raw = await this.storage.get(VAULT_STORAGE_KEY);
    if (!raw) throw new Error('No vault found. Please create a wallet first.');

    const vault: EncryptedVault = JSON.parse(raw);

    const decrypted = await decrypt(
      vault.ciphertext,
      vault.iv,
      vault.salt,
      password,
      vault.iterations
    );

    const seedMap: Record<string, string> = JSON.parse(decrypted);
    this.decryptedSeeds = new Map(Object.entries(seedMap));
    this.resetLockTimer();

    return vault.wallets;
  }

  /**
   * Lock the vault (clear decrypted seeds from memory).
   */
  lock(): void {
    if (this.decryptedSeeds) {
      // Attempt to clear sensitive data
      this.decryptedSeeds.forEach((seed, key) => {
        this.decryptedSeeds!.set(key, '');
      });
      this.decryptedSeeds = null;
    }
    if (this.lockTimeout) {
      clearTimeout(this.lockTimeout);
      this.lockTimeout = null;
    }
  }

  /**
   * Get a decrypted seed phrase for a wallet (must be unlocked).
   */
  getSeed(walletId: string): string {
    if (!this.decryptedSeeds) {
      throw new Error('Vault is locked. Please unlock first.');
    }
    const seed = this.decryptedSeeds.get(walletId);
    if (!seed) {
      throw new Error(`No seed found for wallet ${walletId}`);
    }
    return seed;
  }

  /**
   * Add a new wallet (seed phrase) to the vault.
   */
  async addWallet(
    password: string,
    walletId: string,
    mnemonic: string,
    wallet: Wallet
  ): Promise<void> {
    if (!this.decryptedSeeds) {
      throw new Error('Vault must be unlocked to add a wallet.');
    }

    // Add the new seed
    this.decryptedSeeds.set(walletId, mnemonic);

    // Re-encrypt everything
    const seedMap = Object.fromEntries(this.decryptedSeeds);
    const { ciphertext, iv, salt, iterations } = await encrypt(
      JSON.stringify(seedMap),
      password
    );

    // Load current vault for wallet metadata
    const raw = await this.storage.get(VAULT_STORAGE_KEY);
    const vault: EncryptedVault = raw ? JSON.parse(raw) : { version: VAULT_VERSION, wallets: [] };

    vault.ciphertext = ciphertext;
    vault.iv = iv;
    vault.salt = salt;
    vault.iterations = iterations;
    vault.wallets.push(wallet);

    await this.storage.set(VAULT_STORAGE_KEY, JSON.stringify(vault));
    this.resetLockTimer();
  }

  /**
   * Update wallet metadata (name, accounts) without re-encrypting seeds.
   */
  async updateWallets(wallets: Wallet[]): Promise<void> {
    const raw = await this.storage.get(VAULT_STORAGE_KEY);
    if (!raw) throw new Error('No vault found.');

    const vault: EncryptedVault = JSON.parse(raw);
    vault.wallets = wallets;

    await this.storage.set(VAULT_STORAGE_KEY, JSON.stringify(vault));
  }

  /**
   * Get wallet metadata (always available, even when locked).
   */
  async getWallets(): Promise<Wallet[]> {
    const raw = await this.storage.get(VAULT_STORAGE_KEY);
    if (!raw) return [];

    const vault: EncryptedVault = JSON.parse(raw);
    return vault.wallets;
  }

  /**
   * Change the vault password.
   */
  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    // Verify old password by unlocking
    await this.unlock(oldPassword);

    if (!this.decryptedSeeds) {
      throw new Error('Failed to unlock vault with old password.');
    }

    // Re-encrypt with new password
    const seedMap = Object.fromEntries(this.decryptedSeeds);
    const { ciphertext, iv, salt, iterations } = await encrypt(
      JSON.stringify(seedMap),
      newPassword
    );

    const raw = await this.storage.get(VAULT_STORAGE_KEY);
    const vault: EncryptedVault = JSON.parse(raw!);
    vault.ciphertext = ciphertext;
    vault.iv = iv;
    vault.salt = salt;
    vault.iterations = iterations;

    await this.storage.set(VAULT_STORAGE_KEY, JSON.stringify(vault));
  }

  /**
   * Wipe the entire vault. DESTRUCTIVE — cannot be undone.
   */
  async wipeVault(): Promise<void> {
    this.lock();
    await this.storage.remove(VAULT_STORAGE_KEY);
  }

  /**
   * Verify password without fully unlocking.
   */
  async verifyPassword(password: string): Promise<boolean> {
    const raw = await this.storage.get(VAULT_STORAGE_KEY);
    if (!raw) return false;

    const vault: EncryptedVault = JSON.parse(raw);
    return verifyPassword(
      vault.ciphertext,
      vault.iv,
      vault.salt,
      password,
      vault.iterations
    );
  }

  /** Reset the auto-lock timer */
  private resetLockTimer(): void {
    if (this.lockTimeout) clearTimeout(this.lockTimeout);
    this.lockTimeout = setTimeout(() => {
      this.lock();
    }, this.lockTimeoutMs);
  }
}
