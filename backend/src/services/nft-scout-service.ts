import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;
const BASE_URL = 'https://api.opensea.io/api/v2';

if (!OPENSEA_API_KEY) {
    console.warn('WARNING: OPENSEA_API_KEY is not set. NFT Scout Service will fail.');
}

interface OpenSeaCollectionStats {
    total: {
        volume: number;
        sales: number;
        average_price: number;
        num_owners: number;
        market_cap: number;
        floor_price: number;
        floor_price_symbol: string;
    };
    intervals: any;
}

interface OpenSeaCollection {
    collection: string;
    name: string;
    description: string;
    image_url: string;
    owner: string;
    safelist_status: string;
    category: string;
    is_disabled: boolean;
    is_nsfw: boolean;
    opensea_url: string;
    project_url: string;
    twitter_username: string;
    contracts: { address: string; chain: string }[];
}

interface OpenSeaEvent {
    event_type: string;
    order_hash: string;
    chain: string;
    protocol_address: string;
    closing_date: number;
    nft: {
        identifier: string;
        collection: string;
        contract: string;
        name: string;
        image_url: string;
    };
    quantity: number;
    payment: {
        quantity: string;
        token_address: string;
        decimals: number;
        symbol: string;
    };
    transaction: string;
}

interface SearchResult {
    collection: string;
    name: string;
    slug: string;
    image_url: string;
}

export interface NftCollectionAnalysis {
    slug: string;
    name: string;
    description: string;
    floor_price: number;
    floor_price_symbol: string;
    volume_total: number;
    num_owners: number;
    market_cap: number;
    image_url: string;
    opensea_url: string;
    sales_trend: 'up' | 'down' | 'neutral';
    recent_sales: SimpleSale[];
}

interface SimpleSale {
    nft_name: string;
    price: number;
    symbol: string;
    date: string;
    tx_hash: string;
}

