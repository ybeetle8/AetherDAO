// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {ERC20} from "lib/openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "lib/openzeppelin-contracts/contracts/access/Ownable.sol";
import {IUniswapV2Router02} from "lib/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import {IUniswapV2Pair} from "lib/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import {IUniswapV2Factory} from "lib/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import {IStaking} from "../interfaces/IStaking.sol";
import {ILiquidityStaking} from "../interfaces/ILiquidityStaking.sol";
import {FundRelay} from "../utils/FundRelay.sol";
import {Helper} from "../utils/Helper.sol";

/**
 * @title OLABase - Base implementation for OLA token contracts
 * @notice Base contract containing all shared logic for mainnet and testnet OLA
 * @dev Environment-specific constants are defined as abstract functions
 */
abstract contract OLABase is ERC20, Ownable {
    // =========================================================================
    // ABSTRACT FUNCTIONS - Environment specific constants
    // =========================================================================

    function getDelayedBuyPeriod() internal pure virtual returns (uint256);
    function getPresaleDuration() internal pure virtual returns (uint256);

    // =========================================================================
    // EVENTS - Keep all original events
    // =========================================================================

    event TransactionExecuted(
        address indexed user,
        uint256 indexed timestamp,
        string indexed txType,
        uint256 tokenAmount,
        uint256 usdtAmount,
        uint256 netUserReceived,
        uint256 previousInvestment,
        uint256 newInvestment,
        uint256 burnFee,
        uint256 lpFee,
        uint256 marketingFee,
        uint256 profitAmount,
        uint256 profitTax,
        address referrer
    );

    event FeesProcessed(
        uint256 indexed timestamp,
        string indexed processType,
        uint256 totalFeesXF,
        uint256 totalFeesUSDT,
        uint256 lpAmount,
        uint256 marketingAmount,
        uint256 burnAmount,
        address lpRecipient,
        address marketingRecipient
    );

    event MarketingAddressUpdated(
        address indexed oldAddress,
        address indexed newAddress
    );
    event SwapFailed(string reason, uint256 tokenAmount, uint256 timestamp);
    event FundRelayTransferFailed(
        uint256 expectedAmount,
        uint256 actualAmount,
        uint256 timestamp
    );
    event DelayedBuyEnabled(bool enabled);
    event DelayedBuyPeriodUpdated(uint256 newPeriod);

    event TokensBurned(uint256 amount);
    event LiquidityAdded(uint256 tokenAmount, uint256 usdtAmount);
    event LPRewardDeposited(uint256 amount);
    event InvestmentUpdated(
        address indexed user,
        uint256 indexed timestamp,
        uint256 previousInvestment,
        uint256 newInvestment,
        uint256 changeAmount,
        string changeType
    );

    // Backward compatible events
    event UserTransaction(
        address indexed user,
        uint256 indexed timestamp,
        string txType,
        uint256 tokenAmount,
        uint256 usdtAmount,
        uint256 netReceived
    );
    event FeeCollected(
        address indexed user,
        uint256 amount,
        string indexed category,
        address indexed recipient
    );

    // Legacy events
    event PresaleDurationUpdated(uint256 newDuration);
    event PresaleStatusUpdated(bool active);

    event LiquidityHandleFeeCollected(
        address indexed from,
        address indexed to,
        uint256 feeAmount,
        uint256 netAmount,
        string operationType
    );
    event TransferFeeCollected(
        address indexed from,
        address indexed to,
        uint256 feeAmount,
        uint256 netAmount,
        string transferType
    );
    event LPDistribution(
        uint256 indexed timestamp,
        uint256 regularFeesXF,
        uint256 regularFeesUSDT,
        address liquidityStakingContract,
        string source
    );

    event FeesAccumulated(
        string feeType,
        uint256 amount,
        uint256 totalAccumulated
    );
    event FeeProcessingSkipped(
        uint256 totalFees,
        string reason,
        uint256 timestamp
    );
    event FeeProcessingTriggered(
        uint256 totalFees,
        address indexed triggeredBy,
        string triggerType,
        uint256 timestamp
    );
    event MarketingDistribution(
        uint256 timestamp,
        uint256 tokenAmount,
        uint256 usdtAmount,
        uint256 rewardIndex,
        address indexed recipient,
        string distributionType
    );
    event AutoSwapTriggered(
        uint256 marketingFee,
        uint256 lpFee,
        string trigger
    );
    event NoProfitFeeCollected(
        address indexed seller,
        uint256 indexed timestamp,
        uint256 feeAmountXF,
        uint256 feeAmountUSDT,
        uint256 saleValueUSDT,
        uint256 userInvestmentUSDT
    );

    event SellTransaction(
        address indexed seller,
        uint256 indexed timestamp,
        uint256 originalXFAmount,
        uint256 tradingFeeXF,
        uint256 marketingFeeXF,
        uint256 lpFeeXF,
        uint256 netXFAfterTradingFees,
        uint256 estimatedUSDTFromSale,
        uint256 userHistoricalInvestment,
        uint256 totalProfitAmount,
        uint256 profitTaxUSDT,
        uint256 noProfitFeeUSDT,
        uint256 profitTaxToMarketing,
        uint256 profitTaxToReferrer,
        uint256 userNetProfitUSDT,
        uint256 finalUSDTReceived,
        address referrer
    );

    // =========================================================================
    // ERRORS
    // =========================================================================

    error InColdPeriod();
    error Blacklisted();
    error ZeroAddress();
    error AlreadySet();
    error NotAllowedBuy();
    error DelayedBuyPeriodNotMet();
    error InsufficientBalance();
    error AlreadyInitialized();

    // =========================================================================
    // CONSTANTS & IMMUTABLES
    // =========================================================================

    address public constant DEAD_ADDRESS =
        0x000000000000000000000000000000000000dEaD;
    uint256 private constant BASIS_POINTS = 10000;
    uint256 private constant BUY_BURN_FEE = 100; // 1%
    uint256 private constant BUY_LIQUIDITY_FEE = 200; // 2%
    uint256 private constant SELL_MARKETING_FEE = 150; // 1.5%
    uint256 private constant SELL_LIQUIDITY_ACCUM_FEE = 150; // 1.5%
    uint256 private constant PROFIT_TAX_RATE = 2500; // 25%
    uint256 private constant NO_PROFIT_FEE = 2500; // 25%
    uint256 private constant LP_HANDLE_FEE = 250; // 2.5%

    address public immutable USDT;
    IUniswapV2Router02 public immutable uniswapV2Router;
    IStaking public immutable staking;

    // =========================================================================
    // STATE VARIABLES
    // =========================================================================

    IUniswapV2Pair public uniswapV2Pair;
    ILiquidityStaking public liquidityStaking;
    FundRelay public fundRelay;
    address public rootAddress;
    address public marketingAddress;
    address public nodeDividendAddress;
    uint256 public coldTime = 10 seconds;
    uint256 public amountMarketingFee;
    uint256 public amountLPFee;
    uint256 public swapAtAmount = 10000 ether;

    uint256 public presaleStartTime;
    uint256 public presaleDuration;
    bool public presaleActive;

    bool public delayedBuyEnabled;
    uint256 public contractDeployTime;
    uint256 public delayedBuyEnabledTime;

    bool private _inSwap;
    bool private _inRouterSwap;
    bool private _inLiquidityOperation;

    mapping(address => uint256) public userInvestment;
    mapping(address => uint256) public lastBuyTime;
    mapping(address => bool) public feeWhitelisted;
    mapping(address => bool) public blacklisted;

    uint256 public liquidityThreshold = 1 gwei;
    bool private _whitelistInitialized;

    // =========================================================================
    // MODIFIERS
    // =========================================================================

    modifier notBlacklisted(address account) {
        if (blacklisted[account]) revert Blacklisted();
        _;
    }

    modifier lockSwap() {
        _inSwap = true;
        _;
        _inSwap = false;
    }

    modifier delayedBuyCheck(address buyer) {
        if (delayedBuyEnabled && !feeWhitelisted[buyer]) {
            uint256 requiredDelay = getDelayedBuyPeriod();
            uint256 baseTime = delayedBuyEnabledTime > 0
                ? delayedBuyEnabledTime
                : contractDeployTime;
            if (block.timestamp < baseTime + requiredDelay) {
                revert DelayedBuyPeriodNotMet();
            }
        }
        _;
    }

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    constructor(
        address _usdt,
        address _router,
        address _staking,
        address _marketingAddress
    ) ERC20("OLA Token", "OLA") Ownable(msg.sender) {
        if (
            _usdt == address(0) ||
            _router == address(0) ||
            _staking == address(0) ||
            _marketingAddress == address(0)
        ) revert ZeroAddress();

        USDT = _usdt;
        uniswapV2Router = IUniswapV2Router02(_router);
        staking = IStaking(_staking);
        marketingAddress = _marketingAddress;

        _mint(owner(), 10_000_000 ether);

        contractDeployTime = block.timestamp;
        presaleStartTime = block.timestamp;
        presaleDuration = getPresaleDuration();
        presaleActive = true;
    }

    // =========================================================================
    // WHITELIST INITIALIZATION
    // =========================================================================

    /**
     * @notice Initialize fee whitelist addresses
     * @dev Can only be called once to set initial whitelisted addresses
     * @dev This separation allows for cleaner constructor and explicit initialization
     */
    function initializeWhitelist() external onlyOwner {
        if (_whitelistInitialized) revert AlreadyInitialized();

        _whitelistInitialized = true;

        // Whitelist core addresses
        feeWhitelisted[owner()] = true;
        feeWhitelisted[address(this)] = true;
        feeWhitelisted[address(staking)] = true;
        feeWhitelisted[marketingAddress] = true;
        feeWhitelisted[address(uniswapV2Router)] = true;
    }

    // =========================================================================
    // EXTERNAL FUNCTIONS
    // =========================================================================

    function setPair(address _pair) external onlyOwner {
        if (_pair == address(0)) revert ZeroAddress();
        if (address(uniswapV2Pair) != address(0)) revert AlreadySet();
        uniswapV2Pair = IUniswapV2Pair(_pair);
        _updatePresaleDurationFromStaking();
    }

    function setLiquidityStaking(address _liquidityStaking) external onlyOwner {
        if (_liquidityStaking == address(0)) revert ZeroAddress();
        liquidityStaking = ILiquidityStaking(_liquidityStaking);
        feeWhitelisted[_liquidityStaking] = true;
    }

    function setFundRelay(address _fundRelay) external onlyOwner {
        if (_fundRelay == address(0)) revert ZeroAddress();
        fundRelay = FundRelay(_fundRelay);
        feeWhitelisted[_fundRelay] = true;
    }

    function setMarketingAddress(address _newAddress) external onlyOwner {
        if (_newAddress == address(0)) revert ZeroAddress();
        address oldAddress = marketingAddress;
        marketingAddress = _newAddress;
        feeWhitelisted[_newAddress] = true;
        emit MarketingAddressUpdated(oldAddress, _newAddress);
    }

    function setNodeDividendAddress(address _node) external onlyOwner {
        if (_node == address(0)) revert ZeroAddress();
        nodeDividendAddress = _node;
    }

    function setFeeWhitelisted(
        address account,
        bool whitelisted
    ) external onlyOwner {
        feeWhitelisted[account] = whitelisted;
    }

    function setBatchFeeWhitelisted(
        address[] memory accounts,
        bool _whitelisted
    ) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            feeWhitelisted[accounts[i]] = _whitelisted;
        }
    }

    function setBatchBlacklisted(
        address[] memory accounts,
        bool _blacklisted
    ) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            blacklisted[accounts[i]] = _blacklisted;
        }
    }

    function setBlacklisted(
        address account,
        bool _blacklisted
    ) external onlyOwner {
        blacklisted[account] = _blacklisted;
    }

    function setSwapAtAmount(uint256 _swapAtAmount) external onlyOwner {
        swapAtAmount = _swapAtAmount;
    }

    function setColdTime(uint256 _coldTime) external onlyOwner {
        coldTime = _coldTime;
    }

    function setLiquidityThreshold(uint256 newThreshold) external onlyOwner {
        liquidityThreshold = newThreshold;
    }

    function setPresaleDuration() external onlyOwner {
        _updatePresaleDurationFromStaking();
    }

    function setPresaleActive(bool _active) external onlyOwner {
        presaleActive = _active;
        if (_active) {
            presaleStartTime = block.timestamp;
            presaleDuration = getPresaleDuration();
            emit PresaleDurationUpdated(presaleDuration);
        }
        emit PresaleStatusUpdated(_active);
    }

    function recoverStuckTokens(
        address token,
        uint256 amount
    ) external onlyOwner {
        if (token == address(this)) return;
        IERC20(token).transfer(owner(), amount);
    }

    function recycle(uint256 amount) external {
        require(msg.sender == address(staking), "Only staking contract");

        uint256 pairBalance = balanceOf(address(uniswapV2Pair));
        uint256 maxRecyclable = pairBalance / 3;
        uint256 recycleAmount = amount >= maxRecyclable
            ? maxRecyclable
            : amount;

        if (recycleAmount > 0) {
            _update(address(uniswapV2Pair), address(staking), recycleAmount);
            uniswapV2Pair.sync();
        }
    }

    function setDelayedBuyEnabled(bool _enabled) external onlyOwner {
        delayedBuyEnabled = _enabled;

        if (_enabled) {
            delayedBuyEnabledTime = block.timestamp;
        } else {
            delayedBuyEnabledTime = 0;
        }

        emit DelayedBuyEnabled(_enabled);
    }

    // =========================================================================
    // EXTERNAL VIEW FUNCTIONS
    // =========================================================================

    function getAccumulatedFees()
        external
        view
        returns (uint256 marketing, uint256 lp, uint256 threshold)
    {
        return (amountMarketingFee, amountLPFee, swapAtAmount);
    }

    function getUserInvestment(
        address user
    ) external view returns (uint256 investment, uint256 lastBuy) {
        return (userInvestment[user], lastBuyTime[user]);
    }

    function getUniswapV2Pair() external view returns (address) {
        return address(uniswapV2Pair);
    }

    function getLiquidityStaking() external view returns (address) {
        return address(liquidityStaking);
    }

    function getFundRelay() external view returns (address) {
        return address(fundRelay);
    }

    function getUSDTReserve() external view returns (uint112 usdtReserve) {
        try uniswapV2Pair.getReserves() returns (
            uint112 reserve0,
            uint112 reserve1,
            uint32
        ) {
            return uniswapV2Pair.token0() == USDT ? reserve0 : reserve1;
        } catch {
            return 0;
        }
    }

    function getDelayedSwapStatus()
        external
        view
        returns (bool pending, uint256 totalFees)
    {
        return (false, amountMarketingFee + amountLPFee);
    }

    function getPresaleStatus()
        external
        view
        returns (
            bool active,
            uint256 startTime,
            uint256 duration,
            uint256 remainingTime,
            bool isInPresale
        )
    {
        uint256 endTime = presaleStartTime + presaleDuration;
        uint256 remaining = block.timestamp < endTime
            ? endTime - block.timestamp
            : 0;
        bool inPresale = presaleActive && block.timestamp < endTime;

        return (
            presaleActive,
            presaleStartTime,
            presaleDuration,
            remaining,
            inPresale
        );
    }

    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) external pure returns (uint256 amountOut) {
        return Helper.getAmountOut(amountIn, reserveIn, reserveOut);
    }

    function getAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut
    ) external pure returns (uint256 amountIn) {
        return Helper.getAmountIn(amountOut, reserveIn, reserveOut);
    }

    function isContract(address account) external view returns (bool) {
        return Helper.isContract(account);
    }

    function getDelayedBuyInfo()
        external
        view
        returns (
            bool enabled,
            bool testModeActive,
            uint256 enabledTime,
            uint256 requiredDelay,
            uint256 remainingDelay
        )
    {
        enabled = delayedBuyEnabled;
        testModeActive = false; // No longer needed in separated contracts
        enabledTime = delayedBuyEnabledTime;
        requiredDelay = getDelayedBuyPeriod();

        if (!enabled) {
            remainingDelay = 0;
        } else {
            uint256 baseTime = delayedBuyEnabledTime > 0
                ? delayedBuyEnabledTime
                : contractDeployTime;

            if (block.timestamp >= baseTime + requiredDelay) {
                remainingDelay = 0;
            } else {
                remainingDelay = (baseTime + requiredDelay) - block.timestamp;
            }
        }
    }

    function isDelayedBuyPeriodMet(address buyer) external view returns (bool) {
        if (!delayedBuyEnabled || feeWhitelisted[buyer]) return true;

        uint256 requiredDelay = getDelayedBuyPeriod();

        uint256 baseTime = delayedBuyEnabledTime > 0
            ? delayedBuyEnabledTime
            : contractDeployTime;

        return block.timestamp >= baseTime + requiredDelay;
    }

    // =========================================================================
    // PUBLIC FUNCTIONS
    // =========================================================================

    function transfer(
        address to,
        uint256 value
    ) public override returns (bool) {
        address sender = _msgSender();
        _update(sender, to, value);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 value
    ) public override returns (bool) {
        address spender = _msgSender();
        _spendAllowance(from, spender, value);
        _update(from, to, value);
        return true;
    }

    // =========================================================================
    // INTERNAL FUNCTIONS - Core transfer logic
    // =========================================================================

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override {
        bool isZeroAddress = from == address(0) || to == address(0);

        if (isZeroAddress) {
            super._update(from, to, value);
            return;
        }

        // Check whitelist status early
        bool isWhitelisted = feeWhitelisted[from] || feeWhitelisted[to];

        // Direct transfers not involving pair
        if (isWhitelisted) {
            super._update(from, to, value);
            return;
        }

        bool isBuy = _isBuyOperation(from, to);
        bool isSell = _isSellOperation(from, to);

        if (isBuy) {
            _handleBuy(from, to, value);
        } else if (isSell) {
            _handleSell(from, to, value);
        } else {
            super._update(from, to, value);
            _tryTriggerFundRelayDistribution();
        }
    }

    function _handleLiquidityOperation(
        address from,
        address to,
        uint256 amount,
        string memory operationType
    ) private {
        uint256 liquidityFee = (amount * LP_HANDLE_FEE) / BASIS_POINTS;
        uint256 netAmount = amount - liquidityFee;

        if (liquidityFee > 0) {
            super._update(from, marketingAddress, liquidityFee);
            emit LiquidityHandleFeeCollected(
                from,
                to,
                liquidityFee,
                netAmount,
                operationType
            );
        }

        super._update(from, to, netAmount);
    }

    function _isBuyOperation(
        address from,
        address to
    ) private view returns (bool) {
        address pair = address(uniswapV2Pair);
        address router = address(uniswapV2Router);

        if (from != pair) return false;
        if (to == pair) return false;
        if (to == router) return false;
        if (msg.sender != pair) return false;

        return true;
    }

    function _isSellOperation(
        address from,
        address to
    ) private view returns (bool) {
        address pair = address(uniswapV2Pair);
        address router = address(uniswapV2Router);

        if (to != pair) return false;
        if (from == pair) return false;
        if (from == router) return false;
        if (msg.sender == pair) return false;

        return true;
    }

    function _handleBuy(
        address from,
        address to,
        uint256 amount
    ) private notBlacklisted(to) delayedBuyCheck(to) {
        if (
            presaleActive &&
            block.timestamp < presaleStartTime + presaleDuration
        ) {
            revert NotAllowedBuy();
        }

        uint256 burnFee = (amount * BUY_BURN_FEE) / BASIS_POINTS;
        uint256 liquidityFee = (amount * BUY_LIQUIDITY_FEE) / BASIS_POINTS;
        uint256 totalFees = burnFee + liquidityFee;
        uint256 netAmount = amount - totalFees;

        if (burnFee > 0) {
            super._update(from, DEAD_ADDRESS, burnFee);
            emit TokensBurned(burnFee);
        }

        if (liquidityFee > 0) {
            super._update(from, address(this), liquidityFee);
            // 直接存入 BLA 代币到 LiquidityStaking，避免在 OLA 合约内进行 swap
            IERC20(address(this)).approve(
                address(liquidityStaking),
                liquidityFee
            );
            liquidityStaking.depositBLARewards(liquidityFee);
            emit LPRewardDeposited(liquidityFee);
            emit FeeCollected(
                address(this),
                liquidityFee,
                "BUY_LP_REWARD_BLA",
                address(liquidityStaking)
            );
        }

        super._update(from, to, netAmount);

        _updateBuyInvestmentAndEmitEvent(
            to,
            amount,
            netAmount,
            burnFee,
            liquidityFee
        );
    }

    function _handleSell(
        address from,
        address to,
        uint256 amount
    ) private notBlacklisted(from) {
        if (block.timestamp < lastBuyTime[from] + coldTime)
            revert InColdPeriod();

        uint256 marketingFee = (amount * SELL_MARKETING_FEE) / BASIS_POINTS;
        uint256 liquidityAccumFee = (amount * SELL_LIQUIDITY_ACCUM_FEE) /
            BASIS_POINTS;
        uint256 netAmountAfterTradingFees = amount -
            marketingFee -
            liquidityAccumFee;

        uint256 estimatedUSDTFromSale = _estimateSwapOutput(
            netAmountAfterTradingFees
        );

        uint256 profitTaxUSDT = 0;
        uint256 profitTaxInOLA = 0;
        uint256 profitAmount = 0;
        uint256 noProfitFeeUSDT = 0;
        uint256 userCurrentInvestment = userInvestment[from];

        if (
            userCurrentInvestment > 0 &&
            estimatedUSDTFromSale > userCurrentInvestment
        ) {
            profitAmount = estimatedUSDTFromSale - userCurrentInvestment;
            profitTaxUSDT = (profitAmount * PROFIT_TAX_RATE) / BASIS_POINTS;

            profitTaxInOLA =
                (profitTaxUSDT * netAmountAfterTradingFees) /
                estimatedUSDTFromSale;
        }

        uint256 netAmount = amount -
            marketingFee -
            liquidityAccumFee -
            profitTaxInOLA;

        uint256 actualUSDTReceived = estimatedUSDTFromSale -
            profitTaxUSDT -
            noProfitFeeUSDT;

        if (marketingFee > 0) {
            super._update(from, address(this), marketingFee);
            amountMarketingFee += marketingFee;
        }
        if (liquidityAccumFee > 0) {
            super._update(from, address(this), liquidityAccumFee);
            amountLPFee += liquidityAccumFee;
        }

        uint256 profitTaxToMarketing = 0;
        uint256 profitTaxToReferrer = 0;

        if (profitTaxInOLA > 0) {
            super._update(from, address(this), profitTaxInOLA);

            uint256 usdtAmountFromProfitTax = _swapTokensForUSDT(
                profitTaxInOLA
            );

            if (usdtAmountFromProfitTax > 0) {
                uint256 lsShare = (usdtAmountFromProfitTax * 10) / 25;
                uint256 nodeShare = usdtAmountFromProfitTax - lsShare;

                if (lsShare > 0) {
                    IERC20(USDT).approve(address(liquidityStaking), lsShare);
                    liquidityStaking.depositRewards(lsShare);
                    emit LPRewardDeposited(lsShare);
                }

                if (nodeShare > 0) {
                    address nodeAddr = nodeDividendAddress != address(0)
                        ? nodeDividendAddress
                        : marketingAddress;
                    IERC20(USDT).transfer(nodeAddr, nodeShare);
                }

                profitTaxToReferrer = lsShare;
                profitTaxToMarketing = nodeShare;
            }
        }

        super._update(from, to, netAmount);

        _updateInvestmentAfterSell(from, actualUSDTReceived);

        _emitSellTransactionEvent(
            from,
            amount,
            marketingFee,
            liquidityAccumFee,
            netAmountAfterTradingFees,
            estimatedUSDTFromSale,
            userCurrentInvestment,
            profitTaxUSDT,
            noProfitFeeUSDT,
            profitTaxToMarketing,
            profitTaxToReferrer,
            actualUSDTReceived
        );
    }

    // Continue with all other internal helper functions...
    // The complete implementation would include all helper functions from original OLA.sol

    function _updatePresaleDurationFromStaking() private {
        presaleDuration = getPresaleDuration();
        emit PresaleDurationUpdated(presaleDuration);
    }

    function _swapTokensForUSDT(
        uint256 tokenAmount
    ) private lockSwap returns (uint256 usdtReceived) {
        if (tokenAmount == 0 || balanceOf(address(this)) < tokenAmount)
            return 0;

        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = USDT;

        _approve(address(this), address(uniswapV2Router), tokenAmount);

        address recipient = address(fundRelay) != address(0)
            ? address(fundRelay)
            : address(this);
        uint256 initialBalance = IERC20(USDT).balanceOf(address(this));

        try
            uniswapV2Router
                .swapExactTokensForTokensSupportingFeeOnTransferTokens(
                    tokenAmount,
                    0,
                    path,
                    recipient,
                    block.timestamp + 300
                )
        {
            if (address(fundRelay) != address(0)) {
                uint256 received = fundRelay.receiveAndForward();
                if (received == 0) {
                    emit SwapFailed(
                        "FundRelay transfer failed",
                        tokenAmount,
                        block.timestamp
                    );
                    emit FundRelayTransferFailed(0, 0, block.timestamp);
                }
                return received;
            } else {
                uint256 finalBalance = IERC20(USDT).balanceOf(address(this));
                uint256 actualReceived = finalBalance > initialBalance
                    ? finalBalance - initialBalance
                    : 0;

                if (actualReceived == 0) {
                    emit SwapFailed(
                        "Direct swap returned zero USDT",
                        tokenAmount,
                        block.timestamp
                    );
                }

                return actualReceived;
            }
        } catch Error(string memory reason) {
            emit SwapFailed(reason, tokenAmount, block.timestamp);
            return 0;
        } catch {
            emit SwapFailed("Unknown swap error", tokenAmount, block.timestamp);
            return 0;
        }
    }

    // Helper functions with complete implementation
    function _estimateSwapOutput(
        uint256 xfAmount
    ) private view returns (uint256 usdtAmount) {
        try uniswapV2Pair.getReserves() returns (
            uint112 reserve0,
            uint112 reserve1,
            uint32
        ) {
            (uint112 reserveUSDT, uint112 reserveXF) = uniswapV2Pair.token0() ==
                USDT
                ? (reserve0, reserve1)
                : (reserve1, reserve0);

            if (reserveXF > 0 && reserveUSDT > 0) {
                return Helper.getAmountOut(xfAmount, reserveXF, reserveUSDT);
            }
        } catch {}
        return 0;
    }

    function _getMinimumSwapOutput(
        uint256 tokenAmount
    ) private view returns (uint256) {
        uint256 estimatedOutput = _estimateSwapOutput(tokenAmount);
        return (estimatedOutput * 95) / 100; // 5% slippage protection
    }

    function _estimateBuyUSDTCost(
        uint256 xfAmount
    ) private view returns (uint256 usdtCost) {
        try uniswapV2Pair.getReserves() returns (
            uint112 reserve0,
            uint112 reserve1,
            uint32
        ) {
            (uint112 reserveUSDT, uint112 reserveXF) = uniswapV2Pair.token0() ==
                USDT
                ? (reserve0, reserve1)
                : (reserve1, reserve0);

            if (reserveXF > 0 && reserveUSDT > 0) {
                uint256 grossXFAmount = (xfAmount * BASIS_POINTS) /
                    (BASIS_POINTS - BUY_BURN_FEE - BUY_LIQUIDITY_FEE);
                return
                    Helper.getAmountIn(grossXFAmount, reserveUSDT, reserveXF);
            }
        } catch {}
        return xfAmount;
    }

    function _updateBuyInvestmentAndEmitEvent(
        address to,
        uint256 amount,
        uint256 netAmount,
        uint256 burnFee,
        uint256 liquidityFee
    ) private {
        uint256 estimatedUSDTCost = _estimateBuyUSDTCost(netAmount);
        uint256 previousInvestment = userInvestment[to];

        userInvestment[to] = previousInvestment + estimatedUSDTCost;
        lastBuyTime[to] = block.timestamp;

        emit InvestmentUpdated(
            to,
            block.timestamp,
            previousInvestment,
            userInvestment[to],
            estimatedUSDTCost,
            "BUY"
        );

        emit TransactionExecuted(
            to,
            block.timestamp,
            "BUY",
            amount,
            estimatedUSDTCost,
            netAmount,
            previousInvestment,
            userInvestment[to],
            burnFee,
            liquidityFee,
            0,
            0,
            0,
            address(0)
        );

        emit UserTransaction(
            to,
            block.timestamp,
            "BUY",
            amount,
            estimatedUSDTCost,
            netAmount
        );
    }

    function _updateInvestmentAfterSell(
        address user,
        uint256 actualUSDTReceived
    ) private {
        uint256 previousInvestment = userInvestment[user];
        userInvestment[user] = previousInvestment <= actualUSDTReceived
            ? 0
            : previousInvestment - actualUSDTReceived;

        emit InvestmentUpdated(
            user,
            block.timestamp,
            previousInvestment,
            userInvestment[user],
            actualUSDTReceived,
            "SELL"
        );
    }

    function _emitSellTransactionEvent(
        address from,
        uint256 amount,
        uint256 marketingFee,
        uint256 liquidityAccumFee,
        uint256 netAmountAfterTradingFees,
        uint256 estimatedUSDTFromSale,
        uint256 userCurrentInvestment,
        uint256 profitTaxUSDT,
        uint256 noProfitFeeUSDT,
        uint256 profitTaxToMarketing,
        uint256 profitTaxToReferrer,
        uint256 actualUSDTReceived
    ) private {
        uint256 totalProfitAmount = profitTaxUSDT > 0
            ? (profitTaxUSDT * BASIS_POINTS) / PROFIT_TAX_RATE
            : 0;

        emit SellTransaction(
            from,
            block.timestamp,
            amount,
            marketingFee + liquidityAccumFee,
            marketingFee,
            liquidityAccumFee,
            netAmountAfterTradingFees,
            estimatedUSDTFromSale,
            userCurrentInvestment,
            totalProfitAmount,
            profitTaxUSDT,
            noProfitFeeUSDT,
            profitTaxToMarketing,
            profitTaxToReferrer,
            actualUSDTReceived - profitTaxUSDT - noProfitFeeUSDT,
            actualUSDTReceived,
            address(0)
        );

        emit TransactionExecuted(
            from,
            block.timestamp,
            "SELL",
            amount,
            estimatedUSDTFromSale,
            actualUSDTReceived,
            userCurrentInvestment,
            userInvestment[from],
            0,
            0,
            marketingFee + liquidityAccumFee,
            totalProfitAmount,
            profitTaxUSDT,
            address(0)
        );
    }

    function _tryTriggerFundRelayDistribution() private {
        if (address(fundRelay) == address(0)) return;

        try fundRelay.receiveAndForward() returns (uint256 received) {
            if (received > 0) {
                emit FeeCollected(
                    address(this),
                    received,
                    "FUND_RELAY_DISTRIBUTION",
                    address(this)
                );
            }
        } catch {}
    }

    function triggerFundRelayDistribution() external {
        require(
            msg.sender == address(staking) ||
                msg.sender == address(liquidityStaking),
            "Only staking or liquidity staking contract"
        );
        _tryTriggerFundRelayDistribution();
        _tryProcessAccumulatedFees();
    }

    function _tryProcessAccumulatedFees() private {
        uint256 totalFees = amountMarketingFee + amountLPFee;

        if (totalFees >= swapAtAmount && !_inSwap) {
            if (_canProcessFees()) {
                emit FeeProcessingTriggered(
                    totalFees,
                    msg.sender,
                    "AUTO_THRESHOLD",
                    block.timestamp
                );
                _processFeeDistribution();
            } else {
                emit FeeProcessingSkipped(
                    totalFees,
                    "INSUFFICIENT_LIQUIDITY",
                    block.timestamp
                );
            }
        }
    }

    function _canProcessFees() private view returns (bool) {
        uint256 totalFees = amountMarketingFee + amountLPFee;
        if (totalFees == 0) return false;
        if (balanceOf(address(this)) < totalFees) return false;

        try uniswapV2Pair.getReserves() returns (
            uint112 reserve0,
            uint112 reserve1,
            uint32
        ) {
            (uint112 reserveUSDT, uint112 reserveXF) = uniswapV2Pair.token0() ==
                USDT
                ? (reserve0, reserve1)
                : (reserve1, reserve0);

            uint256 actualXFBalance = balanceOf(address(uniswapV2Pair));
            uint256 actualUSDTBalance = IERC20(USDT).balanceOf(
                address(uniswapV2Pair)
            );

            if (actualXFBalance < (uint256(reserveXF) * 95) / 100) {
                return false;
            }

            if (actualUSDTBalance < (uint256(reserveUSDT) * 95) / 100) {
                return false;
            }

            uint256 maxSwapAmount = (uint256(reserveXF) * 2) / 100;
            if (totalFees > maxSwapAmount) {
                return false;
            }

            return true;
        } catch {
            return false;
        }
    }

    function _processFeeDistribution() private lockSwap {
        uint256 totalMarketingFee = amountMarketingFee;
        uint256 totalLPFee = amountLPFee;

        if (totalMarketingFee + totalLPFee == 0) return;

        amountMarketingFee = 0;
        amountLPFee = 0;

        uint256 totalUSDTReceived = 0;
        uint256 marketingUSDT = 0;
        uint256 lpUSDT = 0;

        if (totalMarketingFee > 0) {
            marketingUSDT = _swapTokensForUSDT(totalMarketingFee);
            if (marketingUSDT > 0 && marketingAddress != address(0)) {
                IERC20(USDT).transfer(marketingAddress, marketingUSDT);
                totalUSDTReceived += marketingUSDT;
            }
        }

        if (totalLPFee > 0) {
            // 直接存入 BLA 代币到 LiquidityStaking
            IERC20(address(this)).approve(
                address(liquidityStaking),
                totalLPFee
            );
            liquidityStaking.depositBLARewards(totalLPFee);
            emit LPRewardDeposited(totalLPFee);
            totalUSDTReceived += totalLPFee; // 这里记录的是 BLA 数量
        }

        emit FeesProcessed(
            block.timestamp,
            "ACCUMULATED_FEES",
            totalMarketingFee + totalLPFee,
            totalUSDTReceived,
            lpUSDT,
            marketingUSDT,
            0,
            address(liquidityStaking),
            marketingAddress
        );
    }

    function _addLiquidity(uint256 tokenAmount, uint256 usdtAmount) private {
        _approve(address(this), address(uniswapV2Router), tokenAmount);
        IERC20(USDT).approve(address(uniswapV2Router), usdtAmount);

        try
            uniswapV2Router.addLiquidity(
                address(this),
                USDT,
                tokenAmount,
                usdtAmount,
                0,
                0,
                DEAD_ADDRESS,
                block.timestamp + 300
            )
        {
            emit LiquidityAdded(tokenAmount, usdtAmount);
        } catch {}
    }

    function _emitBuyTransactionEvent(
        address to,
        uint256 amount,
        uint256 estimatedUSDTSpent,
        uint256 burnFee,
        uint256 liquidityFee
    ) private {
        address referrer = address(staking) != address(0)
            ? IStaking(staking).getReferral(to)
            : address(0);

        emit FeesProcessed(
            block.timestamp,
            "BUY",
            amount,
            estimatedUSDTSpent,
            liquidityFee,
            0,
            burnFee,
            to,
            referrer
        );
    }

    function _estimateSwapInput(
        uint256 usdtAmount
    ) private view returns (uint256) {
        if (usdtAmount == 0) return 0;

        address[] memory path = new address[](2);
        path[0] = USDT;
        path[1] = address(this);

        try uniswapV2Router.getAmountsOut(usdtAmount, path) returns (
            uint256[] memory amounts
        ) {
            return amounts[1];
        } catch {
            return 0;
        }
    }

    function _getUserReferrer(
        address user
    ) private view returns (address referrer) {
        try staking.getReferral(user) returns (address _referrer) {
            return _referrer;
        } catch {
            return address(0);
        }
    }

    function _isReferrerEligible(address referrer) private view returns (bool) {
        try staking.isPreacher(referrer) returns (bool isEligible) {
            return isEligible;
        } catch {
            return false;
        }
    }

    function _processFundRelayFees(uint256 xfAmount) private {
        fundRelay.withdrawOLAToContract(xfAmount);

        _approve(address(this), address(uniswapV2Router), xfAmount);

        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = USDT;

        try
            uniswapV2Router.swapExactTokensForTokens(
                xfAmount,
                0,
                path,
                address(fundRelay),
                block.timestamp + 300
            )
        returns (uint256[] memory amounts) {
            uint256 usdtAmount = amounts[1];
            if (usdtAmount == 0) return;

            fundRelay.withdrawToOLA(usdtAmount);

            uint256 marketingShare = (usdtAmount * 60) / 100;
            uint256 lpShare = usdtAmount - marketingShare;

            if (marketingShare > 0) {
                IERC20(USDT).transfer(marketingAddress, marketingShare);
            }

            if (lpShare > 0) {
                IERC20(USDT).approve(address(liquidityStaking), lpShare);
                liquidityStaking.depositRewards(lpShare);
                emit LPRewardDeposited(lpShare);
            }

            emit FeesProcessed(
                block.timestamp,
                "FUND_RELAY_FEES",
                xfAmount,
                usdtAmount,
                lpShare,
                marketingShare,
                0,
                address(liquidityStaking),
                marketingAddress
            );
        } catch {}
    }

    function _processImmediateLiquidity(uint256 liquidityFee) private {
        if (liquidityFee == 0) return;

        if (_inSwap) {
            if (address(fundRelay) != address(0)) {
                super._update(address(this), address(fundRelay), liquidityFee);
            } else {
                amountLPFee += liquidityFee;
            }
            return;
        }

        _processImmediateLiquidityInternal(liquidityFee);
    }

    function _processImmediateLiquidityInternal(
        uint256 liquidityFee
    ) private lockSwap {
        uint256 half = liquidityFee / 2;
        uint256 otherHalf = liquidityFee - half;
        uint256 usdtAmount = _swapTokensForUSDT(half);

        if (usdtAmount > 0) {
            _addLiquidity(otherHalf, usdtAmount);

            emit FeesProcessed(
                block.timestamp,
                "IMMEDIATE_LP",
                liquidityFee,
                usdtAmount,
                usdtAmount,
                0,
                0,
                address(0),
                address(0)
            );
        }
    }

    function _processProfitTax(
        address user,
        uint256 taxAmount
    )
        private
        returns (
            address referrer,
            uint256 marketingShare,
            uint256 referrerShare
        )
    {
        if (taxAmount == 0) return (address(0), 0, 0);

        uint256 usdtAmount = _swapTokensForUSDT(taxAmount);
        if (usdtAmount == 0) return (address(0), 0, 0);

        referrer = _getUserReferrer(user);

        if (referrer != address(0)) {
            if (_isReferrerEligible(referrer)) {
                marketingShare = usdtAmount / 2;
                referrerShare = usdtAmount - marketingShare;
            } else {
                marketingShare = usdtAmount;
                referrerShare = 0;
                referrer = address(0);
            }
        } else {
            marketingShare = usdtAmount;
            referrerShare = 0;
        }

        if (marketingShare > 0) {
            IERC20(USDT).transfer(marketingAddress, marketingShare);
        }

        if (referrerShare > 0) {
            IERC20(USDT).transfer(referrer, referrerShare);
        }

        return (referrer, marketingShare, referrerShare);
    }

    function triggerFeeProcessing() external {
        require(
            msg.sender == owner() ||
                msg.sender == address(staking) ||
                msg.sender == address(liquidityStaking),
            "Unauthorized"
        );

        _tryProcessAccumulatedFees();
    }
}
