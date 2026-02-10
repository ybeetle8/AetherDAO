// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {AEBase} from "../abstract/AEBase.sol";

/**
 * @title AE - Mainnet implementation of AE token
 * @notice Production environment AE token with mainnet-specific constants
 */
contract AE is AEBase {
    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    constructor(
        address _usdt,
        address _router,
        address _staking,
        address _marketingAddress,
        address _buyTaxNodeRewardAddress,
        address _buyTaxCommunityRewardAddress
    ) AEBase(_usdt, _router, _staking, _marketingAddress, _buyTaxNodeRewardAddress, _buyTaxCommunityRewardAddress) {}

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