// Simple in-memory cache
const cache: Record<string, { data: any; timestamp: number }> = {};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class NftScoutService {
    private async fetchOpenSea(endpoint: string, params: Record<string, string> = {}): Promise<any> {
        const url = new URL(`${BASE_URL}${endpoint}`);
        Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

        const headers: HeadersInit = {
            'x-api-key': OPENSEA_API_KEY || '',
            'accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout

        try {
            const response = await fetch(url.toString(), {
                headers,
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`OpenSea API Error: ${response.status} ${response.statusText} - ${errorText}`);
            }

            return await response.json();
        } catch (error) {
            console.error(`Failed to fetch from OpenSea [${endpoint}]:`, error);
            throw error;
        }
    }

    private getFromCache<T>(key: string): T | null {
        const cached = cache[key];
        if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
            return cached.data as T;
        }
        return null;
    }

    private setCache(key: string, data: any) {
        cache[key] = { data, timestamp: Date.now() };
    }

    /**
     * Search for collections by name
     */
    async searchCollections(query: string): Promise<SearchResult[]> {
        // Fallback strategy: if Search API fails (which is common), try to guess the slug
        // 1. Try search
        try {
            const data = await this.fetchOpenSea('/search/collections', { q: query, limit: '5' });
            if (data.collections) {
                return data.collections.map((c: any) => ({
                    collection: c.collection,
                    name: c.name,
                    slug: c.slug,
                    image_url: c.image_url
                }));
            }
        } catch (error) {
            console.warn(`[NftScout] Search API failed for "${query}". Trying slug fallback...`);
        }

        // 2. Direct Slug Fallback
        // Generate potential slugs
        const normalized = query.trim().toLowerCase();
        const potentialSlugs = [
            normalized.replace(/\s+/g, ''), // "pudgypenguins"
            normalized.replace(/\s+/g, '-'), // "pudgy-penguins"
            normalized // "pudgy"
        ];

        // Remove duplicates
        const uniqueSlugs = [...new Set(potentialSlugs)];
        console.log(`[NftScout] Trying slug fallback variations: ${uniqueSlugs.join(', ')}`);

        for (const slug of uniqueSlugs) {
            try {
                // Check if stats exist for this slug
                const stats = await this.getCollectionStats(slug);

                // Fetch details to confirm
                const details = await this.getCollectionDetails(slug);

                // If this is a valid result, return it
                return [{
                    collection: slug,
                    name: details.name || slug,
                    slug: slug,
                    image_url: details.image_url || ''
                }];

            } catch (e) {
                // Ignore 404s, try next
                continue;
            }
        }

        console.warn(`[NftScout] All slug fallbacks failed for "${query}"`);
        return [];
    }

    /**
     * Get Collection Details (Metadata)
     */
    async getCollectionDetails(slug: string): Promise<OpenSeaCollection> {
        return await this.fetchOpenSea(`/collections/${slug}`);
    }

    /**
     * Get Collection Stats (Floor, Volume, etc.)
     */
    async getCollectionStats(slug: string): Promise<OpenSeaCollectionStats['total']> {
        const cacheKey = `stats:${slug}`;
        const cached = this.getFromCache<OpenSeaCollectionStats['total']>(cacheKey);
        if (cached) return cached;

        const data = await this.fetchOpenSea(`/collections/${slug}/stats`);
        const stats = data.total;

        this.setCache(cacheKey, stats);
        return stats;
    }

    /**
     * Get Recent Sales (Last 10)
     */
    async getRecentSales(slug: string): Promise<OpenSeaEvent[]> {
        // Endpoint: /api/v2/events/collection/{slug}?event_type=sale&limit=10
        // NOTE: 'events/collection/{slug}' might use different query params structure based on docs.
        // Docs said: /api/v2/events/collection/{slug}?event_type=sale

        const data = await this.fetchOpenSea(`/events/collection/${slug}`, {
            event_type: 'sale',
            limit: '10'
        });

        // The response structure for events usually has an 'asset_events' array
        return data.asset_events || [];
    }

    /**
     * Main analysis method called by the agent
     */
    async analyzeCollection(slug: string): Promise<NftCollectionAnalysis> {
        // Parallelize requests
        const [stats, details, salesEvents] = await Promise.all([
            this.getCollectionStats(slug),
            this.getCollectionDetails(slug),
            this.getRecentSales(slug)
        ]);

        // Process recent sales
        const recentSales: SimpleSale[] = salesEvents.map(e => {
            const priceVal = parseFloat(e.payment.quantity) / Math.pow(10, e.payment.decimals);
            return {
                nft_name: e.nft.name || `${details.name} #${e.nft.identifier}`,
                price: priceVal,
                symbol: e.payment.symbol,
                date: new Date(e.closing_date * 1000).toISOString(),
                tx_hash: e.transaction
            };
        });

        // Determine simple trend (just average of first 5 vs last 5 in the list of 10? 
        // Or strictly strictly simplistic: if most recent sale > average of last 10, then UP?
        // Let's do: recent 3 avg vs next 7 avg
        let trend: 'up' | 'down' | 'neutral' = 'neutral';
        if (recentSales.length >= 5) {
            const prices = recentSales.map(s => s.price);
            const recentAvg = prices.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
            const olderAvg = prices.slice(3).reduce((a, b) => a + b, 0) / (prices.length - 3);

            const diff = (recentAvg - olderAvg) / olderAvg;
            if (diff > 0.05) trend = 'up';
            else if (diff < -0.05) trend = 'down';
        }

        return {
            slug: slug,
            name: details.name,
            description: details.description,
            floor_price: stats.floor_price,
            floor_price_symbol: stats.floor_price_symbol || 'ETH', // Default fallback
            volume_total: stats.volume,
            num_owners: stats.num_owners,
            market_cap: stats.market_cap,
            image_url: details.image_url,
            opensea_url: details.opensea_url,
            sales_trend: trend,
            recent_sales: recentSales
        };
    }
}

export const nftScoutService = new NftScoutService();
