// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

/**
 * @title IStaking
 * @notice Interface for XF Protocol Staking Contract with advanced features
 * @dev Complete interface following Solidity Style Guide
 * @author XF Protocol Team
 */
interface IStaking {
    // =========================================================================
    // ERRORS
    // =========================================================================

    /// @notice Thrown when caller is not an externally owned account
    error OnlyEOAAllowed();

    /// @notice Thrown when stake amount is below minimum required
    error BelowMinStakeAmount();

    /// @notice Thrown when stake amount exceeds maximum allowed
    error ExceedsMaxStakeAmount();

    /// @notice Thrown when user's total stake would exceed limit
    error ExceedsUserTotalStakeLimit();

    /// @notice Thrown when stake index is invalid
    error InvalidStakeIndex();

    /// @notice Thrown when user must bind referral first
    error MustBindReferral();

    /// @notice Thrown when staking period requirements not met
    error StakingPeriodNotMet();

    /// @notice Thrown when stake has already been withdrawn
    error AlreadyWithdrawn();

    /// @notice Thrown when caller is not authorized
    error NotAuthorized();

    /// @notice Thrown when user tries to refer themselves
    error CannotReferSelf();

    /// @notice Thrown when referral is already bound
    error AlreadyBound();

    /// @notice Thrown when referral address is invalid
    error InvalidReferral();

    /// @notice Thrown when referral is already locked
    error AlreadyLocked();

    /// @notice Thrown when referrer is invalid
    error InvalidReferrer();

    // =========================================================================
    // STRUCTS
    // =========================================================================

    /**
     * @notice Individual stake record structure
     * @param stakeTime Timestamp when stake was created
     * @param amount Principal amount staked (in USDX)
     * @param status Whether stake has been withdrawn (true = withdrawn)
     * @param stakeIndex Staking tier (0=7days/0.6% daily, 1=30days/0.9% daily, 2=90days/1.1% daily, 3=180days/1.5% daily, 4=365days/2% daily)
     */
    struct Record {
        uint40 stakeTime;
        uint160 amount;
        bool status;
        uint8 stakeIndex;
    }

    /**
     * @notice Supply tracking record for network activity
     * @param stakeTime Timestamp of the supply record
     * @param tamount Total supply at that time
     */
    struct RecordTT {
        uint40 stakeTime;
        uint160 tamount;
    }

    /**
     * @notice Team tier configuration for reward distribution
     * @param threshold Minimum team KPI required for this tier
     * @param rewardRate Reward rate percentage for this tier
     */
    struct TeamTier {
        uint256 threshold;
        uint256 rewardRate;
    }

    /**
     * @notice Complete withdrawal record for user history tracking
     * @param withdrawalTime Timestamp when withdrawal occurred
     * @param stakeIndex Index of the stake record that was withdrawn
     * @param principalAmount Original staked amount
     * @param calculatedReward Total calculated reward (principal + interest)
     * @param usdxReceived Actual USDX received from XF swap
     * @param aeTokensUsed Amount of AE tokens consumed in swap
     * @param referralFee Fee paid to referrer
     * @param teamFee Total team fees distributed
     * @param userPayout Net amount user actually received
     * @param interestEarned Interest earned (usdxReceived - principalAmount)
     */
    struct WithdrawalRecord {
        uint40 withdrawalTime;
        uint256 stakeIndex;
        uint256 principalAmount;
        uint256 calculatedReward;
        uint256 usdxReceived;
        uint256 aeTokensUsed;
        uint256 referralFee;
        uint256 teamFee;
        uint256 userPayout;
        uint256 interestEarned;
    }

    /**
     * @notice 前端展示用的质押订单完整信息
     * @param index 质押记录索引
     * @param stakeTime 质押时间
     * @param amount 质押本金 (USDX)
     * @param status 是否已提取 (true = 已提取)
     * @param stakeIndex 质押档位 (0=7天, 1=30天, 2=90天, 3=180天, 4=365天)
     * @param currentValue 当前价值 (本金 + 利息)
     * @param canWithdraw 是否可以提取
     * @param timeRemaining 距到期剩余秒数 (0 = 已到期)
     * @param earnedInterest 已赚取利息 (currentValue - amount)
     * @param withdrawnInterestAmount 已提取的利息金额
     */
    struct StakeOrderInfo {
        uint256 index;
        uint40 stakeTime;
        uint160 amount;
        bool status;
        uint8 stakeIndex;
        uint256 currentValue;
        bool canWithdraw;
        uint256 timeRemaining;
        uint256 earnedInterest;
        uint256 withdrawnInterestAmount;
    }

