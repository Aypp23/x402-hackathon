import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

console.log('--- WALLET GENERATED ---');
console.log(`Address: ${account.address}`);
console.log(`PrivateKey: ${privateKey}`);
console.log('------------------------');
