/*
Test contract for GYSR utilities

https://github.com/gysr-io/core

SPDX-License-Identifier: MIT
*/

pragma solidity 0.8.4;

import "../GysrUtils.sol";

/**
 * @title Test GYSR utilities
 * @dev simple wrapper contract to test GYSR library utilities
 */
contract TestGysrUtils {
    using GysrUtils for uint256;

    // dummy event
    event Test(uint256 x);

    // read only function to test GYSR bonus calculation
    function testGysrBonus(
        uint256 gysr,
        uint256 amount,
        uint256 total,
        uint256 ratio
    ) public pure returns (uint256) {
        return gysr.gysrBonus(amount, total, ratio);
    }

    // write function to test GYSR bonus as part of a transaction
    function testEventGysrBonus(
        uint256 gysr,
        uint256 amount,
        uint256 total,
        uint256 ratio
    ) external returns (uint256) {
        uint256 bonus = gysr.gysrBonus(amount, total, ratio);
        emit Test(bonus);
        return bonus;
    }
}
