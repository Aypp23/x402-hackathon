# Arcana - AI Agent Marketplace

> Paste into Gamma.app. 10 concise slides, demo-focused.

---

## Slide 1: Title

**Arcana**  
The Gasless AI Agent Marketplace

*Powered by Circle's x402 Protocol on Arc Testnet*

---

## Slide 2: The Problem

AI services are **expensive and siloed**.

Users pay subscriptions for tools they barely use. Independent AI developers have no way to monetize their agents. High gas fees make micropayments impossible.

---

## Slide 3: Our Solution

**Pay-per-query AI marketplace.**

- Users pay **$0.03** per question — no subscriptions
- Specialized agents collaborate to answer queries
- Agents pay each other **instantly via x402** — zero gas fees

---

## Slide 4: How It Works

```
User pays $0.03 → Coordinator Agent → Subcontracts specialists → Each agent earns
```

One payment. Multiple agents. Instant settlement.

The coordinator routes your question to the best agents (prices, news, analytics) and they're paid via x402 signed intents — no blockchain fees.

---

## Slide 5: Meet the Agents

| Agent | What It Does |
|-------|--------------|
| **Price Oracle** | Real-time crypto prices |
| **Chain Scout** | Wallet analytics, DEX volumes |
| **News Scout** | Crypto headlines, sentiment |
| **Yield Optimizer** | Best DeFi yields |
| **NFT Scout** | Collection stats, floor prices |
| **Perp Stats** | Funding rates across exchanges |

Each agent has its own wallet and earns per query.

---

## Slide 6: Demo — Crypto Prices + News

**Query:** "What's the price of ETH and the latest crypto news?"

- Price Oracle fetches live ETH data from CoinGecko
- News Scout aggregates headlines from CoinDesk, The Block
- Both agents paid $0.01 each via x402
- User gets a unified response

*[Insert screenshot or GIF of chat response]*

---

## Slide 7: Demo — Wallet Analysis

**Query:** "Analyze wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"

- Chain Scout fetches portfolio, tokens, NFTs
- Shows transaction history and labels (e.g., "Vitalik.eth")
- Agent paid via x402

*[Insert screenshot of wallet analysis result]*

---

## Slide 8: Demo — DeFi Yields & Perps

**Query:** "Best USDC yields" / "BTC funding rates"

- Yield Optimizer scans Aave, Lido, Beefy, Yearn
- Perp Stats pulls data from Hyperliquid, dYdX
- Results formatted with APY, risk levels, clickable links

*[Insert screenshot of yields/perps response]*

---

## Slide 9: Why x402?

Circle's x402 enables **gasless micropayments**.

Agents sign off-chain payment intents. No gas, instant settlement. This is what makes a pay-per-query agent economy possible.

Without x402, each agent call would cost more in gas than the payment itself.

---

## Slide 10: Try It Now

**Live:** [arcanaa.vercel.app](https://arcanaa.vercel.app)

**Queries to try:**
- "Price of ETH and latest crypto news"
- "Analyze wallet 0xd8dA6BF26..."
- "Best USDC yields"

**GitHub:** [github.com/Aypp23/Arcana](https://github.com/Aypp23/Arcana)

*Questions?*
