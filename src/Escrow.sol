// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IAgentRegistry {
    function recordTaskCompletion(uint256 agentId) external;
}

/**
 * @title Escrow
 * @notice Trustless escrow for agent-to-agent payments
 * @dev Funds are locked until task completion or timeout
 * @dev AUDIT FIXES: Added ReentrancyGuard, existence checks, fallback handlers, registry integration
 */
contract Escrow is ReentrancyGuard {
    // --- Structs ---
    struct EscrowData {
        address buyer;
        address seller;
        uint256 amount;
        bytes32 taskHash;
        uint256 deadline;
        uint256 sellerAgentId; // For reputation tracking
        EscrowStatus status;
    }
    
    enum EscrowStatus {
        None,
        Locked,
        Released,
        Refunded,
        Disputed
    }
    
    // --- State ---
    address public owner;
    IERC20 public paymentToken; // USDC token for payments
    IAgentRegistry public agentRegistry;
    
    uint256 public escrowCount;
    mapping(uint256 => EscrowData) public escrows;
    
    uint256 public constant DEFAULT_TIMEOUT = 5 minutes;
    uint256 public constant MAX_TIMEOUT = 7 days;
    
    // --- Events ---
    event EscrowCreated(uint256 indexed escrowId, address indexed buyer, address indexed seller, uint256 amount, bytes32 taskHash);
    event EscrowReleased(uint256 indexed escrowId, address indexed seller, uint256 amount);
    event EscrowRefunded(uint256 indexed escrowId, address indexed buyer, uint256 amount);
    event EscrowDisputed(uint256 indexed escrowId, address indexed disputer);
    event AgentRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    
    // --- Errors ---
    error InvalidEscrow();
    error NotBuyer();
    error NotBuyerOrSeller();
    error EscrowNotLocked();
    error DeadlineNotReached();
    error TransferFailed();
    error OnlyOwner();
    error ZeroAddress();
    error InvalidTimeout();
    
    // --- Modifiers ---
    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }
    
    // --- Constructor ---
    constructor(address _paymentToken) {
        if (_paymentToken == address(0)) revert ZeroAddress();
        owner = msg.sender;
        paymentToken = IERC20(_paymentToken);
    }
    
    // --- Fallback Handlers (AUDIT FIX) ---
    receive() external payable {
        revert InvalidEscrow();
    }
    
    fallback() external payable {
        revert InvalidEscrow();
    }
    
    // --- Admin Functions ---
    
    /**
     * @notice Set the AgentRegistry for reputation tracking
     */
    function setAgentRegistry(address _registry) external onlyOwner {
        if (_registry == address(0)) revert ZeroAddress();
        address oldRegistry = address(agentRegistry);
        agentRegistry = IAgentRegistry(_registry);
        emit AgentRegistryUpdated(oldRegistry, _registry);
    }
    
    // --- Create Escrow ---
    
    /**
     * @notice Create a new escrow by locking USDC (ERC20)
     * @param seller The service provider who will receive payment
     * @param taskHash Hash of the task description
     * @param sellerAgentId The seller's agent ID for reputation tracking
     * @param amount The amount of USDC to lock (caller must have approved this contract)
     * @return escrowId The ID of the created escrow
     */
    function createEscrow(
        address seller,
        bytes32 taskHash,
        uint256 sellerAgentId,
        uint256 amount
    ) external returns (uint256 escrowId) {
        if (amount == 0) revert InvalidEscrow();
        if (seller == address(0)) revert ZeroAddress();
        
        // Pull tokens from buyer (requires prior approval)
        bool success = paymentToken.transferFrom(msg.sender, address(this), amount);
        if (!success) revert TransferFailed();
        
        escrowId = escrowCount++;
        
        escrows[escrowId] = EscrowData({
            buyer: msg.sender,
            seller: seller,
            amount: amount,
            taskHash: taskHash,
            deadline: block.timestamp + DEFAULT_TIMEOUT,
            sellerAgentId: sellerAgentId,
            status: EscrowStatus.Locked
        });
        
        emit EscrowCreated(escrowId, msg.sender, seller, amount, taskHash);
    }
    
    /**
     * @notice Create escrow with custom timeout (ERC20)
     */
    function createEscrowWithTimeout(
        address seller,
        bytes32 taskHash,
        uint256 sellerAgentId,
        uint256 timeout,
        uint256 amount
    ) external returns (uint256 escrowId) {
        if (amount == 0) revert InvalidEscrow();
        if (seller == address(0)) revert ZeroAddress();
        if (timeout == 0 || timeout > MAX_TIMEOUT) revert InvalidTimeout();
        
        // Pull tokens from buyer
        bool success = paymentToken.transferFrom(msg.sender, address(this), amount);
        if (!success) revert TransferFailed();
        
        escrowId = escrowCount++;
        
        escrows[escrowId] = EscrowData({
            buyer: msg.sender,
            seller: seller,
            amount: amount,
            taskHash: taskHash,
            deadline: block.timestamp + timeout,
            sellerAgentId: sellerAgentId,
            status: EscrowStatus.Locked
        });
        
        emit EscrowCreated(escrowId, msg.sender, seller, amount, taskHash);
    }
    
    // --- Release/Refund (AUDIT FIX: nonReentrant added) ---
    
    /**
     * @notice Buyer releases funds to seller (task completed)
     * @dev AUDIT FIX: Added nonReentrant modifier and existence check
     */
    function release(uint256 escrowId) external nonReentrant {
        EscrowData storage e = escrows[escrowId];
        
        // AUDIT FIX: Existence check
        if (e.status == EscrowStatus.None) revert InvalidEscrow();
        if (e.status != EscrowStatus.Locked) revert EscrowNotLocked();
        if (msg.sender != e.buyer) revert NotBuyer();
        
        // Update state BEFORE external calls (CEI pattern)
        e.status = EscrowStatus.Released;
        uint256 amount = e.amount;
        address seller = e.seller;
        uint256 sellerAgentId = e.sellerAgentId;
        
        // Update reputation if registry is set
        if (address(agentRegistry) != address(0) && sellerAgentId != 0) {
            agentRegistry.recordTaskCompletion(sellerAgentId);
        }
        
        // Transfer funds via ERC20
        bool success = paymentToken.transfer(seller, amount);
        if (!success) revert TransferFailed();
        
        emit EscrowReleased(escrowId, seller, amount);
    }
    
    /**
     * @notice Refund to buyer after deadline (task not completed)
     * @dev AUDIT FIX: Added nonReentrant modifier and existence check
     */
    function refund(uint256 escrowId) external nonReentrant {
        EscrowData storage e = escrows[escrowId];
        
        // AUDIT FIX: Existence check
        if (e.status == EscrowStatus.None) revert InvalidEscrow();
        if (e.status != EscrowStatus.Locked) revert EscrowNotLocked();
        if (msg.sender != e.buyer && msg.sender != e.seller) revert NotBuyerOrSeller();
        if (block.timestamp < e.deadline) revert DeadlineNotReached();
        
        // Update state BEFORE external calls (CEI pattern)
        e.status = EscrowStatus.Refunded;
        uint256 amount = e.amount;
        address buyer = e.buyer;
        
        // Transfer funds via ERC20
        bool success = paymentToken.transfer(buyer, amount);
        if (!success) revert TransferFailed();
        
        emit EscrowRefunded(escrowId, buyer, amount);
    }
    
    /**
     * @notice Mark escrow as disputed (for future arbitration)
     */
    function dispute(uint256 escrowId) external {
        EscrowData storage e = escrows[escrowId];
        
        if (e.status == EscrowStatus.None) revert InvalidEscrow();
        if (e.status != EscrowStatus.Locked) revert EscrowNotLocked();
        if (msg.sender != e.buyer && msg.sender != e.seller) revert NotBuyerOrSeller();
        
        e.status = EscrowStatus.Disputed;
        
        emit EscrowDisputed(escrowId, msg.sender);
    }
    
    // --- View Functions ---
    
    function getEscrow(uint256 escrowId) external view returns (EscrowData memory) {
        return escrows[escrowId];
    }
    
    function isExpired(uint256 escrowId) external view returns (bool) {
        return block.timestamp >= escrows[escrowId].deadline;
    }
    
    function exists(uint256 escrowId) external view returns (bool) {
        return escrows[escrowId].status != EscrowStatus.None;
    }
}
