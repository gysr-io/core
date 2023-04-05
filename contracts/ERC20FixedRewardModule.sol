/*
ERC20FixedRewardModule

https://github.com/gysr-io/core

SPDX-License-Identifier: MIT
*/

pragma solidity 0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IRewardModule.sol";
import "./interfaces/IConfiguration.sol";
import "./OwnerController.sol";
import "./TokenUtils.sol";

/**
 * @title ERC20 fixed reward module
 *
 * @notice this reward module distributes a fixed amount of a single ERC20 token.
 *
 * @dev the fixed reward module provides a guarantee that some amount of tokens
 * will be earned over a specified time period. This can be used to create
 * incentive mechanisms such as bond sales, fixed duration payroll, and more.
 */
contract ERC20FixedRewardModule is IRewardModule, OwnerController {
    using SafeERC20 for IERC20;
    using TokenUtils for IERC20;

    // user position
    struct Position {
        uint256 shares;
        uint256 vested;
        uint256 earned;
        uint128 timestamp;
        uint128 updated;
    }

    // configuration fields
    uint256 public immutable period;
    uint256 public immutable rate;
    IERC20 private immutable _token;
    address private immutable _factory;
    IConfiguration private immutable _config;

    // state fields
    mapping(bytes32 => Position) public positions;
    uint256 public rewards;
    uint256 public debt;

    /**
     * @param token_ the token that will be rewarded
     * @param period_ time period (seconds)
     * @param rate_ constant reward rate (shares / share second)
     * @param config_ address for configuration contract
     * @param factory_ address of module factory
     */
    constructor(
        address token_,
        uint256 period_,
        uint256 rate_,
        address config_,
        address factory_
    ) {
        require(token_ != address(0));
        require(period_ > 0, "xrm1");
        require(rate_ > 0, "xrm2");

        _token = IERC20(token_);
        _config = IConfiguration(config_);
        _factory = factory_;

        period = period_;
        rate = rate_;
    }

    // -- IRewardModule -------------------------------------------------------

    /**
     * @inheritdoc IRewardModule
     */
    function tokens()
        external
        view
        override
        returns (address[] memory tokens_)
    {
        tokens_ = new address[](1);
        tokens_[0] = address(_token);
    }

    /**
     * @inheritdoc IRewardModule
     */
    function balances()
        external
        view
        override
        returns (uint256[] memory balances_)
    {
        balances_ = new uint256[](1);
        if (rewards > 0) {
            balances_[0] =
                (_token.balanceOf(address(this)) * (rewards - debt)) /
                rewards;
        }
    }

    /**
     * @inheritdoc IRewardModule
     */
    function usage() external pure override returns (uint256) {
        return 0;
    }

    /**
     * @inheritdoc IRewardModule
     */
    function factory() external view override returns (address) {
        return _factory;
    }

    /**
     * @inheritdoc IRewardModule
     *
     * @dev additional stake will bookmark earnings and rollover remainder to new unvested position
     */
    function stake(
        bytes32 account,
        address,
        uint256 shares,
        bytes calldata
    ) external override onlyOwner returns (uint256, uint256) {
        uint256 reward = (shares * rate) / 1e18;
        require(reward <= rewards - debt, "xrm3");

        Position storage pos = positions[account];
        uint256 s = pos.shares;
        if (s > 0) {
            uint256 dt = (
                block.timestamp < pos.timestamp + period
                    ? block.timestamp
                    : pos.timestamp + period
            ) - pos.updated;
            uint256 vested = pos.vested;
            pos.earned += ((((s - vested) * dt) / period) * rate) / 1e18;
            pos.vested = vested + ((s - vested) * dt) / period;
        }
        pos.shares = s + shares;
        pos.timestamp = uint128(block.timestamp);
        pos.updated = uint128(block.timestamp);

        debt += reward;
        return (0, 0);
    }

    /**
     * @inheritdoc IRewardModule
     */
    function unstake(
        bytes32 account,
        address,
        address receiver,
        uint256 shares,
        bytes calldata
    ) external override onlyOwner returns (uint256, uint256) {
        Position storage pos = positions[account];
        uint256 s = pos.shares;
        assert(shares <= s); // note: we assume shares has been validated upstream
        require(pos.timestamp < block.timestamp);

        // get all pending rewards
        uint256 updated = pos.updated;
        uint256 end = pos.timestamp + period;
        uint256 dt = (block.timestamp < end ? block.timestamp : end) - updated;
        uint256 r = pos.earned +
            ((((s - pos.vested) * dt) / period) * rate) /
            1e18;

        // remove any lost unvested debt
        if (block.timestamp < end) {
            uint256 unvested = shares < pos.vested ? 0 : shares - pos.vested;
            uint256 remaining = end - block.timestamp;
            debt -= (((unvested * remaining) / period) * rate) / 1e18;
        }
        // TODO rework debt decrease math here for precision

        // update user position
        if (shares < s) {
            pos.shares = s - shares;
            if (shares < pos.vested) {
                pos.vested -= shares;
            } else {
                pos.vested = 0;
            }
            pos.updated = uint128(updated + dt);
            pos.earned = 0;
        } else {
            delete positions[account];
        }

        // distribute rewards
        if (r > 0) {
            _distribute(receiver, r);
        }

        return (0, 0);
    }

    /**
     * @inheritdoc IRewardModule
     */
    function claim(
        bytes32 account,
        address,
        address receiver,
        uint256,
        bytes calldata
    ) external override onlyOwner returns (uint256, uint256) {
        // get all pending rewards
        Position storage pos = positions[account];
        uint256 updated = pos.updated;
        uint256 end = pos.timestamp + period;
        uint256 dt = (block.timestamp < end ? block.timestamp : end) - updated;
        uint256 r = pos.earned +
            ((((pos.shares - pos.vested) * dt) / period) * rate) /
            1e18;

        // update user position
        pos.updated = uint128(updated + dt);
        pos.earned = 0;

        // distribute rewards
        if (r > 0) {
            _distribute(receiver, r);
        }

        return (0, 0);
    }

    /**
     * @inheritdoc IRewardModule
     */
    function update(bytes32, address, bytes calldata) external override {}

    /**
     * @inheritdoc IRewardModule
     */
    function clean(bytes calldata) external override {}

    // -- ERC20FixedRewardModule ----------------------------------------

    /**
     * @notice fund module by depositing reward tokens
     * @dev this is a public method callable by any account or contract
     * @param amount number of reward tokens to deposit
     */
    function fund(uint256 amount) external {
        require(amount > 0, "xrm4");

        // get fees
        (address receiver, uint256 feeRate) = _config.getAddressUint96(
            keccak256("gysr.core.fixed.fund.fee")
        );

        // do funding transfer, fee processing, and reward shares accounting
        uint256 minted = _token.receiveWithFee(
            rewards,
            msg.sender,
            amount,
            receiver,
            feeRate
        );
        rewards += minted;

        emit RewardsFunded(address(_token), amount, minted, block.timestamp);
    }

    /**
     * @notice withdraw uncommitted reward tokens from module
     * @param amount number of reward tokens to withdraw
     */
    function withdraw(uint256 amount) external {
        requireController();

        // validate excess budget
        require(amount > 0, "xrm5");
        require(amount <= _token.balanceOf(address(this)), "xrm6");
        uint256 shares = _token.getShares(rewards, amount);
        require(shares <= rewards - debt, "xrm7");

        // withdraw
        rewards -= shares;
        _token.safeTransfer(msg.sender, amount);
        emit RewardsWithdrawn(address(_token), amount, shares, block.timestamp);
    }

    // -- ERC20FixedRewardModule internal -------------------------------

    /**
     * @dev internal method to distribute rewards
     * @param user address of user
     * @param shares number of shares burned
     */
    function _distribute(address user, uint256 shares) private {
        // compute reward amount in tokens
        uint256 amount = _token.getAmount(rewards, shares);

        // update overall reward shares
        rewards -= shares;
        debt -= shares;

        // do reward
        _token.safeTransfer(user, amount);
        emit RewardsDistributed(user, address(_token), amount, shares);
    }
}
