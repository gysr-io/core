/*
Pool factory interface

This defines the Pool factory interface, primarily intended for
the Pool contract to interact with

https://github.com/gysr-io/core

SPDX-License-Identifier: MIT
*/

pragma solidity ^0.8.4;

interface IPoolFactory {
    /**
     * @return GYSR treasury address
     */
    function treasury() external view returns (address);

    /**
     * @return GYSR spending fee
     */
    function fee() external view returns (uint256);
}
