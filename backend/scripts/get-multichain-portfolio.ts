
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' }); // Load root .env

const API_KEY = process.env.ETHERSCAN_API_KEY;
const ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // Vitalik.eth

const CHAINS = [
    { id: 1, name: "Ethereum Mainnet" },
    { id: 56, name: "BNB Smart Chain Mainnet" },
    { id: 137, name: "Polygon Mainnet" },
    { id: 8453, name: "Base Mainnet" },
    { id: 42161, name: "Arbitrum One Mainnet" },
    { id: 42170, name: "Arbitrum Nova Mainnet" },
    { id: 59144, name: "Linea Mainnet" },
    { id: 81457, name: "Blast Mainnet" },
    { id: 10, name: "OP Mainnet" },
    { id: 43114, name: "Avalanche C-Chain" },
    { id: 199, name: "BitTorrent Chain Mainnet" },
    { id: 42220, name: "Celo Mainnet" },
    { id: 252, name: "Fraxtal Mainnet" },
    { id: 100, name: "Gnosis" },
    { id: 5000, name: "Mantle Mainnet" },
    { id: 4352, name: "Memecore Mainnet" },
    { id: 1284, name: "Moonbeam Mainnet" },
    { id: 1285, name: "Moonriver Mainnet" },
    { id: 204, name: "opBNB Mainnet" },
    { id: 534352, name: "Scroll Mainnet" },
    { id: 167000, name: "Taiko Mainnet" },
    { id: 50, name: "XDC Mainnet" },
    { id: 33139, name: "ApeChain Mainnet" },
    { id: 480, name: "World Mainnet" },
    { id: 146, name: "Sonic Mainnet" },
    { id: 130, name: "Unichain Mainnet" },
    { id: 2741, name: "Abstract Mainnet" },
    { id: 80094, name: "Berachain Mainnet" },
    { id: 1923, name: "Swellchain Mainnet" },
    { id: 143, name: "Monad Mainnet" },
    { id: 999, name: "HyperEVM Mainnet" },
    { id: 747474, name: "Katana Mainnet" },
    { id: 1329, name: "Sei Mainnet" },
    { id: 988, name: "Stable Mainnet" },
    { id: 9745, name: "Plasma Mainnet" }
];

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchEtherscan(chainId: number, params: string) {
    const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&apikey=${API_KEY}&${params}`;

    try {
        const res = await fetch(url);
        const data = await res.json();
        await sleep(150);
        return data;
    } catch (e) {
        return { status: "0", result: [] };
    }
}

async function getNativeBalance(chain: { id: number, name: string }) {
    const data = await fetchEtherscan(chain.id, `module=account&action=balance&address=${ADDRESS}&tag=latest`);
    if (data.status === "1") {
        const bal = parseFloat(data.result) / 1e18;
        return bal;
    }
    return 0;
}

// Helper to determine if a token is likely spam
function isSpam(symbol: string): boolean {
    const s = symbol.toLowerCase();
    return s.includes("http") || s.includes("www") || s.includes(".com") || s.includes(".io") || s.includes(".xyz") || s.length > 15;
}


// DefiLlama Chain Mapping
const LLAMA_CHAINS: Record<number, string> = {
    1: "ethereum",
    56: "bsc",
    137: "polygon",
    8453: "base",
    42161: "arbitrum",
    10: "optimism",
    43114: "avax",
    59144: "linea"
};

async function getPrices(tokens: { contract: string, chainId: number }[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();
    const chunks = [];

    // Group by llama supported chains
    const validTokens = tokens.filter(t => LLAMA_CHAINS[t.chainId]);
    if (validTokens.length === 0) return prices;

    // Chunk requests (max 100 per call usually safe)
    for (let i = 0; i < validTokens.length; i += 50) {
        const chunk = validTokens.slice(i, i + 50);
        const query = chunk.map(t => `${LLAMA_CHAINS[t.chainId]}:${t.contract}`).join(',');

        try {
            const res = await fetch(`https://coins.llama.fi/prices/current/${query}`);
            const data = await res.json();

            if (data.coins) {
                for (const key in data.coins) {
                    // key format: "chain:address"
                    const address = key.split(':')[1];
                    prices.set(address.toLowerCase(), data.coins[key].price);
                }
            }
        } catch (e) {
            // console.error("Price fetch failed", e);
        }
    }
    return prices;
}

