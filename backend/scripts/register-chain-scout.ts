/**
 * Fund Chain Scout wallet with testnet tokens and then register
 */

import { initCircleClient, requestTestnetTokens } from '../src/services/circle-mcp.js';
import { initScoutWallet, registerScoutAgent, getScoutAgentInfo, setScoutWallet } from '../src/agents/scout-wallet.js';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const AGENT_REGISTRY = '0x568f2756fee347adca56405eaa7cfa8cf2d829ab';

// Use the wallet we already created
const SCOUT_WALLET_SET_ID = '5268ec2c-d44d-5f51-a9c8-487036766cf9';
const SCOUT_WALLET_ID = '25d0a836-590e-50b5-88f5-6a0f408b19c3';
const SCOUT_WALLET_ADDRESS = '0x02c3edb122cea7f08a2b98ae7dc619eaff8729fd';

async function main() {
    console.log('🔗 Funding and Registering Chain Scout Agent...');
    console.log('');

    // Initialize Circle client
    const apiKey = process.env.CIRCLE_API_KEY;
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

    if (!apiKey || !entitySecret) {
        console.error('❌ Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET in .env');
        process.exit(1);
    }

    initCircleClient(apiKey, entitySecret);
    console.log('✅ Circle client initialized');

    // Set existing wallet
    setScoutWallet(SCOUT_WALLET_SET_ID, SCOUT_WALLET_ID, SCOUT_WALLET_ADDRESS);
    console.log(`✅ Using wallet: ${SCOUT_WALLET_ADDRESS}`);

    // Request testnet tokens
    console.log('\n💰 Requesting testnet tokens...');
    try {
        await requestTestnetTokens(SCOUT_WALLET_ID, 'ARC-TESTNET');
        console.log('✅ Testnet tokens requested! Waiting 10s for confirmation...');
        await new Promise(r => setTimeout(r, 10000));
    } catch (e: any) {
        console.log('⚠️  Token request:', e.message);
    }

    // Get agent info
    const agentInfo = getScoutAgentInfo();
    console.log('\n📋 Agent Details:');
    console.log(`   Name: ${agentInfo.name}`);
    console.log(`   Service: ${agentInfo.serviceType}`);
    console.log(`   Price: ${Number(agentInfo.price) / 1e18} USDC`);

    // Register on-chain
    console.log('\n⛓️  Registering on AgentRegistry...');

    try {
        const result = await registerScoutAgent(AGENT_REGISTRY);
        console.log('\n✅ Registration successful!');
        console.log(`   Transaction ID: ${result.transactionId}`);
        console.log(`   Status: ${result.status}`);
    } catch (error: any) {
        console.error('\n❌ Registration failed:', error.message);
        // Try to get more details
        if (error.response) {
            console.error('Response:', error.response.data);
        }
        process.exit(1);
    }
}

main().catch(console.error);
