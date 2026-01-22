/**
 * Agent-to-Agent Payments Service
 * Handles escrow creation and release between agents
 */

import { executeContractFunction, getTransactionStatus } from "./circle-mcp.js";
import { config } from "../config.js";
import { getChatWalletId, getChatAddress } from "../agents/chat-wallet.js";
import { getOracleWalletId, getOracleAddress } from "../agents/oracle-wallet.js";
import { getScoutWalletId, getScoutAddress } from "../agents/scout-wallet.js";
import { getNewsScoutWalletId, getNewsScoutAddress } from "../agents/news-scout-wallet.js";
import { getYieldWalletId, getYieldAddress } from "../agents/yield-wallet.js";
import { keccak256, toHex, encodePacked, parseUnits } from "viem";

// Track pending escrows for release
interface PendingEscrow {
    escrowId: number;
    buyerWalletId: string;
    sellerAddress: string;
    amount: string;
    taskHash: string;
    createdAt: Date;
}

const pendingEscrows = new Map<string, PendingEscrow>();

/**
 * Create an escrow from Chat Agent to Price Oracle
 * @param taskDescription Description of the task (e.g., "price:BTC")
 * @returns Transaction ID and escrow details
 */
export async function createOraclePayment(
    taskDescription: string
): Promise<{
    transactionId: string;
    status: string;
    taskHash: string;
}> {
    const chatWalletId = getChatWalletId();
    const oracleAddress = getOracleAddress();

    if (!chatWalletId) {
        throw new Error("Chat Agent wallet not initialized");
    }
    if (!oracleAddress) {
        throw new Error("Oracle wallet not initialized");
    }

    // Create task hash
    const taskHash = keccak256(toHex(taskDescription));

    // Oracle price is $0.001 = 0.001 * 10^18 = 1000000000000000 (1e15)
    const oraclePrice = "0.001"; // In USDC

    console.log(`[Agent Payments] Creating escrow for task: ${taskDescription}`);
    console.log(`[Agent Payments] From: Chat Agent (${getChatAddress()})`);
    console.log(`[Agent Payments] To: Price Oracle (${oracleAddress})`);
    console.log(`[Agent Payments] Amount: ${oraclePrice} USDC`);

    // 1. Approve funds (USDC is 6 decimals, but Arc native is 18? No, standard USDC is 6. Circle's mocks are 18 on Testnet sometimes?)
    // Let's assume 18 for Arc Testnet based on previous code.
    // Actually, earlier code in circle-mcp.ts said "Native USDC on Arc" and passed raw 1.0.
    // BUT contracts usually expect WEI.
    // Let's use string amounts for Circle SDK but for Approve we need function call.

    const usdcAddress = "0x3600000000000000000000000000000000000000"; // Native USDC on Arc

    const amountWei = parseUnits(oraclePrice, 6); // USDC has 6 decimals on Arc Testnet
    const maxApproval = "115792089237316195423570985008687907853269984665640564039457584007913129639935"; // type(uint256).max

    // Check existing allowance to skip approval if already approved
    const { publicClient } = await import("../blockchain.js");
    const allowanceAbi = [{
        name: "allowance",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
        outputs: [{ type: "uint256" }]
    }] as const;

    const currentAllowance = await publicClient.readContract({
        address: usdcAddress as `0x${string}`,
        abi: allowanceAbi,
        functionName: "allowance",
        args: [getChatAddress() as `0x${string}`, config.contracts.escrow],
    });

    // Only approve if allowance is less than amount needed
    if (currentAllowance < amountWei) {
        console.log(`[Agent Payments] Allowance (${currentAllowance}) insufficient. Approving max USDC...`);
        const approveTx = await executeContractFunction(
            chatWalletId,
            usdcAddress,
            "approve(address,uint256)",
            [config.contracts.escrow, maxApproval]
        );
        console.log(`[Agent Payments] Max Approval Tx ID: ${approveTx.transactionId}. Waiting for confirmation...`);

        // Poll for completion
        let attempts = 0;
        while (attempts < 20) {
            const status = await getTransactionStatus(approveTx.transactionId);
            if (status.state === "COMPLETE") {
                console.log(`[Agent Payments] ✅ Max approval confirmed! Future payments skip this step.`);
                break;
            }
            if (status.state === "FAILED") {
                throw new Error(`Approval failed: ${JSON.stringify(status)}`);
            }
            await new Promise(resolve => setTimeout(resolve, 500));
            attempts++;
        }
    } else {
        console.log(`[Agent Payments] ✅ Allowance sufficient (${currentAllowance}), skipping approval`);
    }

    // 2. Call Escrow.createEscrow(seller, taskHash, sellerAgentId, amount)
    const result = await executeContractFunction(
        chatWalletId,
        config.contracts.escrow,
        "createEscrow(address,bytes32,uint256,uint256)",
        [oracleAddress, taskHash, "0", amountWei.toString()] // sellerAgentId=0, amount in wei
    );

    console.log(`[Agent Payments] Escrow tx: ${result.transactionId}`);

    // 3. Wait for escrow creation to complete
    let escrowAttempts = 0;
    while (escrowAttempts < 20) {
        const escrowStatus = await getTransactionStatus(result.transactionId);
        if (escrowStatus.state === "COMPLETE") {
            console.log(`[Agent Payments] Escrow created! TxHash: ${escrowStatus.txHash}`);
            break;
        }
        if (escrowStatus.state === "FAILED") {
            throw new Error(`Escrow creation failed: ${JSON.stringify(escrowStatus)}`);
        }
        await new Promise(resolve => setTimeout(resolve, 500)); // Poll every 500ms
        escrowAttempts++;
    }

    // 4. Get the escrow ID (escrowCount - 1, since we just created one)
    // Note: This is a simplified approach - in production, parse the event logs
    // For now, we'll call release in a fire-and-forget manner
    try {
        // The escrow ID is (escrowCount - 1) but we can't easily read the contract here
        // Instead, we'll use a different approach: query the escrow count
        const { publicClient } = await import("../blockchain.js");
        const escrowAbi = [{
            name: "escrowCount",
            type: "function",
            stateMutability: "view",
            inputs: [],
            outputs: [{ type: "uint256" }]
        }] as const;

        const escrowCount = await publicClient.readContract({
            address: config.contracts.escrow,
            abi: escrowAbi,
            functionName: "escrowCount",
        });

        const escrowId = Number(escrowCount) - 1;
        console.log(`[Agent Payments] Created escrow ID: ${escrowId}, auto-releasing...`);

        // 5. Auto-release the escrow (fire and forget - don't block response)
        releaseOraclePayment(escrowId).then(releaseRes => {
            console.log(`[Agent Payments] ✅ Auto-released escrow ${escrowId}: ${releaseRes.transactionId}`);
        }).catch(releaseErr => {
            console.error(`[Agent Payments] ⚠️ Auto-release failed for escrow ${escrowId}:`, releaseErr);
        });
    } catch (autoReleaseError) {
        console.error(`[Agent Payments] ⚠️ Auto-release setup failed:`, autoReleaseError);
        // Continue - escrow was created, just release failed
    }

    return {
        transactionId: result.transactionId,
        status: result.status,
        taskHash,
    };
}

