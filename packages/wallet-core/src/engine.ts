// ═══════════════════════════════════════════════════════════════════
// Granite Wallet Engine — Main Orchestrator
// © 2026 Black Mountain Investment Group LLC
//
// This is the primary API surface for the Granite Wallet. It
// coordinates between the keychain, vault, and chain providers
// to expose a clean, secure interface for wallet operations.
//
// SECURITY MODEL:
// - Seed phrases encrypted at rest (AES-256-GCM)
// - Private keys derived on-demand, never persisted
// - Auto-lock after configurable timeout
// - All signing happens in-memory
// ═══════════════════════════════════════════════════════════════════

import {
  Chain,
  Wallet,
  WalletAccount,
  WalletEvent,
  TokenBalance,
  GasEstimate,
  DAppSession,
  SendTransactionParams,
  RawEvmTransaction,
  Transaction,
  TxStatus,
  TxDirection,
} from './types';
import {
  generateMnemonic,
  validateMnemonic,
  deriveEVMKeyPair,
  deriveSolanaKeyPair,
  deriveAllChains,
  DerivedKeyPair,
} from './crypto/keychain';
import { VaultManager, StorageBackend, ChromeStorageBackend, ChromeSessionBackend } from './storage/vault';
import { EVMProvider } from './chains/evm-provider';
import { SolanaProvider } from './chains/solana-provider';
import { PriceService } from './chains/price-service';
import { CHAIN_CONFIGS, DEFAULT_TOKENS } from './chains/config';

type EventListener = (event: WalletEvent) => void;

const STATE_KEY = 'granite_state';
const MAX_HISTORY = 200;

/** Non-secret state that must outlive the service worker. */
interface PersistedState {
  activeChain: Chain;
  activeWalletId: string | null;
  connectedDApps: DAppSession[];
  txHistory: Transaction[];
}

/**
 * GraniteWallet — the main wallet engine.
 *
 * Usage:
 * ```ts
 * const wallet = new GraniteWallet();
 *
 * // Create new wallet
 * const mnemonic = await wallet.createWallet('MyPassword123', 'Main Wallet');
 *
 * // Or import existing
 * await wallet.importWallet('MyPassword123', 'Imported', 'word1 word2 ...');
 *
 * // Unlock
 * await wallet.unlock('MyPassword123');
 *
 * // Get balances
 * const balances = await wallet.getBalances('ethereum');
 *
 * // Send transaction
 * await wallet.sendTransaction({ chain: 'ethereum', from: '0x...', to: '0x...', value: '1.0' });
 * ```
 */
export class GraniteWallet {
  private vault: VaultManager;
  private storage: StorageBackend;
  private evmProvider: EVMProvider;
  private solanaProvider: SolanaProvider;
  private priceService: PriceService;
  private listeners: Set<EventListener> = new Set();
  private activeChain: Chain = Chain.ETHEREUM;
  private activeWalletId: string | null = null;
  private connectedDApps: Map<string, DAppSession> = new Map();
  private txHistory: Transaction[] = [];

  constructor(storage?: StorageBackend, session?: StorageBackend, lockTimeoutMs?: number) {
    this.storage = storage || new ChromeStorageBackend();
    this.vault = new VaultManager(
      this.storage,
      session || new ChromeSessionBackend(),
      lockTimeoutMs
    );
    this.evmProvider = new EVMProvider();
    this.solanaProvider = new SolanaProvider();
    this.priceService = new PriceService();
  }

  /**
   * Restore everything a previous service worker instance left behind:
   * the unlocked session, the active chain and wallet, dApp connections
   * and transaction history. Call once before handling any request.
   */
  async init(): Promise<void> {
    await this.vault.restoreSession();
    const raw = await this.storage.get(STATE_KEY);
    if (!raw) return;
    try {
      const state: Partial<PersistedState> = JSON.parse(raw);
      if (state.activeChain && CHAIN_CONFIGS[state.activeChain]) this.activeChain = state.activeChain;
      if (state.activeWalletId) this.activeWalletId = state.activeWalletId;
      this.connectedDApps = new Map((state.connectedDApps || []).map((d) => [d.origin, d]));
      this.txHistory = state.txHistory || [];
    } catch (err) {
      console.warn('Granite: could not read persisted state', err);
    }
  }

