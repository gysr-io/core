/*
Geyser token pool

Simple contract to implement token pool of arbitrary ERC20 token.
This is owned and used by a parent Geyser

https://github.com/gysr-io/core

h/t https://github.com/ampleforth/token-geyser

SPDX-License-Identifier: MIT
*/

pragma solidity ^0.6.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

contract GeyserPool is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public token;

    constructor(address token_) public {
        token = IERC20(token_);
    }

    function balance() public view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function transfer(address to, uint256 value) external onlyOwner {
        token.safeTransfer(to, value);
    }
}
