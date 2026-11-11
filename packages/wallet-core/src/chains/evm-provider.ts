// ═══════════════════════════════════════════════════════════════════
// Granite Wallet — EVM Chain Provider
// Handles all EVM-compatible chain interactions
// © 2026 Black Mountain Investment Group LLC
// ═══════════════════════════════════════════════════════════════════

import { JsonRpcProvider, TransactionRequest, TransactionResponse } from '@ethersproject/providers';
import { Wallet as EthersWallet } from '@ethersproject/wallet';
import { parseUnits, formatUnits } from '@ethersproject/units';
import { Contract } from '@ethersproject/contracts';
import { BigNumber } from '@ethersproject/bignumber';
import { arrayify, isHexString } from '@ethersproject/bytes';
import { Chain, TokenBalance, GasEstimate, Token, TokenStandard, RawEvmTransaction } from '../types';
import { CHAIN_CONFIGS } from './config';

/** Minimal ERC-20 ABI for balance + transfer */
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
];

/**
 * EVM Chain Provider — manages RPC connections and on-chain operations
 * for all Ethereum-compatible networks.
 */
export class EVMProvider {
  private providers: Map<Chain, JsonRpcProvider> = new Map();

  /**
   * Get or create a JSON-RPC provider for a chain.
   */
  getProvider(chain: Chain): JsonRpcProvider {
    let provider = this.providers.get(chain);
    if (!provider) {
      const config = CHAIN_CONFIGS[chain];
      if (!config.rpcUrl) {
        throw new Error(`No RPC URL configured for ${chain}`);
      }
      provider = new JsonRpcProvider(config.rpcUrl, {
        chainId: config.chainId,
        name: config.name,
      });
      this.providers.set(chain, provider);
    }
    return provider;
  }

  /**
   * Fetch native token balance (ETH, MATIC, BNB, etc.)
   */
  async getNativeBalance(chain: Chain, address: string): Promise<TokenBalance> {
    const provider = this.getProvider(chain);
    const config = CHAIN_CONFIGS[chain];
    const balance = await provider.getBalance(address);

    const formatted = formatUnits(balance, config.decimals);

    return {
      token: {
        address: '',
        chain,
        symbol: config.symbol,
        name: config.name,
        decimals: config.decimals,
        standard: TokenStandard.NATIVE,
      },
      balance: balance.toString(),
      balanceFormatted: formatted,
      usdValue: 0, // Filled by price service
      usdPrice: 0,
    };
  }

  /**
   * Fetch ERC-20 token balance.
   */
  async getTokenBalance(
    chain: Chain,
    address: string,
    tokenAddress: string,
    tokenMeta?: Partial<Token>
  ): Promise<TokenBalance> {
    const provider = this.getProvider(chain);
    const contract = new Contract(tokenAddress, ERC20_ABI, provider);

    const [balance, decimals, symbol, name] = await Promise.all([
      contract.balanceOf(address) as Promise<any>,
      tokenMeta?.decimals ?? (contract.decimals() as Promise<number>),
      tokenMeta?.symbol ?? (contract.symbol() as Promise<string>),
      tokenMeta?.name ?? (contract.name() as Promise<string>),
    ]);

    const formatted = formatUnits(balance, decimals);

    return {
      token: {
        address: tokenAddress,
        chain,
        symbol,
        name,
        decimals,
        standard: TokenStandard.ERC20,
        ...tokenMeta,
      },
      balance: balance.toString(),
      balanceFormatted: formatted,
      usdValue: 0,
      usdPrice: 0,
    };
  }

