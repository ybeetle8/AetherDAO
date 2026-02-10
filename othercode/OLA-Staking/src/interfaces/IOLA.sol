// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {IERC20} from "lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

/**
 * @title IOLA
 * @notice Interface for OLA Token - DeFi token with dynamic fees and LP rewards
 * @dev Complete interface following Solidity Style Guide
 * @author OLA Protocol Team
 */
interface IOLA is IERC20 {
    // =========================================================================
    // ERRORS
    // =========================================================================

    /// @notice Thrown when user tries to sell within cold period
    error StillInColdPeriod();

    /// @notice Thrown when transaction exceeds maximum allowed amount
    error ExceedsMaxTransaction();

    /// @notice Thrown when address is blacklisted
    error AddressBlacklisted();

    /// @notice Thrown when caller is not the staking contract
    error OnlyStakingContract();

    /// @notice Thrown when pool update is called too frequently
    error UpdateTooFrequent();

    /// @notice Thrown when input amount is insufficient
    error InsufficientInputAmount();

    /// @notice Thrown when output amount is insufficient
    error InsufficientOutputAmount();

    /// @notice Thrown when liquidity is insufficient
    error InsufficientLiquidity();

    /// @notice Thrown when contract calls are not allowed
    error ContractCallNotAllowed();

    /// @notice Thrown when array length exceeds maximum
    error ArrayLengthExceeded();

    /// @notice Thrown when zero address is provided
    error ZeroAddress();

    /// @notice Thrown when token is already launched
    error AlreadyLaunched();

    /// @notice Thrown when maximum burn amount is reached
    error MaxBurnAmountReached();

    /// @notice Thrown when fee rate is invalid
    error InvalidFeeRate();

    /// @notice Thrown when balance is insufficient
    error InsufficientBalance();
    // =========================================================================
    // STRUCTS
    // =========================================================================

    /**
     * @notice Pool status information for liquidity tracking
     * @param balance USDT reserve balance in the pool
     * @param timestamp Last update timestamp
     */
    struct PoolStatus {
        uint112 balance;
        uint40 timestamp;
    }

    /**
     * @notice Batch distribution record for LP rewards
     * @param batchId Unique identifier for this distribution batch
     * @param timestamp When this batch was distributed
     * @param totalRewards Total USDT rewards distributed in this batch
     * @param participantCount Number of LP holders who received rewards
     * @param totalLPSupply Total LP supply at time of distribution
     * @param distributedPerLP USDT rewards per LP token (scaled by 1e18)
     * @param isComplete Whether the batch distribution was completed
     * @param accumulatedRewards Total accumulated rewards carried from previous batches
     */
    struct BatchDistribution {
        uint256 batchId;
        uint40 timestamp;
        uint256 totalRewards;
        uint256 participantCount;
        uint256 totalLPSupply;
        uint256 distributedPerLP;
        bool isComplete;
        uint256 accumulatedRewards;
    }

    // =========================================================================
    // EVENTS
    // =========================================================================

    // === CORE PROTOCOL EVENTS ===
    event TradingEnabled(uint40 indexed timestamp);
    event TokensRecycled(uint256 indexed amount);
    event PoolReserveUpdated(uint112 indexed newReserve, uint40 timestamp);

    // === FEE AND CONFIGURATION EVENTS ===
    event ColdPeriodUpdated(uint40 indexed newPeriod);
    event FeeSwapThresholdUpdated(uint256 indexed newThreshold);
    event MarketingAddressUpdated(address indexed newAddress);

    // === PROFIT DISTRIBUTION EVENTS ===
    event ProfitDistributed(
        address indexed user,
        address indexed referrer,
        uint256 amount
    );
    event LiquidityAdded(uint256 tokenAmount, uint256 baseTokenAmount);

    // === ACCESS CONTROL EVENTS ===
    event BlacklistUpdated(address indexed account, bool indexed isBlacklisted);
    event AddedToWhitelist(address indexed account);
    event RemovedFromWhitelist(address indexed account);
    event TrustedRoutersAdded(address[] routers);

    // === LP DISTRIBUTION EVENTS ===
    event LPRewardDeposited(uint256 indexed amount, uint256 timestamp);
    event LpRewardsCombined(uint256 indexed combinedAmount, uint256 timestamp);
    event LPDistributionTriggered(
        uint256 indexed distributedCount,
        uint256 gasUsed
    );
    event LPRewardDistributed(
        address indexed holder,
        uint256 indexed reward,
        uint256 lpBalance,
        uint256 totalEligibleLP
    );

    event AutoDistributionStatusChanged(bool indexed enabled);

    // === BATCH DISTRIBUTION EVENTS ===
    event BatchDistributionStarted(
        uint256 indexed batchId,
        uint256 totalRewards,
        uint256 accumulatedRewards,
        uint256 participantCount
    );
    event BatchDistributionCompleted(
        uint256 indexed batchId,
        uint256 totalDistributed,
        uint256 participantCount,
        uint256 remainingRewards
    );
    event RewardsAccumulated(
        uint256 indexed amount,
        uint256 newAccumulatedTotal,
        string source
    );
    event AutoLPRewardsStatusChanged(bool indexed enabled);
    event TokenDistributorUpdated(address indexed distributor);
    event InitialWhitelistSet();
    event UniswapV2PairCreated(address indexed pair);

