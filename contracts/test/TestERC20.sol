// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title Test token
 * @dev basic ERC20 token for testing
 */
contract TestToken is ERC20 {
    uint256 _totalSupply = 50 * 10 ** 6 * 10 ** 18;

    constructor() ERC20("TestToken", "TKN") {
        _mint(msg.sender, _totalSupply);
    }
}

/**
 * @title Test liquidity token
 * @dev another basic ERC20 token for testing
 */
contract TestLiquidityToken is ERC20 {
    uint256 _totalSupply = 1 * 10 ** 6 * 10 ** 18;

    constructor() ERC20("TestLiquidityToken", "LP-TKN") {
        _mint(msg.sender, _totalSupply);
    }
}

/**
 * @title Test indivisible token
 * @dev test ERC20 token with no decimals
 */
contract TestIndivisibleToken is ERC20 {
    uint256 _totalSupply = 1000;

    constructor() ERC20("TestIndivisibleToken", "IND") {
        _mint(msg.sender, _totalSupply);
    }

    function decimals() public pure override returns (uint8) {
        return 0;
    }
}

/**
 * @title Test indivisible token
 * @dev test ERC20 token with parameterized
 */
contract TestTemplateToken is ERC20 {
    uint8 immutable _decimals;

    constructor(
        string memory name,
        string memory symbol,
        uint256 supply,
        uint8 decimals
    ) ERC20(name, symbol) {
        _mint(msg.sender, supply);
        _decimals = decimals;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}
