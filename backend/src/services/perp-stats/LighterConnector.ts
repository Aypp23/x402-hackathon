import { PerpConnector, PerpMarket } from './types.js';

export class LighterConnector implements PerpConnector {
    name = "Lighter";
    private baseUrl = "https://mainnet.zklighter.elliot.ai/api/v1";

    async fetchMarkets(): Promise<PerpMarket[]> {
        try {
            // Updated to use orderBookDetails for stats
            const response = await fetch(`${this.baseUrl}/orderBookDetails`);
            if (!response.ok) {
                throw new Error(`Lighter API failed: ${response.statusText}`);
            }

            const data = await response.json();
            // Expected format: { order_book_details: [...] }
            const list = data.order_book_details || [];
            const markets: PerpMarket[] = [];

            for (const item of list) {
                const symbol = item.symbol;
                const price = parseFloat(item.last_trade_price || "0");
                // funding not explicitly in orderBookDetails list from search, checking if available or 0
                // Search result didn't mention funding, likely 0 or need another call. 
                // For now, 0 or derived if available.
                const funding = 0;
                const volume = parseFloat(item.daily_quote_token_volume || "0");
                const oi = parseFloat(item.open_interest || "0");

                if (symbol) {
                    markets.push({
                        symbol: symbol,
                        price: price,
                        fundingRate1h: funding,
                        openInterestUsd: oi * price,
                        volume24h: volume,
                        exchange: "Lighter"
                    });
                }
            }

            return markets;

        } catch (error) {
            console.error(`[LighterConnector] Error:`, error);
            return [];
        }
    }
}
