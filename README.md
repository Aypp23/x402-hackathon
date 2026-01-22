# Arcana

**Arcana** is a next-generation AI agent marketplace and orchestrator that empowers users with real-time crypto intelligence. It serves as a "personal crypto AI assistant" that can answer complex questions by coordinating specialized sub-agents (Price Oracles, News Scouts, On-Chain Analysts, etc.).

<div align="center">
  <img src="./arc-agent-hub/public/og-image.png" alt="Arcana Banner" width="100%" />
</div>

## 🚀 Features

-   **Multi-Agent Orchestration**: A single query to the main "Arcana" agent can trigger multiple sub-agents to gather data (prices, news, on-chain stats) in parallel.
-   **Real-Time Intelligence**:
    -   **Price Oracle**: Live prices for 100+ tokens (CoinGecko).
    -   **News Scout**: Aggregated crypto news and sentiment analysis.
    -   **Chain Scout**: TVL, volume, and bridge statistics.
    -   **Perp Stats**: Funding rates and open interest from derivatives exchanges.
    -   **Tokenomics**: Vesting schedules and unlock events.
    -   **NFT Scout**: Collection stats and floor prices.
-   **Crypto-Native Payments**:
    -   **User Payments**: Users pay a flat fee ($0.03 USDC) per query directly on the Arc Testnet.
    -   **Agent micro-payments (x402)**: The main agent pays sub-agents using Circle's **x402 proprietary gasless payment protocol**. This allows for high-frequency, zero-gas sub-agent orchestration.
-   **Auto-Withdrawals**: Agents automatically sweep their off-chain x402 earnings to on-chain wallets.
-   **Bridge-Powered**: Integrated CCTP (Circle Cross-Chain Transfer Protocol) for seamless USDC deposits from other testnets.

## 🏗️ Architecture

The project is structured as a monorepo:

-   **`arc-agent-hub/`**: The frontend application.
    -   Built with **React**, **Vite**, **Tailwind CSS**, and **shadcn/ui**.
    -   Handles wallet connection (ConnectKit), chat interface, and direct user payments.
-   **`backend/`**: The central orchestration server.
    -   Built with **Node.js**, **Express**, and **TypeScript**.
    -   Integrates **Google Gemini 1.5 Flash** for natural language understanding.
    -   Manages **Circle x402** credentials and wallets for agent-to-agent payments.
    -   Exposes APIs for the frontend and handles data aggregation.
-   **`contracts/`**: Smart contracts (Foundry) for the Arc testnet ecosystem.

## 🛠️ Tech Stack

-   **Frontend**: React, TypeScript, Vite, WAGMI/Viem, TanStack Query, Recharts.
-   **Backend**: Node.js, Express, Google GenAI SDK, Supabase (logging/analytics), Circle x402 SDK.
-   **Blockchain**: Arc Testnet (EVM compatible), Circle CCTP, USDC.

## 🏁 Getting Started

### Prerequisites

-   Node.js v18+
-   npm or pnpm
-   An Arc Testnet wallet with USDC (use the [Circle Faucet](https://faucet.circle.com/)).

### 1. Installation

Clone the repository and install dependencies for both services:

```bash
# Install Backend Dependencies
cd backend
npm install

# Install Frontend Dependencies
cd ../arc-agent-hub
npm install
```

### 2. Configuration

You need to set up environment variables for both the backend and frontend.

**Backend (`backend/.env`):**
Create a `.env` file in `backend/` based on the example. You will need:
-   `PRIVATE_KEY`: The private key of the main "Arcana" provider agent (must have USDC).
-   `GEMINI_API_KEY`: Google Gemini API key.
-   `CIRCLE_API_KEY` & `CIRCLE_ENTITY_SECRET`: For x402 payments and faucets.
-   `SUPABASE_URL` & `SUPABASE_ANON_KEY`: For chat history and analytics.
-   Agent specific keys (optional, generates new ones if missing): `ORACLE_X402_PRIVATE_KEY`, etc.

**Frontend (`arc-agent-hub/.env`):**
Create a `.env` file in `arc-agent-hub/` with:
-   `VITE_API_URL`: URL of your backend (e.g., `http://localhost:3000`).
-   `VITE_ADMIN_ADDRESS`: Wallet address for admin dashboard visibility.

### 3. Running Locally

**Start the Backend:**
```bash
cd backend
npm run dev
# Server will start on http://localhost:3000
```

**Start the Frontend:**
```bash
cd arc-agent-hub
npm run dev
# App will start on http://localhost:5173
```

## 🚢 Deployment

### Backend
Deploy the `backend` folder to a Node.js hosting provider (Render, Railway, Heroku).
-   **Build Command**: `npm install && npm run build`
-   **Start Command**: `npm start`
-   **Env Vars**: Copy all variables from your local `.env`.

### Frontend
Deploy the `arc-agent-hub` folder to a static host (Vercel, Netlify).
-   **Build Command**: `npm run build`
-   **Output Directory**: `dist`
-   **Env Vars**: Set `VITE_API_URL` to your deployed backend URL.

### Important: CORS
Once deployed, update the `ALLOWED_ORIGINS` environment variable in your **Backend** to include your **Frontend's deployed URL** (e.g., `https://arcana.vercel.app`).

## 📄 License

This project is licensed under the MIT License.