    /// @notice Emitted when tokens are burned during buy transactions
    /// @param amount Amount of tokens burned
    event TokensBurned(uint256 amount);

    /// @notice Emitted when liquidity is permanently locked
    /// @param tokenAmount OLA tokens used for liquidity
    /// @param usdtAmount USDT tokens used for liquidity
    /// @param lpTokensLocked LP tokens sent to dead address
    event LiquidityLocked(
        uint256 tokenAmount,
        uint256 usdtAmount,
        uint256 lpTokensLocked
    );

    /// @notice Emitted when buy transaction is processed
    /// @param buyer Address of token buyer
    /// @param amount Total token amount bought
    /// @param burnFee Amount burned
    /// @param liquidityFee Amount used for liquidity
    event BuyProcessed(
        address indexed buyer,
        uint256 amount,
        uint256 burnFee,
        uint256 liquidityFee
    );

    /// @notice Emitted when sell transaction is processed
    /// @param seller Address of token seller
    /// @param amount Total token amount sold
    /// @param marketingFee Marketing fee charged
    /// @param lpFee LP fee charged
    /// @param profitTax Profit tax in USDT
    event SellProcessed(
        address indexed seller,
        uint256 amount,
        uint256 marketingFee,
        uint256 lpFee,
        uint256 profitTax
    );

    /// @notice Emitted when LP fees are processed into USDT rewards
    /// @param tokenAmount LP fee tokens processed
    /// @param usdtReceived USDT added to rewards pool
    event LpFeeProcessed(uint256 tokenAmount, uint256 usdtReceived);

    /// @notice Emitted when batch LP distribution completes
    /// @param holdersProcessed Number of holders processed
    /// @param totalDistributed Total USDT distributed
    /// @param completed Whether distribution completed successfully
    event LpBatchDistribution(
        uint256 holdersProcessed,
        uint256 totalDistributed,
        bool completed
    );

    /// @notice Emitted when profit tax is distributed
    /// @param user User who triggered the tax
    /// @param referrer Referrer address (zero if none)
    /// @param referrerAmount Amount sent to referrer
    /// @param marketingAmount Amount sent to marketing
    event ProfitTaxDistributed(
        address indexed user,
        address indexed referrer,
        uint256 referrerAmount,
        uint256 marketingAmount
    );

    /// @notice Emitted when LP holder is added to tracking
    /// @param holder New LP holder address
    /// @param lpBalance Initial LP balance
    event LpHolderAdded(address indexed holder, uint256 lpBalance);

    /// @notice Emitted when LP holder is removed from tracking
    /// @param holder Removed LP holder address
    event LpHolderRemoved(address indexed holder);

    /// @notice Emitted when marketing fees are processed
    /// @param amount Token amount processed to USDT
    event MarketingFeesProcessed(uint256 amount);

    /// @notice Emitted when LP rewards are accumulated for future distribution
    /// @param amount USDT amount accumulated
    /// @param accumulatedPerLP New accumulated rewards per LP token
    event LpRewardsAccumulated(uint256 amount, uint256 accumulatedPerLP);

    /// @notice Emitted when user's accumulated rewards are updated
    /// @param user User address
    /// @param newRewards New rewards added
    /// @param totalAccumulated Total accumulated rewards for user
    event UserRewardsUpdated(
        address indexed user,
        uint256 newRewards,
        uint256 totalAccumulated
    );

    // =========================================================================
    // CORE FUNCTIONS
    // =========================================================================

    /**
     * @notice Enables trading and launches the token
     */
    function setPresale() external;

    /**
     * @notice Sets the presale duration
     * @param _duration New presale duration in seconds
     */
    function setPresaleDuration(uint256 _duration) external;

    /**
     * @notice Sets the presale active status
     * @param _active Whether presale is active
     */
    function setPresaleActive(bool _active) external;

    /**
     * @notice Recycles tokens from liquidity pool to staking contract
     * @param amount Amount of tokens to recycle
     */
    function recycle(uint256 amount) external;

    /**
     * @notice Trigger FundRelay fee distribution
     */
    function triggerFundRelayDistribution() external;

    /**
     * @notice Trigger processing of accumulated fees
     * @dev Can be called by staking contracts or owner for manual maintenance
     */
    function triggerFeeProcessing() external;

    /**
     * @notice Updates pool reserve information
     */
    function updatePoolReserve() external;

    // =========================================================================
    // CONFIGURATION FUNCTIONS
    // =========================================================================

    /**
     * @notice Sets the cold period between buy and sell transactions
     * @param newColdTime New cold period in seconds
     */
    function updateTradingParams(
        uint40 newColdTime,
        uint256 newSwapThreshold
    ) external;

