import { PerpConnector, PerpMarket } from './types.js';

export class PacificaConnector implements PerpConnector {
    name = "Pacifica";
    private baseUrl = "https://api.pacifica.fi/api/v1";

    async fetchMarkets(): Promise<PerpMarket[]> {
        try {
            // Docs: https://api.pacifica.fi/api/v1/info/prices
            const response = await fetch(`${this.baseUrl}/info/prices`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': '*/*'
                }
            });

            if (!response.ok) {
                throw new Error(`Pacifica API failed: ${response.status} ${response.statusText}`);
            }

            const json = await response.json();

            // Structure: { success: true, data: [...] }
            if (!json.success || !Array.isArray(json.data)) {
                throw new Error("Invalid Pacifica response structure");
            }

            const markets: PerpMarket[] = [];
            for (const m of json.data) {
                markets.push({
                    symbol: m.symbol,
                    price: parseFloat(m.mark || m.mid || "0"),
                    fundingRate1h: parseFloat(m.funding || "0"),
                    openInterestUsd: parseFloat(m.open_interest || "0") * parseFloat(m.mark || m.mid || "0"),
                    volume24h: parseFloat(m.volume_24h || "0"),
                    exchange: "Pacifica"
                });
            }

            return markets;

        } catch (error) {
            console.error(`[PacificaConnector] Error:`, (error as Error).message);
            if ((error as any).cause) {
                console.error(`   Cause:`, (error as any).cause);
            }
            return [];
        }
    }
}
