// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {OLABase} from "../abstract/OLABase.sol";

/**
 * @title OLA - Mainnet implementation of OLA token
 * @notice Production environment OLA token with mainnet-specific constants
 */
contract OLA is OLABase {
    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    constructor(
        address _usdt,
        address _router,
        address _staking,
        address _marketingAddress
    ) OLABase(_usdt, _router, _staking, _marketingAddress) {}

    // =========================================================================
    // ENVIRONMENT SPECIFIC CONSTANTS - MAINNET VALUES
    // =========================================================================

    // Delayed buy period - 30 days for mainnet
    function getDelayedBuyPeriod() internal pure override returns (uint256) {
        return 30 days;
    }

    // Presale duration - 30 days for mainnet
    function getPresaleDuration() internal pure override returns (uint256) {
        return 30 days;
    }
}
