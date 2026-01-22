/**
 * News Scout Service - Crypto News Aggregation
 * Uses free-crypto-news API (no API key, no rate limits)
 * Sources: CoinDesk, The Block, Decrypt, CoinTelegraph, Bitcoin Magazine, Blockworks, The Defiant
 */

import axios from 'axios';

const NEWS_API_BASE = "https://free-crypto-news.vercel.app";
const FAILSAFE_MIRROR = "https://nirholas.github.io/free-crypto-news";

export interface NewsArticle {
    title: string;
    link: string;
    description: string;
    pubDate: string;
    source: string;
    sourceKey?: string;
    category?: string;
    timeAgo: string;
}

export interface NewsResponse {
    articles: NewsArticle[];
    totalCount: number;
    sources: string[];
    fetchedAt: string;
}

export interface TrendingTopic {
    topic: string;
    count: number;
    sentiment: string;
    recentHeadlines: string[];
}

export interface TrendingResponse {
    trending: TrendingTopic[];
    timeWindow: string;
    articlesAnalyzed: number;
    fetchedAt: string;
}

/**
 * Fetch from API with failsafe fallback
 * Uses axios with decompression disabled to avoid Z_DATA_ERROR
 */
async function fetchWithFailsafe(endpoint: string): Promise<any> {
    const axiosConfig = {
        timeout: 10000,
        decompress: false, // Disable auto-decompression to prevent Z_DATA_ERROR
        headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'identity', // Request uncompressed response
        },
        responseType: 'text' as const, // Get raw text, parse manually
    };

    try {
        const response = await axios.get(`${NEWS_API_BASE}${endpoint}`, axiosConfig);
        return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    } catch (error) {
        console.warn(`[News Scout] Primary API failed, trying failsafe mirror...`);
        try {
            const response = await axios.get(`${FAILSAFE_MIRROR}${endpoint}`, axiosConfig);
            return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        } catch {
            // Failsafe also failed
        }
        throw error;
    }
}

/**
 * Get latest crypto news from all sources
 */
export async function getLatestNews(limit: number = 10): Promise<NewsResponse | null> {
    try {
        console.log(`[News Scout] Fetching latest ${limit} news articles...`);
        const data = await fetchWithFailsafe(`/api/news?limit=${limit}`);
        return data as NewsResponse;
    } catch (error) {
        console.error("[News Scout] Error fetching latest news:", error);
        return null;
    }
}

/**
 * Search news by keyword
 */
export async function searchNews(query: string, limit: number = 10): Promise<NewsResponse | null> {
    try {
        console.log(`[News Scout] Searching news for: ${query}...`);
        const encodedQuery = encodeURIComponent(query);
        const data = await fetchWithFailsafe(`/api/search?q=${encodedQuery}&limit=${limit}`);
        return data as NewsResponse;
    } catch (error) {
        console.error(`[News Scout] Error searching news for ${query}:`, error);
        return null;
    }
}

/**
 * Get DeFi-specific news
 */
export async function getDefiNews(limit: number = 10): Promise<NewsResponse | null> {
    try {
        console.log(`[News Scout] Fetching DeFi news...`);
        const data = await fetchWithFailsafe(`/api/defi?limit=${limit}`);
        return data as NewsResponse;
    } catch (error) {
        console.error("[News Scout] Error fetching DeFi news:", error);
        return null;
    }
}

/**
 * Get Bitcoin-focused news
 */
export async function getBitcoinNews(limit: number = 10): Promise<NewsResponse | null> {
    try {
        console.log(`[News Scout] Fetching Bitcoin news...`);
        const data = await fetchWithFailsafe(`/api/bitcoin?limit=${limit}`);
        return data as NewsResponse;
    } catch (error) {
        console.error("[News Scout] Error fetching Bitcoin news:", error);
        return null;
    }
}

/**
 * Get breaking news (last 15 minutes)
 */
export async function getBreakingNews(): Promise<NewsResponse | null> {
    try {
        console.log(`[News Scout] Fetching breaking news...`);
        const data = await fetchWithFailsafe(`/api/breaking`);
        return data as NewsResponse;
    } catch (error) {
        console.error("[News Scout] Error fetching breaking news:", error);
        return null;
    }
}

/**
 * Get trending topics with sentiment analysis
 */
export async function getTrendingTopics(): Promise<TrendingResponse | null> {
    try {
        console.log(`[News Scout] Fetching trending topics...`);
        const data = await fetchWithFailsafe(`/api/trending`);
        return data as TrendingResponse;
    } catch (error) {
        console.error("[News Scout] Error fetching trending topics:", error);
        return null;
    }
}

/**
 * Format news response for display
 */
export function formatNewsResponse(news: NewsResponse): string {
    const lines: string[] = [];

    lines.push("### 📰 Latest Crypto News");
    lines.push("");

    for (const article of news.articles.slice(0, 10)) {
        lines.push(`**${article.title}**`);
        lines.push(`${article.description}`);
        lines.push(`📍 ${article.source} • ${article.timeAgo}`);
        lines.push("");
    }

    lines.push(`_Fetched from ${news.sources.length} sources at ${new Date(news.fetchedAt).toLocaleTimeString()}_`);

    return lines.join("\n");
}

/**
 * Format trending topics for display
 */
export function formatTrendingTopics(trending: TrendingResponse): string {
    const lines: string[] = [];

    lines.push("### 📈 Trending in Crypto");
    lines.push("");

    for (const topic of trending.trending.slice(0, 5)) {
        const emoji = topic.sentiment === "bullish" ? "🟢" : topic.sentiment === "bearish" ? "🔴" : "⚪";
        lines.push(`${emoji} **${topic.topic}** (${topic.count} mentions)`);
        if (topic.recentHeadlines.length > 0) {
            lines.push(`   _"${topic.recentHeadlines[0]}"_`);
        }
    }

    lines.push("");
    lines.push(`_Based on ${trending.articlesAnalyzed} articles in the last ${trending.timeWindow}_`);

    return lines.join("\n");
}
