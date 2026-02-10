// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IStaking} from "../interfaces/IStaking.sol";
import {ISYI} from "../interfaces/ISYI.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IUniswapV2Router02} from "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

/**
 * @title LiquidityStakingBase - Base implementation for LiquidityStaking contracts
 * @notice Base contract containing all shared logic for mainnet and testnet liquidity staking
 * @dev Environment-specific constants are defined as abstract functions
 */
abstract contract LiquidityStakingBase is ReentrancyGuard, Ownable {
    // =========================================================================
    // ABSTRACT FUNCTIONS - Environment specific constants
    // =========================================================================

    function getMinStakeDuration() internal pure virtual returns (uint256);

    // =========================================================================
    // STATE VARIABLES
    // =========================================================================

    address public immutable syiContract;
    address public immutable usdt;
    address public immutable lpToken;
    IStaking public immutable staking;
    IUniswapV2Router02 public immutable router;

    uint256 public constant MIN_REWARD_AMOUNT = 1000; // 0.001 USDT

    // SYI accumulation for delayed swapping
    uint256 public accumulatedSYI;

    // Staking Related Structs
    struct StakeInfo {
        uint256 amount;
        uint256 stakeTime;
        uint256 lastRewardTime;
        uint256 accumulatedReward;
    }

    struct RewardPool {
        uint256 totalRewards;
        uint256 rewardPerSecond;
        uint256 lastUpdateTime;
        uint256 rewardPerTokenStored;
        uint256 totalStaked;
        uint256 totalWeight;
        uint256 distributedRewards;
        uint256 pendingRewards;
    }

    // Mappings and Arrays
    mapping(address => StakeInfo) public stakes;
    address[] public stakers;
    mapping(address => bool) public isStaker;
    RewardPool public rewardPool;
    mapping(address => bool) public excludedFromStaking;

    uint256 private cachedTotalWeight;
    uint256 private cachedWeightTimestamp;

    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public userPendingRewards;

    // Events
    event Staked(address indexed user, uint256 amount, uint256 timestamp);
    event Unstaked(address indexed user, uint256 amount, uint256 reward);
    event RewardClaimed(address indexed user, uint256 reward);
    event RewardsDeposited(uint256 amount, uint256 newRewardRate);
    event SYIRewardsAccumulated(uint256 syiAmount, uint256 totalAccumulated);
    event SYISwappedToRewards(
        uint256 syiAmount,
        uint256 usdtAmount,
        uint256 newRewardRate
    );
    event AddressExcluded(address indexed account, bool excluded);

    // Errors
    error OnlyAdmin();
    error InvalidAddress();
    error InvalidAmount();
    error InsufficientStakeTime();
    error NoStakeFound();
    error ExcludedFromStaking();
    error TransferFailed();

    // Modifiers
    modifier onlyAdmin() {
        if (msg.sender != syiContract && msg.sender != owner())
            revert OnlyAdmin();
        _;
    }

    modifier updateReward(address account) {
        _updateRewardPool();
        if (account != address(0)) {
            _updateUserReward(account);
        }
        _;
    }

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    constructor(
        address _usdt,
        address _syiContract,
        address _lpToken,
        address _staking,
        address _marketingAddress,
        address _admin,
        address _router
    ) Ownable(_admin) {
        if (
            _usdt == address(0) ||
            _syiContract == address(0) ||
            _lpToken == address(0) ||
            _staking == address(0) ||
            _router == address(0)
        ) {
            revert InvalidAddress();
        }

        usdt = _usdt;
        syiContract = _syiContract;
        lpToken = _lpToken;
        staking = IStaking(_staking);
        router = IUniswapV2Router02(_router);

        rewardPool.lastUpdateTime = block.timestamp;

        if (_marketingAddress != address(0)) {
            excludedFromStaking[_marketingAddress] = true;
            emit AddressExcluded(_marketingAddress, true);
        }
        excludedFromStaking[address(this)] = true;
        excludedFromStaking[_syiContract] = true;
        emit AddressExcluded(address(this), true);
        emit AddressExcluded(_syiContract, true);
    }

    // =========================================================================
    // STAKING FUNCTIONS
    // =========================================================================

    function stake(
        uint256 amount
    ) external nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert InvalidAmount();
        if (excludedFromStaking[msg.sender]) revert ExcludedFromStaking();

        if (!IERC20(lpToken).transferFrom(msg.sender, address(this), amount)) {
            revert TransferFailed();
        }

        StakeInfo storage userStake = stakes[msg.sender];

        if (!isStaker[msg.sender]) {
            stakers.push(msg.sender);
            isStaker[msg.sender] = true;
            userStake.stakeTime = block.timestamp;
            userStake.lastRewardTime = block.timestamp;
            userRewardPerTokenPaid[msg.sender] = _rewardPerToken();
            userPendingRewards[msg.sender] = 0;
        }

        userStake.amount += amount;
        rewardPool.totalStaked += amount;
        _updateCachedTotalWeight();

        emit Staked(msg.sender, amount, block.timestamp);

        _processAccumulatedSYI();
    }

    function unstake(
        uint256 amount
    ) external nonReentrant updateReward(msg.sender) {
        StakeInfo storage userStake = stakes[msg.sender];

        if (userStake.amount == 0) revert NoStakeFound();
        if (amount == 0 || amount > userStake.amount) revert InvalidAmount();
        if (block.timestamp < userStake.stakeTime + getMinStakeDuration()) {
            revert InsufficientStakeTime();
        }

        uint256 reward = _calculatePendingReward(msg.sender);
        if (reward > 0) {
            userPendingRewards[msg.sender] = 0;
            userRewardPerTokenPaid[msg.sender] = _rewardPerToken();

            userStake.accumulatedReward += reward;
            userStake.lastRewardTime = block.timestamp;
            rewardPool.distributedRewards += reward;
            rewardPool.pendingRewards = rewardPool.pendingRewards > reward
                ? rewardPool.pendingRewards - reward
                : 0;

            if (!IERC20(usdt).transfer(msg.sender, reward)) {
                revert TransferFailed();
            }
        }

        userStake.amount -= amount;
        rewardPool.totalStaked -= amount;

        if (userStake.amount == 0) {
            _removeStaker(msg.sender);
        }

        _updateCachedTotalWeight();

        if (!IERC20(lpToken).transfer(msg.sender, amount)) {
            revert TransferFailed();
        }

        emit Unstaked(msg.sender, amount, reward);

        _processAccumulatedSYI();
    }

    function claimReward() external nonReentrant updateReward(msg.sender) {
        uint256 reward = _calculatePendingReward(msg.sender);
        if (reward < MIN_REWARD_AMOUNT) return;

        StakeInfo storage userStake = stakes[msg.sender];

        userPendingRewards[msg.sender] = 0;
        userRewardPerTokenPaid[msg.sender] = _rewardPerToken();

        userStake.accumulatedReward += reward;
        userStake.lastRewardTime = block.timestamp;

        rewardPool.distributedRewards += reward;
        rewardPool.pendingRewards = rewardPool.pendingRewards > reward
            ? rewardPool.pendingRewards - reward
            : 0;

        if (!IERC20(usdt).transfer(msg.sender, reward)) {
            revert TransferFailed();
        }

        emit RewardClaimed(msg.sender, reward);

        _processAccumulatedSYI();
    }

    // =========================================================================
    // SYI CONTRACT FUNCTIONS
    // =========================================================================

    function depositRewards(
        uint256 amount
    ) external onlyAdmin updateReward(address(0)) {
        if (amount == 0) return;

        if (!IERC20(usdt).transferFrom(msg.sender, address(this), amount)) {
            revert TransferFailed();
        }

        rewardPool.totalRewards += amount;
        rewardPool.pendingRewards += amount;

        uint256 distributionPeriod = 7 days;

        rewardPool.rewardPerSecond =
            rewardPool.pendingRewards /
            distributionPeriod;
        emit RewardsDeposited(amount, rewardPool.rewardPerSecond);
    }

    function depositSYIRewards(uint256 syiAmount) external onlyAdmin {
        if (syiAmount == 0) return;

        if (
            !IERC20(syiContract).transferFrom(
                msg.sender,
                address(this),
                syiAmount
            )
        ) {
            revert TransferFailed();
        }

        // 只累积 SYI，不立即进行兑换
        accumulatedSYI += syiAmount;

        emit SYIRewardsAccumulated(syiAmount, accumulatedSYI);
    }

    // =========================================================================
    // INTERNAL FUNCTIONS
    // =========================================================================

    function _calculateWeight(
        uint256 amount,
        uint256 duration
    ) internal pure returns (uint256) {
        uint256 timeMultiplier = 1e18 + (duration * 1e18) / (365 days);
        return (amount * timeMultiplier) / 1e18;
    }

    function _updateRewardPool() internal {
        rewardPool.rewardPerTokenStored = _rewardPerToken();
        rewardPool.lastUpdateTime = block.timestamp;
    }

    function _rewardPerToken() internal view returns (uint256) {
        if (rewardPool.totalStaked == 0) {
            return rewardPool.rewardPerTokenStored;
        }

        uint256 timeDelta = block.timestamp - rewardPool.lastUpdateTime;
        uint256 additionalRewardPerToken = (timeDelta *
            rewardPool.rewardPerSecond *
            1e18) / rewardPool.totalStaked;

        return rewardPool.rewardPerTokenStored + additionalRewardPerToken;
    }

    function _updateUserReward(address account) internal {
        if (account == address(0)) return;

        StakeInfo storage userStake = stakes[account];
        if (userStake.amount == 0) return;

        uint256 currentRewardPerToken = _rewardPerToken();
        uint256 earnedRewards = _calculateEarnedRewards(
            account,
            currentRewardPerToken
        );

        userPendingRewards[account] += earnedRewards;
        userRewardPerTokenPaid[account] = currentRewardPerToken;
    }

    function _calculateEarnedRewards(
        address account,
        uint256 currentRewardPerToken
    ) internal view returns (uint256) {
        StakeInfo memory userStake = stakes[account];
        if (userStake.amount == 0) return 0;

        uint256 rewardPerTokenDelta = currentRewardPerToken -
            userRewardPerTokenPaid[account];

        uint256 stakeDuration = block.timestamp - userStake.stakeTime;
        uint256 timeMultiplier = 1e18 + (stakeDuration * 1e18) / (365 days);

        uint256 baseRewards = (userStake.amount * rewardPerTokenDelta) / 1e18;
        return (baseRewards * timeMultiplier) / 1e18;
    }

    function _calculatePendingReward(
        address account
    ) internal view returns (uint256) {
        StakeInfo memory userStake = stakes[account];
        if (userStake.amount == 0) return 0;

        uint256 currentRewardPerToken = _rewardPerToken();
        uint256 newlyEarned = _calculateEarnedRewards(
            account,
            currentRewardPerToken
        );

        return userPendingRewards[account] + newlyEarned;
    }

    function _calculateCurrentTotalWeight() internal view returns (uint256) {
        if (cachedWeightTimestamp == block.timestamp && cachedTotalWeight > 0) {
            return cachedTotalWeight;
        }

        uint256 currentTotalWeight = 0;

        for (uint256 i = 0; i < stakers.length; i++) {
            address staker = stakers[i];
            StakeInfo memory userStake = stakes[staker];

            if (userStake.amount > 0) {
                uint256 stakeDuration = block.timestamp - userStake.stakeTime;
                uint256 weight = _calculateWeight(
                    userStake.amount,
                    stakeDuration
                );
                currentTotalWeight += weight;
            }
        }

        return currentTotalWeight;
    }

    function _updateCachedTotalWeight() internal {
        cachedTotalWeight = _calculateCurrentTotalWeight();
        cachedWeightTimestamp = block.timestamp;
    }

    function _removeStaker(address account) internal {
        if (!isStaker[account]) return;

        for (uint256 i = 0; i < stakers.length; i++) {
            if (stakers[i] == account) {
                stakers[i] = stakers[stakers.length - 1];
                stakers.pop();
                isStaker[account] = false;
                break;
            }
        }
    }

    function _processAccumulatedSYI() internal {
        // 首先触发 FundRelay 分发
        try ISYI(syiContract).triggerFundRelayDistribution() {} catch {}

        if (accumulatedSYI == 0 || accumulatedSYI < 10 ether) return;

        uint256 syiToSwap = accumulatedSYI;
        accumulatedSYI = 0; // Reset accumulation

        uint256 usdtAmount = _swapSYIForUSDT(syiToSwap);

        if (usdtAmount > 0) {
            rewardPool.totalRewards += usdtAmount;
            rewardPool.pendingRewards += usdtAmount;

            uint256 distributionPeriod = 7 days;
            rewardPool.rewardPerSecond =
                rewardPool.pendingRewards /
                distributionPeriod;

            emit SYISwappedToRewards(
                syiToSwap,
                usdtAmount,
                rewardPool.rewardPerSecond
            );
        }
    }

    function _swapSYIForUSDT(
        uint256 syiAmount
    ) internal returns (uint256 usdtAmount) {
        if (syiAmount == 0) return 0;

        IERC20(syiContract).approve(address(router), syiAmount);

        address[] memory path = new address[](2);
        path[0] = syiContract;
        path[1] = usdt;

        uint256 initialBalance = IERC20(usdt).balanceOf(address(this));

        try
            router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                syiAmount,
                0, // accept any amount of USDT
                path,
                address(this),
                block.timestamp + 300
            )
        {
            uint256 finalBalance = IERC20(usdt).balanceOf(address(this));
            usdtAmount = finalBalance > initialBalance
                ? finalBalance - initialBalance
                : 0;
        } catch {
            // If swap fails, return 0
            usdtAmount = 0;
        }
    }

    // =========================================================================
    // VIEW FUNCTIONS
    // =========================================================================

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
        )
    {
        StakeInfo memory userStake = stakes[account];
        stakedAmount = userStake.amount;
        stakeTime = userStake.stakeTime;
        pendingReward = _calculatePendingReward(account);
        accumulatedReward = userStake.accumulatedReward;

        if (userStake.amount > 0) {
            uint256 stakeDuration = block.timestamp - userStake.stakeTime;
            weight = _calculateWeight(userStake.amount, stakeDuration);
        }
    }

    function getRewardPoolInfo()
        external
        view
        returns (
            uint256 totalRewards,
            uint256 rewardPerSecond,
            uint256 totalStaked,
            uint256 totalWeight,
            uint256 stakersCount,
            uint256 distributedRewards,
            uint256 pendingRewards
        )
    {
        totalRewards = rewardPool.totalRewards;
        rewardPerSecond = rewardPool.rewardPerSecond;
        totalStaked = rewardPool.totalStaked;
        totalWeight = _calculateCurrentTotalWeight();
        stakersCount = stakers.length;
        distributedRewards = rewardPool.distributedRewards;
        pendingRewards = rewardPool.pendingRewards;
    }

    function getStakersCount() external view returns (uint256) {
        return stakers.length;
    }

    function canUnstake(address account) external view returns (bool) {
        StakeInfo memory userStake = stakes[account];
        if (userStake.amount == 0) return false;
        return block.timestamp >= userStake.stakeTime + getMinStakeDuration();
    }

    function canWithdrawStake(
        address account
    )
        external
        view
        returns (bool canWithdraw, uint256 stakedAmount, uint256 timeRemaining)
    {
        StakeInfo memory userStake = stakes[account];
        stakedAmount = userStake.amount;

        if (stakedAmount == 0) {
            canWithdraw = false;
            timeRemaining = 0;
            return (canWithdraw, stakedAmount, timeRemaining);
        }

        uint256 minDuration = getMinStakeDuration();
        uint256 stakeEndTime = userStake.stakeTime + minDuration;

        if (block.timestamp >= stakeEndTime) {
            canWithdraw = true;
            timeRemaining = 0;
        } else {
            canWithdraw = false;
            timeRemaining = stakeEndTime - block.timestamp;
        }
    }

    function getMinStakeDurationExternal()
        external
        pure
        returns (uint256 duration)
    {
        return getMinStakeDuration();
    }

    // =========================================================================
    // ADMIN FUNCTIONS
    // =========================================================================

    function setExcluded(address account, bool excluded) external onlyAdmin {
        excludedFromStaking[account] = excluded;
        emit AddressExcluded(account, excluded);
    }

    function emergencyWithdraw(
        address token,
        uint256 amount
    ) external onlyAdmin {
        IERC20(token).transfer(syiContract, amount);
    }
}
