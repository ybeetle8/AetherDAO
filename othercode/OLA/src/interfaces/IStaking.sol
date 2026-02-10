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
     * @param amount Principal amount staked (in USDT)
     * @param status Whether stake has been withdrawn (true = withdrawn)
     * @param stakeIndex Staking tier (0=1day/0.3% daily, 1=7days/0.6% daily, 2=15days/1.0% daily, 3=30days/1.5% daily)
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
     * @param usdtReceived Actual USDT received from XF swap
     * @param olaTokensUsed Amount of XF tokens consumed in swap
     * @param referralFee Fee paid to referrer
     * @param teamFee Total team fees distributed
     * @param userPayout Net amount user actually received
     * @param interestEarned Interest earned (usdtReceived - principalAmount)
     */
    struct WithdrawalRecord {
        uint40 withdrawalTime;
        uint256 stakeIndex;
        uint256 principalAmount;
        uint256 calculatedReward;
        uint256 usdtReceived;
        uint256 olaTokensUsed;
        uint256 referralFee;
        uint256 teamFee;
        uint256 userPayout;
        uint256 interestEarned;
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
     * @param usdtReceived Actual USDT received from swap
     * @param olaTokensUsed XF tokens consumed in swap
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
        uint256 usdtReceived,
        uint256 olaTokensUsed,
        uint256 referralFee,
        uint256 teamFee,
        uint256 userPayout,
        uint256 interestEarned,
        uint40 withdrawalTime
    );

    /**
     * @notice Emitted when referral relationship is bound
     * @param user User being referred
     * @param parent Referrer address
     */
    event BindReferral(address indexed user, address indexed parent);

    /**
     * @notice Emitted when a user binds a friend account for direct reward
     * @param user User who binds the friend
     * @param friend Friend address to receive direct rewards
     */
    event BindFriend(address indexed user, address indexed friend);

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
     * @notice Emitted when XF contract address is set
     * @param xfAddress Address of the XF contract
     */
    event OLAContractSet(address indexed xfAddress);

    /**
     * @notice Emitted when staking rates are updated
     * @param newRates Array of new per-second rates
     */
    event StakingRatesUpdated(uint256[4] newRates);

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
    // CORE STAKING FUNCTIONS
    // =========================================================================

    /**
     * @notice Stakes USDT tokens and mints staking tokens
     * @param _amount Amount of USDT to stake
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
     * @notice Locks a friend account to receive the 5% direct reward
     * @param _friend The friend address to bind
     */
    function lockFriend(address _friend) external;

    // =========================================================================
    // VIEW FUNCTIONS - USER INFORMATION
    // =========================================================================

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
    /// @dev A preacher is a user who has staked at least 200 USDT
    function isPreacher(address user) external view returns (bool);

    /// @notice Checks if a user has bound their referral relationship
    /// @param user Address to check
    /// @return True if user has bound referral, false otherwise
    function isBindReferral(address user) external view returns (bool);

    /// @notice Gets the referrer of a user
    /// @param user Address to check
    /// @return The referrer address
    function getReferral(address user) external view returns (address);

    /**
     * @notice Gets the friend account bound by a user
     * @param user Address to check
     * @return The friend address
     */
    function getFriend(address user) external view returns (address);

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
     * @return remaining Remaining stake capacity in USDT
     */
    function getRemainingStakeCapacity(
        address user
    ) external view returns (uint256 remaining);

    /**
     * @notice Gets maximum user total stake limit
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
     * @notice Sets the XF token contract address (owner only)
     * @param _xf New XF contract address
     */
    function setOLA(address _xf) external;

    // =========================================================================
    // UTILITY FUNCTIONS
    // =========================================================================

    /**
     * @notice Synchronizes USDT balance with the pool
     */
    function sync() external;

    /**
     * @notice Emergency withdrawal of XF tokens (owner only)
     * @param to Recipient address
     * @param _amount Amount to withdraw
     */
    function emergencyWithdrawOLA(address to, uint256 _amount) external;

    /**
     * @notice Emergency withdrawal of USDT tokens (owner only)
     * @param to Recipient address
     * @param _amount Amount to withdraw
     */
    function emergencyWithdrawUSDT(address to, uint256 _amount) external;
}
