import { publicClient, contracts, createAgentWallet } from "../blockchain.js";
import { config } from "../config.js";
import { keccak256, encodePacked, parseEther, formatEther } from "viem";

interface TaskRequest {
    query: string;
    buyerAddress: `0x${string}`;
    escrowId: bigint;
}

interface TaskResult {
    response: string;
    escrowId: bigint;
    cost: bigint;
}

/**
 * Reseller Agent
 * - Receives queries from users
 * - Finds best provider in registry
 * - Creates escrow and delegates task
 * - Returns response to user with markup
 */
export class ResellerAgent {
    private walletClient: ReturnType<typeof createAgentWallet>["walletClient"];
    private account: ReturnType<typeof createAgentWallet>["account"];

    constructor(privateKey: `0x${string}`) {
        const { account, walletClient } = createAgentWallet(privateKey);
        this.account = account;
        this.walletClient = walletClient;
    }

    get address(): `0x${string}` {
        return this.account.address;
    }

    /**
     * Find the cheapest active provider for a service type
     */
    async findProvider(serviceType: string = "text-generation"): Promise<{
        agentId: bigint;
        price: bigint;
    }> {
        const result = await publicClient.readContract({
            ...contracts.agentRegistry,
            functionName: "getCheapestAgent",
            args: [serviceType],
        }) as [bigint, bigint];

        return { agentId: result[0], price: result[1] };
    }

    /**
     * Get provider details by agent ID
     */
    async getProviderDetails(agentId: bigint): Promise<{
        wallet: `0x${string}`;
        name: string;
        pricePerTask: bigint;
        active: boolean;
    }> {
        const agent = await publicClient.readContract({
            ...contracts.agentRegistry,
            functionName: "getAgent",
            args: [agentId],
        }) as { wallet: `0x${string}`; name: string; pricePerTask: bigint; active: boolean };

        return agent;
    }

    /**
     * Create escrow for a task
     */
    async createEscrow(
        sellerAddress: `0x${string}`,
        taskHash: `0x${string}`,
        sellerAgentId: bigint,
        amount: bigint
    ): Promise<bigint> {
        const hash = await this.walletClient.writeContract({
            ...contracts.escrow,
            functionName: "createEscrow",
            args: [sellerAddress, taskHash, sellerAgentId],
            value: amount,
        });

        // Wait for receipt and get escrow ID from event
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        // Get escrow count (the new escrow ID is count - 1)
        const escrowCount = await publicClient.readContract({
            ...contracts.escrow,
            functionName: "escrowCount",
        }) as bigint;

        return escrowCount - 1n;
    }

    /**
     * Release escrow (task completed successfully)
     */
    async releaseEscrow(escrowId: bigint): Promise<`0x${string}`> {
        const hash = await this.walletClient.writeContract({
            ...contracts.escrow,
            functionName: "release",
            args: [escrowId],
        });

        await publicClient.waitForTransactionReceipt({ hash });
        return hash;
    }

    /**
     * Process a user query end-to-end
     */
    async processQuery(query: string): Promise<{
        response: string;
        cost: bigint;
        providerId: bigint;
        escrowId: bigint;
    }> {
        console.log(`[Reseller] Processing query: "${query.substring(0, 50)}..."`);

        // 1. Find best provider
        const { agentId, price } = await this.findProvider("text-generation");
        if (agentId === 0n) {
            throw new Error("No providers available");
        }

        const provider = await this.getProviderDetails(agentId);
        console.log(`[Reseller] Found provider: ${provider.name} (${formatEther(price)} USDC)`);

        // 2. Create task hash
        const taskHash = keccak256(
            encodePacked(["string", "uint256"], [query, BigInt(Date.now())])
        );

        // 3. Create escrow
        const escrowId = await this.createEscrow(
            provider.wallet,
            taskHash,
            agentId,
            price
        );
        console.log(`[Reseller] Escrow created: ${escrowId}`);

        // 4. Wait for provider to complete task
        // (In production, this would be event-driven or polling)
        // For now, we simulate waiting
        console.log(`[Reseller] Waiting for provider to complete task...`);

        // 5. Poll for completion (Simulated for single-process environment)
        // In a real distributed system, we'd listen for a "TaskCompleted" event or check DB
        let attempts = 0;
        let finalResponse = "";

        // We know the ProviderAgent is running in the same process in this dev setup
        // Ideally we would access the result via shared storage/events
        // For this demo, we'll wait a bit and check if we can get the result from the provider

        // Note: Since ProviderAgent is in the same process (index.ts), it processes async tasks
        // We will wait up to 10 seconds for the result to appear

        await new Promise(resolve => setTimeout(resolve, 2000)); // Initial wait

        // Since we can't easily access the ProviderAgent instance here without a shared store,
        // and we want this to work in the "Real Mode" flow where ProviderAgent executes it:

        // HACK for single-process MVP: 
        // In index.ts, the ProviderAgent is running and polling.
        // It will pick up the task and execute it.
        // But Reseller doesn't have a way to get the result back easily without a database.

        // Solution: For this POC, we will execute the task DIRECTLY here as well if we are 'waiting',
        // OR we use the same gemini service to just get the answer to unblock the user.
        // The proper way is to have ProviderAgent write the result on-chain or to a DB.

        // Let's use the Gemini service directly here to "simulate" the provider returning the result
        // after the delay. This ensures the user gets an answer.
        // The escrow is created, which is the important part for the crypto flow.

        const { generateResponse } = await import("../services/gemini.js");
        const aiResponse = await generateResponse(query);

        console.log(`[Reseller] Task completed (simulated return): ${aiResponse.substring(0, 30)}...`);

        return {
            response: aiResponse,
            cost: config.agent.resellerPrice,
            providerId: agentId,
            escrowId,
        };
    }
}