  /**
   * Fetch all token balances for an address on a given chain.
   */
  async getAllBalances(
    chain: Chain,
    address: string,
    tokenList: Array<{ address: string; symbol: string; name: string; decimals: number }>
  ): Promise<TokenBalance[]> {
    const balances: TokenBalance[] = [];

    // Native balance
    try {
      const native = await this.getNativeBalance(chain, address);
      balances.push(native);
    } catch (err) {
      console.warn(`Failed to fetch native balance on ${chain}:`, err);
    }

    // ERC-20 balances (parallel with error handling)
    const tokenPromises = tokenList
      .filter((t) => t.address) // Skip native token entries
      .map(async (token) => {
        try {
          return await this.getTokenBalance(chain, address, token.address, {
            symbol: token.symbol,
            name: token.name,
            decimals: token.decimals,
          });
        } catch (err) {
          console.warn(`Failed to fetch ${token.symbol} balance:`, err);
          return null;
        }
      });

    const tokenBalances = await Promise.all(tokenPromises);
    balances.push(...tokenBalances.filter((b): b is TokenBalance => b !== null));

    return balances;
  }

  /**
   * Estimate gas for a transaction.
   */
  async estimateGas(chain: Chain, tx: TransactionRequest): Promise<GasEstimate> {
    const provider = this.getProvider(chain);

    const [gasLimit, feeData, block] = await Promise.all([
      provider.estimateGas(tx),
      provider.getFeeData(),
      provider.getBlock('latest'),
    ]);

    const baseFee = block.baseFeePerGas;
    const gasPriceGwei = feeData.gasPrice
      ? formatUnits(feeData.gasPrice, 'gwei')
      : '0';

    // EIP-1559 fee tiers
    const buildTier = (priorityGwei: string, waitSeconds: number) => ({
      maxFeePerGas: baseFee
        ? formatUnits(baseFee.add(parseUnits(priorityGwei, 'gwei')), 'gwei')
        : gasPriceGwei,
      maxPriorityFeePerGas: priorityGwei,
      estimatedSeconds: waitSeconds,
    });

    return {
      gasLimit: gasLimit.toString(),
      gasPrice: gasPriceGwei,
      slow: buildTier('1', 120),
      normal: buildTier('1.5', 30),
      fast: buildTier('3', 10),
      estimatedCostUsd: 0, // Filled by price service
    };
  }

  /**
   * Build and sign a native token transfer.
   */
  async sendNativeToken(
    chain: Chain,
    privateKey: string,
    to: string,
    amount: string, // Human-readable, e.g., "1.5"
    gasSettings?: {
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
      gasLimit?: string;
    }
  ): Promise<TransactionResponse> {
    const provider = this.getProvider(chain);
    const config = CHAIN_CONFIGS[chain];
    const wallet = new EthersWallet(privateKey, provider);

    const tx: TransactionRequest = {
      to,
      value: parseUnits(amount, config.decimals),
      chainId: config.chainId,
    };

    if (gasSettings?.gasLimit) {
      tx.gasLimit = gasSettings.gasLimit;
    }
    if (gasSettings?.maxFeePerGas) {
      tx.maxFeePerGas = parseUnits(gasSettings.maxFeePerGas, 'gwei');
      tx.maxPriorityFeePerGas = parseUnits(
        gasSettings.maxPriorityFeePerGas || '1.5',
        'gwei'
      );
    }

    return wallet.sendTransaction(tx);
  }

  /**
   * Build and sign an ERC-20 token transfer.
   */
  async sendToken(
    chain: Chain,
    privateKey: string,
    tokenAddress: string,
    to: string,
    amount: string,
    decimals: number,
    gasSettings?: {
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
      gasLimit?: string;
    }
  ): Promise<TransactionResponse> {
    const provider = this.getProvider(chain);
    const wallet = new EthersWallet(privateKey, provider);
    const contract = new Contract(tokenAddress, ERC20_ABI, wallet);

    const parsedAmount = parseUnits(amount, decimals);
    const overrides: any = {};
    if (gasSettings?.gasLimit) overrides.gasLimit = gasSettings.gasLimit;
    if (gasSettings?.maxFeePerGas) {
      overrides.maxFeePerGas = parseUnits(gasSettings.maxFeePerGas, 'gwei');
      overrides.maxPriorityFeePerGas = parseUnits(
        gasSettings.maxPriorityFeePerGas || '1.5',
        'gwei'
      );
    }

    return contract.transfer(to, parsedAmount, overrides);
  }

