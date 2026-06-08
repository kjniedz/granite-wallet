// ═══════════════════════════════════════════════════════════════════
// Granite Wallet — Chain Configurations
// © 2026 Black Mountain Investment Group LLC
// ═══════════════════════════════════════════════════════════════════

import { Chain, ChainConfig } from '../types';

/**
 * Default chain configurations.
 * RPC URLs use public endpoints — in production, replace with
 * Alchemy/Infura/QuickNode keys for reliability.
 */
export const CHAIN_CONFIGS: Record<Chain, ChainConfig> = {
  [Chain.ETHEREUM]: {
    chain: Chain.ETHEREUM,
    chainId: 1,
    name: 'Ethereum',
    symbol: 'ETH',
    decimals: 18,
    rpcUrl: 'https://eth.llamarpc.com',
    explorerUrl: 'https://etherscan.io',
    isTestnet: false,
    coinType: 60,
  },
  [Chain.POLYGON]: {
    chain: Chain.POLYGON,
    chainId: 137,
    name: 'Polygon',
    symbol: 'POL',
    decimals: 18,
    rpcUrl: 'https://polygon.llamarpc.com',
    explorerUrl: 'https://polygonscan.com',
    isTestnet: false,
    coinType: 60,
  },
  [Chain.BNB]: {
    chain: Chain.BNB,
    chainId: 56,
    name: 'BNB Chain',
    symbol: 'BNB',
    decimals: 18,
    rpcUrl: 'https://bsc-dataseed1.binance.org',
    explorerUrl: 'https://bscscan.com',
    isTestnet: false,
    coinType: 60,
  },
  [Chain.AVALANCHE]: {
    chain: Chain.AVALANCHE,
    chainId: 43114,
    name: 'Avalanche',
    symbol: 'AVAX',
    decimals: 18,
    rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
    explorerUrl: 'https://snowtrace.io',
    isTestnet: false,
    coinType: 60,
  },
  [Chain.ARBITRUM]: {
    chain: Chain.ARBITRUM,
    chainId: 42161,
    name: 'Arbitrum',
    symbol: 'ETH',
    decimals: 18,
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    explorerUrl: 'https://arbiscan.io',
    isTestnet: false,
    coinType: 60,
  },
  [Chain.OPTIMISM]: {
    chain: Chain.OPTIMISM,
    chainId: 10,
    name: 'Optimism',
    symbol: 'ETH',
    decimals: 18,
    rpcUrl: 'https://mainnet.optimism.io',
    explorerUrl: 'https://optimistic.etherscan.io',
    isTestnet: false,
    coinType: 60,
  },
  [Chain.BASE]: {
    chain: Chain.BASE,
    chainId: 8453,
    name: 'Base',
    symbol: 'ETH',
    decimals: 18,
    rpcUrl: 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
    isTestnet: false,
    coinType: 60,
  },
  [Chain.SOLANA]: {
    chain: Chain.SOLANA,
    chainId: 0, // Solana doesn't use EVM chain IDs
    name: 'Solana',
    symbol: 'SOL',
    decimals: 9,
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    explorerUrl: 'https://solscan.io',
    isTestnet: false,
    coinType: 501,
  },
  [Chain.BITCOIN]: {
    chain: Chain.BITCOIN,
    chainId: 0, // Bitcoin doesn't use EVM chain IDs
    name: 'Bitcoin',
    symbol: 'BTC',
    decimals: 8,
    rpcUrl: '', // Bitcoin uses different RPC (Blockstream, Mempool)
    explorerUrl: 'https://mempool.space',
    isTestnet: false,
    coinType: 0,
  },
};

/**
 * Get chain config by chain ID (EVM only).
 */
export function getChainByChainId(chainId: number): ChainConfig | undefined {
  return Object.values(CHAIN_CONFIGS).find((c) => c.chainId === chainId);
}

/**
 * Get all EVM-compatible chains.
 */
export function getEVMChains(): ChainConfig[] {
  return Object.values(CHAIN_CONFIGS).filter(
    (c) => c.chain !== Chain.SOLANA && c.chain !== Chain.BITCOIN
  );
}

/**
 * Default token lists per chain (native tokens + major stables/tokens).
 */
export const DEFAULT_TOKENS = {
  [Chain.ETHEREUM]: [
    { address: '', symbol: 'ETH', name: 'Ethereum', decimals: 18, coingeckoId: 'ethereum' },
    { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', name: 'Tether', decimals: 6, coingeckoId: 'tether' },
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USD Coin', decimals: 6, coingeckoId: 'usd-coin' },
    { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', name: 'Dai', decimals: 18, coingeckoId: 'dai' },
    { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', name: 'Wrapped Bitcoin', decimals: 8, coingeckoId: 'wrapped-bitcoin' },
    { address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', symbol: 'LINK', name: 'Chainlink', decimals: 18, coingeckoId: 'chainlink' },
    { address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', symbol: 'UNI', name: 'Uniswap', decimals: 18, coingeckoId: 'uniswap' },
  ],
  [Chain.POLYGON]: [
    { address: '', symbol: 'POL', name: 'Polygon', decimals: 18, coingeckoId: 'matic-network' },
    { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT', name: 'Tether', decimals: 6, coingeckoId: 'tether' },
    { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC', name: 'USD Coin', decimals: 6, coingeckoId: 'usd-coin' },
  ],
  [Chain.BNB]: [
    { address: '', symbol: 'BNB', name: 'BNB', decimals: 18, coingeckoId: 'binancecoin' },
    { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', name: 'Tether', decimals: 18, coingeckoId: 'tether' },
    { address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', symbol: 'BUSD', name: 'Binance USD', decimals: 18, coingeckoId: 'binance-usd' },
  ],
  [Chain.SOLANA]: [
    { address: '', symbol: 'SOL', name: 'Solana', decimals: 9, coingeckoId: 'solana' },
    { address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', symbol: 'USDT', name: 'Tether', decimals: 6, coingeckoId: 'tether' },
    { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6, coingeckoId: 'usd-coin' },
  ],
};
