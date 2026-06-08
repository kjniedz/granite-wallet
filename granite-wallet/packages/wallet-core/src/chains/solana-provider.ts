// ═══════════════════════════════════════════════════════════════════
// Granite Wallet — Solana Chain Provider
// © 2026 Black Mountain Investment Group LLC
// ═══════════════════════════════════════════════════════════════════

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  Keypair,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  clusterApiUrl,
} from '@solana/web3.js';
import { Buffer } from 'buffer';
import { Chain, TokenBalance, TokenStandard } from '../types';
import { CHAIN_CONFIGS } from './config';

/**
 * Solana provider for native SOL and SPL token operations.
 */
export class SolanaProvider {
  private connection: Connection;

  constructor(rpcUrl?: string) {
    this.connection = new Connection(
      rpcUrl || CHAIN_CONFIGS[Chain.SOLANA].rpcUrl || clusterApiUrl('mainnet-beta'),
      'confirmed'
    );
  }

  /**
   * Get the underlying Solana Connection instance.
   */
  getConnection(): Connection {
    return this.connection;
  }

  /**
   * Fetch native SOL balance.
   */
  async getBalance(address: string): Promise<TokenBalance> {
    const pubkey = new PublicKey(address);
    const lamports = await this.connection.getBalance(pubkey);

    const balance = lamports / LAMPORTS_PER_SOL;

    return {
      token: {
        address: '',
        chain: Chain.SOLANA,
        symbol: 'SOL',
        name: 'Solana',
        decimals: 9,
        standard: TokenStandard.NATIVE,
      },
      balance: lamports.toString(),
      balanceFormatted: balance.toFixed(9),
      usdValue: 0,
      usdPrice: 0,
    };
  }

  /**
   * Fetch all SPL token balances for an address.
   * Uses getTokenAccountsByOwner to find all token accounts.
   */
  async getTokenBalances(address: string): Promise<TokenBalance[]> {
    const pubkey = new PublicKey(address);

    try {
      // Fetch all token accounts owned by this address
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        pubkey,
        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
      );

      return tokenAccounts.value.map((account) => {
        const parsed = account.account.data.parsed.info;
        const mint = parsed.mint;
        const decimals = parsed.tokenAmount.decimals;
        const balance = parsed.tokenAmount.amount;
        const formatted = parsed.tokenAmount.uiAmountString || '0';

        return {
          token: {
            address: mint,
            chain: Chain.SOLANA,
            symbol: '', // Resolved via token list
            name: '',
            decimals,
            standard: TokenStandard.SPL,
          },
          balance,
          balanceFormatted: formatted,
          usdValue: 0,
          usdPrice: 0,
        };
      });
    } catch (err) {
      console.warn('Failed to fetch SPL token balances:', err);
      return [];
    }
  }

  /**
   * Send native SOL.
   */
  async sendSOL(
    fromPrivateKey: string, // Hex-encoded secret key
    toAddress: string,
    amount: number // In SOL (e.g., 1.5)
  ): Promise<string> {
    const secretKey = Uint8Array.from(Buffer.from(fromPrivateKey, 'hex'));
    const fromKeypair = Keypair.fromSecretKey(secretKey);
    const toPubkey = new PublicKey(toAddress);

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fromKeypair.publicKey,
        toPubkey,
        lamports: Math.round(amount * LAMPORTS_PER_SOL),
      })
    );

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [fromKeypair]
    );

    return signature;
  }

  /**
   * Get recent blockhash (needed for transaction construction).
   */
  async getRecentBlockhash(): Promise<string> {
    const { blockhash } = await this.connection.getLatestBlockhash();
    return blockhash;
  }

  /**
   * Estimate transaction fee.
   */
  async estimateFee(transaction: Transaction): Promise<number> {
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;

    const fee = await this.connection.getFeeForMessage(
      transaction.compileMessage()
    );
    return fee.value || 5000; // Default 5000 lamports
  }

  /**
   * Get transaction status.
   */
  async getTransactionStatus(signature: string): Promise<'confirmed' | 'failed' | 'pending'> {
    const status = await this.connection.getSignatureStatus(signature);
    if (!status.value) return 'pending';
    if (status.value.err) return 'failed';
    if (status.value.confirmationStatus === 'confirmed' || status.value.confirmationStatus === 'finalized') {
      return 'confirmed';
    }
    return 'pending';
  }

  /**
   * Get SOL price estimate using recent slot performance.
   */
  async getSlot(): Promise<number> {
    return this.connection.getSlot();
  }
}
