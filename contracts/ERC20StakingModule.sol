/*
ERC20 Staking Module

This staking module allows users to deposit an amount of ERC20 token
in exchange for shares credited to their address. When the user
unstakes, these shares will be burned and a reward will be distributed.

SPDX-License-Identifier: MIT
*/

pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IStakingModule.sol";

contract ERC20StakingModule is IStakingModule {
    using SafeERC20 for IERC20;

    // constant
    uint256 public constant INITIAL_SHARES_PER_TOKEN = 10**6;

    // members
    IERC20 private immutable _token;
    address private immutable _factory;

    mapping(address => uint256) public shares;
    uint256 public totalShares;

    /**
     * @param token_ the token that will be rewarded
     */
    constructor(address token_, address factory_) {
        _token = IERC20(token_);
        _factory = factory_;
    }

    /**
     * @inheritdoc IStakingModule
     */
    function tokens() external view override returns (address[] memory) {
        address[] memory arr = new address[](1);
        arr[0] = address(_token);
        return arr;
    }

    /**
     * @inheritdoc IStakingModule
     */
    function balances(address user)
        external
        view
        override
        returns (uint256[] memory)
    {
        uint256[] memory arr = new uint256[](1);
        arr[0] = _balance(user);
        return arr;
    }

    /**
     * @inheritdoc IStakingModule
     */
    function factory() external view override returns (address) {
        return _factory;
    }

    /**
     * @inheritdoc IStakingModule
     */
    function totals() public view override returns (uint256[] memory) {
        uint256[] memory arr = new uint256[](1);
        arr[0] = _token.balanceOf(address(this));
        return arr;
    }

    /**
     * @inheritdoc IStakingModule
     */
    function stake(
        address user,
        uint256 amount,
        bytes calldata
    ) external override onlyOwner returns (address, uint256) {
        // validate
        require(amount > 0, "sm1");

        // transfer
        uint256 total = _token.balanceOf(address(this));
        _token.safeTransferFrom(user, address(this), amount);
        uint256 actual = _token.balanceOf(address(this)) - total;

        // mint staking shares at current rate
        uint256 minted =
            (totalShares > 0)
                ? (totalShares * actual) / total
                : actual * INITIAL_SHARES_PER_TOKEN;
        require(minted > 0, "sm2: stake amount too small");

        // update user staking info
        shares[user] += minted;

        // add newly minted shares to global total
        totalShares += minted;

        emit Staked(user, address(_token), amount, minted);

        return (user, minted);
    }

    /**
     * @inheritdoc IStakingModule
     */
    function unstake(
        address user,
        uint256 amount,
        bytes calldata
    ) external override onlyOwner returns (address, uint256) {
        // validate and get shares
        uint256 burned = _shares(user, amount);

        // unstake
        _token.safeTransfer(user, amount);

        // burn shares
        totalShares -= burned;
        shares[user] -= burned;

        emit Unstaked(user, address(_token), amount, burned);

        return (user, burned);
    }

    /**
     * @inheritdoc IStakingModule
     */
    function claim(
        address user,
        uint256 amount,
        bytes calldata
    ) external override onlyOwner returns (address, uint256) {
        uint256 s = _shares(user, amount);
        emit Claimed(user, address(_token), amount, s);
        return (user, s);
    }

    /**
     * @inheritdoc IStakingModule
     */
    function update(address) external override onlyOwner {}

    /**
     * @inheritdoc IStakingModule
     */
    function clean() external override onlyOwner {}

    /**
     * @dev internal helper to get user balance
     * @param user address of interest
     */
    function _balance(address user) private view returns (uint256) {
        if (totalShares == 0) {
            return 0;
        }
        return (_token.balanceOf(address(this)) * shares[user]) / totalShares;
    }

    /**
     * @dev internal helper to validate and convert user stake amount to shares
     * @param user address of user
     * @param amount number of tokens to consider
     * @return equivalent number of shares
     */
    function _shares(address user, uint256 amount)
        private
        view
        returns (uint256)
    {
        // validate
        require(amount > 0, "sm3");
        require(totalShares > 0, "sm4");

        // convert token amount to shares
        uint256 s = (totalShares * amount) / _token.balanceOf(address(this));

        require(s > 0, "sm5");
        require(shares[user] >= s, "sm6");

        return s;
    }
}
