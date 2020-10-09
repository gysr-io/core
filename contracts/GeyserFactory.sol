/*
Geyser Factory

This implements the Geyser factory contract which allows any user to
easily configure and deploy their own Geyser

https://github.com/gysr-io/core

SPDX-License-Identifier: MIT
*/

pragma solidity ^0.6.12;

import "./IGeyserFactory.sol";
import "./Geyser.sol";

contract GeyserFactory is IGeyserFactory {
    // fields
    mapping(address => bool) public map;
    address[] public list;
    address private _gysr;

    /**
     * @param gysr_ address of GYSR token
     */
    constructor(address gysr_) public {
        _gysr = gysr_;
    }

    /**
     * @inheritdoc IGeyserFactory
     */
    function create(
        address stakingToken,
        address rewardToken,
        uint256 bonusMin,
        uint256 bonusMax,
        uint256 bonusPeriod
    ) public override returns (address) {
        // create
        Geyser geyser = new Geyser(
            stakingToken,
            rewardToken,
            bonusMin,
            bonusMax,
            bonusPeriod,
            _gysr
        );
        geyser.transferOwnership(msg.sender);

        // bookkeeping
        map[address(geyser)] = true;
        list.push(address(geyser));

        // output
        emit GeyserCreated(msg.sender, address(geyser));
        return address(geyser);
    }

    /**
     * @return total number of Geysers created by the factory
     */
    function count() public view returns (uint256) {
        return list.length;
    }
}
