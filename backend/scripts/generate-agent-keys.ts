/**
 * Generate EOA private keys for agents
 * These will be used for x402 Gateway operations
 */

import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';

console.log("=== Generating Agent Private Keys ===\n");
console.log("Add these to your .env file:\n");

const agents = ['ORACLE', 'SCOUT', 'NEWS', 'YIELD'];

for (const agent of agents) {
    const privateKey = generatePrivateKey();
    const address = privateKeyToAddress(privateKey);
    
    console.log(`# ${agent.replace('_', ' ')} Agent (x402)`);
    console.log(`${agent}_X402_PRIVATE_KEY=${privateKey}`);
    console.log(`# Address: ${address}`);
    console.log('');
}

console.log("⚠️  KEEP THESE KEYS SECURE - they control real funds!");
