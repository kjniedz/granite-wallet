// ═══════════════════════════════════════════════════════════════════
// Granite Exchange — Swap Engine / DEX Aggregator
// © 2026 Black Mountain Investment Group LLC
//
// Aggregates quotes from multiple DEX protocols and finds the
// best execution route. All swaps are non-custodial — the user
// signs and broadcasts directly.
//
// Supported protocols:
// - Uniswap V3 (Ethereum, Polygon, Arbitrum, Base, Optimism)
// - PancakeSwap (BNB Chain)
// - SushiSwap (multi-chain)
// - Jupiter (Solana)
// - 1inch Aggregation Protocol
//
// Architecture:
// 1. Get quotes from all available DEXes for the pair
// 2. Score routes by: output amount, gas cost, price impact
// 3. Optionally split across DEXes for large trades
// 4. Return best route with encoded calldata
// 5. User signs → broadcast → confirm
// ═══════════════════════════════════════════════════════════════════

import { Chain, Token, SwapQuote, SwapRoute, SwapParams, TokenStandard } from '../types';
import { CHAIN_CONFIGS } from './config';
import { PriceService } from './price-service';

/** DEX protocol metadata */
interface DEXProtocol {
  id: string;
  name: string;
  chains: Chain[];
  /** Router contract address per chain */
  routers: Partial<Record<Chain, string>>;
}

/** Raw quote from a single DEX */
interface RawQuote {
  protocol: string;
  toAmount: string;
  priceImpact: number;
  gasEstimate: string;
  routeData: any; // Protocol-specific calldata
}

// ─── Known DEX Protocols ───

const PROTOCOLS: DEXProtocol[] = [
  {
    id: 'uniswap_v3',
    name: 'Uniswap V3',
    chains: [Chain.ETHEREUM, Chain.POLYGON, Chain.ARBITRUM, Chain.BASE, Chain.OPTIMISM],
    routers: {
      [Chain.ETHEREUM]: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      [Chain.POLYGON]: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      [Chain.ARBITRUM]: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      [Chain.BASE]: '0x2626664c2603336E57B271c5C0b26F421741e481',
      [Chain.OPTIMISM]: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    },
  },
  {
    id: 'sushiswap',
    name: 'SushiSwap',
    chains: [Chain.ETHEREUM, Chain.POLYGON, Chain.ARBITRUM, Chain.BNB, Chain.AVALANCHE],
    routers: {
      [Chain.ETHEREUM]: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
      [Chain.POLYGON]: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
      [Chain.ARBITRUM]: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
      [Chain.BNB]: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
      [Chain.AVALANCHE]: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    },
  },
  {
    id: 'pancakeswap',
    name: 'PancakeSwap',
    chains: [Chain.BNB, Chain.ETHEREUM],
    routers: {
      [Chain.BNB]: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
      [Chain.ETHEREUM]: '0xEfF92A263d31888d860bD50809A8D171709b7b1c',
    },
  },
  {
    id: 'jupiter',
    name: 'Jupiter',
    chains: [Chain.SOLANA],
    routers: {},
  },
];

/** Well-known wrapper token addresses (WETH, WBNB, etc.) */
const WRAPPED_NATIVE: Partial<Record<Chain, string>> = {
  [Chain.ETHEREUM]: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  [Chain.POLYGON]: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  [Chain.BNB]: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  [Chain.AVALANCHE]: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
  [Chain.ARBITRUM]: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  [Chain.BASE]: '0x4200000000000000000000000000000000000006',
  [Chain.OPTIMISM]: '0x4200000000000000000000000000000000000006',
};

/**
 * SwapEngine — core DEX aggregation logic.
 */
export class SwapEngine {
  private priceService: PriceService;

  constructor(priceService?: PriceService) {
    this.priceService = priceService || new PriceService();
  }

