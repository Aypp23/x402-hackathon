/**
 * Tokenomics Analyzer Service
 * 
 * Provides token supply data, vesting schedules, unlock events, and allocation breakdowns.
 * Uses CoinGecko (free) for supply data and Mobula (free) for vesting/unlocks.
 */

// Token ID mappings for different APIs (200+ tokens)
const TOKEN_MAPPINGS: Record<string, { coingecko: string; mobula: string; name: string }> = {
    // ═══════════════════════════════════════════════════════════════════════════
    // TOP 50 BY MARKET CAP
    // ═══════════════════════════════════════════════════════════════════════════
    'btc': { coingecko: 'bitcoin', mobula: 'bitcoin', name: 'Bitcoin' },
    'bitcoin': { coingecko: 'bitcoin', mobula: 'bitcoin', name: 'Bitcoin' },
    'eth': { coingecko: 'ethereum', mobula: 'ethereum', name: 'Ethereum' },
    'ethereum': { coingecko: 'ethereum', mobula: 'ethereum', name: 'Ethereum' },
    'usdt': { coingecko: 'tether', mobula: 'tether', name: 'Tether' },
    'xrp': { coingecko: 'ripple', mobula: 'ripple', name: 'XRP' },
    'bnb': { coingecko: 'binancecoin', mobula: 'binancecoin', name: 'BNB' },
    'sol': { coingecko: 'solana', mobula: 'solana', name: 'Solana' },
    'solana': { coingecko: 'solana', mobula: 'solana', name: 'Solana' },
    'usdc': { coingecko: 'usd-coin', mobula: 'usd-coin', name: 'USD Coin' },
    'steth': { coingecko: 'staked-ether', mobula: 'staked-ether', name: 'Lido Staked Ether' },
    'trx': { coingecko: 'tron', mobula: 'tron', name: 'TRON' },
    'doge': { coingecko: 'dogecoin', mobula: 'dogecoin', name: 'Dogecoin' },
    'dogecoin': { coingecko: 'dogecoin', mobula: 'dogecoin', name: 'Dogecoin' },
    'ada': { coingecko: 'cardano', mobula: 'cardano', name: 'Cardano' },
    'cardano': { coingecko: 'cardano', mobula: 'cardano', name: 'Cardano' },
    'bch': { coingecko: 'bitcoin-cash', mobula: 'bitcoin-cash', name: 'Bitcoin Cash' },
    'wbtc': { coingecko: 'wrapped-bitcoin', mobula: 'wrapped-bitcoin', name: 'Wrapped Bitcoin' },
    'link': { coingecko: 'chainlink', mobula: 'chainlink', name: 'Chainlink' },
    'chainlink': { coingecko: 'chainlink', mobula: 'chainlink', name: 'Chainlink' },
    'xlm': { coingecko: 'stellar', mobula: 'stellar', name: 'Stellar' },
    'xmr': { coingecko: 'monero', mobula: 'monero', name: 'Monero' },
    'sui': { coingecko: 'sui', mobula: 'sui', name: 'Sui' },
    'ltc': { coingecko: 'litecoin', mobula: 'litecoin', name: 'Litecoin' },
    'avax': { coingecko: 'avalanche-2', mobula: 'avalanche', name: 'Avalanche' },
    'avalanche': { coingecko: 'avalanche-2', mobula: 'avalanche', name: 'Avalanche' },
    'hbar': { coingecko: 'hedera-hashgraph', mobula: 'hedera', name: 'Hedera' },
    'shib': { coingecko: 'shiba-inu', mobula: 'shiba-inu', name: 'Shiba Inu' },
    'ton': { coingecko: 'the-open-network', mobula: 'the-open-network', name: 'Toncoin' },
    'dai': { coingecko: 'dai', mobula: 'dai', name: 'Dai' },
    'uni': { coingecko: 'uniswap', mobula: 'uniswap', name: 'Uniswap' },
    'uniswap': { coingecko: 'uniswap', mobula: 'uniswap', name: 'Uniswap' },
    'dot': { coingecko: 'polkadot', mobula: 'polkadot', name: 'Polkadot' },
    'polkadot': { coingecko: 'polkadot', mobula: 'polkadot', name: 'Polkadot' },
    'pepe': { coingecko: 'pepe', mobula: 'pepe', name: 'Pepe' },
    'aave': { coingecko: 'aave', mobula: 'aave', name: 'Aave' },
    'tao': { coingecko: 'bittensor', mobula: 'bittensor', name: 'Bittensor' },
    'near': { coingecko: 'near', mobula: 'near', name: 'NEAR Protocol' },
    'etc': { coingecko: 'ethereum-classic', mobula: 'ethereum-classic', name: 'Ethereum Classic' },
    'icp': { coingecko: 'internet-computer', mobula: 'internet-computer', name: 'Internet Computer' },
    'apt': { coingecko: 'aptos', mobula: 'aptos', name: 'Aptos' },
    'aptos': { coingecko: 'aptos', mobula: 'aptos', name: 'Aptos' },
    'kas': { coingecko: 'kaspa', mobula: 'kaspa', name: 'Kaspa' },
    'pol': { coingecko: 'polygon-ecosystem-token', mobula: 'matic', name: 'Polygon (POL)' },
    'matic': { coingecko: 'matic-network', mobula: 'matic', name: 'Polygon (POL)' },
    'polygon': { coingecko: 'polygon-ecosystem-token', mobula: 'matic', name: 'Polygon (POL)' },
    'arb': { coingecko: 'arbitrum', mobula: 'arbitrum', name: 'Arbitrum' },
    'arbitrum': { coingecko: 'arbitrum', mobula: 'arbitrum', name: 'Arbitrum' },

    // ═══════════════════════════════════════════════════════════════════════════
    // TOP 51-100
    // ═══════════════════════════════════════════════════════════════════════════
    'mon': { coingecko: 'monad', mobula: 'monad', name: 'Monad' },
    'monad': { coingecko: 'monad', mobula: 'monad', name: 'Monad' },
    'algo': { coingecko: 'algorand', mobula: 'algorand', name: 'Algorand' },
    'fil': { coingecko: 'filecoin', mobula: 'filecoin', name: 'Filecoin' },
    'render': { coingecko: 'render-token', mobula: 'render', name: 'Render' },
    'rndr': { coingecko: 'render-token', mobula: 'render', name: 'Render' },
    'atom': { coingecko: 'cosmos', mobula: 'cosmos', name: 'Cosmos' },
    'cosmos': { coingecko: 'cosmos', mobula: 'cosmos', name: 'Cosmos' },
    'qnt': { coingecko: 'quant-network', mobula: 'quant', name: 'Quant' },
    'bonk': { coingecko: 'bonk', mobula: 'bonk', name: 'Bonk' },
    'vet': { coingecko: 'vechain', mobula: 'vechain', name: 'VeChain' },
    'sei': { coingecko: 'sei-network', mobula: 'sei', name: 'Sei' },
    'jup': { coingecko: 'jupiter-exchange-solana', mobula: 'jupiter', name: 'Jupiter' },
    'stx': { coingecko: 'blockstack', mobula: 'stacks', name: 'Stacks' },
    'fet': { coingecko: 'fetch-ai', mobula: 'fetch-ai', name: 'Fetch.ai' },
    'op': { coingecko: 'optimism', mobula: 'optimism', name: 'Optimism' },
    'optimism': { coingecko: 'optimism', mobula: 'optimism', name: 'Optimism' },
    'crv': { coingecko: 'curve-dao-token', mobula: 'curve', name: 'Curve' },
    'curve': { coingecko: 'curve-dao-token', mobula: 'curve', name: 'Curve' },
    'ldo': { coingecko: 'lido-dao', mobula: 'lido-dao', name: 'Lido DAO' },
    'floki': { coingecko: 'floki', mobula: 'floki', name: 'Floki' },
    'inj': { coingecko: 'injective-protocol', mobula: 'injective', name: 'Injective' },
    'tia': { coingecko: 'celestia', mobula: 'celestia', name: 'Celestia' },
    'celestia': { coingecko: 'celestia', mobula: 'celestia', name: 'Celestia' },
    'grt': { coingecko: 'the-graph', mobula: 'the-graph', name: 'The Graph' },
    'ens': { coingecko: 'ethereum-name-service', mobula: 'ens', name: 'Ethereum Name Service' },
    'wif': { coingecko: 'dogwifcoin', mobula: 'dogwifhat', name: 'dogwifhat' },
    'pyth': { coingecko: 'pyth-network', mobula: 'pyth', name: 'Pyth Network' },
    'pendle': { coingecko: 'pendle', mobula: 'pendle', name: 'Pendle' },
    'gno': { coingecko: 'gnosis', mobula: 'gnosis', name: 'Gnosis' },
    'mnt': { coingecko: 'mantle', mobula: 'mantle', name: 'Mantle' },
    'strk': { coingecko: 'starknet', mobula: 'starknet', name: 'Starknet' },

    // ═══════════════════════════════════════════════════════════════════════════
    // TOP 101-200
    // ═══════════════════════════════════════════════════════════════════════════
    'theta': { coingecko: 'theta-token', mobula: 'theta', name: 'Theta Network' },
    'mkr': { coingecko: 'maker', mobula: 'maker', name: 'Maker' },
    'maker': { coingecko: 'maker', mobula: 'maker', name: 'Maker' },
    'flow': { coingecko: 'flow', mobula: 'flow', name: 'Flow' },
    'axs': { coingecko: 'axie-infinity', mobula: 'axie-infinity', name: 'Axie Infinity' },
    'fxs': { coingecko: 'frax-share', mobula: 'frax-share', name: 'Frax Share' },
    'sand': { coingecko: 'the-sandbox', mobula: 'the-sandbox', name: 'The Sandbox' },
    'rune': { coingecko: 'thorchain', mobula: 'thorchain', name: 'THORChain' },
    'eos': { coingecko: 'eos', mobula: 'eos', name: 'EOS' },
    'mana': { coingecko: 'decentraland', mobula: 'decentraland', name: 'Decentraland' },
    'gala': { coingecko: 'gala', mobula: 'gala', name: 'Gala' },
    'comp': { coingecko: 'compound-governance-token', mobula: 'compound', name: 'Compound' },
    'snx': { coingecko: 'synthetix-network-token', mobula: 'synthetix', name: 'Synthetix' },
    'zk': { coingecko: 'zksync', mobula: 'zksync', name: 'zkSync' },
    'mina': { coingecko: 'mina-protocol', mobula: 'mina', name: 'Mina Protocol' },
    'neo': { coingecko: 'neo', mobula: 'neo', name: 'Neo' },
    'ape': { coingecko: 'apecoin', mobula: 'apecoin', name: 'ApeCoin' },
    'kava': { coingecko: 'kava', mobula: 'kava', name: 'Kava' },
    'axl': { coingecko: 'axelar', mobula: 'axelar', name: 'Axelar' },
    'woo': { coingecko: 'woo-network', mobula: 'woo', name: 'WOO Network' },
    'dydx': { coingecko: 'dydx-chain', mobula: 'dydx', name: 'dYdX' },
    'egld': { coingecko: 'elrond-erd-2', mobula: 'multiversx', name: 'MultiversX' },
    'ksm': { coingecko: 'kusama', mobula: 'kusama', name: 'Kusama' },
    'osmo': { coingecko: 'osmosis', mobula: 'osmosis', name: 'Osmosis' },
    'zro': { coingecko: 'layerzero', mobula: 'layerzero', name: 'LayerZero' },
    'ar': { coingecko: 'arweave', mobula: 'arweave', name: 'Arweave' },
    'yfi': { coingecko: 'yearn-finance', mobula: 'yearn', name: 'yearn.finance' },
    'zeta': { coingecko: 'zetachain', mobula: 'zetachain', name: 'ZetaChain' },
    'w': { coingecko: 'wormhole', mobula: 'wormhole', name: 'Wormhole' },
    'lpt': { coingecko: 'livepeer', mobula: 'livepeer', name: 'Livepeer' },
    'imx': { coingecko: 'immutable-x', mobula: 'immutable-x', name: 'Immutable X' },
    'sushi': { coingecko: 'sushi', mobula: 'sushi', name: 'SushiSwap' },
    'celo': { coingecko: 'celo', mobula: 'celo', name: 'Celo' },
    'rose': { coingecko: 'oasis-network', mobula: 'oasis', name: 'Oasis Network' },

    // ═══════════════════════════════════════════════════════════════════════════
    // DEFI PROTOCOLS
    // ═══════════════════════════════════════════════════════════════════════════
    'gmx': { coingecko: 'gmx', mobula: 'gmx', name: 'GMX' },
    'bat': { coingecko: 'basic-attention-token', mobula: 'bat', name: 'Basic Attention Token' },
    'lrc': { coingecko: 'loopring', mobula: 'loopring', name: 'Loopring' },
    'rpl': { coingecko: 'rocket-pool', mobula: 'rocket-pool', name: 'Rocket Pool' },
    'enj': { coingecko: 'enjincoin', mobula: 'enjin', name: 'Enjin Coin' },
    'cvx': { coingecko: 'convex-finance', mobula: 'convex', name: 'Convex Finance' },
    'bal': { coingecko: 'balancer', mobula: 'balancer', name: 'Balancer' },
    'stg': { coingecko: 'stargate-finance', mobula: 'stargate', name: 'Stargate Finance' },
    'joe': { coingecko: 'joe', mobula: 'trader-joe', name: 'Trader Joe' },
    'metis': { coingecko: 'metis-token', mobula: 'metis', name: 'Metis' },
    'ray': { coingecko: 'raydium', mobula: 'raydium', name: 'Raydium' },
    'ocean': { coingecko: 'ocean-protocol', mobula: 'ocean', name: 'Ocean Protocol' },
    'spell': { coingecko: 'spell-token', mobula: 'spell', name: 'Spell Token' },
    'rdnt': { coingecko: 'radiant-capital', mobula: 'radiant', name: 'Radiant Capital' },
    'perp': { coingecko: 'perpetual-protocol', mobula: 'perpetual', name: 'Perpetual Protocol' },
    'lqty': { coingecko: 'liquity', mobula: 'liquity', name: 'Liquity' },
    'alcx': { coingecko: 'alchemix', mobula: 'alchemix', name: 'Alchemix' },
    'dodo': { coingecko: 'dodo', mobula: 'dodo', name: 'DODO' },
    'frax': { coingecko: 'frax', mobula: 'frax', name: 'Frax' },

    // ═══════════════════════════════════════════════════════════════════════════
    // GAMING & METAVERSE
    // ═══════════════════════════════════════════════════════════════════════════
    'ilv': { coingecko: 'illuvium', mobula: 'illuvium', name: 'Illuvium' },
    'alice': { coingecko: 'my-neighbor-alice', mobula: 'alice', name: 'My Neighbor Alice' },
    'ghst': { coingecko: 'aavegotchi', mobula: 'aavegotchi', name: 'Aavegotchi' },
    'tlm': { coingecko: 'alien-worlds', mobula: 'alien-worlds', name: 'Alien Worlds' },
    'ron': { coingecko: 'ronin', mobula: 'ronin', name: 'Ronin' },
    'slp': { coingecko: 'smooth-love-potion', mobula: 'slp', name: 'Smooth Love Potion' },
    'ygg': { coingecko: 'yield-guild-games', mobula: 'ygg', name: 'Yield Guild Games' },
    'magic': { coingecko: 'magic', mobula: 'magic', name: 'Magic' },
    'prime': { coingecko: 'echelon-prime', mobula: 'prime', name: 'Echelon Prime' },
    'atlas': { coingecko: 'star-atlas', mobula: 'star-atlas', name: 'Star Atlas' },
    'gods': { coingecko: 'gods-unchained', mobula: 'gods', name: 'Gods Unchained' },
    'pyr': { coingecko: 'vulcan-forged', mobula: 'vulcan-forged', name: 'Vulcan Forged' },

    // ═══════════════════════════════════════════════════════════════════════════
    // AI & DATA
    // ═══════════════════════════════════════════════════════════════════════════
    'agix': { coingecko: 'singularitynet', mobula: 'singularitynet', name: 'SingularityNET' },
    'trac': { coingecko: 'origintrail', mobula: 'origintrail', name: 'OriginTrail' },
    'storj': { coingecko: 'storj', mobula: 'storj', name: 'Storj' },
    'ankr': { coingecko: 'ankr', mobula: 'ankr', name: 'Ankr' },
    'glm': { coingecko: 'golem', mobula: 'golem', name: 'Golem' },
    'hnt': { coingecko: 'helium', mobula: 'helium', name: 'Helium' },
    'iotx': { coingecko: 'iotex', mobula: 'iotex', name: 'IoTeX' },
    'sc': { coingecko: 'siacoin', mobula: 'siacoin', name: 'Siacoin' },
    'flux': { coingecko: 'zelcash', mobula: 'flux', name: 'Flux' },

    // ═══════════════════════════════════════════════════════════════════════════
    // MEME COINS
    // ═══════════════════════════════════════════════════════════════════════════
    'popcat': { coingecko: 'popcat', mobula: 'popcat', name: 'Popcat' },
    'brett': { coingecko: 'brett', mobula: 'brett', name: 'Brett' },
    'mog': { coingecko: 'mog-coin', mobula: 'mog', name: 'Mog Coin' },
    'babydoge': { coingecko: 'baby-doge-coin', mobula: 'baby-doge', name: 'Baby Doge Coin' },
    'elon': { coingecko: 'dogelon-mars', mobula: 'dogelon', name: 'Dogelon Mars' },
    'mew': { coingecko: 'cat-in-a-dogs-world', mobula: 'mew', name: 'cat in a dogs world' },
    'neiro': { coingecko: 'neiro', mobula: 'neiro', name: 'Neiro' },
    'bome': { coingecko: 'book-of-meme', mobula: 'bome', name: 'Book of Meme' },

    // ═══════════════════════════════════════════════════════════════════════════
    // LAYER 2 & SCALING
    // ═══════════════════════════════════════════════════════════════════════════
    'base': { coingecko: 'base', mobula: 'base', name: 'Base' },
    'scr': { coingecko: 'scroll', mobula: 'scroll', name: 'Scroll' },
    'zil': { coingecko: 'zilliqa', mobula: 'zilliqa', name: 'Zilliqa' },
    'skl': { coingecko: 'skale', mobula: 'skale', name: 'SKALE' },
    'astr': { coingecko: 'astar', mobula: 'astar', name: 'Astar' },
    'cfx': { coingecko: 'conflux-token', mobula: 'conflux', name: 'Conflux' },
    'celr': { coingecko: 'celer-network', mobula: 'celer', name: 'Celer Network' },
    'ckb': { coingecko: 'nervos-network', mobula: 'nervos', name: 'Nervos Network' },

    // ═══════════════════════════════════════════════════════════════════════════
    // INFRASTRUCTURE & ORACLES
    // ═══════════════════════════════════════════════════════════════════════════
    'band': { coingecko: 'band-protocol', mobula: 'band', name: 'Band Protocol' },
    'api3': { coingecko: 'api3', mobula: 'api3', name: 'API3' },
    'uma': { coingecko: 'uma', mobula: 'uma', name: 'UMA' },
    'ssv': { coingecko: 'ssv-network', mobula: 'ssv', name: 'SSV Network' },
    'dia': { coingecko: 'dia-data', mobula: 'dia', name: 'DIA' },
    'ctsi': { coingecko: 'cartesi', mobula: 'cartesi', name: 'Cartesi' },
    'rlc': { coingecko: 'iexec-rlc', mobula: 'iexec', name: 'iExec RLC' },

    // ═══════════════════════════════════════════════════════════════════════════
    // ORDINALS & BTC ECOSYSTEM
    // ═══════════════════════════════════════════════════════════════════════════
    'ordi': { coingecko: 'ordinals', mobula: 'ordi', name: 'ORDI' },
    'sats': { coingecko: 'sats-ordinals', mobula: 'sats', name: 'SATS (Ordinals)' },
    'runes': { coingecko: 'runes', mobula: 'runes', name: 'Runes' },
    'dogs': { coingecko: 'dogs-2', mobula: 'dogs', name: 'DOGS' },

    // ═══════════════════════════════════════════════════════════════════════════
    // AI AGENTS & NEW TOKENS
    // ═══════════════════════════════════════════════════════════════════════════
    'virtual': { coingecko: 'virtual-protocol', mobula: 'virtual-protocol', name: 'Virtuals Protocol' },
    'ai16z': { coingecko: 'ai16z', mobula: 'ai16z', name: 'ai16z' },
    'aixbt': { coingecko: 'aixbt', mobula: 'aixbt', name: 'AIXBT' },
    'zerebro': { coingecko: 'zerebro', mobula: 'zerebro', name: 'Zerebro' },
    'griffain': { coingecko: 'griffain', mobula: 'griffain', name: 'Griffain' },
    'arc': { coingecko: 'arc-2', mobula: 'arc', name: 'Arc' },
    'cookie': { coingecko: 'cookie-dao', mobula: 'cookie', name: 'Cookie DAO' },
    'fartcoin': { coingecko: 'fartcoin', mobula: 'fartcoin', name: 'Fartcoin' },
    'goat': { coingecko: 'goatseus-maximus', mobula: 'goat', name: 'GOAT' },
    'grass': { coingecko: 'grass', mobula: 'grass', name: 'Grass' },
    'io': { coingecko: 'io', mobula: 'io', name: 'io.net' },
    'ondo': { coingecko: 'ondo-finance', mobula: 'ondo', name: 'Ondo Finance' },
    'ena': { coingecko: 'ethena', mobula: 'ethena', name: 'Ethena' },
    'ethena': { coingecko: 'ethena', mobula: 'ethena', name: 'Ethena' },
    'usde': { coingecko: 'ethena-usde', mobula: 'usde', name: 'USDe' },
    'eigen': { coingecko: 'eigenlayer', mobula: 'eigenlayer', name: 'Eigenlayer' },
    'eigenlayer': { coingecko: 'eigenlayer', mobula: 'eigenlayer', name: 'Eigenlayer' },

    // ═══════════════════════════════════════════════════════════════════════════
    // SOLANA ECOSYSTEM
    // ═══════════════════════════════════════════════════════════════════════════
    'jto': { coingecko: 'jito-governance-token', mobula: 'jito', name: 'Jito' },
    'jito': { coingecko: 'jito-governance-token', mobula: 'jito', name: 'Jito' },
    'drift': { coingecko: 'drift-protocol', mobula: 'drift', name: 'Drift Protocol' },
    'orca': { coingecko: 'orca', mobula: 'orca', name: 'Orca' },
    'mnde': { coingecko: 'marinade', mobula: 'marinade', name: 'Marinade' },
    'msol': { coingecko: 'msol', mobula: 'msol', name: 'Marinade Staked SOL' },
    'hxro': { coingecko: 'hxro', mobula: 'hxro', name: 'Hxro' },
    'samo': { coingecko: 'samoyedcoin', mobula: 'samo', name: 'Samoyedcoin' },
    'wen': { coingecko: 'wen-4', mobula: 'wen', name: 'Wen' },
    'tensor': { coingecko: 'tensor', mobula: 'tensor', name: 'Tensor' },
    'kmno': { coingecko: 'kamino', mobula: 'kamino', name: 'Kamino' },
    'kamino': { coingecko: 'kamino', mobula: 'kamino', name: 'Kamino' },

    // ═══════════════════════════════════════════════════════════════════════════
    // MORE LAYER 2 & NEW CHAINS
    // ═══════════════════════════════════════════════════════════════════════════
    'blur': { coingecko: 'blur', mobula: 'blur', name: 'Blur' },
    'blast': { coingecko: 'blast', mobula: 'blast', name: 'Blast' },
    'mode': { coingecko: 'mode', mobula: 'mode', name: 'Mode' },
    'linea': { coingecko: 'linea', mobula: 'linea', name: 'Linea' },
    'taiko': { coingecko: 'taiko', mobula: 'taiko', name: 'Taiko' },
    'sonic': { coingecko: 'sonic-svm', mobula: 'sonic', name: 'Sonic' },
    'fuel': { coingecko: 'fuel-network', mobula: 'fuel', name: 'Fuel Network' },
    'movement': { coingecko: 'movement', mobula: 'movement', name: 'Movement' },
    'move': { coingecko: 'movement', mobula: 'movement', name: 'Movement' },
    'hyperliquid': { coingecko: 'hyperliquid', mobula: 'hyperliquid', name: 'Hyperliquid' },
    'hype': { coingecko: 'hyperliquid', mobula: 'hyperliquid', name: 'Hyperliquid' },
    'berachain': { coingecko: 'berachain-bera', mobula: 'berachain', name: 'Berachain' },
    'bera': { coingecko: 'berachain-bera', mobula: 'berachain', name: 'Berachain' },
    'abstract': { coingecko: 'abstract', mobula: 'abstract', name: 'Abstract' },

    // ═══════════════════════════════════════════════════════════════════════════
    // MORE DEFI & PERPS
    // ═══════════════════════════════════════════════════════════════════════════
    'morpho': { coingecko: 'morpho', mobula: 'morpho', name: 'Morpho' },
    'ethfi': { coingecko: 'ether-fi', mobula: 'etherfi', name: 'Ether.fi' },
    'etherfi': { coingecko: 'ether-fi', mobula: 'etherfi', name: 'Ether.fi' },
    'eeth': { coingecko: 'ether-fi-staked-eth', mobula: 'eeth', name: 'ether.fi Staked ETH' },
    'weeth': { coingecko: 'wrapped-eeth', mobula: 'weeth', name: 'Wrapped eETH' },
    'puffer': { coingecko: 'puffer-finance', mobula: 'puffer', name: 'Puffer Finance' },
    'renzo': { coingecko: 'renzo', mobula: 'renzo', name: 'Renzo' },
    'ezeth': { coingecko: 'renzo-restaked-eth', mobula: 'ezeth', name: 'Renzo Restaked ETH' },
    'kelp': { coingecko: 'kelp-dao-restaked-eth', mobula: 'kelp', name: 'Kelp DAO' },
    'vertex': { coingecko: 'vertex-protocol', mobula: 'vertex', name: 'Vertex Protocol' },
    'vrtx': { coingecko: 'vertex-protocol', mobula: 'vertex', name: 'Vertex Protocol' },
    'aevo': { coingecko: 'aevo-exchange', mobula: 'aevo', name: 'Aevo' },
    'safe': { coingecko: 'safe', mobula: 'safe', name: 'Safe' },
    'cow': { coingecko: 'cow-protocol', mobula: 'cow', name: 'CoW Protocol' },

    // ═══════════════════════════════════════════════════════════════════════════
    // MORE MEMECOINS
    // ═══════════════════════════════════════════════════════════════════════════
    'trump': { coingecko: 'official-trump', mobula: 'trump', name: 'Official Trump' },
    'melania': { coingecko: 'melania-meme', mobula: 'melania', name: 'Melania Meme' },
    'pnut': { coingecko: 'peanut-the-squirrel', mobula: 'pnut', name: 'Peanut the Squirrel' },
    'act': { coingecko: 'act-i-the-ai-prophecy', mobula: 'act', name: 'Act I' },
    'chillguy': { coingecko: 'just-a-chill-guy', mobula: 'chillguy', name: 'Just a Chill Guy' },
    'spx': { coingecko: 'spx6900', mobula: 'spx6900', name: 'SPX6900' },
    'giga': { coingecko: 'giga-chad', mobula: 'giga', name: 'Gigachad' },
    'mother': { coingecko: 'mother-iggy', mobula: 'mother', name: 'Mother Iggy' },
    'retardio': { coingecko: 'retardio', mobula: 'retardio', name: 'Retardio' },

    // ═══════════════════════════════════════════════════════════════════════════
    // RWA & STABLECOINS
    // ═══════════════════════════════════════════════════════════════════════════
    'eur': { coingecko: 'eurc', mobula: 'eurc', name: 'Euro Coin' },
    'eurc': { coingecko: 'eurc', mobula: 'eurc', name: 'Euro Coin' },
    'gho': { coingecko: 'gho', mobula: 'gho', name: 'GHO' },
    'crvusd': { coingecko: 'crvusd', mobula: 'crvusd', name: 'crvUSD' },
    'lusd': { coingecko: 'liquity-usd', mobula: 'lusd', name: 'Liquity USD' },
    'usdm': { coingecko: 'usdm', mobula: 'usdm', name: 'USDM' },
    'pyusd': { coingecko: 'paypal-usd', mobula: 'pyusd', name: 'PayPal USD' },
};