/**
 * Release an escrow (called after Oracle provides service)
 * @param escrowId The escrow ID to release
 */
export async function releaseOraclePayment(
    escrowId: number
): Promise<{
    transactionId: string;
    status: string;
}> {
    const chatWalletId = getChatWalletId();

    if (!chatWalletId) {
        throw new Error("Chat Agent wallet not initialized");
    }

    console.log(`[Agent Payments] Releasing escrow ${escrowId}`);

    // Call Escrow.release(escrowId)
    const result = await executeContractFunction(
        chatWalletId,
        config.contracts.escrow,
        "release(uint256)",
        [escrowId]
    );

    console.log(`[Agent Payments] Release tx: ${result.transactionId}`);

    return result;
}

/**
 * Release an escrow for Scout payment
 * @param escrowId The escrow ID to release
 */
export async function releaseScoutPayment(
    escrowId: number
): Promise<{
    transactionId: string;
    status: string;
}> {
    const chatWalletId = getChatWalletId();

    if (!chatWalletId) {
        throw new Error("Chat Agent wallet not initialized");
    }

    console.log(`[Agent Payments] Releasing Scout escrow ${escrowId}`);

    const result = await executeContractFunction(
        chatWalletId,
        config.contracts.escrow,
        "release(uint256)",
        [escrowId]
    );

    console.log(`[Agent Payments] Release tx: ${result.transactionId}`);

    return result;
}

