export interface PerpMarket {
    symbol: string;         // e.g. "BTC-USD"
    price: number;
    fundingRate1h: number;  // Normalized to 1h rate (decimal, e.g. 0.0001 = 0.01%)
    openInterestUsd: number;
    volume24h: number;
    exchange: string;       // "Hyperliquid", "dYdX", etc.
}

export interface PerpConnector {
    name: string;
    fetchMarkets(): Promise<PerpMarket[]>;
}
