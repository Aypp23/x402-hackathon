// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {Escrow} from "../src/Escrow.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";

contract DeployAgentMarketplace is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address agentAddress = vm.envAddress("AGENT_ADDRESS");
        uint256 dailyLimit = vm.envOr("DAILY_LIMIT", uint256(50 ether)); // 50 USDC (18 decimals)
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy PolicyVault
        PolicyVault vault = new PolicyVault(agentAddress, dailyLimit);
        console.log("PolicyVault deployed at:", address(vault));
        
        // Deploy Escrow with USDC token address
        // Arc Testnet native USDC: 0x3600000000000000000000000000000000000000
        address usdcToken = 0x3600000000000000000000000000000000000000;
        Escrow escrow = new Escrow(usdcToken);
        console.log("Escrow deployed at:", address(escrow));
        
        // Deploy AgentRegistry
        AgentRegistry registry = new AgentRegistry();
        console.log("AgentRegistry deployed at:", address(registry));
        
        // --- Cross-contract configuration ---
        
        // 1. Allowlist escrow contract in vault (so agent can pay escrow)
        vault.setAllowlist(address(escrow), true);
        console.log("Escrow allowlisted in PolicyVault");
        
        // 2. Set escrow as authorized caller in registry (for reputation updates)
        registry.setEscrowContract(address(escrow));
        console.log("Escrow set as authorized in AgentRegistry");
        
        // 3. Set registry in escrow (for reputation tracking on release)
        escrow.setAgentRegistry(address(registry));
        console.log("AgentRegistry set in Escrow");
        
        vm.stopBroadcast();
        
        console.log("---");
        console.log("Deployment complete!");
        console.log("Owner:", vm.addr(deployerPrivateKey));
        console.log("Agent:", agentAddress);
        console.log("Daily Limit:", dailyLimit / 1e18, "USDC");
        console.log("---");
        console.log("Contract Addresses:");
        console.log("  PolicyVault:", address(vault));
        console.log("  Escrow:", address(escrow));
        console.log("  AgentRegistry:", address(registry));
    }
}
