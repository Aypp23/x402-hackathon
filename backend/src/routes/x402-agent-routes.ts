/**
 * x402 Agent Routes - Seller-Side Protected Endpoints
 *
 * Coinbase x402 middleware for Base Sepolia (eip155:84532).
 */

import { Router, type Request, type Response, type RequestHandler } from 'express';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient, type RouteConfig, type RoutesConfig } from '@x402/core/server';
import { fetchPrice, fetchPrices } from '../services/price-oracle.js';
import {
    analyzeWallet,
    estimateTransactionCost,
    getDexReport,
    getGasPrices,
} from '../services/onchain-analytics.js';
import { getBridges, getHacks, getProtocolStats } from '../services/defillama.js';
import {
    searchNews,
    getBreakingNews,
    getLatestNews,
    getTrendingTopics,
} from '../services/news-scout.js';
import { getTopYields, getYieldsForAsset } from '../services/yield-optimizer.js';
import { analyzeTokenomics } from '../services/tokenomics-service.js';
import { nftScoutService } from '../services/nft-scout-service.js';
import { PerpStatsService } from '../services/perp-stats/PerpStatsService.js';
import {
    BASE_SEPOLIA_NETWORK,
    X402_FACILITATOR_URL,
    type X402AgentId,
    getAgentPrice,
    getSellerAddresses,
} from '../services/x402-common.js';
import { checkSellerRoutePolicy } from '../services/agent-policy.js';

const perpService = new PerpStatsService();

export interface X402RouteOptions {
    sellerAddresses?: Partial<Record<X402AgentId, `0x${string}`>>;
}

