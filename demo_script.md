# Arcana Demo Script (~5 Minutes)

> **Target:** Hackathon submission video showcasing Arcana, a gasless AI agent marketplace.

---

## 🎬 INTRO (30 seconds)

**[SCREEN: Show homepage with "Meet Arcana" hero text]**

> "Hi, I'm [Your Name], and this is **Arcana** — a next-generation AI agent marketplace where specialized crypto agents collaborate to answer your questions, and pay each other using Circle's x402 protocol.
>
> Unlike traditional chatbots, Arcana doesn't just generate text. It **orchestrates a swarm of specialized agents** — each with its own wallet — to fetch real-time data from oracles, news feeds, DEXs, and on-chain analytics."

---

## 🔌 WALLET CONNECTION (30 seconds)

**[ACTION: Click the "Connect Wallet" button in the top-right corner]**

> "To use Arcana, users connect their wallet. We support MetaMask, Rabby, and other EIP-6963 wallets via ConnectKit."

**[ACTION: Show the signature request popup]**

> "For security, we ask users to sign a message to verify ownership. This prevents impersonation and ensures only the wallet owner can access their session history."

**[ACTION: Sign the message]**

> "Now I'm connected on **Arc Testnet**, where USDC is the native gas token."

---

## 💬 CHAT DEMO – MULTI-AGENT ORCHESTRATION (2 minutes)

**[SCREEN: Main chat interface]**

> "Let's ask Arcana a complex question that requires multiple data sources."

**[ACTION: Type and send: "What's the current price of ETH and the latest crypto news?"]**

> "Watch what happens behind the scenes..."

**[SCREEN: Show the response loading, then the answer appears]**

> "Arcana's coordinator received my query and recognized it needed TWO specialized agents:
> 1. The **Price Oracle** for real-time ETH pricing from CoinGecko.
> 2. The **News Scout** for the latest headlines.
>
> Each agent was **paid instantly via x402** — Circle's gasless payment protocol. No gas fees, no delays. Just signed intents settled off-chain."

**[ACTION: Scroll down to show the agent attribution at the bottom of the response, if visible, or describe it]**

> "You can see which agents contributed to the answer. Each one earned a micro-payment — as low as $0.01 — for their work."

---

### Demo Query #2: On-Chain Analytics

**[ACTION: Type and send: "Analyze this wallet: 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"]**

> "This is Vitalik's wallet. Arcana routes this to the **Chain Scout** agent, which uses Alchemy and Etherscan APIs to fetch portfolio data, transaction history, and NFT holdings."

**[SCREEN: Show the wallet analysis response with token balances, NFTs, etc.]**

> "In seconds, I get a full breakdown — top tokens, NFT floor prices, recent transactions — all formatted beautifully by Gemini."

---

### Demo Query #3: Perpetual Markets

**[ACTION: Type and send: "Compare BTC funding rates across exchanges"]**

> "This query goes to the **Universal Perp Stats** agent, which aggregates data from Hyperliquid, dYdX, Lighter, and more."

**[SCREEN: Show the table comparing funding rates across exchanges]**

> "Traders can instantly see where funding is highest or lowest — useful for arbitrage strategies."

---

## 🤖 PROVIDERS PAGE (30 seconds)

**[ACTION: Click "Providers" in the sidebar]**

> "The Providers page lists all available agents. Each one has a wallet address, a price per query, and performance stats like average response time and user ratings."

**[SCREEN: Scroll through the provider cards]**

> "We have:
> - **Price Oracle** for token prices
> - **Chain Scout** for wallet and protocol analytics
> - **News Scout** for headlines
> - **Yield Optimizer** for DeFi yields
> - **Tokenomics Analyzer** for vesting and unlock schedules
> - **NFT Scout** for OpenSea collection stats
> - **Universal Perp Stats** for derivatives data"

---

## 💰 DEPOSIT PAGE (30 seconds)

**[ACTION: Click "Deposit" in the sidebar]**

> "To fund your account, you can bridge USDC from other testnets using Circle's **CCTP** — Cross-Chain Transfer Protocol."

**[SCREEN: Show the chain selection (Ethereum Sepolia, Arbitrum Sepolia, etc.)]**

> "Select your source chain, enter an amount, and CCTP handles the burn-and-mint process. Funds arrive on Arc Testnet in about 30 seconds."

**[SCREEN: Show the "Request Testnet Funds" button]**

> "For testing, we also integrated the Circle Faucet to request free testnet USDC."

---

## 🏁 CLOSING (30 seconds)

**[SCREEN: Return to the chat page]**

> "To recap: **Arcana** is a pay-as-you-go AI marketplace where:
> - Users pay $0.03 per query directly in USDC.
> - The coordinator agent **subcontracts specialized agents** via x402 gasless payments.
> - Every agent earns for their work — no gas fees, instant settlement.
>
> We're building the **agent-to-agent economy**, and Circle's x402 is the backbone that makes it possible.
>
> Thanks for watching!"

---

## ✅ OPTIONAL B-ROLL IDEAS

- Show the backend logs printing x402 payment confirmations.
- Briefly show the Render dashboard with the live backend.
- Show the agent wallet balances accumulating earnings.

---

## 📋 QUERIES TO USE (Copy-Paste Ready)

1. `What's the current price of ETH and the latest crypto news?`
2. `Analyze this wallet: 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045`
3. `Compare BTC funding rates across exchanges`
4. `What are the best DeFi yields for USDC right now?`
5. `Show me the floor price and volume for Pudgy Penguins`
6. `What's Arbitrum's tokenomics and next unlock event?`

---

Good luck with your submission! 🚀
