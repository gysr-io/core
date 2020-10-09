/*
Geyser factory interface

This defines the Geyser factory interface

https://github.com/gysr-io/core

SPDX-License-Identifier: MIT
*/

pragma solidity ^0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IGeyserFactory {
    // events
    event GeyserCreated(address indexed user, address geyser);

    /**
     * @notice create a new Geyser
     * @param stakingToken the token that will be staked
     * @param rewardToken the token distributed to users as they unstake
     * @param bonusMin minimum time bonus
     * @param bonusMax maximum time bonus
     * @param bonusPeriod period (in seconds) over which time bonus grows to max
     */
    function create(
        address stakingToken,
        address rewardToken,
        uint256 bonusMin,
        uint256 bonusMax,
        uint256 bonusPeriod
    ) external returns (address);
}