  /** Extend the unlocked session after user activity. */
  async touch(): Promise<void> {
    await this.vault.touch();
  }

  private async saveState(): Promise<void> {
    const state: PersistedState = {
      activeChain: this.activeChain,
      activeWalletId: this.activeWalletId,
      connectedDApps: Array.from(this.connectedDApps.values()),
      txHistory: this.txHistory.slice(0, MAX_HISTORY),
    };
    await this.storage.set(STATE_KEY, JSON.stringify(state));
  }

  // ─── Wallet Lifecycle ───

  /**
   * Create a new wallet with a fresh seed phrase.
   * Returns the mnemonic (display to user for backup, then discard).
   */
  async createWallet(
    password: string,
    name: string = 'Main Wallet',
    strength: 128 | 256 = 128
  ): Promise<{ mnemonic: string; wallet: Wallet }> {
    const mnemonic = generateMnemonic(strength);
    const walletId = generateId();

    // Derive initial accounts across all chains
    const keyPairs = await deriveAllChains(mnemonic, 0);
    const accounts = keyPairsToAccounts(keyPairs, 0);

    const wallet: Wallet = {
      id: walletId,
      name,
      accounts,
      createdAt: Date.now(),
    };

    await this.vault.createVault(password, walletId, name, mnemonic, [wallet]);
    this.activeWalletId = walletId;
    await this.saveState();

    this.emit({ type: 'unlock' });
    this.emit({ type: 'accountsChanged', accounts: accounts.map((a) => a.address) });

    return { mnemonic, wallet };
  }

  /**
   * Import a wallet from an existing seed phrase.
   */
  async importWallet(
    password: string,
    name: string,
    mnemonic: string
  ): Promise<Wallet> {
    if (!validateMnemonic(mnemonic)) {
      throw new Error('Invalid seed phrase. Please check your words and try again.');
    }

    const walletId = generateId();
    const keyPairs = await deriveAllChains(mnemonic, 0);
    const accounts = keyPairsToAccounts(keyPairs, 0);

    const wallet: Wallet = {
      id: walletId,
      name,
      accounts,
      createdAt: Date.now(),
    };

    const hasVault = await this.vault.hasVault();
    if (hasVault) {
      await this.vault.addWallet(password, walletId, mnemonic, wallet);
    } else {
      await this.vault.createVault(password, walletId, name, mnemonic, [wallet]);
    }

    this.activeWalletId = walletId;
    await this.saveState();
    this.emit({ type: 'unlock' });
    return wallet;
  }

  /**
   * Unlock the vault with the user's password.
   */
  async unlock(password: string): Promise<Wallet[]> {
    const wallets = await this.vault.unlock(password);
    if (wallets.length > 0 && !this.activeWalletId) {
      this.activeWalletId = wallets[0].id;
    }
    this.emit({ type: 'unlock' });
    return wallets;
  }

  /**
   * Lock the vault.
   */
  lock(): void {
    this.vault.lock();
    this.emit({ type: 'lock' });
  }

  /**
   * Check if a vault exists.
   */
  async hasVault(): Promise<boolean> {
    return this.vault.hasVault();
  }

  /**
   * Check if currently unlocked.
   */
  isUnlocked(): boolean {
    return this.vault.isUnlocked();
  }

  // ─── Account Management ───

  /**
   * Get all wallets.
   */
  async getWallets(): Promise<Wallet[]> {
    return this.vault.getWallets();
  }

  /**
   * Get the active wallet.
   */
  async getActiveWallet(): Promise<Wallet | null> {
    const wallets = await this.vault.getWallets();
    return wallets.find((w) => w.id === this.activeWalletId) || wallets[0] || null;
  }

  /**
   * Switch active wallet.
   */
  setActiveWallet(walletId: string): void {
    this.activeWalletId = walletId;
    void this.saveState();
  }

  /**
   * Reveal a wallet's seed phrase. The password is checked against the
   * vault every time, even while unlocked, so an open popup on a shared
   * screen cannot hand the phrase to whoever walks by.
   */
  async exportMnemonic(password: string, walletId?: string): Promise<string> {
    if (!(await this.vault.verifyPassword(password))) {
      throw new Error('Incorrect password.');
    }
    if (!this.vault.isUnlocked()) {
      await this.vault.unlock(password);
    }
    const id = walletId || this.activeWalletId || (await this.getActiveWallet())?.id;
    if (!id) throw new Error('No wallet to export.');
    return this.vault.getSeed(id);
  }

