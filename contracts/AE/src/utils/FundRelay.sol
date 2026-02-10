// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {IERC20} from "lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

/**
 * @title FundRelay
 * @notice Dedicated fund relay contract to solve INVALID_TO issues during AE contract swaps
 * @dev Acts as an intermediary between AE contract and Uniswap Router, safely handling USDT transfers
 * @author AE Protocol Team
 * @custom:security-contact security@ae.com
 */
contract FundRelay {
    // =========================================================================
    // State Variables
    // =========================================================================

    /// @notice AE contract address
    address public immutable AE_CONTRACT;

    /// @notice USDT token address
    address public immutable USDT;

    /// @notice Emergency withdrawal address (usually owner)
    address public immutable EMERGENCY_RECIPIENT;

    // =========================================================================
    // Events
    // =========================================================================

    /// @notice Emitted when USDT is received
    event USDTReceived(uint256 amount, address indexed from);

    /// @notice Emitted when USDT is forwarded
    event USDTForwarded(uint256 amount, address indexed to);

    /// @notice Emitted when emergency withdrawal occurs
    event EmergencyWithdraw(uint256 amount, address indexed to);

    // =========================================================================
    // Errors
    // =========================================================================

    /// @notice Only AE contract can call this function
    error OnlyAEContract();

    /// @notice Only emergency recipient can call this function
    error OnlyEmergencyRecipient();

    /// @notice Insufficient balance for operation
    error InsufficientBalance();

    /// @notice Token transfer failed
    error TransferFailed();

    // =========================================================================
    // Modifiers
    // =========================================================================

    /// @dev Only AE contract can call
    modifier onlyAE() {
        if (msg.sender != AE_CONTRACT) revert OnlyAEContract();
        _;
    }

    /// @dev Only emergency recipient can call
    modifier onlyEmergency() {
        if (msg.sender != EMERGENCY_RECIPIENT) revert OnlyEmergencyRecipient();
        _;
    }

    // =========================================================================
    // Constructor
    // =========================================================================

    /**
     * @notice Initializes the FundRelay contract
     * @param _aeContract AE contract address
     * @param _usdt USDT token address
     * @param _emergencyRecipient Emergency withdrawal recipient address
     */
    constructor(
        address _aeContract,
        address _usdt,
        address _emergencyRecipient
    ) {
        require(_aeContract != address(0), "Invalid AE contract");
        require(_usdt != address(0), "Invalid USDT");
        require(
            _emergencyRecipient != address(0),
            "Invalid emergency recipient"
        );

        AE_CONTRACT = _aeContract;
        USDT = _usdt;
        EMERGENCY_RECIPIENT = _emergencyRecipient;

        // Pre-approve AE contract to withdraw all USDT
        IERC20(_usdt).approve(_aeContract, type(uint256).max);
    }

    // =========================================================================
    // Main Functions
    // =========================================================================

    /**
     * @notice Receive USDT and immediately forward to AE contract
     * @dev This function will be called by Uniswap Router to receive swapped USDT
     * @return usdtAmount Amount of USDT forwarded
     */
    function receiveAndForward() external returns (uint256 usdtAmount) {
        uint256 balance = IERC20(USDT).balanceOf(address(this));

        if (balance > 0) {
            emit USDTReceived(balance, msg.sender);

            // Immediately forward to AE contract
            bool success = IERC20(USDT).transfer(AE_CONTRACT, balance);
            if (!success) revert TransferFailed();

            emit USDTForwarded(balance, AE_CONTRACT);
            return balance;
        }

        return 0;
    }

    /**
     * @notice AE contract withdraws USDT
     * @param amount Amount to withdraw
     * @dev Only AE contract can call this function
     */
    function withdrawToAE(uint256 amount) external onlyAE {
        uint256 balance = IERC20(USDT).balanceOf(address(this));
        if (balance < amount) revert InsufficientBalance();

        bool success = IERC20(USDT).transfer(AE_CONTRACT, amount);
        if (!success) revert TransferFailed();

        emit USDTForwarded(amount, AE_CONTRACT);
    }

    /**
     * @notice Get current USDT balance
     * @return balance Current USDT balance in this contract
     */
    function getUSDTBalance() external view returns (uint256 balance) {
        return IERC20(USDT).balanceOf(address(this));
    }

    /**
     * @notice Withdraw AE tokens to AE contract for processing
     * @dev Only AE contract can call this function
     * @param amount Amount of AE to withdraw
     */
    function withdrawAEToContract(uint256 amount) external onlyAE {
        uint256 xfBalance = IERC20(AE_CONTRACT).balanceOf(address(this));
        if (xfBalance < amount) revert InsufficientBalance();

        bool success = IERC20(AE_CONTRACT).transfer(AE_CONTRACT, amount);
        if (!success) revert TransferFailed();
    }

    // =========================================================================
    // Emergency Functions
    // =========================================================================

    /**
     * @notice Emergency withdraw all USDT
     * @dev Only emergency recipient can call this function, used for fund rescue in exceptional situations
     */
    function emergencyWithdraw() external onlyEmergency {
        uint256 balance = IERC20(USDT).balanceOf(address(this));

        if (balance > 0) {
            bool success = IERC20(USDT).transfer(EMERGENCY_RECIPIENT, balance);
            if (!success) revert TransferFailed();

            emit EmergencyWithdraw(balance, EMERGENCY_RECIPIENT);
        }
    }

    /**
     * @notice Emergency withdraw specific token
     * @param token Token address to withdraw
     * @param amount Amount to withdraw
     */
    function emergencyWithdrawToken(
        address token,
        uint256 amount
    ) external onlyEmergency {
        bool success = IERC20(token).transfer(EMERGENCY_RECIPIENT, amount);
        if (!success) revert TransferFailed();
    }
}