    /**
     * @notice Updates marketing address
     * @param newAddress New marketing address
     */
    function setMarketingAddress(address newAddress) external;

    /**
     * @notice Updates staking contract address
     * @param newAddress New staking contract address
     */
    function setStaking(address newAddress) external;

    /**
     * @notice Sets auto LP rewards distribution status
     * @param enabled Whether to enable automatic LP rewards distribution
     */
    function setAutoLPRewardsEnabled(bool enabled) external;

    /**
     * @notice Sets auto distribution status
     * @param enabled Whether to enable auto distribution
     */
    function setAutoDistributeEnabled(bool enabled) external;

    /**
     * @notice Creates the Uniswap V2 pair for this token
     */
    function createUniswapV2Pair() external;

    /**
     * @notice Sets initial whitelist for key addresses
     */
    function setInitialWhitelist() external;

    // =========================================================================
    // ACCESS CONTROL FUNCTIONS
    // =========================================================================

    /**
     * @notice Updates blacklist status for multiple addresses
     * @param addresses Array of addresses to update
     * @param shouldBlacklist Whether to blacklist the addresses
     */
    function updateBlacklist(
        address[] calldata addresses,
        bool shouldBlacklist
    ) external;

    /**
     * @notice Adds a single address to the whitelist
     * @param account Address to add to whitelist
     */
    function addToWhitelist(address account) external;

    /**
     * @notice Removes a single address from the whitelist
     * @param account Address to remove from whitelist
     */
    function removeFromWhitelist(address account) external;

    /**
     * @notice Adds multiple addresses to the whitelist
     * @param accounts Array of addresses to add to whitelist
     */
    function batchAddToWhitelist(address[] calldata accounts) external;

    // =========================================================================
    // LP DISTRIBUTION FUNCTIONS
    // =========================================================================

    /**
     * @notice Gets LP holders information
     * @return holders Array of LP holder addresses
     * @return count Total number of LP holders
     */
    function getLPHoldersInfo()
        external
        view
        returns (address[] memory holders, uint256 count);

    /**
     * @notice Unified LP rewards distribution function
     * @dev Handles fee processing, external USDT deposits, and distribution in one call
     * @param depositAmount Optional USDT amount to deposit from caller (0 to skip deposit)
     * @param forceDistribution Whether to bypass cooldown and threshold checks
     * @return success Whether the operation completed without errors
     * @return processedHolders Number of LP holders that received rewards
     * @return distributedAmount Total USDT amount distributed to holders
     * @return completed Whether the distribution batch completed fully
     */
    function distributeRewards(
        uint256 depositAmount,
        bool forceDistribution
    )
        external
        returns (
            bool success,
            uint256 processedHolders,
            uint256 distributedAmount,
            bool completed
        );

    /**
     * @notice Manually remove invalid LP holders (owner only)
     * @param invalidHolders Array of addresses to remove from LP holder list
     */
    function cleanupLPHolders(address[] calldata invalidHolders) external;

    /**
     * @notice Manually distributes profit tax from contract's USDT balance (Owner only)
     * @param usdtAmount Amount of USDT to distribute as profit tax
     * @param referrer Address of referrer (zero address if none)
     * @param user Address of user for event emission
     */
    function distributeProfitTax(
        uint256 usdtAmount,
        address referrer,
        address user
    ) external;

    // =========================================================================
    // VIEW FUNCTIONS
    // =========================================================================

    function getMarketingFeeRate() external view returns (uint256);
    function getMarketingAddress() external view returns (address);
    function getStakingContract() external view returns (address);
    function getUSDTAddress() external view returns (address);
    function getUniswapV2Pair() external view returns (address);

    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) external pure returns (uint256 amountOut);

    function getUSDTReserve() external view returns (uint112);

    function isPresaleEnabled() external view returns (bool);

    /**
     * @notice Gets comprehensive presale status information
     * @return active Whether presale is active
     * @return startTime When presale started
     * @return duration How long presale lasts
     * @return remainingTime Time remaining in presale
     * @return isInPresale Whether current time is within presale period
     */
    function getPresaleStatus()
        external
        view
        returns (
            bool active,
            uint256 startTime,
            uint256 duration,
            uint256 remainingTime,
            bool isInPresale
        );

    function getColdTime() external view returns (uint40);
    function isWhitelisted(address account) external view returns (bool);
    function isBlacklisted(address account) external view returns (bool);

    function shouldSwapTokensForFund(
        uint256 amount
    ) external view returns (bool);

    /**
     * @notice Gets token balance for an account (standard naming)
     * @param account Address to check balance for
     * @return balance Token balance of the account
     */
    function getTokenBalance(
        address account
    ) external view returns (uint256 balance);

    /**
     * @notice Gets total LP supply held by valid LP holders only
     * @return totalValidSupply Total LP tokens held by valid holders
     */
    function getTotalValidLpSupply() external view returns (uint256);
}
