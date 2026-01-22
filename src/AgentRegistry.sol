// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AgentRegistry
 * @notice Directory of registered agents and their services
 * @dev Agents register services with pricing, buyers discover providers
 * @dev AUDIT FIXES: Added access control, deregistration, loop limits
 */
contract AgentRegistry {
    // --- Structs ---
    struct Agent {
        address wallet;
        string name;
        string serviceType;
        uint256 pricePerTask;
        uint256 reputation;
        uint256 tasksCompleted;
        bool active;
    }
    
    // --- State ---
    address public owner;
    address public escrowContract;
    
    uint256 public agentCount;
    mapping(uint256 => Agent) public agents;
    mapping(address => uint256) public walletToAgentId;
    mapping(string => uint256[]) public serviceTypeToAgents;
    
    // --- Constants ---
    uint256 public constant MAX_QUERY_LIMIT = 100;
    
    // --- Events ---
    event AgentRegistered(uint256 indexed agentId, address indexed wallet, string name, string serviceType, uint256 price);
    event AgentUpdated(uint256 indexed agentId, uint256 newPrice, bool active);
    event AgentDeregistered(uint256 indexed agentId, address indexed wallet);
    event ReputationUpdated(uint256 indexed agentId, uint256 newReputation);
    event TaskCompleted(uint256 indexed agentId, uint256 totalTasks);
    event EscrowContractUpdated(address indexed oldEscrow, address indexed newEscrow);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    
    // --- Errors ---
    error AlreadyRegistered();
    error NotAgentOwner();
    error AgentNotFound();
    error OnlyOwner();
    error OnlyEscrow();
    error ZeroAddress();
    
    // --- Modifiers ---
    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }
    
    modifier onlyEscrow() {
        if (msg.sender != escrowContract) revert OnlyEscrow();
        _;
    }
    
    // --- Constructor ---
    constructor() {
        owner = msg.sender;
    }
    
    // --- Admin Functions ---
    
    /**
     * @notice Set the authorized escrow contract
     * @dev Only escrow can call recordTaskCompletion
     */
    function setEscrowContract(address _escrow) external onlyOwner {
        if (_escrow == address(0)) revert ZeroAddress();
        address oldEscrow = escrowContract;
        escrowContract = _escrow;
        emit EscrowContractUpdated(oldEscrow, _escrow);
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
    
    // --- Register Agent ---
    
    /**
     * @notice Register a new agent with a service offering
     * @param name Human-readable agent name
     * @param serviceType Type of service (e.g., "text-generation", "image-analysis")
     * @param pricePerTask Price in USDC (18 decimals) per task
     */
    function registerAgent(
        string calldata name,
        string calldata serviceType,
        uint256 pricePerTask
    ) external returns (uint256 agentId) {
        if (walletToAgentId[msg.sender] != 0) revert AlreadyRegistered();
        
        agentId = ++agentCount; // Start from 1
        
        agents[agentId] = Agent({
            wallet: msg.sender,
            name: name,
            serviceType: serviceType,
            pricePerTask: pricePerTask,
            reputation: 100, // Start with neutral reputation
            tasksCompleted: 0,
            active: true
        });
        
        walletToAgentId[msg.sender] = agentId;
        serviceTypeToAgents[serviceType].push(agentId);
        
        emit AgentRegistered(agentId, msg.sender, name, serviceType, pricePerTask);
    }
    
    // --- Update Agent ---
    
    /**
     * @notice Update agent price and active status
     */
    function updateAgent(uint256 pricePerTask, bool active) external {
        uint256 agentId = walletToAgentId[msg.sender];
        if (agentId == 0) revert AgentNotFound();
        
        Agent storage a = agents[agentId];
        a.pricePerTask = pricePerTask;
        a.active = active;
        
        emit AgentUpdated(agentId, pricePerTask, active);
    }
    
    /**
     * @notice Deregister an agent (allows re-registration later)
     */
    function deregisterAgent() external {
        uint256 agentId = walletToAgentId[msg.sender];
        if (agentId == 0) revert AgentNotFound();
        
        Agent storage a = agents[agentId];
        a.active = false;
        
        // Clear the wallet mapping to allow re-registration
        delete walletToAgentId[msg.sender];
        
        emit AgentDeregistered(agentId, msg.sender);
    }
    
    /**
     * @notice Record a completed task (only callable by escrow contract)
     * @dev AUDIT FIX: Added onlyEscrow modifier to prevent reputation manipulation
     */
    function recordTaskCompletion(uint256 agentId) external onlyEscrow {
        Agent storage a = agents[agentId];
        if (a.wallet == address(0)) revert AgentNotFound();
        
        a.tasksCompleted++;
        
        // Simple reputation boost (capped at 200)
        if (a.reputation < 200) {
            a.reputation += 1;
        }
        
        emit TaskCompleted(agentId, a.tasksCompleted);
        emit ReputationUpdated(agentId, a.reputation);
    }
    
    // --- View Functions ---
    
    /**
     * @notice Get all agents offering a specific service type
     */
    function getAgentsByService(string calldata serviceType) external view returns (uint256[] memory) {
        return serviceTypeToAgents[serviceType];
    }
    
    /**
     * @notice Get agent details by ID
     */
    function getAgent(uint256 agentId) external view returns (Agent memory) {
        return agents[agentId];
    }
    
    /**
     * @notice Get agent ID by wallet address
     */
    function getAgentIdByWallet(address wallet) external view returns (uint256) {
        return walletToAgentId[wallet];
    }
    
    /**
     * @notice Get cheapest active agent for a service type
     * @dev AUDIT FIX: Added loop limit to prevent out-of-gas
     */
    function getCheapestAgent(string calldata serviceType) external view returns (uint256 agentId, uint256 price) {
        uint256[] memory agentIds = serviceTypeToAgents[serviceType];
        uint256 cheapest = type(uint256).max;
        
        // Limit iterations to prevent out-of-gas
        uint256 limit = agentIds.length > MAX_QUERY_LIMIT ? MAX_QUERY_LIMIT : agentIds.length;
        
        for (uint256 i = 0; i < limit; i++) {
            Agent memory a = agents[agentIds[i]];
            if (a.active && a.pricePerTask < cheapest) {
                cheapest = a.pricePerTask;
                agentId = agentIds[i];
            }
        }
        
        price = cheapest == type(uint256).max ? 0 : cheapest;
    }
    
    /**
     * @notice Get active agents for a service type with pagination
     * @dev AUDIT FIX: Added pagination for large lists
     */
    function getActiveAgentsPaginated(
        string calldata serviceType,
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory activeAgentIds, uint256 total) {
        uint256[] memory allAgents = serviceTypeToAgents[serviceType];
        total = allAgents.length;
        
        if (offset >= total) {
            return (new uint256[](0), total);
        }
        
        uint256 end = offset + limit > total ? total : offset + limit;
        uint256 resultSize = end - offset;
        
        // Count active agents first
        uint256 activeCount = 0;
        for (uint256 i = offset; i < end && activeCount < MAX_QUERY_LIMIT; i++) {
            if (agents[allAgents[i]].active) {
                activeCount++;
            }
        }
        
        // Populate result
        activeAgentIds = new uint256[](activeCount);
        uint256 idx = 0;
        for (uint256 i = offset; i < end && idx < activeCount; i++) {
            if (agents[allAgents[i]].active) {
                activeAgentIds[idx++] = allAgents[i];
            }
        }
    }
}
