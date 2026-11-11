// ═══════════════════════════════════════════════════════════════════
// Granite Wallet — Vault Storage
// Encrypted seed phrase persistence using browser or Node storage
// © 2026 Black Mountain Investment Group LLC
//
// The vault stores encrypted seed phrases and unencrypted wallet
// metadata (addresses, names). Private keys are NEVER stored —
// they're derived on-the-fly from the decrypted seed phrase.
//
// Unlocked seeds live in a session backend (chrome.storage.session in
// the extension: memory only, cleared when the browser closes, never
// written to disk) so the wallet survives the service worker being
// put to sleep without asking for the password every 30 seconds.
// ═══════════════════════════════════════════════════════════════════

import { encrypt, decrypt, verifyPassword } from '../crypto/encryption';
import { EncryptedVault, Wallet } from '../types';

const VAULT_STORAGE_KEY = 'granite_vault';
const SESSION_KEY = 'granite_session';
const VAULT_VERSION = 1;

/** Storage backend interface */
export interface StorageBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

function hasChromeStorage(area: 'local' | 'session'): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage && !!(chrome.storage as any)[area];
}

/**
 * Chrome Extension storage backend (chrome.storage.local), with a
 * localStorage fallback for plain web pages.
 */
export class ChromeStorageBackend implements StorageBackend {
  async get(key: string): Promise<string | null> {
    if (hasChromeStorage('local')) {
      const result = await chrome.storage.local.get([key]);
      return result[key] ?? null;
    }
    return globalThis.localStorage?.getItem(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    if (hasChromeStorage('local')) {
      await chrome.storage.local.set({ [key]: value });
    } else {
      globalThis.localStorage?.setItem(key, value);
    }
  }

  async remove(key: string): Promise<void> {
    if (hasChromeStorage('local')) {
      await chrome.storage.local.remove([key]);
    } else {
      globalThis.localStorage?.removeItem(key);
    }
  }
}

/**
 * chrome.storage.session: in memory, trusted extension contexts only,
 * gone when the browser closes. Falls back to process memory elsewhere.
 */
export class ChromeSessionBackend implements StorageBackend {
  private fallback = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    if (hasChromeStorage('session')) {
      const result = await chrome.storage.session.get([key]);
      return result[key] ?? null;
    }
    return this.fallback.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    if (hasChromeStorage('session')) {
      await chrome.storage.session.set({ [key]: value });
    } else {
      this.fallback.set(key, value);
    }
  }

  async remove(key: string): Promise<void> {
    if (hasChromeStorage('session')) {
      await chrome.storage.session.remove([key]);
    } else {
      this.fallback.delete(key);
    }
  }
}

/**
 * In-memory storage backend (for testing).
 */
export class MemoryStorageBackend implements StorageBackend {
  private store: Map<string, string> = new Map();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }
}

interface SessionRecord {
  seeds: Record<string, string>;
  expiresAt: number;
}

/**
 * Vault Manager — handles encrypted storage of seed phrases.
 *
 * - Seed phrases are encrypted with AES-256-GCM using the user's password
 * - Wallet metadata (addresses, names) is stored in plaintext
 * - Private keys are NEVER stored — derived from decrypted seed on demand
 * - The unlocked state expires after lockTimeoutMs of inactivity
 */
export class VaultManager {
  private storage: StorageBackend;
  private session: StorageBackend;
  private decryptedSeeds: Map<string, string> | null = null; // walletId -> mnemonic
  private lockTimeout: ReturnType<typeof setTimeout> | null = null;
  private lockTimeoutMs: number;

  constructor(
    storage: StorageBackend = new ChromeStorageBackend(),
    session: StorageBackend = new ChromeSessionBackend(),
    lockTimeoutMs: number = 5 * 60 * 1000 // 5 minutes default
  ) {
    this.storage = storage;
    this.session = session;
    this.lockTimeoutMs = lockTimeoutMs;
  }

  /**
   * Restore an unlocked session left by a previous service worker
   * instance. Call once at startup. Expired sessions are discarded.
   */
  async restoreSession(): Promise<boolean> {
    const raw = await this.session.get(SESSION_KEY);
    if (!raw) return false;
    try {
      const record: SessionRecord = JSON.parse(raw);
      if (!record.seeds || record.expiresAt <= Date.now()) {
        await this.session.remove(SESSION_KEY);
        return false;
      }
      this.decryptedSeeds = new Map(Object.entries(record.seeds));
      this.resetLockTimer();
      return true;
    } catch {
      await this.session.remove(SESSION_KEY);
      return false;
    }
  }

  /** Extend the unlocked session after user activity. */
  async touch(): Promise<void> {
    if (this.decryptedSeeds) {
      this.resetLockTimer();
      await this.persistSession();
    }
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

    this.decryptedSeeds = new Map([[walletId, mnemonic]]);
    this.resetLockTimer();
    await this.persistSession();
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
    await this.persistSession();

    return vault.wallets;
  }

  /**
   * Lock the vault (clear decrypted seeds from memory and the session).
   */
  lock(): void {
    if (this.decryptedSeeds) {
      this.decryptedSeeds.forEach((_seed, key) => {
        this.decryptedSeeds!.set(key, '');
      });
      this.decryptedSeeds = null;
    }
    if (this.lockTimeout) {
      clearTimeout(this.lockTimeout);
      this.lockTimeout = null;
    }
    void this.session.remove(SESSION_KEY);
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
    // The password must be the vault's password, otherwise the vault
    // would be re-encrypted under a password the user never chose.
    if (!(await this.verifyPassword(password))) {
      throw new Error('Decryption failed. Wrong password or corrupted vault.');
    }
    if (!this.decryptedSeeds) {
      await this.unlock(password);
    }

    this.decryptedSeeds!.set(walletId, mnemonic);

    const seedMap = Object.fromEntries(this.decryptedSeeds!);
    const { ciphertext, iv, salt, iterations } = await encrypt(
      JSON.stringify(seedMap),
      password
    );

    const raw = await this.storage.get(VAULT_STORAGE_KEY);
    const vault: EncryptedVault = raw ? JSON.parse(raw) : { version: VAULT_VERSION, wallets: [] };

    vault.ciphertext = ciphertext;
    vault.iv = iv;
    vault.salt = salt;
    vault.iterations = iterations;
    vault.wallets.push(wallet);

    await this.storage.set(VAULT_STORAGE_KEY, JSON.stringify(vault));
    this.resetLockTimer();
    await this.persistSession();
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
    await this.unlock(oldPassword);

    if (!this.decryptedSeeds) {
      throw new Error('Failed to unlock vault with old password.');
    }

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
   * Verify password without changing the unlocked state.
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

  private async persistSession(): Promise<void> {
    if (!this.decryptedSeeds) return;
    const record: SessionRecord = {
      seeds: Object.fromEntries(this.decryptedSeeds),
      expiresAt: Date.now() + this.lockTimeoutMs,
    };
    await this.session.set(SESSION_KEY, JSON.stringify(record));
  }

  /** Reset the auto-lock timer */
  private resetLockTimer(): void {
    if (this.lockTimeout) clearTimeout(this.lockTimeout);
    this.lockTimeout = setTimeout(() => {
      this.lock();
    }, this.lockTimeoutMs);
    // Do not keep a Node process or a test alive for the timer.
    (this.lockTimeout as any)?.unref?.();
  }
}
