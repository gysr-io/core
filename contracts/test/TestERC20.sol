// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20 {
    uint256 _totalSupply = 50 * 10**6 * 10**18;

    constructor() ERC20("TestToken", "TKN") {
        _mint(msg.sender, _totalSupply);
    }
}

contract TestLiquidityToken is ERC20 {
    uint256 _totalSupply = 1 * 10**6 * 10**18;

    constructor() ERC20("TestLiquidityToken", "LP-TKN") {
        _mint(msg.sender, _totalSupply);
    }
}

contract TestIndivisibleToken is ERC20 {
    uint256 _totalSupply = 1000;

    constructor() ERC20("TestIndivisibleToken", "IND") {
        _mint(msg.sender, _totalSupply);
    }

    function decimals() public pure override returns (uint8) {
        return 0;
    }
}