  /**
   * Approve a spender for ERC-20 tokens (needed before swaps).
   */
  async approveToken(
    chain: Chain,
    privateKey: string,
    tokenAddress: string,
    spender: string,
    amount: string = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' // Max approval
  ): Promise<TransactionResponse> {
    const provider = this.getProvider(chain);
    const wallet = new EthersWallet(privateKey, provider);
    const contract = new Contract(tokenAddress, ERC20_ABI, wallet);
    return contract.approve(spender, amount);
  }

  /**
   * Check token allowance.
   */
  async checkAllowance(
    chain: Chain,
    tokenAddress: string,
    owner: string,
    spender: string
  ): Promise<string> {
    const provider = this.getProvider(chain);
    const contract = new Contract(tokenAddress, ERC20_ABI, provider);
    const allowance = await contract.allowance(owner, spender);
    return allowance.toString();
  }

  /**
   * Get current block number.
   */
  async getBlockNumber(chain: Chain): Promise<number> {
    return this.getProvider(chain).getBlockNumber();
  }

  /**
   * Wait for a transaction to be confirmed.
   */
  async waitForTransaction(
    chain: Chain,
    txHash: string,
    confirmations: number = 1
  ): Promise<any> {
    return this.getProvider(chain).waitForTransaction(txHash, confirmations);
  }

  /**
   * Send a transaction exactly as a dApp requested it (eth_sendTransaction):
   * calldata and hex quantities pass through untouched, so contract calls
   * and token approvals work the way they do in any other wallet.
   */
  async sendRawTransaction(
    chain: Chain,
    privateKey: string,
    tx: RawEvmTransaction
  ): Promise<TransactionResponse> {
    const provider = this.getProvider(chain);
    const config = CHAIN_CONFIGS[chain];
    const wallet = new EthersWallet(privateKey, provider);

    const request: TransactionRequest = {
      to: tx.to,
      data: tx.data || '0x',
      value: tx.value ? BigNumber.from(tx.value) : BigNumber.from(0),
      chainId: config.chainId,
    };
    if (tx.gas) request.gasLimit = BigNumber.from(tx.gas);
    if (tx.maxFeePerGas) {
      request.maxFeePerGas = BigNumber.from(tx.maxFeePerGas);
      request.maxPriorityFeePerGas = BigNumber.from(tx.maxPriorityFeePerGas || tx.maxFeePerGas);
    } else if (tx.gasPrice) {
      request.gasPrice = BigNumber.from(tx.gasPrice);
    }

    return wallet.sendTransaction(request);
  }

  /**
   * Sign a message (personal_sign, EIP-191).
   * dApps send the message as hex-encoded bytes; signing the hex text
   * itself would produce a signature no site can verify, so hex is
   * decoded to bytes first. Plain strings are signed as UTF-8.
   */
  async signMessage(privateKey: string, message: string): Promise<string> {
    const wallet = new EthersWallet(privateKey);
    const payload = isHexString(message) ? arrayify(message) : message;
    return wallet.signMessage(payload);
  }

  /**
   * Sign typed data (EIP-712). The EIP712Domain type is implied by the
   * domain object and ethers rejects it when listed, so it is dropped.
   */
  async signTypedData(
    privateKey: string,
    domain: any,
    types: any,
    value: any
  ): Promise<string> {
    const wallet = new EthersWallet(privateKey);
    const { EIP712Domain: _domain, ...rest } = types || {};
    return (wallet as any)._signTypedData(domain, rest, value);
  }

  /**
   * Destroy all provider connections.
   */
  destroy(): void {
    this.providers.clear();
  }

  /**
   * Raw JSON-RPC proxy — forward any RPC call to the chain provider.
   * Used by the background worker to handle dApp requests we don't
   * need to intercept (eth_getBalance, eth_call, eth_blockNumber, etc.)
   */
  async sendRawRPC(chain: Chain, method: string, params: any[]): Promise<any> {
    const provider = this.getProvider(chain);
    return provider.send(method, params);
  }
}
