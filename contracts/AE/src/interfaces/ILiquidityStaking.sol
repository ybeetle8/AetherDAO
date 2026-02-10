// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

/**
 * @title ILiquidityStaking
 * @notice Interface for LP staking reward system
 * @author XF Protocol Team
 */
interface ILiquidityStaking {
    // =========================================================================
    // Events
    // =========================================================================

    /// @notice Emitted when user stakes LP tokens
    event Staked(address indexed user, uint256 amount, uint256 timestamp);

    /// @notice Emitted when user unstakes LP tokens
    event Unstaked(address indexed user, uint256 amount, uint256 reward);

    /// @notice Emitted when user claims rewards
    event RewardClaimed(address indexed user, uint256 reward);

    /// @notice Emitted when rewards are deposited to the pool
    event RewardsDeposited(uint256 amount, uint256 newRewardRate);

    /// @notice Emitted when BLA rewards are accumulated for future swapping
    event BLARewardsAccumulated(uint256 blaAmount, uint256 totalAccumulated);

    /// @notice Emitted when accumulated BLA is swapped to USDT rewards
    event BLASwappedToRewards(uint256 blaAmount, uint256 usdtAmount, uint256 newRewardRate);

    /// @notice Emitted when address exclusion status changes
    event AddressExcluded(address indexed account, bool excluded);

    // =========================================================================
    // Errors
    // =========================================================================

    /// @notice Only admin can call this function
    error OnlyAdmin();

    /// @notice Invalid address provided
    error InvalidAddress();

    /// @notice Invalid amount provided
    error InvalidAmount();

    /// @notice Insufficient stake time
    error InsufficientStakeTime();

    /// @notice No stake found for user
    error NoStakeFound();

    /// @notice Address is excluded from staking
    error ExcludedFromStaking();

    /// @notice Token transfer failed
    error TransferFailed();

    // =========================================================================
    // Staking Functions
    // =========================================================================

    /**
     * @notice Stake LP tokens
     * @param amount Amount of LP tokens to stake
     */
    function stake(uint256 amount) external;

    /**
     * @notice Unstake LP tokens
     * @param amount Amount of LP tokens to unstake
     */
    function unstake(uint256 amount) external;

    /**
     * @notice Claim pending rewards
     */
    function claimReward() external;

    /**
     * @notice Deposit rewards (only callable by XF contract)
     * @param amount Amount of USDT rewards to deposit
     */
    function depositRewards(uint256 amount) external;

    /**
     * @notice Deposit BLA rewards (only callable by XF contract)
     * @param blaAmount Amount of BLA tokens to deposit and convert to USDT for rewards
     */
    function depositBLARewards(uint256 blaAmount) external;

    // =========================================================================
    // View Functions
    // =========================================================================

    /**
     * @notice Get user stake information
     * @param account User address
     * @return stakedAmount Amount of LP tokens staked
     * @return stakeTime Timestamp when user first staked
     * @return pendingReward Pending reward amount
     * @return accumulatedReward Total accumulated rewards
     * @return weight Current weight of user's stake
     */
    function getUserStakeInfo(
        address account
    )
        external
        view
        returns (
            uint256 stakedAmount,
            uint256 stakeTime,
            uint256 pendingReward,
            uint256 accumulatedReward,
            uint256 weight
        );

    /**
     * @notice Get reward pool information
     * @return totalRewards Total rewards in the pool
     * @return rewardPerSecond Reward distribution rate per second
     * @return totalStaked Total amount of LP tokens staked
     * @return totalWeight Total weight of all stakes
     * @return stakersCount Number of active stakers
     */
    function getRewardPoolInfo()
        external
        view
        returns (
            uint256 totalRewards,
            uint256 rewardPerSecond,
            uint256 totalStaked,
            uint256 totalWeight,
            uint256 stakersCount
        );

    /**
     * @notice Get number of active stakers
     * @return Number of addresses currently staking
     */
    function getStakersCount() external view returns (uint256);

    /**
     * @notice Check if user can unstake
     * @param account User address to check
     * @return True if user can unstake, false otherwise
     */
    function canUnstake(address account) external view returns (bool);

    /**
     * @notice Check if user can withdraw LP stake with detailed information
     * @param account User address to check
     * @return canWithdraw True if user can withdraw LP stake, false otherwise
     * @return stakedAmount Amount of LP tokens staked
     * @return timeRemaining Remaining time in seconds (0 if can withdraw)
     */
    function canWithdrawStake(
        address account
    )
        external
        view
        returns (bool canWithdraw, uint256 stakedAmount, uint256 timeRemaining);

    // =========================================================================
    // Admin Functions
    // =========================================================================

    /**
     * @notice Set address exclusion status (only callable by admin)
     * @param account Address to set exclusion status for
     * @param excluded True to exclude from staking, false to allow
     */
    function setExcluded(address account, bool excluded) external;

    /**
     * @notice Emergency withdraw tokens (only callable by admin)
     * @param token Token address to withdraw
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address token, uint256 amount) external;
}
