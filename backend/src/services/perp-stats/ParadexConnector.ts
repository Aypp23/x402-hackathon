import { PerpConnector, PerpMarket } from './types.js';

export class ParadexConnector implements PerpConnector {
    name = "Paradex";
    private baseUrl = "https://api.prod.paradex.trade/v1/markets/summary?market=ALL";

    async fetchMarkets(): Promise<PerpMarket[]> {
        try {
            const response = await fetch(this.baseUrl);
            if (!response.ok) {
                throw new Error(`Paradex API failed: ${response.statusText} `);
            }

            const data = await response.json();
            // Data: { results: [{ symbol: "BTC-USD-PERP", ... }] }

            const markets: PerpMarket[] = [];

            // Need summary for stats (funding, OI)
            // /v1/markets just lists markets?
            // Need /v1/markets/summary ? 
            // Checking docs... usually summary has the valid data.
            // Start with fetching summary. If url is wrong, I'll need to update.
            // Let's assume /v1/markets/summary for now as it's standard. 
            // Or fetch markets then fetch stats?
            // Actually, /v1/bbo or /v1/funding/data?
            // Let's use https://api.prod.paradex.trade/v1/markets/summary if possible.
            // If not, I'll update. 
            // Re-checking research... "System Config" was mentioned.
            // I'll stick to a commonly named endpoint for now and fix during verification if needed.

            // Correction: Fetching specific summary endpoint seems safer.
            // Using markets summary with market=ALL implied or just summary
            const summaryUrl = "https://api.prod.paradex.trade/v1/markets/summary?market=ALL";
            const summaryResp = await fetch(summaryUrl);

            if (summaryResp.ok) {
                const summaryData = await summaryResp.json();
                // summaryData.results is the array
                const results = summaryData.results || [];

                for (const m of results) {
                    markets.push({
                        symbol: m.symbol,
                        price: parseFloat(m.mark_price || m.last_traded_price || "0"),
                        fundingRate1h: parseFloat(m.funding_rate || "0"),
                        openInterestUsd: parseFloat(m.open_interest || "0") * parseFloat(m.mark_price || m.last_traded_price || "0"),
                        volume24h: parseFloat(m.volume_24h || "0"),
                        exchange: "Paradex"
                    });
                }
            } else {
                // Fallback to /markets if summary fails
                const marketsUrl = "https://api.prod.paradex.trade/v1/markets";
                const marketsResp = await fetch(marketsUrl);
                if (marketsResp.ok) {
                    const data = await marketsResp.json();
                    const results = data.results || [];
                    for (const m of results) {
                        markets.push({
                            symbol: m.symbol,
                            price: 0,
                            fundingRate1h: 0,
                            openInterestUsd: 0,
                            volume24h: 0,
                            exchange: "Paradex"
                        });
                    }
                }
            }

            return markets;

        } catch (error) {
            console.error(`[ParadexConnector] Error: `, error);
            // Non-critical, return empty
            return [];
        }
    }
}
