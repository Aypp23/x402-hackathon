/**
 * News Scout Service - Crypto News Aggregation
 * Uses cryptocurrency.cv API (no API key, no rate limits)
 */

import axios from 'axios';

const NEWS_API_BASE = process.env.NEWS_API_BASE_URL || 'https://cryptocurrency.cv';
const NEWS_CACHE_BASE = process.env.NEWS_API_CACHE_BASE_URL || 'https://nirholas.github.io/free-crypto-news';
const NEWS_TIMEOUT_MS = Number(process.env.NEWS_API_TIMEOUT_MS || 5000);
const NEWS_RETRY_COUNT = Number(process.env.NEWS_API_RETRY_COUNT || 0);

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
 * Fetch from primary API endpoint list.
 */
async function fetchFromPrimary(endpointCandidates: string[]): Promise<unknown> {
    const axiosConfig = {
        timeout: NEWS_TIMEOUT_MS,
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'arcana-news-scout/1.0',
        },
        responseType: 'json' as const,
    };

    let lastError: unknown;
    for (const endpoint of endpointCandidates) {
        const url = `${NEWS_API_BASE}${endpoint}`;
        for (let attempt = 0; attempt <= NEWS_RETRY_COUNT; attempt++) {
            try {
                const response = await axios.get(url, axiosConfig);
                const payload = response.data;
                if (typeof payload === 'string') {
                    return JSON.parse(payload);
                }
                return payload;
            } catch (error) {
                lastError = error;
                const message = (error as Error).message;
                const status = axios.isAxiosError(error) ? error.response?.status : undefined;
                const isRetriable = axios.isAxiosError(error)
                    ? !status || status >= 500 || error.code === 'ECONNABORTED' || error.code === 'ENOTFOUND'
                    : false;

                console.warn(`[News Scout] Failed ${url} (attempt ${attempt + 1}/${NEWS_RETRY_COUNT + 1}): ${message}`);

                if (!isRetriable || attempt >= NEWS_RETRY_COUNT) {
                    break;
                }
            }
        }
    }

    throw lastError instanceof Error
        ? lastError
        : new Error('[News Scout] Failed to fetch from primary news API');
}

async function fetchFromCache(cachePath: string): Promise<unknown> {
    const url = `${NEWS_CACHE_BASE}${cachePath}`;
    const response = await axios.get(url, {
        timeout: Math.min(NEWS_TIMEOUT_MS, 6000),
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'arcana-news-scout/1.0',
        },
        responseType: 'json',
    });

    if (typeof response.data === 'string') {
        return JSON.parse(response.data);
    }

    return response.data;
}

async function fetchFromCacheCandidates(cachePaths: string[]): Promise<unknown> {
    let lastError: unknown;
    for (const path of cachePaths) {
        try {
            return await fetchFromCache(path);
        } catch (error) {
            lastError = error;
            console.warn(`[News Scout] Failed cache ${NEWS_CACHE_BASE}${path}: ${(error as Error).message}`);
        }
    }

    throw lastError instanceof Error
        ? lastError
        : new Error('[News Scout] Failed to fetch from cache mirror');
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
}

function asNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
}

function toIsoDate(value: unknown): string {
    const raw = asString(value);
    if (!raw) return new Date().toISOString();

    const timestamp = Date.parse(raw);
    if (Number.isNaN(timestamp)) return new Date().toISOString();
    return new Date(timestamp).toISOString();
}

function formatTimeAgo(isoDate: string): string {
    const diffMs = Date.now() - new Date(isoDate).getTime();
    if (!Number.isFinite(diffMs) || diffMs <= 0) return 'just now';

    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (diffMs < minute) return 'just now';
    if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
    if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
    return `${Math.floor(diffMs / day)}d ago`;
}