/**
 * Create an escrow from Chat Agent to Chain Scout
 * @param taskDescription Description of the task (e.g., "wallet:0x123...")
 * @returns Transaction ID and escrow details
 */
export async function createScoutPayment(
    taskDescription: string
): Promise<{
    transactionId: string;
    status: string;
    taskHash: string;
}> {
    const chatWalletId = getChatWalletId();
    const scoutAddress = getScoutAddress();

    if (!chatWalletId) {
        throw new Error("Chat Agent wallet not initialized");
    }
    if (!scoutAddress) {
        throw new Error("Chain Scout wallet not initialized");
    }

    // Create task hash
    const taskHash = keccak256(toHex(taskDescription));

    // Chain Scout price is $0.002 per query
    const scoutPrice = "0.002"; // In USDC

    console.log(`[Agent Payments] Creating escrow for Chain Scout task: ${taskDescription}`);
    console.log(`[Agent Payments] From: Chat Agent (${getChatAddress()})`);
    console.log(`[Agent Payments] To: Chain Scout (${scoutAddress})`);
    console.log(`[Agent Payments] Amount: ${scoutPrice} USDC`);

    const usdcAddress = "0x3600000000000000000000000000000000000000"; // Native USDC on Arc
    const amountWei = parseUnits(scoutPrice, 6); // USDC has 6 decimals on Arc Testnet
    const maxApproval = "115792089237316195423570985008687907853269984665640564039457584007913129639935"; // type(uint256).max

    // Check existing allowance to skip approval if already approved
    const { publicClient } = await import("../blockchain.js");
    const allowanceAbi = [{
        name: "allowance",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
        outputs: [{ type: "uint256" }]
    }] as const;

    const currentAllowance = await publicClient.readContract({
        address: usdcAddress as `0x${string}`,
        abi: allowanceAbi,
        functionName: "allowance",
        args: [getChatAddress() as `0x${string}`, config.contracts.escrow],
    });

    // Only approve if allowance is less than amount needed
    if (currentAllowance < amountWei) {
        console.log(`[Agent Payments] Allowance (${currentAllowance}) insufficient. Approving max USDC...`);
        const approveTx = await executeContractFunction(
            chatWalletId,
            usdcAddress,
            "approve(address,uint256)",
            [config.contracts.escrow, maxApproval]
        );
        console.log(`[Agent Payments] Max Approval Tx ID: ${approveTx.transactionId}. Waiting for confirmation...`);

        // Poll for completion
        let attempts = 0;
        while (attempts < 20) {
            const status = await getTransactionStatus(approveTx.transactionId);
            if (status.state === "COMPLETE") {
                console.log(`[Agent Payments] ✅ Max approval confirmed! Future payments skip this step.`);
                break;
            }
            if (status.state === "FAILED") {
                throw new Error(`Approval failed: ${JSON.stringify(status)}`);
            }
            await new Promise(resolve => setTimeout(resolve, 500));
            attempts++;
        }
    } else {
        console.log(`[Agent Payments] ✅ Allowance sufficient (${currentAllowance}), skipping approval`);
    }

    const result = await executeContractFunction(
        chatWalletId,
        config.contracts.escrow,
        "createEscrow(address,bytes32,uint256,uint256)",
        [scoutAddress, taskHash, "0", amountWei.toString()] // sellerAgentId=0, amount in wei
    );

    console.log(`[Agent Payments] Escrow tx: ${result.transactionId}`);

    // 3. Wait for escrow creation to complete
    let escrowAttempts = 0;
    while (escrowAttempts < 20) {
        const escrowStatus = await getTransactionStatus(result.transactionId);
        if (escrowStatus.state === "COMPLETE") {
            console.log(`[Agent Payments] Escrow created! TxHash: ${escrowStatus.txHash}`);
            break;
        }
        if (escrowStatus.state === "FAILED") {
            throw new Error(`Escrow creation failed: ${JSON.stringify(escrowStatus)}`);
        }
        await new Promise(resolve => setTimeout(resolve, 500)); // Poll every 500ms
        escrowAttempts++;
    }

    // 4. Get the escrow ID and auto-release
    try {
        const { publicClient } = await import("../blockchain.js");
        const escrowAbi = [{
            name: "escrowCount",
            type: "function",
            stateMutability: "view",
            inputs: [],
            outputs: [{ type: "uint256" }]
        }] as const;

        const escrowCount = await publicClient.readContract({
            address: config.contracts.escrow,
            abi: escrowAbi,
            functionName: "escrowCount",
        });

        const escrowId = Number(escrowCount) - 1;
        console.log(`[Agent Payments] Created escrow ID: ${escrowId}, auto-releasing...`);

        // 5. Auto-release (fire and forget)
        releaseScoutPayment(escrowId).then(releaseRes => {
            console.log(`[Agent Payments] ✅ Auto-released Scout escrow ${escrowId}: ${releaseRes.transactionId}`);
        }).catch(releaseErr => {
            console.error(`[Agent Payments] ⚠️ Auto-release failed for Scout escrow ${escrowId}:`, releaseErr);
        });
    } catch (autoReleaseError) {
        console.error(`[Agent Payments] ⚠️ Auto-release setup failed:`, autoReleaseError);
    }

    return {
        transactionId: result.transactionId,
        status: result.status,
        taskHash,
    };
}

