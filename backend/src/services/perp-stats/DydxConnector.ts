
import { PerpConnector, PerpMarket } from './types.js';

export class DydxConnector implements PerpConnector {
    name = "dYdX";
    private baseUrl = "https://indexer.dydx.trade/v4/perpetualMarkets";

    async fetchMarkets(): Promise<PerpMarket[]> {
        let retries = 3;
        while (retries > 0) {
            try {
                const response = await fetch(this.baseUrl);
                if (!response.ok) {
                    throw new Error(`dYdX API failed: ${response.statusText}`);
                }

                const data = await response.json();
                const markets: PerpMarket[] = [];

                if (data.markets) {
                    for (const key in data.markets) {
                        const m = data.markets[key];
                        const price = parseFloat(m.oraclePrice || "0");
                        const funding = parseFloat(m.nextFundingRate || "0");
                        const oi = parseFloat(m.openInterest || "0") * price;
                        const vol = parseFloat(m.volume24H || "0");

                        markets.push({
                            symbol: key,
                            price: price,
                            fundingRate1h: funding,
                            openInterestUsd: oi,
                            volume24h: vol,
                            exchange: "dYdX"
                        });
                    }
                }

                return markets;

            } catch (error) {
                const msg = (error as Error).message;
                // Retry only on network/SSL errors
                if (retries === 1 || (!msg.includes("SSL") && !msg.includes("fetch failed") && !msg.includes("ECONNRESET"))) {
                    console.error(`[DydxConnector] Error:`, msg);
                    return [];
                }
                // Wait small random delay before retry
                await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
                retries--;
            }
        }
        return [];
    }
}