function normalizeArticle(article: unknown): NewsArticle | null {
    const row = asRecord(article);
    if (!row) return null;

    const sourceObject = asRecord(row.source);
    const title = asString(row.title || row.headline || row.name);
    const link = asString(row.link || row.url || row.articleUrl || row.href);
    const description = asString(row.description || row.summary || row.excerpt || row.content);
    const pubDate = toIsoDate(
        row.pubDate
        || row.publishedAt
        || row.published_at
        || row.date
        || row.createdAt
        || row.created_at
        || row.timestamp,
    );

    if (!title) return null;

    const source = asString(
        row.sourceName
        || row.source_key
        || row.sourceKey
        || row.source_id
        || row.sourceId
        || row.publisher
        || row.author
        || sourceObject?.name
        || sourceObject?.title
        || row.source,
    ) || 'Unknown';

    const sourceKey = asString(row.sourceKey || row.source_key || row.sourceId || row.source_id) || undefined;

    const categories = asArray(row.categories).map(asString).filter(Boolean);
    const category = asString(row.category || row.topic || categories[0]) || undefined;

    return {
        title,
        link: link || '#',
        description,
        pubDate,
        source,
        sourceKey,
        category,
        timeAgo: formatTimeAgo(pubDate),
    };
}

function extractNewsItems(payload: unknown): unknown[] {
    if (Array.isArray(payload)) return payload;

    const root = asRecord(payload);
    if (!root) return [];

    if (Array.isArray(root.articles)) return root.articles;
    if (Array.isArray(root.data)) return root.data;
    if (Array.isArray(root.items)) return root.items;
    if (Array.isArray(root.results)) return root.results;

    const nestedData = asRecord(root.data);
    if (nestedData && Array.isArray(nestedData.articles)) {
        return nestedData.articles;
    }

    return [];
}

function normalizeNewsResponse(payload: unknown, limit: number): NewsResponse {
    const root = asRecord(payload) || {};
    const articles = extractNewsItems(payload)
        .map(normalizeArticle)
        .filter((article): article is NewsArticle => Boolean(article))
        .slice(0, Math.max(1, limit));

    const meta = asRecord(root.meta);
    const totalCount = asNumber(root.totalCount || root.total || meta?.total) || articles.length;

    const sources = Array.from(new Set(articles.map((article) => article.source).filter(Boolean)));

    return {
        articles,
        totalCount,
        sources,
        fetchedAt: toIsoDate(root.fetchedAt || root.generatedAt || root.updatedAt || root.timestamp),
    };
}

function normalizeTrendingResponse(payload: unknown): TrendingResponse {
    if (Array.isArray(payload)) {
        payload = { trending: payload };
    }

    const root = asRecord(payload) || {};
    const rawTrending = asArray(root.trending).length > 0
        ? asArray(root.trending)
        : asArray(root.data).length > 0
            ? asArray(root.data)
            : asArray(root.topics);

    const trending = rawTrending
        .map((item) => {
            const row = asRecord(item);
            if (!row) return null;

            const topic = asString(row.topic || row.name || row.label || row.ticker || row.asset);
            if (!topic) return null;

            const recentHeadlines = asArray(row.recentHeadlines).length > 0
                ? asArray(row.recentHeadlines).map(asString).filter(Boolean)
                : asArray(row.headlines).map(asString).filter(Boolean);

            return {
                topic,
                count: asNumber(row.count || row.mentions || row.score),
                sentiment: (asString(row.sentiment || row.bias || row.polarity) || 'neutral').toLowerCase(),
                recentHeadlines,
            } satisfies TrendingTopic;
        })
        .filter((topic): topic is TrendingTopic => Boolean(topic))
        .slice(0, 10);

    const meta = asRecord(root.meta);
    const analyzed = asNumber(root.articlesAnalyzed || root.totalArticles || meta?.total)
        || trending.reduce((sum, topic) => sum + topic.count, 0);

    return {
        trending,
        timeWindow: asString(root.timeWindow || root.window || root.range || meta?.window) || '24h',
        articlesAnalyzed: analyzed,
        fetchedAt: toIsoDate(root.fetchedAt || root.generatedAt || root.updatedAt || root.timestamp),
    };
}