  /**
   * Get the address for a specific chain in the active wallet.
   */
  async getAddress(chain: Chain): Promise<string | null> {
    const wallet = await this.getActiveWallet();
    if (!wallet) return null;
    const account = wallet.accounts.find((a) => a.chain === chain);
    return account?.address || null;
  }

  /**
   * Get all addresses in the active wallet.
   */
  async getAddresses(): Promise<Record<Chain, string>> {
    const wallet = await this.getActiveWallet();
    if (!wallet) return {} as Record<Chain, string>;

    const addresses: Partial<Record<Chain, string>> = {};
    for (const account of wallet.accounts) {
      addresses[account.chain] = account.address;
    }
    return addresses as Record<Chain, string>;
  }

  /**
   * Derive a new account at the next index for a chain.
   */
  async deriveNextAccount(chain: Chain): Promise<WalletAccount> {
    if (!this.vault.isUnlocked() || !this.activeWalletId) {
      throw new Error('Wallet must be unlocked.');
    }

    const mnemonic = this.vault.getSeed(this.activeWalletId);
    const wallets = await this.vault.getWallets();
    const wallet = wallets.find((w) => w.id === this.activeWalletId)!;

    // Find the highest index for this chain
    const chainAccounts = wallet.accounts.filter((a) => a.chain === chain);
    const nextIndex = chainAccounts.length > 0
      ? Math.max(...chainAccounts.map((a) => a.index)) + 1
      : 0;

    let keyPair: DerivedKeyPair;
    if (chain === Chain.SOLANA) {
      keyPair = await deriveSolanaKeyPair(mnemonic, nextIndex);
    } else {
      keyPair = deriveEVMKeyPair(mnemonic, chain, nextIndex);
    }

    const account: WalletAccount = {
      id: generateId(),
      name: `Account ${nextIndex + 1}`,
      chain,
      address: keyPair.address,
      derivationPath: keyPair.derivationPath,
      index: nextIndex,
      createdAt: Date.now(),
    };

    wallet.accounts.push(account);
    await this.vault.updateWallets(wallets);

    return account;
  }

  // ─── Chain & Network ───

  /**
   * Get/set the active chain.
   */
  getActiveChain(): Chain {
    return this.activeChain;
  }

  setActiveChain(chain: Chain): void {
    const config = CHAIN_CONFIGS[chain];
    if (!config) throw new Error(`Unknown chain: ${chain}`);
    this.activeChain = chain;
    void this.saveState();
    this.emit({ type: 'chainChanged', chainId: config.chainId });
  }

  // ─── Balances ───

  /**
   * Fetch all token balances for the active wallet on a chain.
   * Enriched with USD prices.
   */
  async getBalances(chain?: Chain): Promise<TokenBalance[]> {
    const targetChain = chain || this.activeChain;
    const address = await this.getAddress(targetChain);
    if (!address) return [];

    let balances: TokenBalance[];

    if (targetChain === Chain.SOLANA) {
      
      const [nativeBalance, tokenBalances] = await Promise.all([
        this.solanaProvider.getBalance(address),
        this.solanaProvider.getTokenBalances(address),
      ]);
      balances = [nativeBalance, ...tokenBalances];
    } else {
      // EVM chain
      const tokenList = (DEFAULT_TOKENS as any)[targetChain] || [];
      balances = await this.evmProvider.getAllBalances(targetChain, address, tokenList);
    }

    // Enrich with USD prices
    return this.priceService.enrichBalances(balances);
  }

  /**
   * Fetch balances across ALL chains for the active wallet.
   */
  async getAllChainBalances(): Promise<Record<Chain, TokenBalance[]>> {
    const wallet = await this.getActiveWallet();
    if (!wallet) return {} as Record<Chain, TokenBalance[]>;

    const results: Partial<Record<Chain, TokenBalance[]>> = {};
    const chains = [...new Set(wallet.accounts.map((a) => a.chain))];

    const promises = chains.map(async (chain) => {
      try {
        results[chain] = await this.getBalances(chain);
      } catch (err) {
        console.warn(`Failed to fetch balances for ${chain}:`, err);
        results[chain] = [];
      }
    });

    await Promise.all(promises);
    return results as Record<Chain, TokenBalance[]>;
  }

