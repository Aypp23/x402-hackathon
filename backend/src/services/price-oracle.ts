import { config } from "../config.js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";

// Log API key status
console.log(`[Oracle] CoinGecko API key ${COINGECKO_API_KEY ? "loaded ✅" : "NOT SET (using free tier) ⚠️"}`);

// Price cache to reduce API calls
interface CachedPrice {
    data: PriceData;
    timestamp: number;
}

const priceCache = new Map<string, CachedPrice>();

export interface PriceData {
    symbol: string;
    name: string;
    price: number;
    currency: string;
    change24h: number;
    marketCap: number;
    volume24h: number;
    lastUpdated: string;
}

// Symbol to CoinGecko ID mapping (Top 500 by market cap)
const SYMBOL_TO_ID: Record<string, string> = {
    // ═══════════════════════════════════════════════════════════════════════════
    // TOP 50 BY MARKET CAP
    // ═══════════════════════════════════════════════════════════════════════════
    btc: "bitcoin", bitcoin: "bitcoin",
    eth: "ethereum", ethereum: "ethereum",
    usdt: "tether", tether: "tether",
    xrp: "ripple", ripple: "ripple",
    bnb: "binancecoin", binance: "binancecoin",
    sol: "solana", solana: "solana",
    usdc: "usd-coin",
    steth: "staked-ether",
    trx: "tron", tron: "tron",
    doge: "dogecoin", dogecoin: "dogecoin",
    ada: "cardano", cardano: "cardano",
    bch: "bitcoin-cash",
    wbtc: "wrapped-bitcoin",
    link: "chainlink", chainlink: "chainlink",
    leo: "leo-token",
    xlm: "stellar", stellar: "stellar",
    xmr: "monero", monero: "monero",
    sui: "sui",
    ltc: "litecoin", litecoin: "litecoin",
    hype: "hyperliquid", hyperliquid: "hyperliquid",
    avax: "avalanche-2", avalanche: "avalanche-2",
    hbar: "hedera-hashgraph", hedera: "hedera-hashgraph",
    shib: "shiba-inu",
    ton: "the-open-network",
    dai: "dai",
    cro: "crypto-com-chain",
    uni: "uniswap", uniswap: "uniswap",
    dot: "polkadot", polkadot: "polkadot",
    pepe: "pepe",
    aave: "aave",
    tao: "bittensor", bittensor: "bittensor",
    bgb: "bitget-token",
    okb: "okb",
    near: "near",
    etc: "ethereum-classic",
    ena: "ethena",
    icp: "internet-computer",
    wld: "worldcoin-wld", worldcoin: "worldcoin-wld",
    apt: "aptos", aptos: "aptos",
    ondo: "ondo-finance",
    kas: "kaspa", kaspa: "kaspa",
    pol: "polygon-ecosystem-token", matic: "polygon-ecosystem-token", polygon: "polygon-ecosystem-token",
    mon: "monad", monad: "monad",
    arb: "arbitrum", arbitrum: "arbitrum",

    // ═══════════════════════════════════════════════════════════════════════════
    // TOP 51-100
    // ═══════════════════════════════════════════════════════════════════════════
    algo: "algorand", algorand: "algorand",
    fil: "filecoin", filecoin: "filecoin",
    render: "render-token", rndr: "render-token",
    atom: "cosmos", cosmos: "cosmos",
    qnt: "quant-network",
    trump: "official-trump",
    bonk: "bonk",
    vet: "vechain", vechain: "vechain",
    flr: "flare-networks",
    nexo: "nexo",
    sei: "sei-network",
    pengu: "pudgy-penguins",
    virtual: "virtual-protocol",
    ip: "story-2",
    jup: "jupiter-exchange-solana", jupiter: "jupiter-exchange-solana",
    cake: "pancakeswap-token",
    stx: "blockstack", stacks: "blockstack",
    fet: "fetch-ai",
    morpho: "morpho",
    op: "optimism", optimism: "optimism",
    crv: "curve-dao-token", curve: "curve-dao-token",
    xtz: "tezos", tezos: "tezos",
    ldo: "lido-dao",
    floki: "floki",
    dash: "dash",
    aero: "aerodrome-finance",
    inj: "injective-protocol", injective: "injective-protocol",
    ethfi: "ether-fi",
    tia: "celestia", celestia: "celestia",
    fdusd: "first-digital-usd",
    gho: "gho",
    chz: "chiliz", chiliz: "chiliz",
    strk: "starknet", starknet: "starknet",
    iota: "iota",
    btt: "bittorrent",
    grt: "the-graph",
    ens: "ethereum-name-service",
    cfx: "conflux-token",
    wif: "dogwifcoin", dogwifhat: "dogwifcoin",
    pyth: "pyth-network",
    kaia: "kaia",
    xpl: "plasma", plasma: "plasma",
    pendle: "pendle",
    gno: "gnosis", gnosis: "gnosis",
    s: "sonic-3", sonic: "sonic-3",
    eurc: "euro-coin",
    jasmy: "jasmycoin",
    ohm: "olympus",
    zec: "zcash", zcash: "zcash",
    pi: "pi-network",
    sky: "sky",
    mnt: "mantle", mantle: "mantle",

    // ═══════════════════════════════════════════════════════════════════════════
    // TOP 101-200
    // ═══════════════════════════════════════════════════════════════════════════
    ftt: "ftx-token",
    theta: "theta-token",
    mkr: "maker", maker: "maker",
    flow: "flow",
    axs: "axie-infinity",
    fxs: "frax-share",
    sand: "the-sandbox",
    xdc: "xdce-crowd-sale",
    ao: "ao",
    rune: "thorchain", thorchain: "thorchain",
    eos: "eos",
    mana: "decentraland", decentraland: "decentraland",
    kcs: "kucoin-shares",
    gala: "gala",
    aioz: "aioz-network",
    dexe: "dexe",
    beam: "beam-2",
    mog: "mog-coin",
    blur: "blur",
    comp: "compound-governance-token", compound: "compound-governance-token",
    snx: "synthetix-network-token", synthetix: "synthetix-network-token",
    zk: "zksync",
    grass: "grass",
    mina: "mina-protocol",
    neo: "neo",
    ape: "apecoin",
    fartcoin: "fartcoin",
    kava: "kava",
    bsv: "bitcoin-sv",
    wemix: "wemix-token",
    corechain: "coredaoorg",
    axl: "axelar",
    rsr: "reserve-rights-token",
    super: "superfarm",
    woo: "woo-network",
    dydx: "dydx-chain",
    egld: "elrond-erd-2", multiversx: "elrond-erd-2",
    ksm: "kusama", kusama: "kusama",
    osmo: "osmosis",
    zro: "layerzero", layerzero: "layerzero",
    xec: "ecash",
    "1inch": "1inch", oneinch: "1inch",
    safe: "safe",
    eigen: "eigenlayer",
    luna: "terra-luna-2",
    iotx: "iotex",
    pnut: "pnut",
    neiro: "neiro",
    ar: "arweave", arweave: "arweave",
    yfi: "yearn-finance", yearn: "yearn-finance",
    zeta: "zetachain",
    bome: "book-of-meme",
    w: "wormhole",
    brett: "brett",
    lpt: "livepeer",
    twt: "trust-wallet-token",
    orca: "orca",
    prime: "echelon-prime",
    imx: "immutable-x",
    sushi: "sushi",
    sats: "sats-ordinals",
    celo: "celo",
    rose: "oasis-network",
    sfp: "safepal",
    cetus: "cetus-protocol",
    deep: "deepbook",
    move: "movement",
    mew: "cat-in-a-dogs-world",
    ace: "fusionai",
    santos: "santos-fc-fan-token",

    // ═══════════════════════════════════════════════════════════════════════════
    // TOP 201-300
    // ═══════════════════════════════════════════════════════════════════════════
    rvn: "ravencoin",
    gt: "gatechain-token",
    ssv: "ssv-network",
    glm: "golem",
    magic: "magic",
    waves: "waves",
    ankr: "ankr",
    scr: "scroll",
    xem: "nem",
    lunc: "terra-luna",
    ustc: "terrausd",
    bat: "basic-attention-token",
    io: "io-net",
    lrc: "loopring",
    zil: "zilliqa",
    audio: "audius",
    qtum: "qtum",
    sxp: "swipe",
    cheel: "cheelee",
    mplx: "metaplex",
    gmx: "gmx",
    skl: "skale",
    ont: "ontology",
    dent: "dent",
    mx: "mx-token",
    ckb: "nervos-network",
    hot: "holotoken",
    hnt: "helium",
    jto: "jito-governance-token",
    prcl: "parcl",
    tnsr: "tensor",
    // wld and blur already defined above
    nft: "apenft",
    icx: "icon",
    zen: "horizen",
    paxg: "pax-gold",
    rpl: "rocket-pool",
    enj: "enjincoin",
    uma: "uma",
    sc: "siacoin",
    ilv: "illuvium",
    tusd: "true-usd",
    stg: "stargate-finance",
    qkc: "quarkchain",
    one: "harmony",
    cvx: "convex-finance",
    wen: "wen-solana",
    cat: "simon-s-cat",
    band: "band-protocol",
    spell: "spell-token",
    popcat: "popcat",
    joe: "joe",
    metis: "metis-token",
    ray: "raydium",
    cvc: "civic",
    agix: "singularitynet",
    storj: "storj",
    ocean: "ocean-protocol",
    ach: "alchemy-pay",
    flux: "zelcash",
    celr: "celer-network",
    mbox: "mobox",

    // ═══════════════════════════════════════════════════════════════════════════
    // TOP 301-400
    // ═══════════════════════════════════════════════════════════════════════════
    bone: "bone-shibaswap",
    mask: "mask-network",
    api3: "api3",
    gmt: "stepn",
    vtho: "vethor-token",
    rdnt: "radiant-capital",
    reef: "reef",
    elf: "aelf",
    rlc: "iexec-rlc",
    nkn: "nkn",
    req: "request-network",
    troy: "troy",
    sys: "syscoin",
    fun: "funfair",
    ctsi: "cartesi",
    people: "constitutiondao",
    lsk: "lisk",
    mav: "maverick-protocol",
    dia: "dia-data",
    ordi: "ordinals",
    high: "highstreet",
    looks: "looksrare",
    powr: "power-ledger",
    oxt: "orchid-protocol",
    coti: "coti",
    prom: "prom",
    perp: "perpetual-protocol",
    waxp: "wax",
    chr: "chromia",
    badger: "badger-dao",
    tribe: "tribe-2",
    clv: "clover-finance",
    bake: "bakerytoken",
    win: "winklink",
    tko: "tokocrypto",
    iost: "iostoken",
    poly: "polymath",
    ardr: "ardor",
    dgb: "digibyte",
    astr: "astar",
    rad: "radicle",
    lqty: "liquity",
    alice: "my-neighbor-alice",
    nxm: "nxm",
    ghst: "aavegotchi",
    phb: "phoenix",
    tlm: "alien-worlds",
    amp: "amp-token",
    xno: "nano",
    bel: "bella-protocol",
    df: "dforce-token",
    forth: "ampleforth-governance-token",
    alpaca: "alpaca-finance",
    aurora: "aurora-near",
    dar: "mines-of-dalarnia",
    lever: "lever",

    // ═══════════════════════════════════════════════════════════════════════════
    // TOP 401-500
    // ═══════════════════════════════════════════════════════════════════════════
    fida: "bonfida",
    steem: "steem",
    akro: "akropolis",
    om: "mantra-dao",
    arpa: "arpa-chain",
    blz: "bluzelle",
    atm: "atletico-madrid",
    jst: "just",
    fis: "stafi",
    orai: "oraichain-token",
    uft: "unlockd-finance",
    vidt: "vidt-dao",
    alcx: "alchemix",
    pond: "marlin",
    ctc: "creditcoin-2",
    quick: "quickswap",
    png: "pangolin",
    epx: "ellipsis",
    hard: "hard-protocol",
    wing: "wing-finance",
    bzrx: "bzx-protocol",
    burger: "burger-swap",
    med: "medibloc",
    vgx: "voyager-token",
    rgt: "rari-governance-token",
    farm: "harvest-finance",
    pols: "polkastarter",
    snt: "status",
    ern: "ethernity-chain",
    tvk: "terra-virtua-kolect",
    tru: "truefi",
    iris: "iris-network",
    chess: "tranchess",
    hifi: "hifi-finance",
    dodo: "dodo",
    btm: "bytom",
    voxel: "voxies",
    raca: "radio-caca",
    cos: "contentos",
    mob: "mobilecoin",
    beta: "beta-finance",
    ogn: "origin-protocol",
    mtl: "metal",
    agi: "singularitynet",
    stmx: "storm",
    xvs: "venus",
    mir: "mirror-protocol",
    cream: "cream-2",
    bnt: "bancor",
    nuls: "nuls",
    keep: "keep-network",
    torn: "tornado-cash",
    kp3r: "keep3rv1",
    rook: "rook",
    hegic: "hegic",
    dpi: "defipulse-index",
    bal: "balancer",
    apy: "apy-finance",
    ygg: "yield-guild-games",
    srm: "serum",
    mngo: "mango-markets",
    cope: "cope",
    step: "step-finance",
    slnd: "solend",
    port: "port-finance",
    oxy: "oxygen",
    tulip: "solfarm",
    prt: "portion",
    like: "likecoin",
    msol: "marinade-staked-sol",
    sbr: "saber",

    // ═══════════════════════════════════════════════════════════════════════════
    // ADDITIONAL POPULAR TOKENS (DEFI, GAMING, AI, MEME)
    // ═══════════════════════════════════════════════════════════════════════════
    // DeFi
    frax: "frax",
    lusd: "liquity-usd",
    susd: "susd",
    frxeth: "frax-ether",
    cbeth: "coinbase-wrapped-staked-eth",
    reth: "rocket-pool-eth",
    weth: "weth",
    // Gaming/Metaverse
    atlas: "star-atlas",
    polis: "star-atlas-dao",
    gods: "gods-unchained",
    pyr: "vulcan-forged",
    mc: "merit-circle",
    ron: "ronin",
    slp: "smooth-love-potion",
    dezzy: "dezzy",
    // AI tokens
    agrs: "agoras",
    trac: "origintrail",
    ait: "aitravis",
    nmt: "netmind-token",
    // Meme coins
    babydoge: "baby-doge-coin",
    kishu: "kishu-inu",
    akita: "akita-inu",
    hoge: "hoge-finance",
    samo: "samoyedcoin",
    elon: "dogelon-mars",
    // Stablecoins
    busd: "binance-usd",
    usdp: "paxos-standard",
    gusd: "gemini-dollar",
    usdd: "usdd",
    mim: "magic-internet-money",
    ust: "terrausd",
    // Wrapped tokens
    wbnb: "wbnb",
    wavax: "wrapped-avax",
    wmatic: "wmatic",
    wsol: "wrapped-solana",
    // Exchange tokens (gt, ht already defined above)
    ht: "huobi-token",
    // ftt and srm already defined above
};

