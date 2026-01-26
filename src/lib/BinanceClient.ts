/**
 * @file BinanceClient.ts
 * @description Binance Futures API client for fetching balances and funding rates (Underlying APR).
 *   Implements the DexClient interface with HMAC-SHA256 authentication.
 *
 * @dependencies
 *   - axios: HTTP client for API calls
 *   - node:crypto: HMAC-SHA256 signature generation
 *   - DexClient: Base class and types
 *
 * @environment
 *   - BINANCE_API_KEY: Binance API key (passed to constructor)
 *   - BINANCE_API_SECRET: Binance API secret (passed to constructor)
 *
 * @behavior
 *   - getBalance(): Fetches USDC balance from Binance Futures (tries v3, falls back to v2)
 *   - getFunding(asset): Fetches current funding rate (Underlying APR), annualized (*3*365)
 *   - order(): Not yet implemented (throws error)
 *
 * @notes
 *   - Uses HMAC-SHA256 for request signing
 *   - 15-second timeout on all requests
 *   - Funding rate annualization assumes 8-hour funding intervals (*3*365)
 *   - v3 API returns different response format than v2, both handled
 *   - The funding rate returned is the Underlying APR (floating rate from the perp exchange)
 *
 * @see DexClient.ts for base class interface
 * @see HyperliquidClient.ts for alternative exchange implementation
 */

import axios from 'axios';
import { createHmac } from 'node:crypto';
import { DexClient, OrderSide, Asset, OrderResult } from './DexClient.js';

export class BinanceClient extends DexClient {
  constructor(
    private apiKey: string,
    private apiSecret: string
  ) {
    super();
  }

  async getBalance(): Promise<string> {
    const balances = await this.fetchBalances();
    const usdc = balances.find((b: any) => (b.asset || b.a) === 'USDC');
    return usdc?.availableBalance || usdc?.ab || '0';
  }

  async order(_side: OrderSide, _asset: Asset, _size: string): Promise<OrderResult> {
    // TODO: Implement order placement
    throw new Error('Order placement not implemented yet');
  }

  async getFunding(asset: Asset): Promise<number> {
    const symbol = `${asset}USDT`;
    const { data } = await axios.get(
      `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`,
      { timeout: 15000 }
    );
    const fundingRate = parseFloat(data.lastFundingRate);
    // Binance funding happens every 8 hours (3x daily), annualize: * 3 * 365
    return fundingRate * 3 * 365;
  }

  private async fetchBalances(): Promise<any[]> {
    const timestamp = Date.now();
    const query = `timestamp=${timestamp}&recvWindow=5000`;
    const signature = createHmac('sha256', this.apiSecret)
      .update(query)
      .digest('hex');

    // Try v3 first, fallback to v2
    for (const endpoint of ['/fapi/v3/balance', '/fapi/v2/balance']) {
      try {
        const { data } = await axios.get(
          `https://fapi.binance.com${endpoint}?${query}&signature=${signature}`,
          { headers: { 'X-MBX-APIKEY': this.apiKey }, timeout: 15000 }
        );
        return data;
      } catch (error) {
        if (endpoint === '/fapi/v2/balance') throw error;
      }
    }
    throw new Error('Failed to fetch balances');
  }
}
