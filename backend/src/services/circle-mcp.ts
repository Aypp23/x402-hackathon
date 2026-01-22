import {
    initiateDeveloperControlledWalletsClient,
    Blockchain,
} from "@circle-fin/developer-controlled-wallets";

type CircleClient = ReturnType<typeof initiateDeveloperControlledWalletsClient>;

let client: CircleClient | null = null;

/**
 * Initialize the Circle Developer-Controlled Wallets client
 * @param apiKey Circle API key
 * @param entitySecret Entity secret for wallet operations
 */
export function initCircleClient(apiKey: string, entitySecret: string) {
    client = initiateDeveloperControlledWalletsClient({
        apiKey,
        entitySecret,
    });
    console.log("[Circle MCP] Client initialized");
    return client;
}

/**
 * Get the initialized client (throws if not initialized)
 */
function getClient(): CircleClient {
    if (!client) {
        throw new Error("Circle client not initialized. Call initCircleClient first.");
    }
    return client;
}

// --- Wallet Set Operations ---

/**
 * Create a new wallet set
 */
export async function createWalletSet(name: string): Promise<string> {
    const c = getClient();
    const response = await c.createWalletSet({
        name,
    });

    if (!response.data?.walletSet) {
        throw new Error("Failed to create wallet set");
    }

    console.log(`[Circle MCP] Created wallet set: ${response.data.walletSet.id}`);
    return response.data.walletSet.id;
}

// --- Wallet Operations ---

/**
 * Create a new wallet in a wallet set
 */
export async function createWallet(
    walletSetId: string,
    blockchain: Blockchain = Blockchain.ArcTestnet
): Promise<{ id: string; address: string }> {
    const c = getClient();
    const response = await c.createWallets({
        walletSetId,
        blockchains: [blockchain],
        count: 1,
    });

    if (!response.data?.wallets || response.data.wallets.length === 0) {
        throw new Error("Failed to create wallet");
    }

    const wallet = response.data.wallets[0];
    console.log(`[Circle MCP] Created wallet: ${wallet.id} (${wallet.address})`);

    return {
        id: wallet.id,
        address: wallet.address as `0x${string}`,
    };
}

/**
 * Get wallet by ID
 */
export async function getWallet(walletId: string): Promise<{
    id: string;
    address: string;
    blockchain: string;
    state: string;
}> {
    const c = getClient();
    const response = await c.getWallet({ id: walletId });

    if (!response.data?.wallet) {
        throw new Error("Wallet not found");
    }

    return {
        id: response.data.wallet.id,
        address: response.data.wallet.address,
        blockchain: response.data.wallet.blockchain,
        state: response.data.wallet.state,
    };
}

/**
 * Get token balances for a wallet
 */
export async function getWalletBalance(walletId: string): Promise<{
    tokenBalances: Array<{
        token: { symbol: string; decimals: number };
        amount: string;
    }>;
}> {
    const c = getClient();
    const response = await c.getWalletTokenBalance({
        id: walletId,
        includeAll: true,
    });

    // Map balances to a simpler format
    const balances = (response.data?.tokenBalances || []).map((b) => ({
        token: {
            symbol: b.token?.symbol || "UNKNOWN",
            decimals: b.token?.decimals || 18,
        },
        amount: b.amount,
    }));

    return { tokenBalances: balances };
}

// --- Transfer Operations ---

/**
 * Create a USDC transfer (native transfer on Arc)
 */
export async function transferUSDC(
    walletId: string,
    destinationAddress: string,
    amount: string // Amount in USDC (will be converted to proper units)
): Promise<{ transactionId: string; status: string }> {
    const c = getClient();

    // For Arc Testnet, USDC is native (18 decimals)
    // The amount should be in human-readable format (e.g., "1.0" for 1 USDC)
    const response = await c.createTransaction({
        walletId,
        tokenAddress: "0x3600000000000000000000000000000000000000", // Native USDC on Arc
        destinationAddress,
        amount: [amount],
        fee: {
            type: "level",
            config: {
                feeLevel: "MEDIUM",
            },
        },
    });

    if (!response.data) {
        throw new Error("Failed to create transaction");
    }

    // Access transaction from the response
    const txData = response.data as unknown as { id: string; state: string };
    console.log(`[Circle MCP] Transaction created: ${txData.id}`);

    return {
        transactionId: txData.id,
        status: txData.state,
    };
}