export interface SupplyData {
    circulating: number;
    total: number;
    max: number | null;
    circulatingFormatted: string;
    totalFormatted: string;
    maxFormatted: string | null;
    percentUnlocked: number;
}

export interface UnlockEvent {
    date: string;
    amount: number;
    amountFormatted: string;
    percentOfCirculating: number;
    recipient?: string;
    riskLevel: string;
}

export interface Allocation {
    category: string;
    percentage: number;
    amount?: number;
    amountFormatted?: string;
}

export interface TokenomicsData {
    symbol: string;
    name: string;
    supply: SupplyData;
    nextUnlock: UnlockEvent | null;
    upcomingUnlocks: UnlockEvent[];
    allocations: Allocation[];
    inflation: {
        annualRate: string;
        fullyDilutedBy: string | null;
    };
    fetchedAt: string;
}

function formatNumber(num: number): string {
    if (num >= 1_000_000_000) {
        return (num / 1_000_000_000).toFixed(2) + 'B';
    } else if (num >= 1_000_000) {
        return (num / 1_000_000).toFixed(2) + 'M';
    } else if (num >= 1_000) {
        return (num / 1_000).toFixed(2) + 'K';
    }
    return num.toFixed(2);
}

function getUnlockRisk(percentOfCirculating: number): string {
    if (percentOfCirculating > 5) return "🔴 HIGH - Major unlock, significant selling pressure expected";
    if (percentOfCirculating > 2) return "🟠 MEDIUM - Noticeable selling pressure likely";
    if (percentOfCirculating > 0.5) return "🟡 LOW - Minor supply increase";
    return "🟢 MINIMAL - Negligible impact";
}

