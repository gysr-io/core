/*
GeyserToken

https://github.com/gysr-io/core

SPDX-License-Identifier: MIT
*/

pragma solidity 0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title GYSR token
 *
 * @notice simple ERC20 compliant contract to implement GYSR token
 */
contract GeyserToken is ERC20 {
    uint256 DECIMALS = 18;
    uint256 TOTAL_SUPPLY = 10 * 10**6 * 10**DECIMALS;

    constructor() ERC20("Geyser", "GYSR") {
        _mint(msg.sender, TOTAL_SUPPLY);
    }
}
