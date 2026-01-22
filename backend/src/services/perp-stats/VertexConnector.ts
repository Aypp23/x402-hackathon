import { PerpConnector, PerpMarket } from './types.js';

export class VertexConnector implements PerpConnector {
    name = "Vertex";
    private baseUrl = "https://gateway.prod.vertexprotocol.com/v1/query";

    async fetchMarkets(): Promise<PerpMarket[]> {
        try {
            // Fetch All Products (snapshots)
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                body: JSON.stringify({
                    type: "market_snapshots",
                    limit: 100
                })
            });

            if (!response.ok) {
                throw new Error(`Vertex API failed: ${response.statusText}`);
            }

            const data = await response.json();
            // Data structure: { snapshots: [ { productId: 1, ticker_id: "BTC-PERP", snapshot: { ... } } ] }

            const markets: PerpMarket[] = [];
            const snapshots = data.snapshots || [];

            for (const item of snapshots) {
                const snap = item.snapshot;
                // snap.openInterest (base)
                // snap.product.oraclePrice (x18)
                // snap.fundingRate (1h)

                // Vertex units can be raw scaled. 
                // Usually need to check decimals.
                // Assuming standard formatting or x18.
                // The API usually returns user-friendly numbers in some endpoints, but snapshot might be raw X18.
                // However, let's assume raw values are strings and need parsing.
                // snap.oraclePrice is usually x18.
                // fundingRate is usually daily or hourly. 

                // For simplified demo, we treat as raw. 
                // In production, we'd import the Vertex SDK to handle decimals. 
                // For now, I'll log one during verification and adjust scaling.

                // Let's assume standard values for now.

                markets.push({
                    symbol: item.ticker_id || `product-${item.productId}`,
                    price: parseFloat(snap.oraclePrice || "0") / 1e18, // Vertex uses 1e18 for price
                    fundingRate1h: parseFloat(snap.fundingRate || "0") / 1e18, // Verify scaling
                    openInterestUsd: (parseFloat(snap.openInterest || "0") / 1e18) * (parseFloat(snap.oraclePrice || "0") / 1e18),
                    volume24h: 0, // Need 24h stats separately?
                    exchange: "Vertex"
                });
            }

            return markets;

        } catch (error) {
            console.error(`[VertexConnector] Error:`, error);
            return [];
        }
    }
}