    // =========================================================================
    // EVENTS
    // =========================================================================

    /**
     * @notice Emitted when a user stakes tokens
     * @param user Address of the staker
     * @param amount Amount staked
     * @param timestamp Block timestamp
     * @param index Stake record index
     * @param stakeTime Staking period duration
     */
    event Staked(
        address indexed user,
        uint256 amount,
        uint256 timestamp,
        uint256 index,
        uint256 stakeTime
    );

    /**
     * @notice Emitted when rewards are paid to a user (legacy event for compatibility)
     * @param user Address receiving rewards
     * @param reward Reward amount
     * @param timestamp Block timestamp
     * @param index Stake record index
     */
    event RewardPaid(
        address indexed user,
        uint256 reward,
        uint40 timestamp,
        uint256 index
    );

    /**
     * @notice Emitted when a user withdraws (unstakes) with complete details
     * @param user Address of the user
     * @param stakeIndex Index of the withdrawn stake record
     * @param principalAmount Original staked amount
     * @param calculatedReward Total calculated reward
     * @param usdxReceived Actual USDX received from swap
     * @param aeTokensUsed AE tokens consumed in swap
     * @param referralFee Fee paid to referrer
     * @param teamFee Total team fees distributed
     * @param userPayout Net amount user received
     * @param interestEarned Interest earned
     * @param withdrawalTime Withdrawal timestamp
     */
    event WithdrawalCompleted(
        address indexed user,
        uint256 indexed stakeIndex,
        uint256 principalAmount,
        uint256 calculatedReward,
        uint256 usdxReceived,
        uint256 aeTokensUsed,
        uint256 referralFee,
        uint256 teamFee,
        uint256 userPayout,
        uint256 interestEarned,
        uint40 withdrawalTime
    );

    /**
     * @notice Emitted when referral relationship is bound
     * @param user User being referred
     * @param referrer Referrer address
     * @param timestamp Binding timestamp
     */
    event ReferralBound(
        address indexed user,
        address indexed referrer,
        uint256 timestamp
    );

    /**
     * @notice Emitted when admin binds a referral relationship
     * @param user User being referred
     * @param referrer Referrer address
     * @param admin Admin who performed the binding
     * @param timestamp Binding timestamp
     */
    event AdminReferralBound(
        address indexed user,
        address indexed referrer,
        address indexed admin,
        uint256 timestamp
    );

    /**
     * @notice Emitted for token transfers (minting/burning)
     * @param from Source address (address(0) for minting)
     * @param to Destination address (address(0) for burning)
     * @param amount Transfer amount
     */
    event Transfer(address indexed from, address indexed to, uint256 amount);

    /**
     * @notice Emitted when test mode is changed
     * @param enabled Whether test mode is enabled
     */
    event TestModeSet(bool enabled);

    /**
     * @notice Emitted when AE contract address is set
     * @param aeAddress Address of the AE contract
     */
    event AEContractSet(address indexed aeAddress);

    /**
     * @notice Emitted when staking rates are updated
     * @param newRates Array of new per-second rates
     */
    event StakingRatesUpdated(uint256[5] newRates);

    event PresaleDurationUpdated(uint256 duration);

    /**
     * @notice Emitted when strict differential reward is paid
     * @param recipient Address receiving the reward
     * @param tier User's tier level (1-7)
     * @param actualRewardRate Actual reward rate applied (differential)
     * @param rewardAmount Actual reward amount paid
     * @param previousCumulativeRate Cumulative rate before this tier
     * @param currentTierRate Full rate for current tier
     */
    event StrictDifferentialRewardPaid(
        address indexed recipient,
        uint8 indexed tier,
        uint256 actualRewardRate,
        uint256 rewardAmount,
        uint256 previousCumulativeRate,
        uint256 currentTierRate
    );

    /**
     * @notice Comprehensive event for team reward distribution summary
     * @param interestAmount Total interest amount being distributed
     * @param totalTeamRewardPool Total team reward pool (35% of interest)
     * @param totalDistributed Total amount distributed to tier members
     * @param marketingAmount Amount sent to marketing address
     * @param tierRecipients Array of addresses receiving rewards [V1..V7] (address(0) if no recipient)
     * @param tierAmounts Array of reward amounts [V1..V7] (0 if no reward)
     * @param activeTiers Bitmap indicating which tiers received rewards (bit 0=V1, bit 1=V2, ... bit 6=V7)
     */
    event TeamRewardDistributionCompleted(
        uint256 interestAmount,
        uint256 totalTeamRewardPool,
        uint256 totalDistributed,
        uint256 marketingAmount,
        address[7] tierRecipients,
        uint256[7] tierAmounts,
        uint8 activeTiers
    );