  /**
   * Get the best swap quote across all available DEXes.
   */
  async getQuote(params: SwapParams): Promise<SwapQuote> {
    const { chain, fromToken, toToken, amount, slippageBps, fromAddress } = params;

    // Validate
    if (!amount || parseFloat(amount) <= 0) {
      throw new Error('Invalid swap amount');
    }
    if (fromToken.symbol === toToken.symbol && fromToken.address === toToken.address) {
      throw new Error('Cannot swap a token for itself');
    }

    // Find available DEXes for this chain
    const availableProtocols = PROTOCOLS.filter((p) => p.chains.includes(chain));
    if (availableProtocols.length === 0) {
      throw new Error(`No DEX protocols available for ${CHAIN_CONFIGS[chain].name}`);
    }

    // Solana: route through Jupiter
    if (chain === Chain.SOLANA) {
      return this.getJupiterQuote(params);
    }

    // EVM: get quotes from all available DEXes
    const quotes = await this.getEVMQuotes(params, availableProtocols);

    if (quotes.length === 0) {
      throw new Error('No swap routes found. Try a different pair or amount.');
    }

    // Score and rank quotes (best output amount after gas)
    const scored = quotes
      .map((q) => ({
        ...q,
        score: parseFloat(q.toAmount) - parseFloat(q.gasEstimate) * 0.001,
      }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];

    // Get price for fee estimation
    const nativePrice = await this.priceService.getPrice(CHAIN_CONFIGS[chain].symbol);

    // Build the swap quote
    const exchangeRate = (parseFloat(best.toAmount) / parseFloat(amount)).toString();

    return {
      fromToken,
      toToken,
      fromAmount: amount,
      toAmount: best.toAmount,
      exchangeRate,
      priceImpact: best.priceImpact,
      route: [
        {
          protocol: best.protocol,
          fromToken: fromToken.symbol,
          toToken: toToken.symbol,
          portion: 100,
        },
      ],
      estimatedGas: best.gasEstimate,
      estimatedFeeUsd: parseFloat(best.gasEstimate) * nativePrice * 1e-9, // gwei to ETH to USD
      expiresIn: 30_000, // 30 seconds
    };
  }

  /**
   * Get quotes from EVM DEXes.
   * In production, these would call on-chain quoter contracts or API endpoints.
   * For now we simulate realistic quotes based on market prices.
   */
  private async getEVMQuotes(
    params: SwapParams,
    protocols: DEXProtocol[]
  ): Promise<RawQuote[]> {
    const { fromToken, toToken, amount, chain } = params;

    // Get market exchange rate
    const rate = await this.priceService.getExchangeRate(fromToken.symbol, toToken.symbol);
    if (!rate) return [];

    const fromAmount = parseFloat(amount);
    const baseToAmount = fromAmount * rate;

    // Generate realistic quotes with slight variations per DEX
    const quotes: RawQuote[] = [];

    for (const protocol of protocols) {
      if (!protocol.chains.includes(chain)) continue;

      // Each DEX has slightly different pricing due to liquidity depth
      const spreadFactor = 0.997 + Math.random() * 0.004; // 0.3% - 0.7% spread
      const toAmount = (baseToAmount * spreadFactor).toFixed(toToken.decimals > 6 ? 8 : 6);

      // Price impact scales with trade size relative to typical pool liquidity
      const priceImpact = Math.min(fromAmount * 0.00001, 5); // Cap at 5%

      // Gas estimates vary by protocol complexity
      const gasEstimates: Record<string, string> = {
        uniswap_v3: '150000',
        sushiswap: '180000',
        pancakeswap: '160000',
      };

      quotes.push({
        protocol: protocol.id,
        toAmount,
        priceImpact: Math.round(priceImpact * 100) / 100,
        gasEstimate: gasEstimates[protocol.id] || '200000',
        routeData: {
          router: protocol.routers[chain],
          path: this.buildSwapPath(fromToken, toToken, chain),
          deadline: Math.floor(Date.now() / 1000) + 1200, // 20 minutes
        },
      });
    }

    return quotes;
  }

  /**
   * Get a quote from Jupiter (Solana's DEX aggregator).
   */
  private async getJupiterQuote(params: SwapParams): Promise<SwapQuote> {
    const { fromToken, toToken, amount } = params;

    // In production: call Jupiter API
    // const response = await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${fromToken.address}&outputMint=${toToken.address}&amount=${lamports}`);

    const rate = await this.priceService.getExchangeRate(fromToken.symbol, toToken.symbol);
    const fromAmount = parseFloat(amount);
    const toAmount = (fromAmount * rate * 0.998).toFixed(6); // 0.2% spread

    return {
      fromToken,
      toToken,
      fromAmount: amount,
      toAmount,
      exchangeRate: (parseFloat(toAmount) / fromAmount).toString(),
      priceImpact: 0.1,
      route: [
        {
          protocol: 'jupiter',
          fromToken: fromToken.symbol,
          toToken: toToken.symbol,
          portion: 100,
        },
      ],
      estimatedGas: '5000', // Compute units
      estimatedFeeUsd: 0.001,
      expiresIn: 30_000,
    };
  }

  /**
   * Execute a swap (build + return unsigned transaction data).
   * The calling code handles signing and broadcasting.
   */
  async buildSwapTransaction(
    params: SwapParams,
    quote: SwapQuote
  ): Promise<{
    to: string;
    data: string;
    value: string;
    gasLimit: string;
  }> {
    const { chain, fromToken, slippageBps } = params;
    const route = quote.route[0];

    if (!route) throw new Error('No route in quote');

    const protocol = PROTOCOLS.find((p) => p.id === route.protocol);
    if (!protocol) throw new Error(`Unknown protocol: ${route.protocol}`);

    const router = protocol.routers[chain];
    if (!router) throw new Error(`No router for ${route.protocol} on ${chain}`);

    // Calculate minimum output with slippage
    const minOutput = parseFloat(quote.toAmount) * (1 - slippageBps / 10000);

    // Build swap calldata
    // In production, this encodes the actual contract call (Uniswap exactInputSingle, etc.)
    const isNativeIn = !fromToken.address || fromToken.standard === TokenStandard.NATIVE;

    return {
      to: router,
      data: this.encodeSwapCalldata(params, quote, minOutput),
      value: isNativeIn ? this.toWei(params.amount, fromToken.decimals) : '0',
      gasLimit: quote.estimatedGas,
    };
  }

  /**
   * Get available trading pairs for a chain.
   */
  getAvailableProtocols(chain: Chain): DEXProtocol[] {
    return PROTOCOLS.filter((p) => p.chains.includes(chain));
  }

  /**
   * Check if a swap pair is supported.
   */
  isPairSupported(chain: Chain, fromSymbol: string, toSymbol: string): boolean {
    // All token pairs are theoretically supported via routing
    // through wrapped native intermediary
    return PROTOCOLS.some((p) => p.chains.includes(chain));
  }

  /**
   * Get the wrapped native token address for a chain.
   */
  getWrappedNative(chain: Chain): string | undefined {
    return WRAPPED_NATIVE[chain];
  }

  // ─── Internal Helpers ───

  private buildSwapPath(fromToken: Token, toToken: Token, chain: Chain): string[] {
    const fromAddr = fromToken.address || WRAPPED_NATIVE[chain] || '';
    const toAddr = toToken.address || WRAPPED_NATIVE[chain] || '';

    // Direct pair
    if (fromAddr && toAddr) {
      return [fromAddr, toAddr];
    }
    return [];
  }

  private encodeSwapCalldata(
    params: SwapParams,
    quote: SwapQuote,
    minOutput: number
  ): string {
    // In production, use ethers.js Contract interface to encode:
    // - Uniswap V3: ISwapRouter.exactInputSingle()
    // - Uniswap V2/Sushi: swapExactTokensForTokens()
    // - PancakeSwap: swapExactTokensForTokens()
    //
    // For now, return a placeholder that the approval modal will display
    const route = quote.route[0];
    return JSON.stringify({
      protocol: route.protocol,
      from: params.fromToken.symbol,
      to: params.toToken.symbol,
      amountIn: params.amount,
      minAmountOut: minOutput.toString(),
      deadline: Math.floor(Date.now() / 1000) + 1200,
    });
  }

  private toWei(amount: string, decimals: number): string {
    const parts = amount.split('.');
    const whole = parts[0] || '0';
    let fraction = (parts[1] || '').slice(0, decimals).padEnd(decimals, '0');
    return BigInt(whole + fraction).toString();
  }
}
