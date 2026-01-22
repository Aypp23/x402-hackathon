import { publicClient, contracts, createAgentWallet } from "../blockchain.js";
import { config } from "../config.js";
import { generateResponse, initGemini } from "../services/gemini.js";
import { formatEther } from "viem";

interface EscrowData {
    buyer: `0x${string}`;
    seller: `0x${string}`;
    amount: bigint;
    taskHash: `0x${string}`;
    deadline: bigint;
    sellerAgentId: bigint;
    status: number; // 0=None, 1=Locked, 2=Released, 3=Refunded, 4=Disputed
}

/**
 * Provider Agent
 * - Registers as a service provider
 * - Monitors for incoming escrow tasks
 * - Executes tasks using Gemini
 * - Waits for buyer to release payment
 */
export class ProviderAgent {
    private walletClient: ReturnType<typeof createAgentWallet>["walletClient"];
    private account: ReturnType<typeof createAgentWallet>["account"];
    private agentId: bigint | null = null;
    private geminiInitialized = false;

    constructor(privateKey: `0x${string}`) {
        const { account, walletClient } = createAgentWallet(privateKey);
        this.account = account;
        this.walletClient = walletClient;
    }

    get address(): `0x${string}` {
        return this.account.address;
    }

    /**
     * Initialize Gemini with API key
     */
    initializeGemini(apiKey: string) {
        initGemini(apiKey);
        this.geminiInitialized = true;
        console.log(`[Provider] Gemini initialized with model: ${config.gemini.model}`);
    }

    /**
     * Register as a service provider
     */
    async register(
        name: string = "AI Provider Bot",
        serviceType: string = "text-generation",
        pricePerTask: bigint = config.agent.providerPrice
    ): Promise<bigint> {
        // Check if already registered
        const existingId = await publicClient.readContract({
            ...contracts.agentRegistry,
            functionName: "getAgentIdByWallet",
            args: [this.address],
        }) as bigint;

        if (existingId > 0n) {
            this.agentId = existingId;
            console.log(`[Provider] Already registered as agent ${existingId}`);
            return existingId;
        }

        // Register new agent
        const hash = await this.walletClient.writeContract({
            ...contracts.agentRegistry,
            functionName: "registerAgent",
            args: [name, serviceType, pricePerTask],
        });

        await publicClient.waitForTransactionReceipt({ hash });

        // Get the new agent ID
        this.agentId = await publicClient.readContract({
            ...contracts.agentRegistry,
            functionName: "getAgentIdByWallet",
            args: [this.address],
        }) as bigint;

        console.log(`[Provider] Registered as agent ${this.agentId}`);
        return this.agentId;
    }

    /**
     * Get pending escrows for this provider
     */
    async getPendingEscrows(): Promise<{ escrowId: bigint; data: EscrowData }[]> {
        const escrowCount = await publicClient.readContract({
            ...contracts.escrow,
            functionName: "escrowCount",
        }) as bigint;

        const pending: { escrowId: bigint; data: EscrowData }[] = [];

        // Check recent escrows (last 100)
        const startId = escrowCount > 100n ? escrowCount - 100n : 0n;

        for (let i = startId; i < escrowCount; i++) {
            const escrowData = await publicClient.readContract({
                ...contracts.escrow,
                functionName: "getEscrow",
                args: [i],
            }) as EscrowData;

            // Check if this escrow is for us and is locked
            if (escrowData.seller === this.address && escrowData.status === 1) {
                pending.push({ escrowId: i, data: escrowData });
            }
        }

        return pending;
    }

    /**
     * Execute a task using Gemini
     */
    async executeTask(escrowId: bigint, query: string): Promise<string> {
        if (!this.geminiInitialized) {
            throw new Error("Gemini not initialized. Call initializeGemini first.");
        }

        console.log(`[Provider] Executing task ${escrowId}: "${query.substring(0, 50)}..."`);

        try {
            const result = await generateResponse(query);
            console.log(`[Provider] Task ${escrowId} completed. Response length: ${result.response.length}`);
            return result.response;
        } catch (error) {
            console.error(`[Provider] Task ${escrowId} failed:`, error);
            throw error;
        }
    }

    /**
     * Start listening for tasks (polling mode)
     */
    async startPolling(intervalMs: number = 5000) {
        console.log(`[Provider] Starting task polling (every ${intervalMs}ms)...`);

        setInterval(async () => {
            try {
                const pending = await this.getPendingEscrows();

                if (pending.length > 0) {
                    console.log(`[Provider] Found ${pending.length} pending tasks`);

                    for (const { escrowId, data } of pending) {
                        console.log(`[Provider] Processing escrow ${escrowId}...`);
                        // Note: In production, we'd decode the task from events or off-chain storage
                        // For now, we just log that we found a pending task
                        console.log(`[Provider] Escrow ${escrowId}: ${formatEther(data.amount)} USDC from ${data.buyer}`);
                    }
                }
            } catch (error) {
                console.error("[Provider] Polling error:", error);
            }
        }, intervalMs);
    }

    /**
     * Get agent statistics
     */
    async getStats(): Promise<{
        agentId: bigint;
        reputation: bigint;
        tasksCompleted: bigint;
        balance: bigint;
    }> {
        if (!this.agentId) {
            throw new Error("Agent not registered");
        }

        const agent = await publicClient.readContract({
            ...contracts.agentRegistry,
            functionName: "getAgent",
            args: [this.agentId],
        }) as { reputation: bigint; tasksCompleted: bigint };

        const balance = await publicClient.getBalance({ address: this.address });

        return {
            agentId: this.agentId,
            reputation: agent.reputation,
            tasksCompleted: agent.tasksCompleted,
            balance,
        };
    }
}
