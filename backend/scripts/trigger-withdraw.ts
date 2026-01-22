
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

// Import the service functionality
// We need to use dynamic import or require to execute logic
import { runAutoWithdrawCycle } from '../src/services/x402-agent-auto-withdraw.js';

async function main() {
    console.log('\n=== ⚡️ Triggering Auto-Withdraw Cycle ===\n');

    try {
        await runAutoWithdrawCycle();
        console.log('\n✅ Cycle complete.');
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

main().catch(console.error);