/**
 * Get transaction status
 */
export async function getTransactionStatus(transactionId: string): Promise<{
    id: string;
    state: string;
    txHash?: string;
}> {
    const c = getClient();
    const response = await c.getTransaction({ id: transactionId });

    if (!response.data) {
        throw new Error("Transaction not found");
    }

    // Log the full response to debug structure
    console.log(`[Circle MCP] GetTransaction Response:`, JSON.stringify(response.data, null, 2));

    // Based on SDK docs, response.data usually contains { transaction: { ... } }
    const data = response.data as any;
    const txData = data.transaction || data; // Fallback to data if flat structure

    return {
        id: txData.id,
        state: txData.state,
        txHash: txData.txHash,
    };
}

/**
 * List transactions for a wallet
 */
export async function getWalletTransactions(walletId: string): Promise<Array<{
    id: string;
    transactionType: string;
    custodyType: string;
    state: string;
    amounts: any[];
    txHash?: string;
    createDate: string;
}>> {
    const c = getClient();
    const response = await c.listTransactions({
        walletIds: [walletId]
    });

    if (!response.data?.transactions) {
        return [];
    }

    return response.data.transactions.map((tx: any) => ({
        id: tx.id,
        transactionType: tx.transactionType,
        custodyType: tx.custodyType,
        state: tx.state,
        amounts: tx.amounts,
        txHash: tx.txHash,
        createDate: tx.createDate
    }));
}

// --- Testnet Faucet ---

/**
 * Request testnet tokens for a wallet
 */
export async function requestTestnetTokens(
    address: string,
    blockchain: Blockchain = Blockchain.ArcTestnet,
    options: { usdc?: boolean; native?: boolean; eurc?: boolean } = { usdc: true }
): Promise<void> {
    const c = getClient();

    // The SDK expects 'blockchain' as 'TestnetBlockchain' type which might be a subset of Blockchain string
    // But since TestnetBlockchain export is missing, we cast or use what we have.
    // Based on debug, Blockchain.ArcTestnet exists.
    await c.requestTestnetTokens({
        address,
        blockchain: blockchain as any, // Cast to any to avoid type mismatch if SDK definitions are strict
        usdc: options.usdc,
        native: options.native,
        eurc: options.eurc,
    });

    console.log(`[Circle MCP] Testnet tokens requested for ${address}`);
}

// --- Helper to list wallets ---

/**
 * List all wallets in a wallet set
 */
export async function listWallets(walletSetId: string): Promise<Array<{
    id: string;
    address: string;
    blockchain: string;
}>> {
    const c = getClient();
    const response = await c.listWallets({
        walletSetId,
    });

    return (response.data?.wallets || []).map((w) => ({
        id: w.id,
        address: w.address,
        blockchain: w.blockchain,
    }));
}

// --- Contract Execution ---

/**
 * Execute a smart contract function from a Circle wallet
 */
export async function executeContractFunction(
    walletId: string,
    contractAddress: string,
    abiFunctionSignature: string,
    abiParameters?: (string | number | bigint)[]
): Promise<{ transactionId: string; status: string }> {
    const c = getClient();

    const params: any = {
        walletId,
        contractAddress,
        abiFunctionSignature,
        fee: {
            type: "level",
            config: {
                feeLevel: "MEDIUM",
            },
        },
    };

    if (abiParameters && abiParameters.length > 0) {
        params.abiParameters = abiParameters.map(p => String(p));
    }

    const response = await c.createContractExecutionTransaction(params);

    if (!response.data) {
        throw new Error("Failed to execute contract function");
    }

    const txData = response.data as unknown as { id: string; state: string };
    console.log(`[Circle MCP] Contract execution: ${txData.id}`);

    return {
        transactionId: txData.id,
        status: txData.state,
    };
}

// --- Export blockchain constants ---
export { Blockchain };