  // ─── Transactions ───

  /**
   * Send a transaction (native or token transfer).
   */
  async sendTransaction(params: SendTransactionParams): Promise<string> {
    if (!this.vault.isUnlocked() || !this.activeWalletId) {
      throw new Error('Wallet must be unlocked to send transactions.');
    }

    const mnemonic = this.vault.getSeed(this.activeWalletId);
    const wallet = await this.getActiveWallet();
    if (!wallet) throw new Error('No active wallet.');

    // Find the account and derive its private key
    const account = wallet.accounts.find(
      (a) => a.chain === params.chain && a.address.toLowerCase() === params.from.toLowerCase()
    );
    if (!account) throw new Error(`No account found for ${params.from} on ${params.chain}`);

    let txHash: string;

    if (params.chain === Chain.SOLANA) {
      const keyPair = await deriveSolanaKeyPair(mnemonic, account.index);
      
      txHash = await this.solanaProvider.sendSOL(
        keyPair.privateKey,
        params.to,
        parseFloat(params.value)
      );
    } else {
      const keyPair = deriveEVMKeyPair(mnemonic, params.chain, account.index);

      if (params.token && params.token.address) {
        // ERC-20 transfer
        const response = await this.evmProvider.sendToken(
          params.chain,
          keyPair.privateKey,
          params.token.address,
          params.to,
          params.value,
          params.token.decimals,
          {
            maxFeePerGas: params.maxFeePerGas,
            maxPriorityFeePerGas: params.maxPriorityFeePerGas,
            gasLimit: params.gasLimit,
          }
        );
        txHash = response.hash;
      } else {
        // Native transfer
        const response = await this.evmProvider.sendNativeToken(
          params.chain,
          keyPair.privateKey,
          params.to,
          params.value,
          {
            maxFeePerGas: params.maxFeePerGas,
            maxPriorityFeePerGas: params.maxPriorityFeePerGas,
            gasLimit: params.gasLimit,
          }
        );
        txHash = response.hash;
      }
    }

    this.emit({ type: 'transactionSent', hash: txHash, chain: params.chain });

    await this.recordTransaction({
      hash: txHash,
      chain: params.chain,
      from: params.from,
      to: params.to,
      value: params.value,
      status: TxStatus.PENDING,
      direction: TxDirection.SENT,
      timestamp: Date.now(),
      token: params.token,
    });

    // Watch for confirmation in background
    this.watchTransaction(params.chain, txHash);

    return txHash;
  }

  /**
   * Send a transaction a dApp asked for through eth_sendTransaction,
   * with its calldata and hex quantities untouched. The caller has
   * already shown it to the user and received approval.
   */
  async sendDAppTransaction(tx: RawEvmTransaction): Promise<string> {
    if (!this.vault.isUnlocked() || !this.activeWalletId) {
      throw new Error('Wallet must be unlocked to send transactions.');
    }
    if (tx.chain === Chain.SOLANA) {
      throw new Error('eth_sendTransaction is not available on Solana.');
    }

    const mnemonic = this.vault.getSeed(this.activeWalletId);
    const wallet = await this.getActiveWallet();
    if (!wallet) throw new Error('No active wallet.');

    const account = wallet.accounts.find(
      (a) => a.chain === tx.chain && a.address.toLowerCase() === (tx.from || '').toLowerCase()
    );
    if (!account) throw new Error(`No account found for ${tx.from} on ${tx.chain}`);

    const keyPair = deriveEVMKeyPair(mnemonic, tx.chain, account.index);
    const response = await this.evmProvider.sendRawTransaction(tx.chain, keyPair.privateKey, tx);

    this.emit({ type: 'transactionSent', hash: response.hash, chain: tx.chain });
    await this.recordTransaction({
      hash: response.hash,
      chain: tx.chain,
      from: account.address,
      to: tx.to || '',
      value: tx.value || '0x0',
      status: TxStatus.PENDING,
      direction: tx.data && tx.data !== '0x' ? TxDirection.CONTRACT : TxDirection.SENT,
      timestamp: Date.now(),
    });
    this.watchTransaction(tx.chain, response.hash);

    return response.hash;
  }

