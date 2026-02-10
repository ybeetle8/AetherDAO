// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {LiquidityStakingBase} from "../abstract/LiquidityStakingBase.sol";

/**
 * @title LiquidityStaking - Mainnet implementation of LiquidityStaking
 * @notice Production environment liquidity staking with mainnet-specific constants
 */
contract LiquidityStaking is LiquidityStakingBase {
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
    ) LiquidityStakingBase(_usdt, _syiContract, _lpToken, _staking, _marketingAddress, _admin, _router) {}

    // =========================================================================
    // ENVIRONMENT SPECIFIC CONSTANTS - MAINNET VALUES
    // =========================================================================

    // Minimum stake duration - 24 hours for mainnet
    function getMinStakeDuration() internal pure override returns (uint256) {
        return 24 hours;
    }
}