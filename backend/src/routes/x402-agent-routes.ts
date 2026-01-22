/**
 * x402 Agent Routes - Seller-Side Protected Endpoints
 * 
 * These endpoints are protected by x402 Gateway middleware.
 * They automatically handle the 402 Payment Required negotiation.
 */

import { Router, Request, Response } from 'express';
import { createGatewayMiddleware } from '@circlefin/x402-batching/server';
import { fetchPrice, fetchPrices } from '../services/price-oracle.js';
import { analyzeWallet, getDexReport, getGasPrices } from '../services/onchain-analytics.js';
import { searchNews, getBreakingNews, getLatestNews } from '../services/news-scout.js';
import { getTopYields, getYieldsForAsset } from '../services/yield-optimizer.js';
import { analyzeTokenomics } from '../services/tokenomics-service.js';
import { nftScoutService } from '../services/nft-scout-service.js';
import { PerpStatsService } from '../services/perp-stats/PerpStatsService.js';

const perpService = new PerpStatsService();

// Agent addresses (sellers receive payments at these addresses)
// These are EOA wallets with private keys in .env - they CAN withdraw from Gateway
const AGENT_ADDRESSES = {
    // New EOA addresses that can withdraw from x402 Gateway
    priceOracle: process.env.ORACLE_X402_ADDRESS || '0xbaFF2E0939f89b53d4caE023078746C2eeA6E2F7',
    chainScout: process.env.SCOUT_X402_ADDRESS || '0xf09bC01bEb00b142071b648c4826Ab48572aEea5',
    newsScout: process.env.NEWS_X402_ADDRESS || '0x32a6778E4D6634BaB9e54A9F78ff5D087179a5c4',
    yieldOptimizer: process.env.YIELD_X402_ADDRESS || '0x095691C40335E7Da13ca669EE3A07eB7422e2be3',
    tokenomics: process.env.TOKENOMICS_X402_ADDRESS || '0xc99A4f20E7433d0B6fB48ca805Ffebe989e48Ca6',
    nftScout: process.env.NFT_SCOUT_X402_ADDRESS || '0xEb6d935822e643Af37ec7C6a7Bd6136c0036Cd69',
    perpStats: process.env.PERP_STATS_X402_ADDRESS || '0x89651811043ba5a04d44b17462d07a0e3cf0565e',
} as const;

// Create Gateway middleware for each agent
const oracleGateway = createGatewayMiddleware({
    sellerAddress: AGENT_ADDRESSES.priceOracle,
});

const scoutGateway = createGatewayMiddleware({
    sellerAddress: AGENT_ADDRESSES.chainScout,
});

const nftScoutGateway = createGatewayMiddleware({
    sellerAddress: AGENT_ADDRESSES.nftScout,
});

const newsGateway = createGatewayMiddleware({
    sellerAddress: AGENT_ADDRESSES.newsScout,
});

const yieldGateway = createGatewayMiddleware({
    sellerAddress: AGENT_ADDRESSES.yieldOptimizer,
});

const tokenomicsGateway = createGatewayMiddleware({
    sellerAddress: AGENT_ADDRESSES.tokenomics,
});

const perpGateway = createGatewayMiddleware({
    sellerAddress: AGENT_ADDRESSES.perpStats,
});

const router = Router();

