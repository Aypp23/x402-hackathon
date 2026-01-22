// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {Escrow} from "../src/Escrow.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Mock ERC20 for testing
contract MockUSDC {
    string public name = "Mock USDC";
    string public symbol = "USDC";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }
    
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
    
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract AgentMarketplaceTest is Test {
    PolicyVault public vault;
    Escrow public escrow;
    AgentRegistry public registry;
    MockUSDC public usdc;
    
    address public owner = address(1);
    address public agent = address(2);
    address public buyer = address(3);
    address public provider = address(4);
    
    uint256 public constant DAILY_LIMIT = 10 ether; // 10 USDC (18 decimals)
    
    function setUp() public {
        vm.deal(owner, 100 ether);
        vm.deal(buyer, 100 ether);
        vm.deal(agent, 100 ether);
        
        // Deploy mock USDC
        usdc = new MockUSDC();
        usdc.mint(buyer, 100 ether);
        usdc.mint(agent, 100 ether);
        
        vm.prank(owner);
        vault = new PolicyVault(agent, DAILY_LIMIT);
        
        vm.prank(owner);
        escrow = new Escrow(address(usdc));
        
        vm.prank(owner);
        registry = new AgentRegistry();
        
        // Set escrow as authorized caller for registry
        vm.prank(owner);
        registry.setEscrowContract(address(escrow));
        
        // Set registry in escrow for reputation tracking
        vm.prank(owner);
        escrow.setAgentRegistry(address(registry));
    }
    
    // --- PolicyVault Tests ---
    
    function test_VaultDeposit() public {
        vm.prank(buyer);
        (bool success, ) = address(vault).call{value: 5 ether}("");
        assertTrue(success);
        assertEq(vault.getBalance(), 5 ether);
    }
    
    function test_VaultWithdraw() public {
        // Fund vault
        vm.prank(buyer);
        (bool success, ) = address(vault).call{value: 5 ether}("");
        assertTrue(success);
        
        // Owner allowlists provider
        vm.prank(owner);
        vault.setAllowlist(provider, true);
        
        // Agent withdraws to allowlisted address
        uint256 providerBefore = provider.balance;
        vm.prank(agent);
        vault.withdraw(provider, 1 ether);
        
        assertEq(provider.balance, providerBefore + 1 ether);
        assertEq(vault.spentToday(), 1 ether);
    }
    
    function test_VaultRejectsNonAllowlisted() public {
        vm.prank(buyer);
        (bool success, ) = address(vault).call{value: 5 ether}("");
        assertTrue(success);
        
        vm.prank(agent);
        vm.expectRevert(PolicyVault.NotAllowlisted.selector);
        vault.withdraw(provider, 1 ether);
    }
    
    function test_VaultRejectsExceedingDailyLimit() public {
        vm.prank(buyer);
        (bool success, ) = address(vault).call{value: 15 ether}("");
        assertTrue(success);
        
        vm.prank(owner);
        vault.setAllowlist(provider, true);
        
        vm.prank(agent);
        vm.expectRevert(PolicyVault.ExceedsDailyLimit.selector);
        vault.withdraw(provider, 11 ether);
    }
    
    function test_VaultFreezeBlocksWithdrawals() public {
        vm.prank(buyer);
        (bool success, ) = address(vault).call{value: 5 ether}("");
        assertTrue(success);
        
        vm.prank(owner);
        vault.setAllowlist(provider, true);
        
        vm.prank(owner);
        vault.setFrozen(true);
        
        vm.prank(agent);
        vm.expectRevert(PolicyVault.VaultFrozen.selector);
        vault.withdraw(provider, 1 ether);
    }
    
    // --- Escrow Tests ---
    
    function test_EscrowCreateAndRelease() public {
        bytes32 taskHash = keccak256("test task");
        
        // Register provider as agent first
        vm.prank(provider);
        uint256 agentId = registry.registerAgent("Provider Bot", "text-generation", 0.02 ether);
        
        // Approve escrow to spend buyer's USDC
        vm.prank(buyer);
        usdc.approve(address(escrow), 1 ether);
        
        vm.prank(buyer);
        uint256 escrowId = escrow.createEscrow(provider, taskHash, agentId, 1 ether);
        
        assertEq(escrowId, 0);
        
        Escrow.EscrowData memory data = escrow.getEscrow(escrowId);
        assertEq(data.buyer, buyer);
        assertEq(data.seller, provider);
        assertEq(data.amount, 1 ether);
        assertEq(uint(data.status), uint(Escrow.EscrowStatus.Locked));
        
        // Buyer releases
        uint256 providerBefore = usdc.balanceOf(provider);
        vm.prank(buyer);
        escrow.release(escrowId);
        
        assertEq(usdc.balanceOf(provider), providerBefore + 1 ether);
        
        data = escrow.getEscrow(escrowId);
        assertEq(uint(data.status), uint(Escrow.EscrowStatus.Released));
        
        // Check reputation was updated
        AgentRegistry.Agent memory a = registry.getAgent(agentId);
        assertEq(a.tasksCompleted, 1);
        assertEq(a.reputation, 101);
    }
    
    function test_EscrowRefundAfterTimeout() public {
        bytes32 taskHash = keccak256("test task");
        
        vm.prank(buyer);
        usdc.approve(address(escrow), 1 ether);
        
        vm.prank(buyer);
        uint256 escrowId = escrow.createEscrow(provider, taskHash, 0, 1 ether);
        
        // Warp past deadline
        vm.warp(block.timestamp + 6 minutes);
        
        uint256 buyerBefore = usdc.balanceOf(buyer);
        vm.prank(buyer);
        escrow.refund(escrowId);
        
        assertEq(usdc.balanceOf(buyer), buyerBefore + 1 ether);
    }
    
    function test_EscrowRefundFailsBeforeTimeout() public {
        bytes32 taskHash = keccak256("test task");
        
        vm.prank(buyer);
        usdc.approve(address(escrow), 1 ether);
        
        vm.prank(buyer);
        uint256 escrowId = escrow.createEscrow(provider, taskHash, 0, 1 ether);
        
        vm.prank(buyer);
        vm.expectRevert(Escrow.DeadlineNotReached.selector);
        escrow.refund(escrowId);
    }
    
    function test_EscrowExistenceCheck() public {
        // Try to release non-existent escrow
        vm.prank(buyer);
        vm.expectRevert(Escrow.InvalidEscrow.selector);
        escrow.release(999);
    }
    
    function test_EscrowDispute() public {
        bytes32 taskHash = keccak256("test task");
        
        vm.prank(buyer);
        usdc.approve(address(escrow), 1 ether);
        
        vm.prank(buyer);
        uint256 escrowId = escrow.createEscrow(provider, taskHash, 0, 1 ether);
        
        vm.prank(buyer);
        escrow.dispute(escrowId);
        
        Escrow.EscrowData memory data = escrow.getEscrow(escrowId);
        assertEq(uint(data.status), uint(Escrow.EscrowStatus.Disputed));
    }
    
    function test_EscrowFallbackReverts() public {
        // Try to send ETH directly to escrow - should fail
        vm.prank(buyer);
        (bool success, ) = address(escrow).call{value: 1 ether}("");
        // Low-level call returns false when target reverts
        assertFalse(success);
    }
    
    // --- AgentRegistry Tests ---
    
    function test_AgentRegistration() public {
        vm.prank(provider);
        uint256 agentId = registry.registerAgent("Provider Bot", "text-generation", 0.02 ether);
        
        assertEq(agentId, 1);
        
        AgentRegistry.Agent memory a = registry.getAgent(agentId);
        assertEq(a.wallet, provider);
        assertEq(a.name, "Provider Bot");
        assertEq(a.pricePerTask, 0.02 ether);
        assertEq(a.reputation, 100);
        assertTrue(a.active);
    }
    
    function test_AgentServiceDiscovery() public {
        vm.prank(provider);
        registry.registerAgent("Provider 1", "text-generation", 0.02 ether);
        
        vm.prank(agent);
        registry.registerAgent("Provider 2", "text-generation", 0.01 ether);
        
        uint256[] memory agents = registry.getAgentsByService("text-generation");
        assertEq(agents.length, 2);
        
        (uint256 cheapestId, uint256 cheapestPrice) = registry.getCheapestAgent("text-generation");
        assertEq(cheapestId, 2); // Provider 2
        assertEq(cheapestPrice, 0.01 ether);
    }
    
    function test_RecordTaskCompletionOnlyEscrow() public {
        vm.prank(provider);
        uint256 agentId = registry.registerAgent("Provider Bot", "text-generation", 0.02 ether);
        
        // Random caller should fail
        vm.prank(buyer);
        vm.expectRevert(AgentRegistry.OnlyEscrow.selector);
        registry.recordTaskCompletion(agentId);
        
        // Escrow should succeed
        vm.prank(address(escrow));
        registry.recordTaskCompletion(agentId);
        
        AgentRegistry.Agent memory a = registry.getAgent(agentId);
        assertEq(a.tasksCompleted, 1);
        assertEq(a.reputation, 101);
    }
    
    function test_AgentDeregistration() public {
        vm.prank(provider);
        uint256 agentId = registry.registerAgent("Provider Bot", "text-generation", 0.02 ether);
        
        assertEq(registry.getAgentIdByWallet(provider), agentId);
        
        vm.prank(provider);
        registry.deregisterAgent();
        
        // Wallet mapping cleared
        assertEq(registry.getAgentIdByWallet(provider), 0);
        
        // Can re-register
        vm.prank(provider);
        uint256 newAgentId = registry.registerAgent("Provider Bot v2", "text-generation", 0.03 ether);
        assertEq(newAgentId, 2);
    }
}