  private async recordTransaction(tx: Transaction): Promise<void> {
    this.txHistory.unshift(tx);
    if (this.txHistory.length > MAX_HISTORY) this.txHistory.length = MAX_HISTORY;
    await this.saveState();
  }

  /**
   * Watch a transaction for confirmation and update history.
   */
  private async watchTransaction(chain: Chain, txHash: string): Promise<void> {
    try {
      if (chain === Chain.SOLANA) {
        // Poll Solana
        
        const maxAttempts = 60;
        for (let i = 0; i < maxAttempts; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const status = await this.solanaProvider.getTransactionStatus(txHash);
          if (status === 'confirmed') {
            this.updateTxStatus(txHash, TxStatus.CONFIRMED);
            this.emit({ type: 'transactionConfirmed', hash: txHash, chain });
            return;
          }
          if (status === 'failed') {
            this.updateTxStatus(txHash, TxStatus.FAILED);
            return;
          }
        }
      } else {
        // EVM: wait for receipt
        const receipt = await this.evmProvider.waitForTransaction(chain, txHash, 1);
        const status = receipt?.status === 1 ? TxStatus.CONFIRMED : TxStatus.FAILED;
        this.updateTxStatus(txHash, status);
        if (status === TxStatus.CONFIRMED) {
          this.emit({ type: 'transactionConfirmed', hash: txHash, chain });
        }
      }
    } catch (err) {
      console.warn(`Tx watch failed for ${txHash}:`, err);
    }
  }

  private updateTxStatus(hash: string, status: TxStatus): void {
    const tx = this.txHistory.find((t) => t.hash === hash);
    if (tx) {
      tx.status = status;
      void this.saveState();
    }
  }

  /**
   * Estimate gas for a transaction.
   */
  async estimateGas(params: SendTransactionParams): Promise<GasEstimate> {
    if (params.chain === Chain.SOLANA) {
      // Solana has a flat fee model
      return {
        gasLimit: '200000', // Compute units
        gasPrice: '0',
        slow: { maxFeePerGas: '0', maxPriorityFeePerGas: '0', estimatedSeconds: 30 },
        normal: { maxFeePerGas: '0', maxPriorityFeePerGas: '0', estimatedSeconds: 5 },
        fast: { maxFeePerGas: '0', maxPriorityFeePerGas: '0', estimatedSeconds: 1 },
        estimatedCostUsd: 0.001, // ~0.000005 SOL
      };
    }

    return this.evmProvider.estimateGas(params.chain, {
      from: params.from,
      to: params.to,
      value: params.value,
      data: params.data,
    });
  }

  // ─── Message Signing ───

  /**
   * Sign a message (personal_sign for EVM).
   */
  async signMessage(chain: Chain, address: string, message: string): Promise<string> {
    if (!this.vault.isUnlocked() || !this.activeWalletId) {
      throw new Error('Wallet must be unlocked.');
    }

    const mnemonic = this.vault.getSeed(this.activeWalletId);
    const wallet = await this.getActiveWallet();
    const account = wallet?.accounts.find(
      (a) => a.chain === chain && a.address.toLowerCase() === address.toLowerCase()
    );
    if (!account) throw new Error('Account not found.');

    const keyPair = deriveEVMKeyPair(mnemonic, chain, account.index);
    return this.evmProvider.signMessage(keyPair.privateKey, message);
  }

  /**
   * Sign typed data (EIP-712).
   */
  async signTypedData(
    chain: Chain,
    address: string,
    domain: any,
    types: any,
    value: any
  ): Promise<string> {
    if (!this.vault.isUnlocked() || !this.activeWalletId) {
      throw new Error('Wallet must be unlocked.');
    }

    const mnemonic = this.vault.getSeed(this.activeWalletId);
    const wallet = await this.getActiveWallet();
    const account = wallet?.accounts.find(
      (a) => a.chain === chain && a.address.toLowerCase() === address.toLowerCase()
    );
    if (!account) throw new Error('Account not found.');

    const keyPair = deriveEVMKeyPair(mnemonic, chain, account.index);
    return this.evmProvider.signTypedData(keyPair.privateKey, domain, types, value);
  }

  // ─── dApp Connections ───