// Helper to extract payment info from request
function getPaymentInfo(req: Request) {
    // The x402 middleware attaches payment info to req
    const payment = (req as any).payment;
    return payment ? {
        amount: payment.amount,
        payer: payment.payer,
        transaction: payment.transaction,
    } : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRICE ORACLE ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /oracle/price?symbol=BTC
 * Protected: $0.01 per request
 */
router.get('/oracle/price', oracleGateway.require('$0.01') as any, async (req: Request, res: Response) => {
    try {
        const symbol = (req.query.symbol as string) || 'BTC';
        const payment = getPaymentInfo(req);

        console.log(`[x402 Oracle] Price for ${symbol}, paid by ${payment?.payer}`);

        const priceData = await fetchPrice(symbol);

        res.json({
            success: true,
            data: priceData,
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

/**
 * POST /oracle/prices
 * Body: { symbols: ["BTC", "ETH", ...] }
 * Protected: $0.02 for batch
 */
router.post('/oracle/prices', oracleGateway.require('$0.02') as any, async (req: Request, res: Response) => {
    try {
        const { symbols } = req.body as { symbols: string[] };
        const payment = getPaymentInfo(req);

        console.log(`[x402 Oracle] Batch: ${symbols?.join(', ')}, paid by ${payment?.payer}`);

        const prices = await fetchPrices(symbols || ['BTC', 'ETH']);

        res.json({
            success: true,
            data: prices,
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// CHAIN SCOUT ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /scout/analyze?address=0x...
 * Protected: $0.02 per request
 */
router.get('/scout/analyze', scoutGateway.require('$0.02') as any, async (req: Request, res: Response) => {
    try {
        const address = req.query.address as string;
        const payment = getPaymentInfo(req);

        if (!address) {
            return res.status(400).json({ success: false, error: 'Address required' });
        }

        console.log(`[x402 Scout] Analyze ${address}, paid by ${payment?.payer}`);

        const analysis = await analyzeWallet(address);

        res.json({
            success: true,
            data: analysis,
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

/**
 * GET /scout/gas
 * Protected: $0.01 per request
 */
router.get('/scout/gas', scoutGateway.require('$0.01') as any, async (_req: Request, res: Response) => {
    try {
        const payment = getPaymentInfo(_req);

        console.log(`[x402 Scout] Gas prices, paid by ${payment?.payer}`);

        const gasPrices = await getGasPrices();

        res.json({
            success: true,
            data: gasPrices,
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

/**
 * GET /scout/dex?chain=ethereum
 * Protected: $0.01 per request
 */
router.get('/scout/dex', scoutGateway.require('$0.01') as any, async (req: Request, res: Response) => {
    try {
        const chain = (req.query.chain as string) || 'ethereum';
        const payment = getPaymentInfo(req);

        console.log(`[x402 Scout] DEX report for ${chain}, paid by ${payment?.payer}`);

        const dexReport = await getDexReport(chain);

        res.json({
            success: true,
            data: dexReport,
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// NFT SCOUT ENDPOINTS - Manual Settlement for Guaranteed Liquidity
// ─────────────────────────────────────────────────────────────────────────────

import { BatchFacilitatorClient } from '@circlefin/x402-batching/server';

const nftFacilitator = new BatchFacilitatorClient();

/**
 * Helper to handle manual x402 payment
 */
async function handleManualSettlement(req: Request, res: Response, amountStr: string, sellerAddress: string): Promise<boolean> {
    const signature = req.headers['payment-signature'] as string;

    if (!signature) {
        res.status(402).json({
            x402Version: 2,
            resource: {
                url: req.originalUrl || req.url,
                description: 'Paid Resource',
                mimeType: 'application/json'
            },
            accepts: [{
                scheme: 'exact',
                amount: (parseFloat(amountStr.replace('$', '')) * 1000000).toString(), // Convert to microUSDC
                payTo: sellerAddress,
                network: 'eip155:5042002', // Fixed: Use CAIP-2 Chain ID for Arc Testnet
                asset: '0x3600000000000000000000000000000000000000',
                maxTimeoutSeconds: 345600,
                extra: {
                    name: 'GatewayWalletBatched',
                    version: '1',
                    verifyingContract: '0x0077777d7eba4688bdef3e311b846f25870a19b9'
                }
            }]
        });
        return false;
    }

    try {
        const payload = JSON.parse(Buffer.from(signature, 'base64').toString());
        // Simple requirements reconstruction
        const requirements = {
            amount: (parseFloat(amountStr.replace('$', '')) * 1000000).toString(),
            payTo: sellerAddress,
            scheme: 'exact',
            network: 'eip155:5042002',
            asset: '0x3600000000000000000000000000000000000000',
            maxTimeoutSeconds: 345600,
            extra: {
                name: 'GatewayWalletBatched',
                version: '1',
                verifyingContract: '0x0077777d7eba4688bdef3e311b846f25870a19b9'
            }
        };

        // 1. Verify
        const verification = await nftFacilitator.verify(payload, requirements as any);
        if (!verification.isValid) {
            res.status(402).json({ error: 'Invalid signature', details: (verification as any).error });
            return false;
        }

        // 2. Settle (Explicitly flush to Gateway)
        // This is the critical step to ensure funds become Withdrawable
        const settlement = await nftFacilitator.settle(payload, requirements as any);
        if (!settlement.success) {
            console.error('[x402] Settlement failed:', (settlement as any).error);
            res.status(402).json({ error: 'Settlement failed', details: (settlement as any).error });
            return false;
        }

        // Attach payment info for route handler
        (req as any).payment = {
            amount: amountStr,
            payer: (verification as any).payer || payload.payer || 'unknown',
            transaction: (settlement as any).id || (settlement as any).transactionId || 'settled'
        };

        return true;

    } catch (e) {
        console.error('[x402] Error processing payment:', e);
        res.status(400).json({
            error: `Malformed payment header: ${e instanceof Error ? e.message : String(e)}`
        });
        return false;
    }
}

/**
 * GET /scout/nft/:slug
 * Price: $0.02
 */
router.get('/scout/nft/:slug', async (req: Request, res: Response) => {
    // Manual Payment Check
    const paid = await handleManualSettlement(req, res, '$0.02', AGENT_ADDRESSES.nftScout);
    if (!paid) return; // Response already sent

    try {
        const { slug } = req.params;
        const payment = getPaymentInfo(req);

        console.log(`[x402 NFT Scout] Analyze ${slug}, paid by ${payment?.payer} (Explicit Settlement)`);

        const analysis = await nftScoutService.analyzeCollection(slug);

        res.json({
            success: true,
            data: analysis,
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

/**
 * GET /scout/search?q=pudgy
 * Price: $0.01
 */
router.get('/scout/search', async (req: Request, res: Response) => {
    // Manual Payment Check
    const paid = await handleManualSettlement(req, res, '$0.01', AGENT_ADDRESSES.nftScout);
    if (!paid) return;

    try {
        const query = req.query.q as string;
        const payment = getPaymentInfo(req);

        if (!query) {
            return res.status(400).json({ success: false, error: 'Query required' });
        }

        console.log(`[x402 NFT Scout] Search "${query}", paid by ${payment?.payer} (Explicit Settlement)`);

        const results = await nftScoutService.searchCollections(query);

        res.json({
            success: true,
            data: results,
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// NEWS SCOUT ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /news/search?query=bitcoin
 * Protected: $0.01 per request
 */
router.get('/news/search', newsGateway.require('$0.01') as any, async (req: Request, res: Response) => {
    try {
        const query = req.query.query as string;
        const payment = getPaymentInfo(req);

        if (!query) {
            return res.status(400).json({ success: false, error: 'Query required' });
        }

        console.log(`[x402 News] Search "${query}", paid by ${payment?.payer}`);

        const news = await searchNews(query);

        res.json({
            success: true,
            data: news,
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

/**
 * GET /news/latest
 * Protected: $0.01 per request
 */
router.get('/news/latest', newsGateway.require('$0.01') as any, async (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 10;
        const payment = getPaymentInfo(req);

        console.log(`[x402 News] Latest news, paid by ${payment?.payer}`);

        const news = await getLatestNews(limit);

        res.json({
            success: true,
            data: news,
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

/**
 * GET /news/breaking
 * Protected: $0.01 per request
 */
router.get('/news/breaking', newsGateway.require('$0.01') as any, async (req: Request, res: Response) => {
    try {
        const payment = getPaymentInfo(req);

        console.log(`[x402 News] Breaking news, paid by ${payment?.payer}`);

        const news = await getBreakingNews();

        res.json({
            success: true,
            data: news,
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// YIELD OPTIMIZER ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /yield/top?minApy=5&chain=ethereum
 * Protected: $0.01 per request
 */
router.get('/yield/top', yieldGateway.require('$0.01') as any, async (req: Request, res: Response) => {
    try {
        const chain = req.query.chain as string;
        const minApy = parseFloat(req.query.minApy as string) || 0;
        const limit = parseInt(req.query.limit as string) || 20;
        const payment = getPaymentInfo(req);

        console.log(`[x402 Yield] Top yields, paid by ${payment?.payer}`);

        const yields = await getTopYields({ chain, minApy, limit });

        res.json({
            success: true,
            data: yields,
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

/**
 * GET /yield/asset?token=ETH
 * Protected: $0.01 per request
 */
router.get('/yield/asset', yieldGateway.require('$0.01') as any, async (req: Request, res: Response) => {
    try {
        const token = req.query.token as string;
        const payment = getPaymentInfo(req);

        if (!token) {
            return res.status(400).json({ success: false, error: 'Token required' });
        }

        console.log(`[x402 Yield] Yields for ${token}, paid by ${payment?.payer}`);

        const yields = await getYieldsForAsset(token);

        res.json({
            success: true,
            data: yields,
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// TOKENOMICS ANALYZER ENDPOINTS - $0.02 per query
// ─────────────────────────────────────────────────────────────────────────────

// GET /tokenomics/analyze?symbol=ARB - Analyze token economics
router.get('/tokenomics/analyze', tokenomicsGateway.require('$0.02') as any, async (req: Request, res: Response) => {
    try {
        const symbol = req.query.symbol as string || 'ARB';
        const payment = getPaymentInfo(req);

        console.log(`[x402 Tokenomics] Analyzing ${symbol}, paid by ${payment?.payer}`);

        const analysis = await analyzeTokenomics(symbol);

        if (!analysis) {
            return res.status(404).json({
                success: false,
                error: `Token not found: ${symbol}. Supported: ARB, OP, SUI, APT, ETH, etc.`,
            });
        }

        res.json({
            success: true,
            data: analysis,
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PERP STATS AGENT ENDPOINTS - Aggregated "Alpha" Data
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /perp/markets
 * Protected: $0.02 per request
 * Returns consolidated market data from 7+ exchanges
 */
router.get('/perp/markets', perpGateway.require('$0.02') as any, async (req: Request, res: Response) => {
    try {
        const payment = getPaymentInfo(req);
        console.log(`[x402 Perp] Market Data, paid by ${payment?.payer}`);

        const markets = await perpService.getMarkets();

        res.json({
            success: true,
            data: markets,
            meta: {
                count: markets.length,
                sources: [...new Set(markets.map(m => m.exchange))]
            },
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

/**
 * GET /perp/global
 * Protected: $0.02 per request
 * Returns global aggregated stats (Total Volume, OI)
 */
router.get('/perp/global', perpGateway.require('$0.02') as any, async (req: Request, res: Response) => {
    try {
        const payment = getPaymentInfo(req);
        console.log(`[x402 Perp] Global Stats, paid by ${payment?.payer}`);

        const stats = await perpService.getGlobalStats();

        res.json({
            success: true,
            data: stats,
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH CHECK (FREE)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        agents: {
            oracle: AGENT_ADDRESSES.priceOracle,
            scout: AGENT_ADDRESSES.chainScout,
            news: AGENT_ADDRESSES.newsScout,
            yield: AGENT_ADDRESSES.yieldOptimizer,
            tokenomics: AGENT_ADDRESSES.tokenomics,
            nft: AGENT_ADDRESSES.nftScout,
        },
        endpoints: {
            oracle: ['GET /oracle/price', 'POST /oracle/prices'],
            scout: ['GET /scout/analyze', 'GET /scout/gas', 'GET /scout/dex'],
            news: ['GET /news/search', 'GET /news/latest', 'GET /news/breaking'],
            yield: ['GET /yield/top', 'GET /yield/asset'],
            tokenomics: ['GET /tokenomics/analyze'],
            nft: ['GET /scout/nft/:slug', 'GET /scout/search'],
            perp: ['GET /perp/markets', 'GET /perp/global'],
        },
    });
});

export default router;