function filterNewsByQuery(news: NewsResponse, query: string, limit: number): NewsResponse {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return news;

    const terms = normalizedQuery.split(/\s+/).filter((term) => term.length >= 2);
    if (terms.length === 0) return news;

    const filtered = news.articles.filter((article) => {
        const haystack = `${article.title} ${article.description} ${article.source} ${article.category || ''}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
    });

    return {
        ...news,
        articles: filtered.slice(0, Math.max(1, limit)),
        totalCount: filtered.length,
        sources: Array.from(new Set(filtered.map((article) => article.source).filter(Boolean))),
    };
}

/**
 * Get latest crypto news from all sources
 */
export async function getLatestNews(limit: number = 10): Promise<NewsResponse | null> {
    const safeLimit = Math.max(1, Math.min(limit, 20));
    try {
        console.log(`[News Scout] Fetching latest ${safeLimit} news articles...`);
        const data = await fetchFromPrimary([
            `/api/news?limit=${safeLimit}&per_page=${safeLimit}&page=1`,
            `/api/news?per_page=${safeLimit}&page=1`,
            `/api/news?limit=${safeLimit}`,
        ]);
        return normalizeNewsResponse(data, safeLimit);
    } catch (error) {
        console.warn("[News Scout] Primary latest endpoint failed, trying cache...");
        try {
            const cached = await fetchFromCacheCandidates([
                '/cache/latest.json',
                '/cache/news.json',
            ]);
            return normalizeNewsResponse(cached, safeLimit);
        } catch (cacheError) {
            console.error("[News Scout] Error fetching latest news:", cacheError);
            return null;
        }
    }
}

/**
 * Search news by keyword
 */
export async function searchNews(query: string, limit: number = 10): Promise<NewsResponse | null> {
    const safeLimit = Math.max(1, Math.min(limit, 20));
    try {
        console.log(`[News Scout] Searching news for: ${query}...`);
        const encodedQuery = encodeURIComponent(query);
        const data = await fetchFromPrimary([
            `/api/search?q=${encodedQuery}&limit=${safeLimit}&per_page=${safeLimit}`,
            `/api/search?q=${encodedQuery}&per_page=${safeLimit}`,
        ]);
        return normalizeNewsResponse(data, safeLimit);
    } catch (error) {
        console.warn(`[News Scout] Primary search failed for "${query}", trying cache filter...`);
        try {
            const cached = await fetchFromCacheCandidates([
                '/cache/latest.json',
                '/cache/news.json',
            ]);
            const normalized = normalizeNewsResponse(cached, 100);
            return filterNewsByQuery(normalized, query, safeLimit);
        } catch (cacheError) {
            console.error(`[News Scout] Error searching news for ${query}:`, cacheError);
            return null;
        }
    }
}

/**
 * Get DeFi-specific news
 */
export async function getDefiNews(limit: number = 10): Promise<NewsResponse | null> {
    try {
        console.log(`[News Scout] Fetching DeFi news...`);
        return await searchNews('defi', limit);
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
        return await searchNews('bitcoin', limit);
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
        const data = await fetchFromPrimary(['/api/breaking']);
        return normalizeNewsResponse(data, 10);
    } catch (error) {
        console.warn("[News Scout] Primary breaking endpoint failed, trying cache...");
        try {
            const cached = await fetchFromCacheCandidates([
                '/cache/latest.json',
                '/cache/news.json',
            ]);
            return normalizeNewsResponse(cached, 10);
        } catch (cacheError) {
            console.error("[News Scout] Error fetching breaking news:", cacheError);
            return null;
        }
    }
}

/**
 * Get trending topics with sentiment analysis
 */
export async function getTrendingTopics(): Promise<TrendingResponse | null> {
    try {
        console.log(`[News Scout] Fetching trending topics...`);
        const data = await fetchFromPrimary(['/api/trending']);
        return normalizeTrendingResponse(data);
    } catch (error) {
        console.warn("[News Scout] Primary trending endpoint failed, trying cache...");
        try {
            const cached = await fetchFromCacheCandidates([
                '/cache/trending.json',
            ]);
            return normalizeTrendingResponse(cached);
        } catch (cacheError) {
            console.error("[News Scout] Error fetching trending topics:", cacheError);
            return null;
        }
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
