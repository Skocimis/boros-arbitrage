export type FeeMode =
  | { type: 'manual'; amount: number }
  | { type: 'taker-taker'; dexFee: number }
  | { type: 'maker-taker'; dexFee: number };

interface DexRates {
  maker: number;
  taker: number;
}

const DEX_FEE_RATES: Record<string, DexRates> = {
  hyperliquid: { maker: 0.0001, taker: 0.00035 },
  okx: { maker: 0.0002, taker: 0.0005 },
  gate: { maker: 0.0002, taker: 0.0005 },
  binance: { maker: 0.0002, taker: 0.0005 },
  lighter: { maker: 0, taker: 0 },
};

export const BOROS_SWAP_RATE = 0.0005;

export function getDexRates(platformName: string): DexRates {
  const name = platformName.toLowerCase();
  for (const [key, rates] of Object.entries(DEX_FEE_RATES)) {
    if (name.includes(key)) return rates;
  }
  return { maker: 0.0002, taker: 0.0005 };
}

export function computeBorosSwapFee(size: number, minMaturity: number, entryTimestamp: number): number {
  const secondsRemaining = Math.max(0, minMaturity - entryTimestamp);
  return size * 2 * BOROS_SWAP_RATE * secondsRemaining / (365 * 86400);
}

export function computeFeeAtTimestamp(feeMode: FeeMode, size: number, minMaturity: number, entryTimestamp: number): number {
  if (feeMode.type === 'manual') return feeMode.amount;
  return feeMode.dexFee + computeBorosSwapFee(size, minMaturity, entryTimestamp);
}

export function estimateTakerTaker(size: number, platform1: string, platform2: string) {
  const rates1 = getDexRates(platform1);
  const rates2 = getDexRates(platform2);
  const dexFee = 2 * size * (rates1.taker + rates2.taker);
  return {
    dexFee,
    dex1Rate: rates1.taker,
    dex2Rate: rates2.taker,
    platform1,
    platform2,
  };
}

export function estimateMakerTaker(size: number, platform1: string, platform2: string) {
  const rates1 = getDexRates(platform1);
  const rates2 = getDexRates(platform2);

  const fee_1maker = 2 * size * (rates1.maker + rates2.taker);
  const fee_2maker = 2 * size * (rates2.maker + rates1.taker);

  if (fee_1maker <= fee_2maker) {
    return {
      dexFee: fee_1maker,
      makerPlatform: platform1,
      takerPlatform: platform2,
      makerRate: rates1.maker,
      takerRate: rates2.taker,
    };
  }
  return {
    dexFee: fee_2maker,
    makerPlatform: platform2,
    takerPlatform: platform1,
    makerRate: rates2.maker,
    takerRate: rates1.taker,
  };
}
