// ═══════════════════════════════════════════════════════════════════
// Granite Wallet Core — Type Definitions
// © 2026 Black Mountain Investment Group LLC
// ═══════════════════════════════════════════════════════════════════

/** Supported blockchain networks */
export enum Chain {
  ETHEREUM = 'ethereum',
  POLYGON = 'polygon',
  BNB = 'bnb',
  AVALANCHE = 'avalanche',
  ARBITRUM = 'arbitrum',
  OPTIMISM = 'optimism',
  BASE = 'base',
  SOLANA = 'solana',
}

/** EVM-compatible chain config */
export interface EVMChainConfig {
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  rpcUrl: string;
  explorerUrl: string;
  isTestnet: boolean;
}

/** Full chain configuration */
export interface ChainConfig extends EVMChainConfig {
  chain: Chain;
  iconUrl?: string;
  /** BIP-44 coin type for HD derivation */
  coinType: number;
}

/** A single wallet account derived from seed */
export interface WalletAccount {
  /** Unique account ID */
  id: string;
  /** User-assigned label */
  name: string;
  /** Chain this account belongs to */
  chain: Chain;
  /** Public address */
  address: string;
  /** BIP-44 derivation path */
  derivationPath: string;
  /** Account index in derivation */
  index: number;
  /** Timestamp created */
  createdAt: number;
}

/** A wallet is a collection of accounts derived from one seed */
export interface Wallet {
  /** Unique wallet ID */
  id: string;
  /** User-assigned name (e.g., "Main Wallet", "HODL") */
  name: string;
  /** Accounts across all chains */
  accounts: WalletAccount[];
  /** Timestamp created */
  createdAt: number;
}

/** Token standard types */
export enum TokenStandard {
  NATIVE = 'native',
  ERC20 = 'erc20',
  SPL = 'spl',
  BEP20 = 'bep20',
}

/** Token metadata */
export interface Token {
  /** Contract address (empty string for native) */
  address: string;
  chain: Chain;
  symbol: string;
  name: string;
  decimals: number;
  standard: TokenStandard;
  iconUrl?: string;
  /** CoinGecko ID for pricing */
  coingeckoId?: string;
}

/** Token balance with USD value */
export interface TokenBalance {
  token: Token;
  balance: string; // Raw balance as string (wei, lamports, etc.)
  balanceFormatted: string; // Human-readable balance
  usdValue: number;
  usdPrice: number;
}

/** Transaction status */
export enum TxStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
}

/** Transaction direction */
export enum TxDirection {
  SENT = 'sent',
  RECEIVED = 'received',
  APPROVE = 'approve',
  CONTRACT = 'contract',
}

/** Transaction record */
export interface Transaction {
  hash: string;
  chain: Chain;
  from: string;
  to: string;
  value: string;
  gasUsed?: string;
  gasPrice?: string;
  fee?: string;
  status: TxStatus;
  direction: TxDirection;
  timestamp: number;
  token?: Token;
  blockNumber?: number;
}

/** Parameters for sending a transaction */
export interface SendTransactionParams {
  chain: Chain;
  from: string;
  to: string;
  value: string; // Amount in human-readable format (e.g., "1.5")
  token?: Token; // Omit for native token
  gasLimit?: string;
  gasPrice?: string; // For legacy
  maxFeePerGas?: string; // For EIP-1559
  maxPriorityFeePerGas?: string;
  data?: string; // Contract call data
}

/**
 * A transaction exactly as a dApp requested it through EIP-1193
 * eth_sendTransaction. Quantities are hex strings in wei / gas units,
 * which is what dApps send; nothing here is human-readable.
 */
export interface RawEvmTransaction {
  chain: Chain;
  from: string;
  to?: string;
  value?: string;
  data?: string;
  gas?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

/** Gas estimate */
export interface GasEstimate {
  /** Estimated gas units */
  gasLimit: string;
  /** Current gas price in gwei (legacy) */
  gasPrice: string;
  /** Slow/normal/fast prices for EIP-1559 */
  slow: { maxFeePerGas: string; maxPriorityFeePerGas: string; estimatedSeconds: number };
  normal: { maxFeePerGas: string; maxPriorityFeePerGas: string; estimatedSeconds: number };
  fast: { maxFeePerGas: string; maxPriorityFeePerGas: string; estimatedSeconds: number };
  /** Estimated cost in USD */
  estimatedCostUsd: number;
}

/** Connection request from a dApp */
export interface DAppConnectionRequest {
  origin: string;
  name: string;
  iconUrl?: string;
  chainId?: number;
}

/** Connected dApp session */
export interface DAppSession {
  origin: string;
  name: string;
  iconUrl?: string;
  connectedAt: number;
  accounts: string[]; // Addresses exposed to this dApp
  chainId: number;
}

/** Encrypted vault structure stored locally */
export interface EncryptedVault {
  /** Vault version for migration */
  version: number;
  /** AES-GCM encrypted seed phrases (JSON string) */
  ciphertext: string;
  /** AES-GCM initialization vector */
  iv: string;
  /** PBKDF2 salt */
  salt: string;
  /** PBKDF2 iterations */
  iterations: number;
  /** Wallet metadata (not encrypted) */
  wallets: Wallet[];
}

/** Events emitted by the wallet engine */
export type WalletEvent =
  | { type: 'accountsChanged'; accounts: string[] }
  | { type: 'chainChanged'; chainId: number }
  | { type: 'connect'; chainId: number }
  | { type: 'disconnect' }
  | { type: 'lock' }
  | { type: 'unlock' }
  | { type: 'transactionSent'; hash: string; chain: Chain }
  | { type: 'transactionConfirmed'; hash: string; chain: Chain };
