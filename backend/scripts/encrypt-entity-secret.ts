/**
 * Script to encrypt entity secret for Circle registration
 * 
 * Usage: npx tsx scripts/encrypt-entity-secret.ts
 */

import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const API_KEY = process.env.CIRCLE_API_KEY;
const ENTITY_SECRET = 'a92aa5de0d331d4ad7cba0d737272727c30ad05ad1206b04df92d072e6147ac4';

if (!API_KEY) {
    console.error('CIRCLE_API_KEY not found in .env file');
    console.error('Please add: CIRCLE_API_KEY=your_api_key');
    process.exit(1);
}

console.log(`Using API Key: ${API_KEY.substring(0, 20)}...`);

async function getPublicKey(): Promise<string> {
    const response = await fetch('https://api.circle.com/v1/w3s/config/entity/publicKey', {
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to get public key: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.data.publicKey;
}

function encryptEntitySecret(publicKeyPem: string, entitySecret: string): string {
    // Convert hex entity secret to buffer
    const secretBuffer = Buffer.from(entitySecret, 'hex');

    // Encrypt using RSA-OAEP with SHA-256
    const encrypted = crypto.publicEncrypt(
        {
            key: publicKeyPem,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256',
        },
        secretBuffer
    );

    // Return base64 encoded
    return encrypted.toString('base64');
}

async function main() {
    console.log('\nFetching Circle public key...\n');

    const publicKey = await getPublicKey();
    console.log('Public Key retrieved successfully!\n');

    console.log('Encrypting entity secret...\n');
    const ciphertext = encryptEntitySecret(publicKey, ENTITY_SECRET);

    console.log('='.repeat(80));
    console.log('ENTITY SECRET CIPHERTEXT (paste this in Circle Console):');
    console.log('='.repeat(80));
    console.log(ciphertext);
    console.log('='.repeat(80));
    console.log(`\nLength: ${ciphertext.length} characters`);
    console.log('\nNext steps:');
    console.log('1. Copy the ciphertext above');
    console.log('2. Go to Circle Console → Configurator → Entity Secret');
    console.log('3. Paste and click Register');
    console.log('4. Download and save the recovery file!');
}

main().catch(console.error);
