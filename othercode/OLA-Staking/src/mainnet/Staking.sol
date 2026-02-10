// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {StakingBase} from "../abstract/StakingBase.sol";

/**
 * @title Staking - Mainnet implementation of Staking contract
 * @notice Production environment staking with mainnet-specific constants
 */
contract Staking is StakingBase {
    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    constructor(
        address _usdt,
        address _router,
        address _rootAddress,
        address _feeRecipient
    ) StakingBase(_usdt, _router, _rootAddress, _feeRecipient) {}

    // =========================================================================
    // ENVIRONMENT SPECIFIC CONSTANTS - MAINNET VALUES
    // =========================================================================

    // APY Rates (Production mode: daily compounding to match documentation expectations)
    function getAPYRate1D() internal pure override returns (uint256) {
        return 1002999999999999900; // 0.3% over 1 day
    }

    function getAPYRate7D() internal pure override returns (uint256) {
        return 1006005015832844700; // 4.28% over 7 days
    }

    function getAPYRate15D() internal pure override returns (uint256) {
        return 1010001800489432400; // 16.1% over 15 days
    }

    function getAPYRate30D() internal pure override returns (uint256) {
        return 1015000428130702600; // 56.31% over 30 days
    }

    // Staking Periods (Production mode: days)
    function getStakePeriod1D() internal pure override returns (uint256) {
        return 1 days;
    }

    function getStakePeriod7D() internal pure override returns (uint256) {
        return 7 days;
    }

    function getStakePeriod15D() internal pure override returns (uint256) {
        return 15 days;
    }

    function getStakePeriod30D() internal pure override returns (uint256) {
        return 30 days;
    }

    // Team Thresholds (Production mode: V1..V7)
    function getTeamThresholdTier1() internal pure override returns (uint256) {
        return 10_000 ether; // V1
    }

    function getTeamThresholdTier2() internal pure override returns (uint256) {
        return 50_000 ether; // V2
    }

    function getTeamThresholdTier3() internal pure override returns (uint256) {
        return 200_000 ether; // V3
    }

    function getTeamThresholdTier4() internal pure override returns (uint256) {
        return 500_000 ether; // V4
    }

    function getTeamThresholdTier5() internal pure override returns (uint256) {
        return 1_000_000 ether; // V5
    }

    function getTeamThresholdTier6() internal pure override returns (uint256) {
        return 2_500_000 ether; // V6
    }

    function getTeamThresholdTier7() internal pure override returns (uint256) {
        return 5_000_000 ether; // V7
    }

    // EOA check - enabled for mainnet
    function shouldCheckEOA() internal pure override returns (bool) {
        return true;
    }

    // Compound Interest Time Unit - daily for mainnet
    function getCompoundTimeUnit() internal pure override returns (uint256) {
        return 1 days;
    }
}
