import { PerpConnector, PerpMarket } from './types.js';

export class EdgeXConnector implements PerpConnector {
    name = "EdgeX";
    private baseUrl = "https://pro.edgex.exchange/api/v1";

    async fetchMarkets(): Promise<PerpMarket[]> {
        try {
            // Docs: https://pro.edgex.exchange/api/v1/public/meta/getMetaData
            const response = await fetch(`${this.baseUrl}/public/meta/getMetaData`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`EdgeX API failed: ${response.status} ${response.statusText}`);
            }

            const json = await response.json();
            const markets: PerpMarket[] = [];

            // Structure: { data: { contractList: [...] } }
            const contracts = json.data?.contractList || [];

            for (const c of contracts) {
                // c.contractName = "BTCUSDT"
                // c.fundingInterestRate = "0.0003" (Default?)
                // No price in metadata, likely 0 until we find ticker endpoint.

                markets.push({
                    symbol: c.contractName,
                    price: 0, // Not available in metadata
                    fundingRate1h: parseFloat(c.fundingInterestRate || "0"),
                    openInterestUsd: 0,
                    volume24h: 0,
                    exchange: "EdgeX"
                });
            }

            return markets;

        } catch (error) {
            console.error(`[EdgeXConnector] Error:`, (error as Error).message);
            if ((error as any).cause) {
                console.error(`   Cause:`, (error as any).cause);
            }
            return [];
        }
    }
}
