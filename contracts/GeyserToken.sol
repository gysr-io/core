/*
Geyser token

Simple ERC20 compliant contract to implement GYSR token

https://github.com/gysr-io/core

SPDX-License-Identifier: MIT
*/

pragma solidity ^0.6.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract GeyserToken is ERC20 {
    uint256 DECIMALS = 18;
    uint256 _totalSupply = 10 * 10**6 * 10**DECIMALS;

    constructor() public ERC20("Geyser", "GYSR") {
        _setupDecimals(uint8(DECIMALS));
        _mint(msg.sender, _totalSupply);
    }
}