async function fetchCoinGeckoSupply(coinId: string): Promise<SupplyData | null> {
    try {
        const url = `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`;
        const response = await fetch(url);

        if (!response.ok) {
            console.error(`[Tokenomics] CoinGecko error: ${response.status}`);
            return null;
        }

        const data = await response.json();
        const marketData = data.market_data;

        const circulating = marketData.circulating_supply || 0;
        const total = marketData.total_supply || circulating;
        const max = marketData.max_supply;

        const percentUnlocked = total > 0 ? (circulating / total) * 100 : 100;

        return {
            circulating,
            total,
            max,
            circulatingFormatted: formatNumber(circulating),
            totalFormatted: formatNumber(total),
            maxFormatted: max ? formatNumber(max) : null,
            percentUnlocked: Math.round(percentUnlocked * 10) / 10,
        };
    } catch (error) {
        console.error('[Tokenomics] CoinGecko fetch error:', error);
        return null;
    }
}

async function fetchMobulaVesting(assetName: string): Promise<{ unlocks: UnlockEvent[], allocations: Allocation[] } | null> {
    const maxRetries = 3;
    const baseDelay = 1000; // 1 second

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // Mobula's metadata endpoint includes vesting info
            const url = `https://api.mobula.io/api/1/metadata?asset=${assetName}`;
            const response = await fetch(url);

            if (response.status === 429) {
                // Rate limited - wait and retry with exponential backoff
                const delay = baseDelay * Math.pow(2, attempt);
                console.log(`[Tokenomics] Mobula rate limited (429), retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            if (!response.ok) {
                console.log(`[Tokenomics] Mobula returned ${response.status}, vesting data may not be available`);
                return null;
            }

            const data = await response.json();

            // Parse vesting/unlock data from Mobula response
            const unlocks: UnlockEvent[] = [];
            const allocations: Allocation[] = [];

            // Mobula includes distribution and vesting in different formats
            if (data.data?.distribution) {
                const distribution = data.data.distribution;

                if (Array.isArray(distribution)) {
                    // Handle array format (e.g., Optimism)
                    for (const item of distribution) {
                        if (item.percentage) {
                            allocations.push({
                                category: item.name || item.category || 'Unknown',
                                percentage: parseFloat(item.percentage) || 0,
                            });
                        }
                    }
                } else {
                    // Handle object format where key is category
                    for (const [category, info] of Object.entries(distribution as Record<string, any>)) {
                        if (info.percentage) {
                            allocations.push({
                                category: category.charAt(0).toUpperCase() + category.slice(1),
                                percentage: parseFloat(info.percentage) || 0,
                            });
                        }
                    }
                }
            }

            // Check for unlock schedule
            if (data.data?.release_schedule && Array.isArray(data.data.release_schedule)) {
                const now = new Date();
                for (const event of data.data.release_schedule) {
                    const eventDate = new Date(event.date || event.unlock_date);
                    if (eventDate > now) {
                        const amount = parseFloat(event.amount || event.tokens || event.tokens_to_unlock || 0);

                        // Parse allocation_details to show who gets what
                        let recipient = event.recipient || event.category || '';
                        if (event.allocation_details && typeof event.allocation_details === 'object') {
                            const details = Object.entries(event.allocation_details)
                                .map(([name, amt]) => `${name}: ${formatNumber(amt as number)}`)
                                .join(', ');
                            recipient = details || recipient;
                        }

                        unlocks.push({
                            date: eventDate.toISOString().split('T')[0],
                            amount,
                            amountFormatted: formatNumber(amount),
                            percentOfCirculating: event.percent || 0,
                            recipient: recipient || 'Unknown',
                            riskLevel: getUnlockRisk(event.percent || 0),
                        });
                    }
                }
                // Sort by date
                unlocks.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            }

            return { unlocks, allocations };
        } catch (error) {
            console.error('[Tokenomics] Mobula fetch error:', error);
            if (attempt === maxRetries - 1) {
                return null;
            }
        }
    }

    // All retries exhausted
    console.log(`[Tokenomics] Mobula API failed after ${maxRetries} retries`);
    return null;
}

// Hardcoded allocation data for major tokens (since free APIs don't always have this)
const KNOWN_ALLOCATIONS: Record<string, Allocation[]> = {
    'arbitrum': [
        { category: 'DAO Treasury', percentage: 42.78 },
        { category: 'Team & Advisors', percentage: 26.94 },
        { category: 'Investors', percentage: 17.53 },
        { category: 'Community (Airdrop)', percentage: 11.62 },
    ],
    'matic-network': [
        { category: 'Staking Rewards', percentage: 12 },
        { category: 'Team', percentage: 16 },
        { category: 'Advisors', percentage: 4 },
        { category: 'Foundation', percentage: 21.86 },
        { category: 'Ecosystem', percentage: 23.33 },
        { category: 'Private Sale', percentage: 19.28 },
        { category: 'Launchpad Sale', percentage: 3.53 },
    ],
    'polygon-ecosystem-token': [
        { category: 'Staking Rewards', percentage: 12 },
        { category: 'Team', percentage: 16 },
        { category: 'Advisors', percentage: 4 },
        { category: 'Foundation', percentage: 21.86 },
        { category: 'Ecosystem', percentage: 23.33 },
        { category: 'Private Sale', percentage: 19.28 },
        { category: 'Launchpad Sale', percentage: 3.53 },
    ],
    'monad': [
        { category: 'Core Team', percentage: 20 },
        { category: 'Investors', percentage: 20 },
        { category: 'Ecosystem & Grants', percentage: 30 },
        { category: 'Community', percentage: 30 },
    ],
    'optimism': [
        { category: 'Ecosystem Fund', percentage: 25 },
        { category: 'Retroactive Public Goods', percentage: 20 },
        { category: 'Core Contributors', percentage: 19 },
        { category: 'Investors', percentage: 17 },
        { category: 'Airdrops', percentage: 19 },
    ],
    'sui': [
        { category: 'Community Reserve', percentage: 50 },
        { category: 'Core Contributors', percentage: 20 },
        { category: 'Investors', percentage: 14 },
        { category: 'Mysten Labs Treasury', percentage: 10 },
        { category: 'Community Access Program', percentage: 6 },
    ],
    'aptos': [
        { category: 'Community', percentage: 51.02 },
        { category: 'Core Contributors', percentage: 19 },
        { category: 'Foundation', percentage: 16.5 },
        { category: 'Investors', percentage: 13.48 },
    ],
    'celestia': [
        { category: 'Public Allocation', percentage: 20 },
        { category: 'R&D + Ecosystem', percentage: 26.8 },
        { category: 'Core Contributors', percentage: 35.6 },
        { category: 'Investors', percentage: 17.6 },
    ],
};

export async function analyzeTokenomics(symbol: string): Promise<TokenomicsData | null> {
    const normalizedSymbol = symbol.toLowerCase().trim();
    const mapping = TOKEN_MAPPINGS[normalizedSymbol];

    if (!mapping) {
        console.log(`[Tokenomics] Token not found in mappings: ${symbol}`);
        // Try to use symbol directly for CoinGecko
        const supply = await fetchCoinGeckoSupply(normalizedSymbol);
        if (!supply) {
            return null;
        }

        return {
            symbol: symbol.toUpperCase(),
            name: symbol,
            supply,
            nextUnlock: null,
            upcomingUnlocks: [],
            allocations: [],
            inflation: {
                annualRate: 'Unknown',
                fullyDilutedBy: null,
            },
            fetchedAt: new Date().toISOString(),
        };
    }

    console.log(`[Tokenomics] Analyzing ${mapping.name} (${symbol.toUpperCase()})...`);

    // Fetch supply data from CoinGecko
    const supply = await fetchCoinGeckoSupply(mapping.coingecko);
    if (!supply) {
        return null;
    }

    // Try to fetch vesting data from Mobula
    const vestingData = await fetchMobulaVesting(mapping.mobula);

    // Use known allocations if Mobula doesn't return any
    let allocations = vestingData?.allocations || [];
    if (allocations.length === 0 && KNOWN_ALLOCATIONS[mapping.coingecko]) {
        allocations = KNOWN_ALLOCATIONS[mapping.coingecko];
    }

    // Get unlocks from Mobula
    const unlocks = vestingData?.unlocks || [];
    const nextUnlock = unlocks.length > 0 ? unlocks[0] : null;

    // Calculate inflation estimate
    let annualRate = 'Unknown';
    if (supply.total > 0 && supply.circulating > 0) {
        const remaining = supply.total - supply.circulating;
        if (remaining > 0) {
            // Rough estimate: remaining tokens released over 3-4 years
            const yearlyRelease = remaining / 3.5;
            const rate = (yearlyRelease / supply.circulating) * 100;
            annualRate = `~${rate.toFixed(1)}%`;
        } else {
            annualRate = '0% (Fully Circulating)';
        }
    }

    // Estimate fully diluted date
    let fullyDilutedBy: string | null = null;
    if (supply.percentUnlocked < 100) {
        const yearsRemaining = ((100 - supply.percentUnlocked) / 100) * 4; // Assume 4-year schedule
        const fullyDilutedDate = new Date();
        fullyDilutedDate.setFullYear(fullyDilutedDate.getFullYear() + Math.ceil(yearsRemaining));
        fullyDilutedBy = `~${fullyDilutedDate.getFullYear()}`;
    }

    return {
        symbol: symbol.toUpperCase(),
        name: mapping.name,
        supply,
        nextUnlock,
        upcomingUnlocks: unlocks.slice(0, 5), // Top 5 upcoming unlocks
        allocations,
        inflation: {
            annualRate,
            fullyDilutedBy,
        },
        fetchedAt: new Date().toISOString(),
    };
}

// Get list of supported tokens
export function getSupportedTokens(): string[] {
    const unique = new Set<string>();
    for (const [key, value] of Object.entries(TOKEN_MAPPINGS)) {
        // Only add main symbol (shorter version)
        if (key.length <= 5) {
            unique.add(key.toUpperCase());
        }
    }
    return Array.from(unique).sort();
}
