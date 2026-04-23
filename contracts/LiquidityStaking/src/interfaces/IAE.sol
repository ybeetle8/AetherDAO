// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

/**
 * @title IAE
 * @notice Minimal interface for AE token contract used by LiquidityStaking
 */
interface IAE {
    function triggerFundRelayDistribution() external;
}