export function buildX402AgentRoutes(options: X402RouteOptions = {}): Router {
    const sellerAddresses = getSellerAddresses(options.sellerAddresses);

    const facilitatorClient = new HTTPFacilitatorClient({
        url: X402_FACILITATOR_URL,
    });

    const resourceServer = new x402ResourceServer(facilitatorClient)
        .register(BASE_SEPOLIA_NETWORK, new ExactEvmScheme());

    const router = Router();

    const protect = (
        method: 'GET' | 'POST',
        routePath: string,
        agentId: X402AgentId,
        description: string,
    ): RequestHandler => {
        const routeConfig: RouteConfig = {
            accepts: [
                {
                    scheme: 'exact',
                    price: getAgentPrice(agentId),
                    network: BASE_SEPOLIA_NETWORK,
                    payTo: sellerAddresses[agentId],
                },
            ],
            description,
            mimeType: 'application/json',
        };

        const config: RoutesConfig = {
            [`${method} ${routePath}`]: {
                ...routeConfig,
            },
        };

        const paymentHandler = paymentMiddleware(config, resourceServer) as unknown as RequestHandler;

        return async (req: Request, res: Response, next) => {
            const endpoint = `/api/x402${routePath}`;
            const policyCheck = await checkSellerRoutePolicy(agentId, endpoint);
            if (!policyCheck.allowed) {
                return res.status(policyCheck.statusCode || 403).json({
                    success: false,
                    error: policyCheck.reason || 'Blocked by policy',
                    policy: {
                        agentId,
                        frozen: policyCheck.policy.frozen,
                    },
                });
            }

            return paymentHandler(req, res, next);
        };
    };

    function getPaymentInfo(req: Request, agentId: X402AgentId) {
        const payment = (req as any).payment;
        return {
            amount: getAgentPrice(agentId),
            network: BASE_SEPOLIA_NETWORK,
            payTo: sellerAddresses[agentId],
            payer: payment?.payer,
            transaction: payment?.transaction,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRICE ORACLE
    // ─────────────────────────────────────────────────────────────────────────

    router.get('/oracle/price', protect('GET', '/oracle/price', 'oracle', 'Oracle price quote'), async (req: Request, res: Response) => {
        try {
            const symbol = (req.query.symbol as string) || 'BTC';
            const data = await fetchPrice(symbol);

            if (!data) {
                return res.status(404).json({
                    success: false,
                    error: `Price unavailable for ${symbol}`,
                    payment: getPaymentInfo(req, 'oracle'),
                });
            }

            return res.json({
                success: true,
                data,
                payment: getPaymentInfo(req, 'oracle'),
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                error: (error as Error).message,
            });
        }
    });

    router.post('/oracle/prices', protect('POST', '/oracle/prices', 'oracle', 'Batch oracle prices'), async (req: Request, res: Response) => {
        try {
            const { symbols } = req.body as { symbols?: string[] };
            const data = await fetchPrices(symbols || ['BTC', 'ETH']);

            return res.json({
                success: true,
                data,
                payment: getPaymentInfo(req, 'oracle'),
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                error: (error as Error).message,
            });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // CHAIN SCOUT
    // ─────────────────────────────────────────────────────────────────────────

    router.get('/scout/analyze', protect('GET', '/scout/analyze', 'scout', 'Wallet analytics report'), async (req: Request, res: Response) => {
        try {
            const address = req.query.address as string;
            if (!address) {
                return res.status(400).json({ success: false, error: 'Address required' });
            }

            const data = await analyzeWallet(address);
            if (!data) {
                return res.status(404).json({ success: false, error: 'Wallet analysis unavailable' });
            }

            return res.json({
                success: true,
                data,
                payment: getPaymentInfo(req, 'scout'),
            });
        } catch (error) {
            return res.status(500).json({ success: false, error: (error as Error).message });
        }
    });

    router.get('/scout/gas', protect('GET', '/scout/gas', 'scout', 'Current gas market data'), async (req: Request, res: Response) => {
        try {
            const data = await getGasPrices();
            return res.json({
                success: true,
                data,
                payment: getPaymentInfo(req, 'scout'),
            });
        } catch (error) {
            return res.status(500).json({ success: false, error: (error as Error).message });
        }
    });

    router.get('/scout/gas-estimate', protect('GET', '/scout/gas-estimate', 'scout', 'Gas estimate for transaction type'), async (req: Request, res: Response) => {
        try {
            const operation = (req.query.operation as string) || 'eth_transfer';
            const data = await estimateTransactionCost(operation);
            if (!data) {
                return res.status(404).json({
                    success: false,
                    error: `No estimate for operation: ${operation}`,
                });
            }

            return res.json({
                success: true,
                data,
                payment: getPaymentInfo(req, 'scout'),
            });
        } catch (error) {
            return res.status(500).json({ success: false, error: (error as Error).message });
        }
    });

    router.get('/scout/dex', protect('GET', '/scout/dex', 'scout', 'DEX volume report by chain'), async (req: Request, res: Response) => {
        try {
            const chain = (req.query.chain as string) || 'ethereum';
            const data = await getDexReport(chain);
            if (!data) {
                return res.status(404).json({ success: false, error: `DEX report unavailable for ${chain}` });
            }

            return res.json({
                success: true,
                data,
                payment: getPaymentInfo(req, 'scout'),
            });
        } catch (error) {
            return res.status(500).json({ success: false, error: (error as Error).message });
        }
    });

    router.get('/scout/protocol', protect('GET', '/scout/protocol', 'scout', 'Protocol TVL and fees stats'), async (req: Request, res: Response) => {
        try {
            const protocol = (req.query.protocol as string) || '';
            if (!protocol) {
                return res.status(400).json({ success: false, error: 'Protocol required' });
            }

            const data = await getProtocolStats(protocol);
            if (!data) {
                return res.status(404).json({ success: false, error: `Protocol not found: ${protocol}` });
            }

            return res.json({
                success: true,
                data,
                payment: getPaymentInfo(req, 'scout'),
            });
        } catch (error) {
            return res.status(500).json({ success: false, error: (error as Error).message });
        }
    });

    router.get('/scout/bridges', protect('GET', '/scout/bridges', 'scout', 'Top bridge activity'), async (req: Request, res: Response) => {
        try {
            const data = await getBridges();
            if (!data) {
                return res.status(404).json({ success: false, error: 'Bridge data unavailable' });
            }

            return res.json({
                success: true,
                data,
                payment: getPaymentInfo(req, 'scout'),
            });
        } catch (error) {
            return res.status(500).json({ success: false, error: (error as Error).message });
        }
    });

    router.get('/scout/hacks', protect('GET', '/scout/hacks', 'scout', 'Recent exploit and hack feed'), async (req: Request, res: Response) => {
        try {
            const data = await getHacks();
            if (!data) {
                return res.status(404).json({ success: false, error: 'Hack feed unavailable' });
            }

            return res.json({
                success: true,
                data,
                payment: getPaymentInfo(req, 'scout'),
            });
        } catch (error) {
            return res.status(500).json({ success: false, error: (error as Error).message });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // NFT SCOUT
    // ─────────────────────────────────────────────────────────────────────────

    router.get('/scout/nft/:slug', protect('GET', '/scout/nft/:slug', 'nft', 'NFT collection analytics'), async (req: Request, res: Response) => {
        try {
            const { slug } = req.params;
            const data = await nftScoutService.analyzeCollection(slug);

            return res.json({
                success: true,
                data,
                payment: getPaymentInfo(req, 'nft'),
            });
        } catch (error) {
            return res.status(500).json({ success: false, error: (error as Error).message });
        }
    });

    router.get('/scout/search', protect('GET', '/scout/search', 'nft', 'NFT collection discovery by keyword'), async (req: Request, res: Response) => {
        try {
            const query = req.query.q as string;
            if (!query) {
                return res.status(400).json({ success: false, error: 'Query required' });
            }

            const data = await nftScoutService.searchCollections(query);
            return res.json({
                success: true,
                data,
                payment: getPaymentInfo(req, 'nft'),
            });
        } catch (error) {
            return res.status(500).json({ success: false, error: (error as Error).message });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // NEWS
    // ─────────────────────────────────────────────────────────────────────────

    router.get('/news/search', protect('GET', '/news/search', 'news', 'Topic-based crypto news search'), async (req: Request, res: Response) => {
        try {
            const query = req.query.query as string;
            const limit = Number(req.query.limit || 10);
            if (!query) {
                return res.status(400).json({ success: false, error: 'Query required' });
            }

            const data = await searchNews(query, limit);
            return res.json({
                success: true,
                data,
                payment: getPaymentInfo(req, 'news'),
            });
        } catch (error) {
            return res.status(500).json({ success: false, error: (error as Error).message });
        }
    });

    router.get('/news/latest', protect('GET', '/news/latest', 'news', 'Latest crypto headlines'), async (req: Request, res: Response) => {
        try {
            const limit = Number(req.query.limit || 10);
            const data = await getLatestNews(limit);
            return res.json({
                success: true,
                data,
                payment: getPaymentInfo(req, 'news'),
            });
        } catch (error) {
            return res.status(500).json({ success: false, error: (error as Error).message });
        }
    });

    router.get('/news/breaking', protect('GET', '/news/breaking', 'news', 'Breaking crypto news'), async (req: Request, res: Response) => {
        try {
            const data = await getBreakingNews();
            return res.json({
                success: true,
                data,
                payment: getPaymentInfo(req, 'news'),
            });
        } catch (error) {
            return res.status(500).json({ success: false, error: (error as Error).message });
        }
    });

    router.get('/news/trending', protect('GET', '/news/trending', 'news', 'Trending topics and sentiment'), async (req: Request, res: Response) => {
        try {
            const data = await getTrendingTopics();
            return res.json({
                success: true,
                data,
                payment: getPaymentInfo(req, 'news'),
            });
        } catch (error) {
            return res.status(500).json({ success: false, error: (error as Error).message });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // YIELD
    // ─────────────────────────────────────────────────────────────────────────

    router.get('/yield/top', protect('GET', '/yield/top', 'yield', 'Top APY opportunities'), async (req: Request, res: Response) => {
        try {
            const chain = req.query.chain as string | undefined;
            const minApy = Number(req.query.minApy || 0);
            const maxApy = req.query.maxApy ? Number(req.query.maxApy) : undefined;
            const type = req.query.type as string | undefined;
            const protocol = req.query.protocol as string | undefined;
            const limit = Number(req.query.limit || 20);

            const data = await getTopYields({
                chain,
                minApy,
                maxApy,
                type,
                protocol,
                limit,
            });

            return res.json({
                success: true,
                data,
                payment: getPaymentInfo(req, 'yield'),
            });
        } catch (error) {
            return res.status(500).json({ success: false, error: (error as Error).message });
        }
    });

    router.get('/yield/asset', protect('GET', '/yield/asset', 'yield', 'Yield opportunities for specific asset'), async (req: Request, res: Response) => {
        try {
            const token = req.query.token as string;
            if (!token) {
                return res.status(400).json({ success: false, error: 'Token required' });
            }

            const data = await getYieldsForAsset(token);
            return res.json({
                success: true,
                data,
                payment: getPaymentInfo(req, 'yield'),
            });
        } catch (error) {
            return res.status(500).json({ success: false, error: (error as Error).message });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TOKENOMICS
    // ─────────────────────────────────────────────────────────────────────────

    router.get('/tokenomics/analyze', protect('GET', '/tokenomics/analyze', 'tokenomics', 'Tokenomics and unlock analysis'), async (req: Request, res: Response) => {
        try {
            const symbol = (req.query.symbol as string) || 'ARB';
            const data = await analyzeTokenomics(symbol);
            if (!data) {
                return res.status(404).json({ success: false, error: `Token not found: ${symbol}` });
            }

            return res.json({
                success: true,
                data,
                payment: getPaymentInfo(req, 'tokenomics'),
            });
        } catch (error) {
            return res.status(500).json({ success: false, error: (error as Error).message });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // PERP
    // ─────────────────────────────────────────────────────────────────────────

    router.get('/perp/markets', protect('GET', '/perp/markets', 'perp', 'Perpetual markets snapshot'), async (req: Request, res: Response) => {
        try {
            const data = await perpService.getMarkets();

            return res.json({
                success: true,
                data,
                meta: {
                    count: data.length,
                    sources: [...new Set(data.map((m) => m.exchange))],
                },
                payment: getPaymentInfo(req, 'perp'),
            });
        } catch (error) {
            return res.status(500).json({ success: false, error: (error as Error).message });
        }
    });

    router.get('/perp/global', protect('GET', '/perp/global', 'perp', 'Global perp market summary'), async (req: Request, res: Response) => {
        try {
            const data = await perpService.getGlobalStats();
            return res.json({
                success: true,
                data,
                payment: getPaymentInfo(req, 'perp'),
            });
        } catch (error) {
            return res.status(500).json({ success: false, error: (error as Error).message });
        }
    });

    // Health check (free)
    router.get('/health', (_req: Request, res: Response) => {
        res.json({
            status: 'ok',
            network: BASE_SEPOLIA_NETWORK,
            facilitator: X402_FACILITATOR_URL,
            agents: sellerAddresses,
            endpoints: {
                oracle: ['GET /oracle/price', 'POST /oracle/prices'],
                scout: [
                    'GET /scout/analyze',
                    'GET /scout/gas',
                    'GET /scout/gas-estimate',
                    'GET /scout/dex',
                    'GET /scout/protocol',
                    'GET /scout/bridges',
                    'GET /scout/hacks',
                ],
                news: ['GET /news/search', 'GET /news/latest', 'GET /news/breaking', 'GET /news/trending'],
                yield: ['GET /yield/top', 'GET /yield/asset'],
                tokenomics: ['GET /tokenomics/analyze'],
                nft: ['GET /scout/nft/:slug', 'GET /scout/search'],
                perp: ['GET /perp/markets', 'GET /perp/global'],
            },
        });
    });

    return router;
}