async function getTokens(chain: { id: number, name: string }, nativeBal: number) {
    const contracts = new Set<string>();
    const symbols = new Map<string, string>();
    const decimals = new Map<string, number>();

    // Explicitly add WhiteRock (WHITE) on Ethereum
    if (chain.id === 1) {
        const whiteRock = "0x9cdf242Ef7975D8c68D5C1F5B6905801699b1940";
        contracts.add(whiteRock.toLowerCase());
        symbols.set(whiteRock.toLowerCase(), "WHITE");
        decimals.set(whiteRock.toLowerCase(), 18);
    }

    // "Deep Scan": Fetch history pages to find older assets (KNC, OMG, etc.)
    // We scan up to 5 pages of 1000 txs = 5000 txs.
    // Etherscan max offset is usually 10000 but 3000-5000 covers most active users.
    const maxPages = 5;
    let txCount = 0;

    process.stderr.write(`Scanning ${chain.name} (Deep History)... \r`);

    for (let page = 1; page <= maxPages; page++) {
        const data = await fetchEtherscan(chain.id, `module=account&action=tokentx&address=${ADDRESS}&page=${page}&offset=1000&sort=desc`);

        if (data.status === "1" && Array.isArray(data.result)) {
            if (data.result.length === 0) break;

            txCount += data.result.length;
            data.result.forEach((tx: any) => {
                contracts.add(tx.contractAddress);
                symbols.set(tx.contractAddress, tx.tokenSymbol || "UNK");
                decimals.set(tx.contractAddress, parseInt(tx.tokenDecimal || "18"));
            });

            // If page is not full, we reached end
            if (data.result.length < 1000) break;
        } else {
            break;
        }
        await sleep(200); // Respect rate limits during pagination
    }

    let tokens: { symbol: string, balance: number, contract: string, chainId: number, value: number, price: number }[] = [];

    // 2. Fetch Balances for each contract
    for (const contract of contracts) {
        const sym = symbols.get(contract) || "UNK";

        if (isSpam(sym)) continue;

        const balData = await fetchEtherscan(chain.id, `module=account&action=tokenbalance&contractaddress=${contract}&address=${ADDRESS}&tag=latest`);

        if (balData.status === "1") {
            const rawBal = balData.result;
            if (rawBal !== "0") {
                const dec = decimals.get(contract) || 18;
                const bal = parseFloat(rawBal) / Math.pow(10, dec);

                if (bal > 0.0001) {
                    tokens.push({ symbol: sym, balance: bal, contract: contract.toLowerCase(), chainId: chain.id, value: 0, price: 0 });
                }
            }
        }
        await sleep(50); // Speed up slightly
    }

    // 3. Fetch Prices
    if (tokens.length > 0) {
        const tokenPrices = await getPrices(tokens.map(t => ({ contract: t.contract, chainId: t.chainId })));

        tokens.forEach(t => {
            const p = tokenPrices.get(t.contract);
            if (p) {
                t.price = p;
                t.value = t.balance * p;
            }
        });

        // 4. Fetch Native Price
        if (nativeBal > 0 && LLAMA_CHAINS[chain.id]) {
            // Hacky native price fetch: use WETH/WMATIC address usually works, or CoinGecko ID.
            // For prototype, we'll skip native value summation or use a mapping.
            // Actually, DefiLlama supports "coingecko:ethereum" etc.
        }
    }

    // Sort by Value descending
    tokens.sort((a, b) => b.value - a.value);

    // Output Section
    // Only show if value > $1 OR explicitly WhiteRock OR Crypto holdings > 0 with native
    if (nativeBal > 0.001 || tokens.length > 0) {
        console.log(`\n### ${chain.name}`);
        console.log(`| Asset | Balance | Price ($) | Value ($) | Contract |`);
        console.log(`| :--- | :--- | :--- | :--- | :--- |`);

        if (nativeBal > 0.001) {
            console.log(`| **Native** | ${nativeBal.toLocaleString(undefined, { maximumFractionDigits: 4 })} | - | - | - |`);
        }

        for (const t of tokens) {
            // Show if it has value > $0.1 or is the requested WHITE token
            if (t.value > 0.1 || t.symbol === "WHITE" || t.contract === "0x9cdf242ef7975d8c68d5c1f5b6905801699b1940") {
                const priceStr = t.price > 0 ? `$${t.price.toFixed(4)}` : "-";
                const valStr = t.value > 0 ? `$${t.value.toFixed(2)}` : "-";
                console.log(`| ${t.symbol} | ${t.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })} | ${priceStr} | **${valStr}** | \`${t.contract.substring(0, 8)}...\` |`);
            }
        }
    }
}

async function main() {
    console.log(`# Multichain Portfolio Report`);
    console.log(`**Address:** \`${ADDRESS}\``);
    console.log(`**Date:** ${new Date().toISOString().split('T')[0]}`);
    console.log(`\n---`);

    for (const chain of CHAINS) {
        process.stderr.write(`Scanning ${chain.name}...   \r`); // Progress on stderr

        try {
            const native = await getNativeBalance(chain);
            await getTokens(chain, native);
        } catch (e) {
            // Ignore
        }
    }

    process.stderr.write("\n✅ Scan Complete.\n");
}

main();