    /**
     * @notice Event emitted when a user fails preacher check during team reward distribution
     * @param user User address that failed the check
     * @param tier Tier level the user would have qualified for
     * @param reason Reason for failure
     */
    event PreacherCheckFailed(
        address indexed user,
        uint8 indexed tier,
        string reason
    );

    // =========================================================================
    // GLOBAL STATISTICS EVENTS
    // =========================================================================

    /**
     * @notice Emitted when global dividend total is updated
     * @param userPayout The payout amount added
     * @param newTotalDividends New cumulative total dividends
     */
    event GlobalDividendUpdated(uint256 userPayout, uint256 newTotalDividends);

    /**
     * @notice Emitted when global education fund total is updated
     * @param amount The education fund amount added
     * @param newTotalEducationFund New cumulative total education fund
     */
    event GlobalEducationFundUpdated(uint256 amount, uint256 newTotalEducationFund);

    /**
     * @notice Emitted when staker count changes
     * @param user The user address
     * @param isJoin True if user joined, false if user left
     * @param newTotalStakers New total staker count
     */
    event StakerCountChanged(address indexed user, bool isJoin, uint256 newTotalStakers);

    // =========================================================================
    // CORE STAKING FUNCTIONS
    // =========================================================================

    /**
     * @notice Stakes USDX tokens and mints staking tokens
     * @param _amount Amount of USDX to stake
     * @param _stakeIndex Staking tier (0=1day/0.3% daily, 1=7days/0.6% daily, 2=15days/1.0% daily, 3=30days/1.5% daily)
     * @dev User must bind referral relationship via lockReferral() before staking
     * @dev Slippage protection is handled automatically within the contract
     */
    function stake(uint160 _amount, uint8 _stakeIndex) external;

    /**
     * @notice Unstakes tokens and distributes rewards
     * @param stakeIndex Index of the stake record to unstake
     * @return totalReward Total reward amount calculated
     */
    function unstake(uint256 stakeIndex) external returns (uint256 totalReward);

    // =========================================================================
    // WITHDRAWAL HISTORY FUNCTIONS
    // =========================================================================

    /**
     * @notice Gets withdrawal history for a user
     * @param user User address
     * @return Array of withdrawal records
     */
    function getWithdrawalHistory(
        address user
    ) external view returns (WithdrawalRecord[] memory);

    /**
     * @notice Gets the number of withdrawals for a user
     * @param user User address
     * @return count Number of withdrawals
     */
    function getWithdrawalCount(
        address user
    ) external view returns (uint256 count);

    /**
     * @notice Gets a specific withdrawal record
     * @param user User address
     * @param index Withdrawal record index
     * @return withdrawal Withdrawal record details
     */
    function getWithdrawalRecord(
        address user,
        uint256 index
    ) external view returns (WithdrawalRecord memory withdrawal);

    // =========================================================================
    // REFERRAL SYSTEM FUNCTIONS
    // =========================================================================

    /**
     * @notice Locks referral relationship for caller
     * @param _referrer The referrer to bind to (or address(0) for root)
     */
    function lockReferral(address _referrer) external;

    /**
     * @notice Admin binds referral relationship for a user
     * @param user The user to bind
     * @param _referrer The referrer to bind to (or address(0) for root)
     */
    function adminBindReferral(address user, address _referrer) external;

    /**
     * @notice Admin batch binds referral relationships
     * @param users Array of users to bind
     * @param referrers Array of corresponding referrers
     */
    function batchAdminBindReferral(address[] calldata users, address[] calldata referrers) external;

    // =========================================================================
    // VIEW FUNCTIONS - USER INFORMATION
    // =========================================================================

    /// @notice 获取用户所有质押订单的完整信息
    /// @param user 用户地址
    /// @return orders 质押订单信息数组
    function getUserStakeRecords(
        address user
    ) external view returns (StakeOrderInfo[] memory orders);