function getCoinGeckoId(symbol: string): string {
    const normalized = symbol.toLowerCase();
    return SYMBOL_TO_ID[normalized] || normalized;
}

function isCacheValid(cached: CachedPrice): boolean {
    const cacheSeconds = 30; // 30 second cache
    return Date.now() - cached.timestamp < cacheSeconds * 1000;
}

export async function fetchPrice(symbol: string): Promise<PriceData | null> {
    const coinId = getCoinGeckoId(symbol);

    // Check cache first
    const cached = priceCache.get(coinId);
    if (cached && isCacheValid(cached)) {
        console.log(`[Oracle] Using cached price for ${coinId}`);
        return cached.data;
    }

    try {
        const url = `${COINGECKO_BASE_URL}/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`;

        const headers: Record<string, string> = {
            'Accept': 'application/json',
        };

        if (COINGECKO_API_KEY) {
            headers['x-cg-demo-api-key'] = COINGECKO_API_KEY;
        }

        const response = await fetch(url, { headers });

        if (!response.ok) {
            console.error(`[Oracle] CoinGecko API error: ${response.status}`);
            return null;
        }

        const data = await response.json();

        const priceData: PriceData = {
            symbol: data.symbol?.toUpperCase() || symbol.toUpperCase(),
            name: data.name || symbol,
            price: data.market_data?.current_price?.usd || 0,
            currency: "USD",
            change24h: data.market_data?.price_change_percentage_24h || 0,
            marketCap: data.market_data?.market_cap?.usd || 0,
            volume24h: data.market_data?.total_volume?.usd || 0,
            lastUpdated: new Date().toISOString(),
        };

        // Cache the result
        priceCache.set(coinId, {
            data: priceData,
            timestamp: Date.now(),
        });

        console.log(`[Oracle] Fetched price for ${coinId}: $${priceData.price}`);
        return priceData;
    } catch (error) {
        console.error(`[Oracle] Failed to fetch price for ${symbol}:`, error);
        return null;
    }
}

