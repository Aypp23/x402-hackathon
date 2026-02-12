import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import solc from 'solc';
import { ethers } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(__dirname, '../..');

dotenv.config({ path: path.join(backendRoot, '.env') });

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const AGENT_ADDRESS = process.env.AGENT_ADDRESS;
const RPC_URL = process.env.CHAIN_RPC_URL || 'https://sepolia.base.org';
const EXPECTED_CHAIN_ID = BigInt(process.env.CHAIN_ID || '84532');
const USDC_BASE_SEPOLIA = process.env.USDC_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

function parseDailyLimit(rawValue) {
    if (!rawValue || rawValue.trim() === '') {
        return ethers.parseEther('50');
    }

    const value = rawValue.trim();
    if (value.includes('.')) {
        return ethers.parseUnits(value, 18);
    }

    return BigInt(value);
}

const DAILY_LIMIT = parseDailyLimit(process.env.DAILY_LIMIT);

if (!PRIVATE_KEY) {
    throw new Error('Missing PRIVATE_KEY in backend/.env');
}

if (!AGENT_ADDRESS || !ethers.isAddress(AGENT_ADDRESS)) {
    throw new Error('Missing or invalid AGENT_ADDRESS in backend/.env');
}

if (!ethers.isAddress(USDC_BASE_SEPOLIA)) {
    throw new Error(`Invalid USDC_ADDRESS: ${USDC_BASE_SEPOLIA}`);
}

function loadSource(relativePath) {
    const absolutePath = path.join(repoRoot, relativePath);
    return fs.readFileSync(absolutePath, 'utf8');
}

function buildCompilerInput() {
    return {
        language: 'Solidity',
        sources: {
            'src/PolicyVault.sol': { content: loadSource('src/PolicyVault.sol') },
            'src/Escrow.sol': { content: loadSource('src/Escrow.sol') },
            'src/AgentRegistry.sol': { content: loadSource('src/AgentRegistry.sol') },
            '@openzeppelin/contracts/utils/ReentrancyGuard.sol': {
                content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

abstract contract ReentrancyGuard {
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;
    uint256 private _status;

    error ReentrancyGuardReentrantCall();

    constructor() {
        _status = NOT_ENTERED;
    }

    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    function _nonReentrantBefore() private {
        if (_status == ENTERED) {
            revert ReentrancyGuardReentrantCall();
        }
        _status = ENTERED;
    }

    function _nonReentrantAfter() private {
        _status = NOT_ENTERED;
    }
}
`,
            },
            '@openzeppelin/contracts/token/ERC20/IERC20.sol': {
                content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}
`,
            },
        },
        settings: {
            optimizer: {
                enabled: false,
                runs: 200,
            },
            outputSelection: {
                '*': {
                    '*': ['abi', 'evm.bytecode.object'],
                },
            },
        },
    };
}

function compileContracts() {
    const output = JSON.parse(solc.compile(JSON.stringify(buildCompilerInput())));
    const errors = output.errors || [];

    for (const err of errors) {
        if (err.severity === 'error') {
            throw new Error(`Solidity compile error: ${err.formattedMessage}`);
        }
    }

    return {
        PolicyVault: output.contracts['src/PolicyVault.sol'].PolicyVault,
        Escrow: output.contracts['src/Escrow.sol'].Escrow,
        AgentRegistry: output.contracts['src/AgentRegistry.sol'].AgentRegistry,
    };
}

async function deployContract(name, compiledContract, signer, args = [], nextNonce) {
    const bytecode = compiledContract?.evm?.bytecode?.object;
    if (!bytecode || bytecode.length === 0) {
        throw new Error(`${name} bytecode is missing`);
    }

    const factory = new ethers.ContractFactory(
        compiledContract.abi,
        bytecode.startsWith('0x') ? bytecode : `0x${bytecode}`,
        signer
    );

    const contract = await factory.deploy(...args, { nonce: nextNonce() });
    const deploymentTx = contract.deploymentTransaction();
    console.log(`[Deploy] ${name} tx: ${deploymentTx.hash}`);
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    console.log(`[Deploy] ${name} address: ${address}`);
    return contract;
}

async function main() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const network = await provider.getNetwork();
    const chainId = BigInt(network.chainId);

    console.log(`[Config] RPC URL: ${RPC_URL}`);
    console.log(`[Config] Chain ID: ${chainId.toString()}`);
    if (chainId !== EXPECTED_CHAIN_ID) {
        console.warn(`[Warn] Expected chain ID ${EXPECTED_CHAIN_ID.toString()}, got ${chainId.toString()}`);
    }

    const signer = new ethers.Wallet(PRIVATE_KEY, provider);
    const deployerAddress = await signer.getAddress();
    const balance = await provider.getBalance(deployerAddress);
    console.log(`[Config] Deployer: ${deployerAddress}`);
    console.log(`[Config] Deployer balance: ${ethers.formatEther(balance)} ETH`);
    const nonceCursor = {
        value: await provider.getTransactionCount(deployerAddress, 'pending'),
    };
    const nextNonce = () => nonceCursor.value++;
    console.log(`[Config] Starting nonce: ${nonceCursor.value}`);

    const compiled = compileContracts();

    const policyVault = await deployContract('PolicyVault', compiled.PolicyVault, signer, [
        AGENT_ADDRESS,
        DAILY_LIMIT,
    ], nextNonce);

    const escrow = await deployContract('Escrow', compiled.Escrow, signer, [USDC_BASE_SEPOLIA], nextNonce);
    const agentRegistry = await deployContract('AgentRegistry', compiled.AgentRegistry, signer, [], nextNonce);

    console.log('[Config] Linking contracts...');
    await (await policyVault.setAllowlist(await escrow.getAddress(), true, { nonce: nextNonce() })).wait();
    await (await agentRegistry.setEscrowContract(await escrow.getAddress(), { nonce: nextNonce() })).wait();
    await (await escrow.setAgentRegistry(await agentRegistry.getAddress(), { nonce: nextNonce() })).wait();
    console.log('[Config] Link complete');

    const result = {
        chainId: chainId.toString(),
        deployer: deployerAddress,
        policyVault: await policyVault.getAddress(),
        escrow: await escrow.getAddress(),
        agentRegistry: await agentRegistry.getAddress(),
    };

    console.log('[Result]', JSON.stringify(result, null, 2));
}

main().catch((error) => {
    console.error('[Deploy] Failed:', error.message);
    process.exit(1);
});