    /// @notice Retrieves complete user information from staking contract
    /// @param user The address of the user to query
    /// @return totalStaked Total amount staked by the user
    /// @return teamKPI Team KPI value for the user
    /// @return referrer Address of the user's referrer
    /// @return hasLocked Whether the user has locked their referral relationship
    /// @return isPreacherStatus Whether the user has preacher (market maker) status
    function getUserInfo(
        address user
    )
        external
        view
        returns (
            uint128 totalStaked,
            uint128 teamKPI,
            address referrer,
            bool hasLocked,
            bool isPreacherStatus
        );

    /// @notice Checks if a user has preacher (market maker) status
    /// @param user Address to check
    /// @return True if user is a preacher, false otherwise
    /// @dev A preacher is a user who has staked at least 200 USDX
    function isPreacher(address user) external view returns (bool);

    /// @notice Checks if a user has bound their referral relationship
    /// @param user Address to check
    /// @return True if user has bound referral, false otherwise
    function isBindReferral(address user) external view returns (bool);

    /// @notice Gets the referrer of a user
    /// @param user Address to check
    /// @return The referrer address
    function getReferral(address user) external view returns (address);

    /// @notice Gets the team KPI value for a user (excluding self-investment)
    /// @param _user User address
    /// @return The team KPI value (total investment from team members only)
    function getTeamKpi(address _user) external view returns (uint256);

    /// @notice Gets the current network input value
    /// @return value The network input value
    function network1In() external view returns (uint256 value);

    /// @notice Gets the maximum stake amount allowed
    /// @return The maximum stake amount
    function maxStakeAmount() external view returns (uint256);

    /// @notice Gets the number of stake records for a user
    /// @param user User address
    /// @return count Number of stake records
    function stakeCount(address user) external view returns (uint256 count);

    /// @notice Gets the current balance (pending rewards) for a user
    /// @param account User address
    /// @return balance Total pending rewards
    function balanceOf(address account) external view returns (uint256 balance);

    /// @notice Gets the reward for a specific stake slot
    /// @param user User address
    /// @param index Stake record index
    /// @return reward Reward amount for the slot
    function rewardOfSlot(
        address user,
        uint8 index
    ) external view returns (uint256 reward);

    /// @notice Gets referral chain for a user
    /// @param user User address
    /// @param maxDepth Maximum depth to traverse
    /// @return Array of referrer addresses
    function getReferrals(
        address user,
        uint8 maxDepth
    ) external view returns (address[] memory);

    /// @notice Checks if a user can withdraw a specific stake
    /// @param user User address
    /// @param stakeIndex Index of the stake record to check
    /// @return canWithdraw True if the stake can be withdrawn, false otherwise
    function canWithdrawStake(
        address user,
        uint256 stakeIndex
    ) external view returns (bool canWithdraw);

    /// @notice Gets withdrawal status for all user stakes
    /// @param user User address
    /// @return stakeIndices Array of stake indices
    /// @return canWithdrawArray Array of withdrawal eligibility (true = can withdraw)
    /// @return timeRemaining Array of remaining time in seconds (0 if can withdraw)
    function getUserStakeWithdrawalStatus(
        address user
    )
        external
        view
        returns (
            uint256[] memory stakeIndices,
            bool[] memory canWithdrawArray,
            uint256[] memory timeRemaining
        );

    // =========================================================================
    // VIEW FUNCTIONS - NETWORK AND LIMITS
    // =========================================================================

    /**
     * @notice Gets remaining stake capacity for a user
     * @param user User address
     * @return remaining Remaining stake capacity in USDX
     */
    function getRemainingStakeCapacity(
        address user
    ) external view returns (uint256 remaining);

    /**
     * @notice Gets the minimum stake amount allowed
     * @return minAmount The minimum stake amount
     */
    function getMinStakeAmount() external pure returns (uint256 minAmount);

    /**
     * @notice Gets the maximum user total stake limit
     * @return limit Maximum total stake limit per user
     */
    function getMaxUserTotalStake() external pure returns (uint256 limit);

    /**
     * @notice Gets the root address
     * @return rootAddress The root address
     */
    function getRootAddress() external view returns (address rootAddress);

    /**
     * @notice Gets the principal balance (original staked amount) for a user
     * @param account User address
     * @return balance Principal balance
     */
    function principalBalance(
        address account
    ) external view returns (uint256 balance);

    // =========================================================================
    // ADMINISTRATIVE FUNCTIONS
    // =========================================================================

    /**
     * @notice Sets the AE token contract address (owner only)
     * @param _ae New AE contract address
     */
    function setAE(address _ae) external;