export async function fetchPrices(symbols: string[]): Promise<PriceData[]> {
    const results: PriceData[] = [];

    for (const symbol of symbols) {
        const price = await fetchPrice(symbol);
        if (price) {
            results.push(price);
        }
    }

    return results;
}

export function clearPriceCache(): void {
    priceCache.clear();
    console.log("[Oracle] Price cache cleared");
}

// ============ Token Price by Contract Address ============

// Map our internal chain names to CoinGecko platform IDs
const CHAIN_TO_PLATFORM: Record<string, string> = {
    "eth-mainnet": "ethereum",
    "base-mainnet": "base",
    "arb-mainnet": "arbitrum-one",
    "opt-mainnet": "optimistic-ethereum",
    "polygon-mainnet": "polygon-pos",
    "bnb-mainnet": "binance-smart-chain",
    "monad-mainnet": "monad", // CoinGecko platform ID (verify when available)
};

// Known stablecoin addresses (lowercase) - always show these regardless of price lookup
const STABLECOIN_ADDRESSES: Record<string, { symbol: string; price: number }> = {
    // Ethereum
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { symbol: "USDC", price: 1.0 },
    "0xdac17f958d2ee523a2206206994597c13d831ec7": { symbol: "USDT", price: 1.0 },
    "0x6b175474e89094c44da98b954eedeac495271d0f": { symbol: "DAI", price: 1.0 },
    // Base
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", price: 1.0 },
    // Arbitrum
    "0xaf88d065e77c8cc2239327c5edb3a432268e5831": { symbol: "USDC", price: 1.0 },
    "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": { symbol: "USDT", price: 1.0 },
    // Optimism
    "0x0b2c639c533813f4aa9d7837caf62653d097ff85": { symbol: "USDC", price: 1.0 },
    // Polygon
    "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": { symbol: "USDC", price: 1.0 },
};

