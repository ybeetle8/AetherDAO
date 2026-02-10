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

    // APY Rates (Production mode: daily compounding)
    function getAPYRate7D() internal pure override returns (uint256) {
        return 1006000000000000000; // 0.6% daily over 7 days
    }

    function getAPYRate30D() internal pure override returns (uint256) {
        return 1009000000000000000; // 0.9% daily over 30 days
    }

    function getAPYRate90D() internal pure override returns (uint256) {
        return 1011000000000000000; // 1.1% daily over 90 days
    }

    function getAPYRate180D() internal pure override returns (uint256) {
        return 1015000000000000000; // 1.5% daily over 180 days
    }

    function getAPYRate365D() internal pure override returns (uint256) {
        return 1020000000000000000; // 2% daily over 365 days
    }

    // Staking Periods (Production mode: days)
    function getStakePeriod7D() internal pure override returns (uint256) {
        return 7 days;
    }

    function getStakePeriod30D() internal pure override returns (uint256) {
        return 30 days;
    }

    function getStakePeriod90D() internal pure override returns (uint256) {
        return 90 days;
    }

    function getStakePeriod180D() internal pure override returns (uint256) {
        return 180 days;
    }

    function getStakePeriod365D() internal pure override returns (uint256) {
        return 365 days;
    }

    // Team Thresholds (Production mode: V1..V9)
    function getTeamThresholdTier1() internal pure override returns (uint256) {
        return 3_000 ether; // V1
    }

    function getTeamThresholdTier2() internal pure override returns (uint256) {
        return 10_000 ether; // V2
    }

    function getTeamThresholdTier3() internal pure override returns (uint256) {
        return 30_000 ether; // V3
    }

    function getTeamThresholdTier4() internal pure override returns (uint256) {
        return 100_000 ether; // V4
    }

    function getTeamThresholdTier5() internal pure override returns (uint256) {
        return 300_000 ether; // V5
    }

    function getTeamThresholdTier6() internal pure override returns (uint256) {
        return 1_000_000 ether; // V6
    }

    function getTeamThresholdTier7() internal pure override returns (uint256) {
        return 3_000_000 ether; // V7
    }

    function getTeamThresholdTier8() internal pure override returns (uint256) {
        return 10_000_000 ether; // V8
    }

    function getTeamThresholdTier9() internal pure override returns (uint256) {
        return 30_000_000 ether; // V9
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
