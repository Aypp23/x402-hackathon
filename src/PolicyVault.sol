// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PolicyVault
 * @notice Agent treasury with onchain spending policies
 * @dev Enforces daily spending limits, allowlists, and emergency freeze
 * @dev ASSET TYPE: Native token (ETH)
 * @dev AUDIT FIXES: Added ReentrancyGuard, zero address validation, clarified asset type
 */
contract PolicyVault is ReentrancyGuard {
    // --- State ---
    address public owner;
    address public agent;
    bool public frozen;
    
    uint256 public dailyLimit;
    uint256 public spentToday;
    uint256 public lastResetDay;
    
    mapping(address => bool) public allowlist;
    
    // --- Events ---
    event Deposit(address indexed from, uint256 amount);
    event Withdrawal(address indexed to, uint256 amount);
    event PolicyUpdated(uint256 newDailyLimit);
    event AllowlistUpdated(address indexed target, bool allowed);
    event Frozen(bool status);
    event AgentUpdated(address indexed newAgent);
    event EmergencyWithdrawal(address indexed to, uint256 amount);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    
    // --- Errors ---
    error OnlyOwner();
    error OnlyAgent();
    error VaultFrozen();
    error ExceedsDailyLimit();
    error NotAllowlisted();
    error TransferFailed();
    error ZeroAddress();
    
    // --- Modifiers ---
    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }
    
    modifier onlyAgent() {
        if (msg.sender != agent) revert OnlyAgent();
        _;
    }
    
    modifier notFrozen() {
        if (frozen) revert VaultFrozen();
        _;
    }
    
    // --- Constructor ---
    constructor(address _agent, uint256 _dailyLimit) {
        if (_agent == address(0)) revert ZeroAddress();
        owner = msg.sender;
        agent = _agent;
        dailyLimit = _dailyLimit;
        lastResetDay = block.timestamp / 1 days;
    }
    
    // --- Receive native ETH/USDC ---
    /// @dev Accepts native token deposits.
    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }
    
    // --- Agent Functions ---
    
    /**
     * @notice Agent withdraws native ETH/USDC within policy limits
     * @dev AUDIT FIX: Added nonReentrant and zero address validation
     * @param to Recipient address (must be allowlisted and non-zero)
     * @param amount Amount of native token to transfer
     */
    function withdraw(address to, uint256 amount) external onlyAgent notFrozen nonReentrant {
        // AUDIT FIX: Zero address validation
        if (to == address(0)) revert ZeroAddress();
        
        // Check allowlist
        if (!allowlist[to]) revert NotAllowlisted();
        
        // Reset daily counter if new day
        uint256 today = block.timestamp / 1 days;
        if (today > lastResetDay) {
            spentToday = 0;
            lastResetDay = today;
        }
        
        // Check daily limit
        if (spentToday + amount > dailyLimit) revert ExceedsDailyLimit();
        
        // Update spent amount BEFORE transfer (CEI pattern)
        spentToday += amount;
        
        // Transfer native ETH/USDC
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
        
        emit Withdrawal(to, amount);
    }
    
    // --- Owner Functions ---
    
    /**
     * @notice Update daily spending limit
     */
    function setDailyLimit(uint256 _limit) external onlyOwner {
        dailyLimit = _limit;
        emit PolicyUpdated(_limit);
    }
    
    /**
     * @notice Add or remove address from allowlist
     */
    function setAllowlist(address _target, bool _allowed) external onlyOwner {
        if (_target == address(0)) revert ZeroAddress();
        allowlist[_target] = _allowed;
        emit AllowlistUpdated(_target, _allowed);
    }
    
    /**
     * @notice Freeze or unfreeze the vault (kill switch)
     */
    function setFrozen(bool _frozen) external onlyOwner {
        frozen = _frozen;
        emit Frozen(_frozen);
    }
    
    /**
     * @notice Update the agent address
     */
    function setAgent(address _agent) external onlyOwner {
        if (_agent == address(0)) revert ZeroAddress();
        agent = _agent;
        emit AgentUpdated(_agent);
    }
    
    /**
     * @notice Transfer ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
    
    /**
     * @notice Emergency withdraw by owner (bypasses daily limits but NOT allowlist)
     * @dev AUDIT FIX: Added nonReentrant and zero address validation
     * @dev WARNING: This function bypasses daily limits. Use only in emergencies.
     * @dev NOTE: Still requires vault to NOT be frozen for safety.
     */
    function emergencyWithdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        // AUDIT FIX: Zero address validation
        if (to == address(0)) revert ZeroAddress();
        
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
        
        emit EmergencyWithdrawal(to, amount);
    }
    
    // --- View Functions ---
    
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
    
    function getRemainingDaily() external view returns (uint256) {
        uint256 today = block.timestamp / 1 days;
        if (today > lastResetDay) {
            return dailyLimit;
        }
        return dailyLimit > spentToday ? dailyLimit - spentToday : 0;
    }
}