// Cache for contract-based prices
const tokenPriceCache = new Map<string, { price: number; timestamp: number }>();

/**
 * Fetch token price by contract address using CoinGecko
 * Returns null if price cannot be fetched (token will be skipped)
 */
export async function fetchTokenPrice(chain: string, contractAddress: string): Promise<number | null> {
    const addressLower = contractAddress.toLowerCase();

    // Check if it's a known stablecoin
    const stablecoin = STABLECOIN_ADDRESSES[addressLower];
    if (stablecoin) {
        return stablecoin.price;
    }

    // Native token check
    if (contractAddress === "native") {
        // For native tokens, use the existing fetchPrice logic
        const nativeSymbol = chain.includes("bnb") ? "bnb" : chain.includes("polygon") ? "matic-network" : "ethereum";
        const priceData = await fetchPrice(nativeSymbol);
        return priceData?.price || null;
    }

    const platform = CHAIN_TO_PLATFORM[chain];
    if (!platform) {
        return null;
    }

    // Check cache
    const cacheKey = `${platform}:${addressLower}`;
    const cached = tokenPriceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 60_000) {
        return cached.price;
    }

    // For single token, just return null and rely on batch
    return null;
}

/**
 * Batch fetch token prices for multiple contract addresses on one chain.
 * Returns a map of address -> priceUsd
 */
