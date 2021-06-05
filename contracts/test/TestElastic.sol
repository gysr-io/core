// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title Test elastic token
 * @dev mocked up elastic supply token
 */
contract TestElasticToken is ERC20 {
    uint256 _totalSupply = 50 * 10**6 * 10**18;

    uint256 private _coeff;

    constructor() ERC20("TestElasticToken", "ELASTIC") {
        _coeff = 1.0 * 10**18;
        _mint(msg.sender, 10 * 10**6 * 10**18);
    }

    // read current coefficient
    function getCoefficient() public view returns (uint256) {
        return _coeff;
    }

    // set new value for coefficient
    function setCoefficient(uint256 coeff) public {
        _coeff = coeff;
    }

    // wrap to adjust for coefficient
    function totalSupply() public view override returns (uint256) {
        return (super.totalSupply() * _coeff) / 1e18;
    }

    // wrap to adjust for coefficient
    function balanceOf(address account) public view override returns (uint256) {
        return (super.balanceOf(account) * _coeff) / 1e18;
    }

    // wrap to adjust for inverse of coefficient
    function transfer(address recipient, uint256 amount)
        public
        virtual
        override
        returns (bool)
    {
        return super.transfer(recipient, (amount * 1e18) / _coeff);
    }

    // wrap to adjust for coefficient
    function allowance(address owner, address spender)
        public
        view
        virtual
        override
        returns (uint256)
    {
        return (_coeff * allowance(owner, spender)) / 1e18;
    }

    // wrap to adjust for inverse of coefficient
    function approve(address spender, uint256 amount)
        public
        virtual
        override
        returns (bool)
    {
        return super.approve(spender, (amount * 1e18) / _coeff);
    }

    // wrap to adjust for inverse of coefficient
    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public virtual override returns (bool) {
        return super.transferFrom(sender, recipient, (amount * 1e18) / _coeff);
    }

    // wrap to adjust for inverse of coefficient
    function increaseAllowance(address spender, uint256 addedValue)
        public
        virtual
        override
        returns (bool)
    {
        return super.increaseAllowance(spender, (addedValue * 1e18) / _coeff);
    }

    // wrap to adjust for inverse of coefficient
    function decreaseAllowance(address spender, uint256 subtractedValue)
        public
        virtual
        override
        returns (bool)
    {
        return
            super.decreaseAllowance(spender, (subtractedValue * 1e18) / _coeff);
    }
}
