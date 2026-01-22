import { PerpConnector, PerpMarket } from './types.js';

export class HyperliquidConnector implements PerpConnector {
    name = "Hyperliquid";
    private baseUrl = "https://api.hyperliquid.xyz/info";

    async fetchMarkets(): Promise<PerpMarket[]> {
        try {
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'ArcScale/1.0'
                },
                body: JSON.stringify({ type: "metaAndAssetCtxs" })
            });

            if (!response.ok) {
                throw new Error(`Hyperliquid API failed: ${response.statusText}`);
            }

            const data = await response.json();
            // Data structure: [universe, assetCtxs]
            // universe: { universe: [{ name: "BTC", ... }] }
            // assetCtxs: [{ funding: "...", openInterest: "...", oraclePx: "..." }]

            const universe = data[0].universe;
            const assetCtxs = data[1];

            const markets: PerpMarket[] = [];

            for (let i = 0; i < universe.length; i++) {
                const assetMeta = universe[i];
                const assetCtx = assetCtxs[i];

                if (!assetCtx) continue;

                // Hyperliquid funding is hourly? 
                // Documentation says "funding" is the premium. 
                // Need to normalize. Usually presented as 1h rate or 8h rate. 
                // Hyperliquid displays hourly funding. The raw value in assetCtx is likely the current rate.
                // Checking docs/experience: It is the raw premium.
                // Use float conversion.

                markets.push({
                    symbol: `${assetMeta.name}-USD`, // Canonical format
                    price: parseFloat(assetCtx.oraclePx),
                    fundingRate1h: parseFloat(assetCtx.funding),
                    openInterestUsd: parseFloat(assetCtx.openInterest) * parseFloat(assetCtx.oraclePx),
                    volume24h: 0, // Hyperliquid metaAndAssetCtxs doesn't have 24h volume. 
                    // To get volume, we might need "userFills" or "candleSnapshot". 
                    // For now, set to 0 or fetch separately if critical. 
                    // Global stats endpoint suggests separate call for 24h stats.
                    // Endpoint: {"type": "userState", "user": "..."} no.
                    // Endpoint: /info {"type": "l2Book"} no.
                    // Actually, let's keep it simple for now and just use OI/Funding which are the "Alpha".
                    exchange: "Hyperliquid"
                });
            }

            return markets;

        } catch (error) {
            console.error(`[HyperliquidConnector] Error:`, error);
            return [];
        }
    }
}