export async function fetchTokenPricesBatch(
    chain: string,
    contractAddresses: string[]
): Promise<Map<string, number>> {
    const prices = new Map<string, number>();

    if (contractAddresses.length === 0) return prices;

    const platform = CHAIN_TO_PLATFORM[chain];
    if (!platform) return prices;

    // Check cache and collect uncached addresses
    const uncached: string[] = [];
    for (const addr of contractAddresses) {
        const addressLower = addr.toLowerCase();

        // Stablecoin shortcut
        const stablecoin = STABLECOIN_ADDRESSES[addressLower];
        if (stablecoin) {
            prices.set(addressLower, stablecoin.price);
            continue;
        }

        // Check cache
        const cacheKey = `${platform}:${addressLower}`;
        const cached = tokenPriceCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 60_000) {
            prices.set(addressLower, cached.price);
        } else {
            uncached.push(addressLower);
        }
    }

    if (uncached.length === 0) return prices;

    // CoinGecko allows multiple addresses in one call (up to ~100)
    // Split into chunks of 50 to be safe
    const chunks: string[][] = [];
    for (let i = 0; i < uncached.length; i += 50) {
        chunks.push(uncached.slice(i, i + 50));
    }

    for (const chunk of chunks) {
        try {
            const addressesParam = chunk.join(",");
            const url = `${COINGECKO_BASE_URL}/simple/token_price/${platform}?contract_addresses=${addressesParam}&vs_currencies=usd`;

            const headers: Record<string, string> = { 'Accept': 'application/json' };
            if (COINGECKO_API_KEY) {
                headers['x-cg-demo-api-key'] = COINGECKO_API_KEY;
            }

            const response = await fetch(url, { headers });

            if (!response.ok) {
                // Silently skip on error (rate limit, etc.)
                continue;
            }

            const data = await response.json();

            for (const addr of chunk) {
                const price = data[addr]?.usd;
                if (price !== undefined && price !== null) {
                    prices.set(addr, price);
                    tokenPriceCache.set(`${platform}:${addr}`, { price, timestamp: Date.now() });
                }
            }

            // Small delay between chunks to avoid rate limit
            if (chunks.length > 1) {
                await new Promise(r => setTimeout(r, 200));
            }

        } catch (error) {
            // Silently continue
        }
    }

    return prices;
}

