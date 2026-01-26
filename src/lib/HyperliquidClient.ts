/**
 * @file HyperliquidClient.ts
 * @description Hyperliquid DEX API client for fetching funding rates (Underlying APR).
 *   Skeleton implementation - only getFunding() is implemented.
 *
 * @dependencies
 *   - axios: HTTP client for API calls
 *   - DexClient: Base class and types
 *
 * @behavior
 *   - getBalance(): Not implemented (throws error)
 *   - order(): Not implemented (throws error)
 *   - getFunding(asset): Fetches predicted funding rate (Underlying APR), annualized (*24*365)
 *
 * @notes
 *   - This is a minimal skeleton for funding rate comparison
 *   - For full Hyperliquid trading, use src/scripts/ which use @nktkas/hyperliquid SDK
 *   - Funding rate annualization assumes hourly funding intervals (*24*365)
 *   - API endpoint: https://api.hyperliquid.xyz/info with predictedFundings type
 *   - The funding rate returned is the Underlying APR (floating rate from the perp exchange)
 *
 * @see src/scripts/hyperliquidShort.ts for full trading implementation
 * @see src/scripts/setHyperliquidLeverage.ts for leverage configuration
 * @see DexClient.ts for base class interface
 */

import axios from 'axios';
import { DexClient, OrderSide, Asset, OrderResult } from './DexClient.js';

export class HyperliquidClient extends DexClient {
  constructor(_apiKey: string) {
    super();
  }

  async getBalance(): Promise<string> {
    // TODO: Implement Hyperliquid balance fetching
    throw new Error('HyperliquidClient.getBalance() not implemented');
  }

  async order(_side: OrderSide, _asset: Asset, _size: string): Promise<OrderResult> {
    // TODO: Implement Hyperliquid order placement
    throw new Error('HyperliquidClient.order() not implemented');
  }

  async getFunding(asset: Asset): Promise<number> {
    const { data } = await axios.post(
      'https://api.hyperliquid.xyz/info',
      { type: 'predictedFundings' },
      { timeout: 15000 }
    );

    // Find the asset in the response array
    const assetData = data.find((item: any) => item[0] === asset);
    if (!assetData) throw new Error(`Asset ${asset} not found`);

    // Find HlPerp venue within the asset data
    const venues = assetData[1];
    const hlPerp = venues.find((venue: any) => venue[0] === 'HlPerp');
    if (!hlPerp) throw new Error(`HlPerp venue not found for ${asset}`);

    const fundingRate = parseFloat(hlPerp[1].fundingRate);
    // Hyperliquid funding happens hourly, annualize: * 24 * 365
    return fundingRate * 24 * 365;
  }
}
