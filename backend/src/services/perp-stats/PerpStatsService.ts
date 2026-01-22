import { PerpConnector, PerpMarket } from './types.js';
import { HyperliquidConnector } from './HyperliquidConnector.js';
import { DydxConnector } from './DydxConnector.js';
import { ParadexConnector } from './ParadexConnector.js';
import { VertexConnector } from './VertexConnector.js';
import { LighterConnector } from './LighterConnector.js';
import { PacificaConnector } from './PacificaConnector.js';
import { EdgeXConnector } from './EdgeXConnector.js';

export class PerpStatsService {
    private connectors: PerpConnector[];
    private cache: { markets: PerpMarket[], timestamp: number } | null = null;
    private CACHE_TTL = 30 * 1000; // 30 seconds

    constructor() {
        this.connectors = [
            new HyperliquidConnector(),
            // new DydxConnector(), // Uncomment when verify works
            // new ParadexConnector(), 
            // new VertexConnector(),
            // new LighterConnector(),
            // new PacificaConnector(),
            // new EdgeXConnector()
        ];

        // Initialize all (add them all back)
        this.connectors = [
            new HyperliquidConnector(),
            new DydxConnector(),
            new ParadexConnector(),
            new LighterConnector(),
            // new VertexConnector(), // Geo-blocked / ECONNRESET
            new PacificaConnector(),
            new EdgeXConnector() // Partial Support (Metadata only)
        ];
    }

    async getMarkets(): Promise<PerpMarket[]> {
        const now = Date.now();
        if (this.cache && (now - this.cache.timestamp < this.CACHE_TTL)) {
            return this.cache.markets;
        }

        console.log("[PerpStats] Fetching fresh data...");
        const promises = this.connectors.map(c =>
            c.fetchMarkets()
                .catch(err => {
                    console.error(`[PerpStats] ${c.name} failed:`, err);
                    return [];
                })
        );

        const results = await Promise.all(promises);
        const markets = results.flat();

        // Simple deduplication or normalization if needed? 
        // We keep them separate by "exchange" field.

        this.cache = { markets, timestamp: now };
        return markets;
    }

    async getGlobalStats() {
        const markets = await this.getMarkets();

        const totalVolume24h = markets.reduce((sum, m) => sum + (m.volume24h || 0), 0);
        const totalOpenInterestUsd = markets.reduce((sum, m) => sum + (m.openInterestUsd || 0), 0);

        const exchanges = [...new Set(markets.map(m => m.exchange))];

        return {
            totalVolume24h,
            totalOpenInterestUsd,
            activeExchanges: exchanges,
            marketCount: markets.length
        };
    }
}

export const perpStatsService = new PerpStatsService();