  /**
   * Connect a dApp.
   */
  async connectDApp(origin: string, name: string, iconUrl?: string): Promise<DAppSession> {
    const address = await this.getAddress(this.activeChain);
    if (!address) throw new Error('No active account.');

    const session: DAppSession = {
      origin,
      name,
      iconUrl,
      connectedAt: Date.now(),
      accounts: [address],
      chainId: CHAIN_CONFIGS[this.activeChain].chainId,
    };

    this.connectedDApps.set(origin, session);
    await this.saveState();
    this.emit({ type: 'connect', chainId: session.chainId });
    return session;
  }

  /**
   * Disconnect a dApp.
   */
  async disconnectDApp(origin: string): Promise<void> {
    this.connectedDApps.delete(origin);
    await this.saveState();
    this.emit({ type: 'disconnect' });
  }

  /**
   * Get all connected dApps.
   */
  getConnectedDApps(): DAppSession[] {
    return Array.from(this.connectedDApps.values());
  }

  /**
   * Check if a dApp is connected.
   */
  isDAppConnected(origin: string): boolean {
    return this.connectedDApps.has(origin);
  }

  // ─── Prices ───

  /**
   * Get USD price for a token.
   */
  async getTokenPrice(symbol: string): Promise<number> {
    return this.priceService.getPrice(symbol);
  }

  /**
   * Get exchange rate between two tokens.
   */
  async getExchangeRate(fromSymbol: string, toSymbol: string): Promise<number> {
    return this.priceService.getExchangeRate(fromSymbol, toSymbol);
  }

  // ─── Validation ───

  /**
   * Validate an address for a given chain.
   */
  validateAddress(chain: Chain, address: string): { valid: boolean; error?: string } {
    if (!address || !address.trim()) {
      return { valid: false, error: 'Address is required' };
    }

    if (chain === Chain.SOLANA) {
      // Solana: base58 that decodes to 32 bytes
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) || !isSolanaPublicKey(address)) {
        return { valid: false, error: 'Invalid Solana address' };
      }
      return { valid: true };
    }

    // EVM: 0x + 40 hex chars
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return { valid: false, error: 'Invalid address. Must start with 0x followed by 40 hex characters.' };
    }
    return { valid: true };
  }

  // ─── Transaction History ───

  /**
   * Get transaction history for the active wallet.
   */
  getTransactionHistory(chain?: Chain, limit: number = 50): Transaction[] {
    let history = this.txHistory;
    if (chain) {
      history = history.filter((t) => t.chain === chain);
    }
    return history.slice(0, limit);
  }

  /**
   * Add an externally-created transaction to history (e.g., incoming).
   */
  addTransaction(tx: Transaction): void {
    void this.recordTransaction(tx);
  }

  // ─── RPC Proxy ───

  /**
   * Forward a raw JSON-RPC call to the active chain's provider.
   * Used by the background worker to handle dApp calls we don't intercept.
   */
  async sendRawRPC(method: string, params: any[], chain?: Chain): Promise<any> {
    const targetChain = chain || this.activeChain;
    if (targetChain === Chain.SOLANA) {
      throw new Error('Solana does not support EVM JSON-RPC methods.');
    }
    return this.evmProvider.sendRawRPC(targetChain, method, params);
  }

  /**
   * Get the EVM provider directly (for advanced usage).
   */
  getEVMProvider(): EVMProvider {
    return this.evmProvider;
  }

  // ─── Events ───

  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: WalletEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (err) {
        console.error('Event listener error:', err);
      }
    });
  }

  // ─── Cleanup ───

  destroy(): void {
    this.lock();
    this.evmProvider.destroy();
    this.listeners.clear();
    this.connectedDApps.clear();
  }
}

// ─── Helpers ───

function generateId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return 'gw_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function keyPairsToAccounts(keyPairs: DerivedKeyPair[], index: number): WalletAccount[] {
  return keyPairs.map((kp) => ({
    id: generateId(),
    name: `${CHAIN_CONFIGS[kp.chain].name} Account`,
    chain: kp.chain,
    address: kp.address,
    derivationPath: kp.derivationPath,
    index,
    createdAt: Date.now(),
  }));
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function isSolanaPublicKey(address: string): boolean {
  let n = 0n;
  for (const ch of address) {
    const v = BASE58.indexOf(ch);
    if (v < 0) return false;
    n = n * 58n + BigInt(v);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let leading = 0;
  for (const ch of address) {
    if (ch === '1') leading++;
    else break;
  }
  return leading + hex.length / 2 === 32;
}
