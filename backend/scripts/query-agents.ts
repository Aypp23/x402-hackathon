/**
 * Query registered agents from AgentRegistry
 */

import { createPublicClient, http, formatEther } from 'viem';

const client = createPublicClient({
    transport: http('https://rpc.testnet.arc.network')
});

const AGENT_REGISTRY = '0x568f2756fee347adca56405eaa7cfa8cf2d829ab';

const abi = [
    {
        name: 'agentCount',
        type: 'function',
        inputs: [],
        outputs: [{ type: 'uint256' }],
        stateMutability: 'view'
    },
    {
        name: 'getAgent',
        type: 'function',
        inputs: [{ name: 'agentId', type: 'uint256' }],
        outputs: [{
            type: 'tuple',
            components: [
                { name: 'wallet', type: 'address' },
                { name: 'name', type: 'string' },
                { name: 'serviceType', type: 'string' },
                { name: 'pricePerTask', type: 'uint256' },
                { name: 'reputation', type: 'uint256' },
                { name: 'tasksCompleted', type: 'uint256' },
                { name: 'active', type: 'bool' }
            ]
        }],
        stateMutability: 'view'
    }
] as const;

async function main() {
    console.log('🔍 Querying AgentRegistry at:', AGENT_REGISTRY);
    console.log('');

    const count = await client.readContract({
        address: AGENT_REGISTRY,
        abi,
        functionName: 'agentCount'
    });

    console.log(`📊 Total Registered Agents: ${count}`);
    console.log('');

    if (Number(count) === 0) {
        console.log('❌ No agents registered yet.');
        return;
    }

    console.log('='.repeat(60));

    for (let i = 1; i <= Number(count); i++) {
        const agent = await client.readContract({
            address: AGENT_REGISTRY,
            abi,
            functionName: 'getAgent',
            args: [BigInt(i)]
        }) as any;

        console.log(`\n🤖 Agent #${i}:`);
        console.log(`   Name: ${agent.name}`);
        console.log(`   Service: ${agent.serviceType}`);
        console.log(`   Wallet: ${agent.wallet}`);
        console.log(`   Price/Task: ${formatEther(agent.pricePerTask)} USDC`);
        console.log(`   Tasks Completed: ${agent.tasksCompleted}`);
        console.log(`   Reputation: ${agent.reputation}`);
        console.log(`   Active: ${agent.active ? '✅' : '❌'}`);
    }

    console.log('\n' + '='.repeat(60));
}

main().catch(console.error);
