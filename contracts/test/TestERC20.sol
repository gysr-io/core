// SPDX-License-Identifier: MIT

pragma solidity ^0.6.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20 {
    uint256 DECIMALS = 18;
    uint256 _totalSupply = 50 * 10**6 * 10**DECIMALS;

    constructor() public ERC20("TestToken", "TKN") {
        _setupDecimals(uint8(DECIMALS));
        _mint(msg.sender, _totalSupply);
    }
}

contract TestLiquidityToken is ERC20 {
    uint256 DECIMALS = 18;
    uint256 _totalSupply = 1 * 10**6 * 10**DECIMALS;

    constructor() public ERC20("TestLiquidityToken", "LP-TKN") {
        _setupDecimals(uint8(DECIMALS));
        _mint(msg.sender, _totalSupply);
    }
}

contract TestIndivisibleToken is ERC20 {
    uint256 DECIMALS = 0;
    uint256 _totalSupply = 1000;

    constructor() public ERC20("TestIndivisibleToken", "IND") {
        _setupDecimals(uint8(DECIMALS));
        _mint(msg.sender, _totalSupply);
    }
}