    // =========================================================================
    // UTILITY FUNCTIONS
    // =========================================================================

    /**
     * @notice Emergency withdrawal of AE tokens (owner only)
     * @param to Recipient address
     * @param _amount Amount to withdraw
     */
    function emergencyWithdrawAE(address to, uint256 _amount) external;

    /**
     * @notice Emergency withdrawal of USDX tokens (owner only)
     * @param to Recipient address
     * @param _amount Amount to withdraw
     */
    function emergencyWithdrawUSDX(address to, uint256 _amount) external;

    /**
     * @notice Check if a user has already used the 7-day stake
     * @param user User address to check
     * @return Whether the user has used 7-day stake
     */
    function has7DayStakeBeenUsed(address user) external view returns (bool);

    /**
     * @notice Reset a user's 7-day stake usage status (owner only)
     * @param user User address to reset
     */
    function reset7DayStakeUsage(address user) external;

    /**
     * @notice Batch reset multiple users' 7-day stake usage status (owner only)
     * @param users Array of user addresses to reset
     */
    function batchReset7DayStakeUsage(address[] calldata users) external;

    // =========================================================================
    // DAILY NETWORK STAKE LIMIT FUNCTIONS
    // =========================================================================

    /**
     * @notice Gets the remaining daily network stake quota for the current period
     * @return remaining Remaining quota in USDX (18 decimals)
     */
    function getDailyStakeRemaining() external view returns (uint256 remaining);

    /**
     * @notice Gets the amount already staked in the current daily period
     * @return used Amount already used in USDX (18 decimals)
     */
    function getDailyStakeUsed() external view returns (uint256 used);

    /**
     * @notice Gets the timestamp of the next daily limit reset
     * @return nextReset Unix timestamp of the next reset
     */
    function getNextDailyResetTime() external view returns (uint256 nextReset);

    // =========================================================================
    // EARLY INTEREST WITHDRAWAL FUNCTIONS
    // =========================================================================

    /**
     * @notice Emitted when a user withdraws interest early (before maturity)
     * @param user The address of the user
     * @param stakeIndex The index of the stake
     * @param interestAmount The interest amount being withdrawn
     * @param usdxReceived The actual USDX received from swap
     * @param aeTokensUsed The amount of AE tokens used for the swap
     * @param referralFee The fee paid to education fund (5%)
     * @param teamFee The fee paid to team (35%)
     * @param userPayout The final amount paid to user
     * @param timestamp The timestamp of withdrawal
     */
    event InterestWithdrawn(
        address indexed user,
        uint256 indexed stakeIndex,
        uint256 interestAmount,
        uint256 usdxReceived,
        uint256 aeTokensUsed,
        uint256 referralFee,
        uint256 teamFee,
        uint256 userPayout,
        uint40 timestamp
    );

    /**
     * @notice Withdraws accumulated interest from a stake without withdrawing principal
     * @param stakeIndex Index of the stake record
     * @return interestWithdrawn Amount of interest withdrawn (before fees)
     * @dev Can be called multiple times before stake maturity
     * @dev Principal remains staked and continues earning interest
     * @dev Same fee structure as unstake: 5% education fund + 35% team + 5% redemption fee
     */
    function withdrawInterest(uint256 stakeIndex) external returns (uint256 interestWithdrawn);

    /**
     * @notice Gets the available interest that can be withdrawn for a stake
     * @param user User address
     * @param stakeIndex Index of the stake record
     * @return availableInterest Amount of interest available for withdrawal
     */
    function getAvailableInterest(address user, uint256 stakeIndex)
        external
        view
        returns (uint256 availableInterest);

    /**
     * @notice Gets the total interest already withdrawn from a stake
     * @param user User address
     * @param stakeIndex Index of the stake record
     * @return withdrawn Total interest already withdrawn
     */
    function getWithdrawnInterest(address user, uint256 stakeIndex)
        external
        view
        returns (uint256 withdrawn);

    // =========================================================================
    // GLOBAL STATISTICS FUNCTIONS
    // =========================================================================

    /**
     * @notice 获取全局统计数据（供前端 Dashboard 使用）
     * @return tvl 全网质押总量 (当前活跃本金)
     * @return dividends 全网累计分红 (用户累计到账 USDX)
     * @return educationFund 全网累计教育基金
     * @return stakerCount 当前质押参与人数
     */
    function getGlobalStats() external view returns (
        uint256 tvl,
        uint256 dividends,
        uint256 educationFund,
        uint256 stakerCount
    );
}