/**
 * Create an escrow from Chat Agent to News Scout
 * @param taskDescription Description of the task (e.g., "news:latest")
 * @returns Transaction ID and escrow details
 */
export async function createNewsScoutPayment(
    taskDescription: string
): Promise<{
    transactionId: string;
    status: string;
    taskHash: string;
}> {
    const chatWalletId = getChatWalletId();
    const newsScoutAddress = getNewsScoutAddress();

    if (!chatWalletId) {
        throw new Error("Chat Agent wallet not initialized");
    }
    if (!newsScoutAddress) {
        throw new Error("News Scout wallet not initialized");
    }

    // Create task hash
    const taskHash = keccak256(toHex(taskDescription));

    // News Scout price is $0.001 per query (same as Price Oracle)
    const newsScoutPrice = "0.001"; // In USDC

    console.log(`[Agent Payments] Creating escrow for News Scout task: ${taskDescription}`);
    console.log(`[Agent Payments] From: Chat Agent (${getChatAddress()})`);
    console.log(`[Agent Payments] To: News Scout (${newsScoutAddress})`);
    console.log(`[Agent Payments] Amount: ${newsScoutPrice} USDC`);

    const usdcAddress = "0x3600000000000000000000000000000000000000"; // Native USDC on Arc
    const amountWei = parseUnits(newsScoutPrice, 6); // USDC has 6 decimals on Arc Testnet
    const maxApproval = "115792089237316195423570985008687907853269984665640564039457584007913129639935"; // type(uint256).max

    // Check existing allowance to skip approval if already approved
    const { publicClient } = await import("../blockchain.js");
    const allowanceAbi = [{
        name: "allowance",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
        outputs: [{ type: "uint256" }]
    }] as const;

    const currentAllowance = await publicClient.readContract({
        address: usdcAddress as `0x${string}`,
        abi: allowanceAbi,
        functionName: "allowance",
        args: [getChatAddress() as `0x${string}`, config.contracts.escrow],
    });

    // Only approve if allowance is less than amount needed
    if (currentAllowance < amountWei) {
        console.log(`[Agent Payments] Allowance (${currentAllowance}) insufficient. Approving max USDC...`);
        const approveTx = await executeContractFunction(
            chatWalletId,
            usdcAddress,
            "approve(address,uint256)",
            [config.contracts.escrow, maxApproval]
        );
        console.log(`[Agent Payments] Max Approval Tx ID: ${approveTx.transactionId}. Waiting for confirmation...`);

        // Poll for completion
        let attempts = 0;
        while (attempts < 20) {
            const status = await getTransactionStatus(approveTx.transactionId);
            if (status.state === "COMPLETE") {
                console.log(`[Agent Payments] ✅ Max approval confirmed! Future payments skip this step.`);
                break;
            }
            if (status.state === "FAILED") {
                throw new Error(`Approval failed: ${JSON.stringify(status)}`);
            }
            await new Promise(resolve => setTimeout(resolve, 500));
            attempts++;
        }
    } else {
        console.log(`[Agent Payments] ✅ Allowance sufficient (${currentAllowance}), skipping approval`);
    }

    const result = await executeContractFunction(
        chatWalletId,
        config.contracts.escrow,
        "createEscrow(address,bytes32,uint256,uint256)",
        [newsScoutAddress, taskHash, "0", amountWei.toString()] // sellerAgentId=0, amount in wei
    );

    console.log(`[Agent Payments] Escrow tx: ${result.transactionId}`);

    // Wait for escrow creation to complete
    let escrowAttempts = 0;
    while (escrowAttempts < 20) {
        const escrowStatus = await getTransactionStatus(result.transactionId);
        if (escrowStatus.state === "COMPLETE") {
            console.log(`[Agent Payments] Escrow created! TxHash: ${escrowStatus.txHash}`);
            break;
        }
        if (escrowStatus.state === "FAILED") {
            throw new Error(`Escrow creation failed: ${JSON.stringify(escrowStatus)}`);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
        escrowAttempts++;
    }

    // Get the escrow ID and auto-release
    try {
        const escrowAbi = [{
            name: "escrowCount",
            type: "function",
            stateMutability: "view",
            inputs: [],
            outputs: [{ type: "uint256" }]
        }] as const;

        const escrowCount = await publicClient.readContract({
            address: config.contracts.escrow,
            abi: escrowAbi,
            functionName: "escrowCount",
        });

        const escrowId = Number(escrowCount) - 1;
        console.log(`[Agent Payments] Created escrow ID: ${escrowId}, auto-releasing...`);

        // Auto-release
        const releaseResult = await executeContractFunction(
            chatWalletId,
            config.contracts.escrow,
            "release(uint256)",
            [escrowId]
        );
        console.log(`[Agent Payments] ✅ Auto-released News Scout escrow ${escrowId}: ${releaseResult.transactionId}`);
    } catch (releaseError) {
        console.error(`[Agent Payments] Failed to auto-release escrow:`, releaseError);
    }

    return {
        transactionId: result.transactionId,
        status: result.status,
        taskHash,
    };
}

/**
 * Get all agent wallet statuses
 */
export function getAgentWalletStatus(): {
    chatAgent: { address: string | null; walletId: string | null };
    priceOracle: { address: string | null; walletId: string | null };
    chainScout: { address: string | null; walletId: string | null };
    newsScout: { address: string | null; walletId: string | null };
    yieldOptimizer: { address: string | null; walletId: string | null };
} {
    return {
        chatAgent: {
            address: getChatAddress(),
            walletId: getChatWalletId(),
        },
        priceOracle: {
            address: getOracleAddress(),
            walletId: getOracleWalletId(),
        },
        chainScout: {
            address: getScoutAddress(),
            walletId: getScoutWalletId(),
        },
        newsScout: {
            address: getNewsScoutAddress(),
            walletId: getNewsScoutWalletId(),
        },
        yieldOptimizer: {
            address: getYieldAddress(),
            walletId: getYieldWalletId(),
        },
    };
}

/**
 * Create an escrow from Chat Agent to Yield Optimizer
 * @param taskDescription Description of the task (e.g., "yields:top")
 * @returns Transaction ID and escrow details
 */
export async function createYieldOptimizerPayment(
    taskDescription: string
): Promise<{
    transactionId: string;
    status: string;
    taskHash: string;
}> {
    const chatWalletId = getChatWalletId();
    const yieldAddress = getYieldAddress();

    if (!chatWalletId) {
        throw new Error("Chat Agent wallet not initialized");
    }
    if (!yieldAddress) {
        throw new Error("Yield Optimizer wallet not initialized");
    }

    // Create task hash
    const taskHash = keccak256(toHex(taskDescription));

    // Yield Optimizer price is $0.001 = 0.001 USDC
    const yieldPrice = "0.001";

    console.log(`[Agent Payments] Creating escrow for Yield Optimizer: ${taskDescription}`);
    console.log(`[Agent Payments] From: Chat Agent (${getChatAddress()})`);
    console.log(`[Agent Payments] To: Yield Optimizer (${yieldAddress})`);
    console.log(`[Agent Payments] Amount: ${yieldPrice} USDC`);

    const { publicClient } = await import("../blockchain.js");
    const usdcAddress = "0x3600000000000000000000000000000000000000"; // Native USDC on Arc
    const amountWei = parseUnits(yieldPrice, 6); // USDC has 6 decimals
    const maxApproval = "115792089237316195423570985008687907853269984665640564039457584007913129639935";

    // Check existing allowance
    const allowanceAbi = [{
        name: "allowance",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
        outputs: [{ type: "uint256" }]
    }] as const;

    const currentAllowance = await publicClient.readContract({
        address: usdcAddress as `0x${string}`,
        abi: allowanceAbi,
        functionName: "allowance",
        args: [getChatAddress() as `0x${string}`, config.contracts.escrow],
    });

    // Approve if needed
    if (currentAllowance < amountWei) {
        console.log(`[Agent Payments] Allowance insufficient. Approving max USDC...`);
        const approveTx = await executeContractFunction(
            chatWalletId,
            usdcAddress,
            "approve(address,uint256)",
            [config.contracts.escrow, maxApproval]
        );
        console.log(`[Agent Payments] Approval Tx ID: ${approveTx.transactionId}`);

        let attempts = 0;
        while (attempts < 20) {
            const status = await getTransactionStatus(approveTx.transactionId);
            if (status.state === "COMPLETE") {
                console.log(`[Agent Payments] ✅ Approval confirmed!`);
                break;
            }
            if (status.state === "FAILED") {
                throw new Error(`Approval failed: ${JSON.stringify(status)}`);
            }
            await new Promise(resolve => setTimeout(resolve, 500));
            attempts++;
        }
    } else {
        console.log(`[Agent Payments] ✅ Allowance sufficient, skipping approval`);
    }

    // Create escrow
    const result = await executeContractFunction(
        chatWalletId,
        config.contracts.escrow,
        "createEscrow(address,bytes32,uint256,uint256)",
        [yieldAddress, taskHash, "0", amountWei.toString()]
    );

    console.log(`[Agent Payments] Escrow tx: ${result.transactionId}`);

    // Wait for escrow creation
    let escrowAttempts = 0;
    while (escrowAttempts < 20) {
        const escrowStatus = await getTransactionStatus(result.transactionId);
        if (escrowStatus.state === "COMPLETE") {
            console.log(`[Agent Payments] Escrow created! TxHash: ${escrowStatus.txHash}`);
            break;
        }
        if (escrowStatus.state === "FAILED") {
            throw new Error(`Escrow creation failed: ${JSON.stringify(escrowStatus)}`);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
        escrowAttempts++;
    }

    // Auto-release escrow
    try {
        const escrowAbi = [{
            name: "escrowCount",
            type: "function",
            stateMutability: "view",
            inputs: [],
            outputs: [{ type: "uint256" }]
        }] as const;

        const escrowCount = await publicClient.readContract({
            address: config.contracts.escrow,
            abi: escrowAbi,
            functionName: "escrowCount",
        });

        const escrowId = Number(escrowCount) - 1;
        console.log(`[Agent Payments] Created escrow ID: ${escrowId}, auto-releasing...`);

        const releaseResult = await executeContractFunction(
            chatWalletId,
            config.contracts.escrow,
            "release(uint256)",
            [escrowId]
        );
        console.log(`[Agent Payments] ✅ Auto-released Yield Optimizer escrow ${escrowId}: ${releaseResult.transactionId}`);
    } catch (releaseError) {
        console.error(`[Agent Payments] Failed to auto-release escrow:`, releaseError);
    }

    return {
        transactionId: result.transactionId,
        status: result.status,
        taskHash,
    };
}
