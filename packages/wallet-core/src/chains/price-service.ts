// ═══════════════════════════════════════════════════════════════════
// Granite Wallet — Price Service
// Fetches token prices from CoinGecko (free, no API key required)
// © 2026 Black Mountain Investment Group LLC
// ═══════════════════════════════════════════════════════════════════

import { TokenBalance } from '../types';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

/** Price cache to avoid hammering the API */
interface PriceCache {
  prices: Record<string, number>;
  timestamp: number;
}

const CACHE_TTL_MS = 60_000; // 1 minute

export class PriceService {
  private cache: PriceCache | null = null;

  /**
   * Default CoinGecko IDs for our supported tokens.
   */
  private static readonly TOKEN_IDS: Record<string, string> = {
    ETH: 'ethereum',
    BTC: 'bitcoin',
    SOL: 'solana',
    BNB: 'binancecoin',
    POL: 'matic-network',
    MATIC: 'matic-network',
    AVAX: 'avalanche-2',
    USDT: 'tether',
    USDC: 'usd-coin',
    DAI: 'dai',
    WBTC: 'wrapped-bitcoin',
    LINK: 'chainlink',
    UNI: 'uniswap',
    BUSD: 'binance-usd',
    ARB: 'arbitrum',
    OP: 'optimism',
  };

  /**
   * Fetch USD prices for a list of token symbols.
   */
  async getPrices(symbols: string[]): Promise<Record<string, number>> {
    // Check cache
    if (this.cache && Date.now() - this.cache.timestamp < CACHE_TTL_MS) {
      const cached: Record<string, number> = {};
      let allCached = true;
      for (const sym of symbols) {
        const key = sym.toUpperCase();
        if (this.cache.prices[key] !== undefined) {
          cached[key] = this.cache.prices[key];
        } else {
          allCached = false;
        }
      }
      if (allCached) return cached;
    }

    // Map symbols to CoinGecko IDs
    const idMap: Record<string, string> = {};
    for (const sym of symbols) {
      const upper = sym.toUpperCase();
      const geckoId = PriceService.TOKEN_IDS[upper];
      if (geckoId) idMap[upper] = geckoId;
    }

    const geckoIds = [...new Set(Object.values(idMap))];
    if (geckoIds.length === 0) return {};

    try {
      const url = `${COINGECKO_BASE}/simple/price?ids=${geckoIds.join(',')}&vs_currencies=usd`;
      const response = await fetch(url);

      if (!response.ok) {
        console.warn(`CoinGecko API error: ${response.status}`);
        return this.cache?.prices || {};
      }

      const data = await response.json();

      // Map back to symbols
      const prices: Record<string, number> = {};
      for (const [symbol, geckoId] of Object.entries(idMap)) {
        if (data[geckoId]?.usd) {
          prices[symbol] = data[geckoId].usd;
        }
      }

      // Stablecoins fallback
      for (const stable of ['USDT', 'USDC', 'DAI', 'BUSD']) {
        if (symbols.includes(stable) && !prices[stable]) {
          prices[stable] = 1.0;
        }
      }

      // Update cache
      this.cache = {
        prices: { ...(this.cache?.prices || {}), ...prices },
        timestamp: Date.now(),
      };

      return prices;
    } catch (err) {
      console.warn('Price fetch failed:', err);
      return this.cache?.prices || {};
    }
  }

  /**
   * Get a single token price.
   */
  async getPrice(symbol: string): Promise<number> {
    const prices = await this.getPrices([symbol]);
    return prices[symbol.toUpperCase()] || 0;
  }

  /**
   * Enrich token balances with USD values.
   */
  async enrichBalances(balances: TokenBalance[]): Promise<TokenBalance[]> {
    const symbols = balances.map((b) => b.token.symbol).filter(Boolean);
    const prices = await this.getPrices(symbols);

    return balances.map((b) => {
      const price = prices[b.token.symbol.toUpperCase()] || 0;
      const balanceNum = parseFloat(b.balanceFormatted) || 0;
      return {
        ...b,
        usdPrice: price,
        usdValue: balanceNum * price,
      };
    });
  }

  /**
   * Get exchange rate between two tokens.
   */
  async getExchangeRate(fromSymbol: string, toSymbol: string): Promise<number> {
    const prices = await this.getPrices([fromSymbol, toSymbol]);
    const fromPrice = prices[fromSymbol.toUpperCase()];
    const toPrice = prices[toSymbol.toUpperCase()];
    if (!fromPrice || !toPrice) return 0;
    return fromPrice / toPrice;
  }

  /**
   * Clear the price cache.
   */
  clearCache(): void {
    this.cache = null;
  }
}
