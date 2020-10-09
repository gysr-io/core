// SPDX-License-Identifier: MIT

pragma solidity ^0.6.12;

import "@openzeppelin/contracts/GSN/Context.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Address.sol";

/**
 * @dev This is a copy of the OpenZeppelin ERC20 contract, modified to mock up
 * an elastic supply token.
 *
 * This copy is only needed because certain critical functions are not marked
 * virtual and therefore cannot be overriden.
 *
 * Original contract here:
 * https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC20/ERC20.sol
 */
contract TestElasticToken is Context, IERC20 {
    using SafeMath for uint256;
    using Address for address;

    mapping(address => uint256) private _balances;

    mapping(address => mapping(address => uint256)) private _allowances;

    uint256 private _totalSupply;
    uint256 private _coeff;

    string private _name;
    string private _symbol;
    uint8 private _decimals;

    constructor() public {
        _name = "TestElasticToken";
        _symbol = "ELASTIC";
        _decimals = 18;
        _coeff = 1.0 * 10**uint256(_decimals);
        _mint(msg.sender, 10 * 10**6 * 10**uint256(_decimals));
    }

    function name() public view returns (string memory) {
        return _name;
    }

    function symbol() public view returns (string memory) {
        return _symbol;
    }

    function decimals() public view returns (uint8) {
        return _decimals;
    }

    // read current coefficient
    function getCoefficient() public view returns (uint256) {
        return _coeff;
    }

    // set new value for coefficient
    function setCoefficient(uint256 coeff) public {
        _coeff = coeff;
    }

    // modified to adjust for coefficient
    function totalSupply() public override view returns (uint256) {
        return _totalSupply.mul(_coeff).div(10**uint256(_decimals));
    }

    // modified to adjust for coefficient
    function balanceOf(address account) public override view returns (uint256) {
        return _balances[account].mul(_coeff).div(10**uint256(_decimals));
    }

    // modified to adjust for inverse of coefficient
    function transfer(address recipient, uint256 amount)
        public
        virtual
        override
        returns (bool)
    {
        _transfer(
            _msgSender(),
            recipient,
            amount.mul(10**uint256(_decimals)).div(_coeff)
        );
        return true;
    }

    // modified to adjust for coefficient
    function allowance(address owner, address spender)
        public
        virtual
        override
        view
        returns (uint256)
    {
        return
            _allowances[owner][spender].mul(_coeff).div(10**uint256(_decimals));
    }

    // modified to adjust for inverse of coefficient
    function approve(address spender, uint256 amount)
        public
        virtual
        override
        returns (bool)
    {
        _approve(
            _msgSender(),
            spender,
            amount.mul(10**uint256(_decimals)).div(_coeff)
        );
        return true;
    }

    // modified to adjust for inverse of coefficient
    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public virtual override returns (bool) {
        amount = amount.mul(10**uint256(_decimals)).div(_coeff);
        _transfer(sender, recipient, amount);
        _approve(
            sender,
            _msgSender(),
            _allowances[sender][_msgSender()].sub(
                amount,
                "ERC20: transfer amount exceeds allowance"
            )
        );
        return true;
    }

    // modified to adjust for inverse of coefficient
    function increaseAllowance(address spender, uint256 addedValue)
        public
        virtual
        returns (bool)
    {
        _approve(
            _msgSender(),
            spender,
            _allowances[_msgSender()][spender].add(
                addedValue.mul(10**uint256(_decimals)).div(_coeff)
            )
        );
        return true;
    }

    // modified to adjust for inverse of coefficient
    function decreaseAllowance(address spender, uint256 subtractedValue)
        public
        virtual
        returns (bool)
    {
        _approve(
            _msgSender(),
            spender,
            _allowances[_msgSender()][spender].sub(
                subtractedValue.mul(10**uint256(_decimals)).div(_coeff),
                "ERC20: decreased allowance below zero"
            )
        );
        return true;
    }

    function _transfer(
        address sender,
        address recipient,
        uint256 amount
    ) internal virtual {
        require(sender != address(0), "ERC20: transfer from the zero address");
        require(recipient != address(0), "ERC20: transfer to the zero address");

        _beforeTokenTransfer(sender, recipient, amount);

        _balances[sender] = _balances[sender].sub(
            amount,
            "ERC20: transfer amount exceeds balance"
        );
        _balances[recipient] = _balances[recipient].add(amount);
        emit Transfer(sender, recipient, amount);
    }

    function _mint(address account, uint256 amount) internal virtual {
        require(account != address(0), "ERC20: mint to the zero address");

        _beforeTokenTransfer(address(0), account, amount);

        _totalSupply = _totalSupply.add(amount);
        _balances[account] = _balances[account].add(amount);
        emit Transfer(address(0), account, amount);
    }

    function _burn(address account, uint256 amount) internal virtual {
        require(account != address(0), "ERC20: burn from the zero address");

        _beforeTokenTransfer(account, address(0), amount);

        _balances[account] = _balances[account].sub(
            amount,
            "ERC20: burn amount exceeds balance"
        );
        _totalSupply = _totalSupply.sub(amount);
        emit Transfer(account, address(0), amount);
    }

    function _approve(
        address owner,
        address spender,
        uint256 amount
    ) internal virtual {
        require(owner != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");

        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }

    function _setupDecimals(uint8 decimals_) internal {
        _decimals = decimals_;
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual {}
}
