/*
ERC20 Competitive Reward Module

h/t https://github.com/ampleforth/token-geyser

SPDX-License-Identifier: MIT
*/

pragma solidity ^0.8.4;

import "./interfaces/IRewardModule.sol";
import "./ERC20BaseRewardModule.sol";
import "./GysrUtils.sol";

contract ERC20CompetitiveRewardModule is ERC20BaseRewardModule {
    using SafeERC20 for IERC20;
    using GysrUtils for uint256;

    // single stake by user
    struct Stake {
        uint256 shares;
        uint256 timestamp;
    }

    mapping(address => Stake[]) public stakes;

    // configuration fields
    uint256 public immutable bonusMin;
    uint256 public immutable bonusMax;
    uint256 public immutable bonusPeriod;
    IERC20 private immutable _token;
    address private immutable _factory;

    // global state fields
    uint256 public totalStakingShares;
    uint256 public totalStakingShareSeconds;
    uint256 private _usage;

    /**
     * @param token_ the token that will be rewarded
     * @param bonusMin_ initial time bonus
     * @param bonusMax_ maximum time bonus
     * @param bonusPeriod_ period (in seconds) over which time bonus grows to max
     * @param factory_ address of module factory
     */
    constructor(
        address token_,
        uint256 bonusMin_,
        uint256 bonusMax_,
        uint256 bonusPeriod_,
        address factory_
    ) {
        require(bonusMin_ <= bonusMax_, "crm1");

        _token = IERC20(token_);
        _factory = factory_;

        bonusMin = bonusMin_;
        bonusMax = bonusMax_;
        bonusPeriod = bonusPeriod_;

        lastUpdated = block.timestamp;
    }

    // -- IRewardModule -------------------------------------------------------

    /**
     * @inheritdoc IRewardModule
     */
    function tokens() external view override returns (address[] memory) {
        address[] memory arr = new address[](1);
        arr[0] = address(_token);
        return arr;
    }

    /**
     * @inheritdoc IRewardModule
     */
    function balances() public view override returns (uint256[] memory) {
        uint256[] memory arr = new uint256[](1);
        arr[0] = totalLocked();
        return arr;
    }

    /**
     * @inheritdoc IRewardModule
     */
    function usage() external view override returns (uint256) {
        return _usage;
    }

    /**
     * @inheritdoc IRewardModule
     */
    function factory() external view override returns (address) {
        return _factory;
    }

    /**
     * @inheritdoc IRewardModule
     */
    function stake(
        address account,
        address,
        uint256 shares,
        bytes calldata
    ) external override onlyOwner returns (uint256, uint256) {
        _update();
        _stake(account, shares);
        return (0, 0);
    }

    /**
     * @inheritdoc IRewardModule
     */
    function unstake(
        address account,
        address user,
        uint256 shares,
        bytes calldata data
    ) external override onlyOwner returns (uint256, uint256) {
        _update();
        return _unstake(account, user, shares, data);
    }

    /**
     * @inheritdoc IRewardModule
     */
    function claim(
        address account,
        address user,
        uint256 shares,
        bytes calldata data
    ) external override onlyOwner returns (uint256, uint256) {
        _update();
        uint256 spent;
        uint256 vested;
        (spent, vested) = _unstake(account, user, shares, data);
        _stake(account, shares);
        return (spent, vested);
    }

    /**
     * @inheritdoc IRewardModule
     */
    function update(address) external override onlyOwner {
        _update();
    }

    /**
     * @inheritdoc IRewardModule
     */
    function clean() external override onlyOwner {
        _update();
        _clean(address(_token));
    }

    // -- ERC20CompetitiveRewardModule ----------------------------------------

    /**
     * @notice fund module by locking up reward tokens for distribution
     * @param amount number of reward tokens to lock up as funding
     * @param duration period (seconds) over which funding will be unlocked
     */
    function fund(uint256 amount, uint256 duration) external {
        _update();
        _fund(address(_token), amount, duration, block.timestamp);
    }

    /**
     * @notice fund module by locking up reward tokens for distribution
     * @param amount number of reward tokens to lock up as funding
     * @param duration period (seconds) over which funding will be unlocked
     * @param start time (seconds) at which funding begins to unlock
     */
    function fund(
        uint256 amount,
        uint256 duration,
        uint256 start
    ) external {
        _update();
        _fund(address(_token), amount, duration, start);
    }

    /**
     * @notice compute time bonus earned as a function of staking time
     * @param time length of time for which the tokens have been staked
     * @return bonus multiplier for time
     */
    function timeBonus(uint256 time) public view returns (uint256) {
        if (time >= bonusPeriod) {
            return 10**DECIMALS + bonusMax;
        }

        // linearly interpolate between bonus min and bonus max
        uint256 bonus = bonusMin + ((bonusMax - bonusMin) * time) / bonusPeriod;
        return 10**DECIMALS + bonus;
    }

    /**
     * @return total number of locked reward tokens
     */
    function totalLocked() public view returns (uint256) {
        if (lockedShares(address(_token)) == 0) {
            return 0;
        }
        return
            (_token.balanceOf(address(this)) * lockedShares(address(_token))) /
            totalShares(address(_token));
    }

    /**
     * @return total number of unlocked reward tokens
     */
    function totalUnlocked() public view returns (uint256) {
        uint256 unlockedShares =
            totalShares(address(_token)) - lockedShares(address(_token));

        if (unlockedShares == 0) {
            return 0;
        }
        return
            (_token.balanceOf(address(this)) * unlockedShares) /
            totalShares(address(_token));
    }

    /**
     * @param addr address of interest
     * @return number of active stakes for user
     */
    function stakeCount(address addr) public view returns (uint256) {
        return stakes[addr].length;
    }

    // -- ERC20CompetitiveRewardModule internal -------------------------------

    /**
     * @dev internal implementation of stake method
     * @param account address of staking account
     * @param shares number of shares burned
     */
    function _stake(address account, uint256 shares) private {
        // update user staking info
        stakes[account].push(Stake(shares, block.timestamp));

        // add newly minted shares to global total
        totalStakingShares += shares;
    }

    /**
     * @dev internal implementation of unstake method
     * @param account address of staking account
     * @param user address of user
     * @param shares number of shares burned
     * @param data additional data
     * @return amount of gysr spent
     * @return amount of gysr vested
     */
    function _unstake(
        address account,
        address user,
        uint256 shares,
        bytes calldata data
    ) private returns (uint256, uint256) {
        // validate
        // note: we assume shares has been validated upstream
        require(data.length == 0 || data.length == 32, "crm2");

        // parse GYSR amount from data
        uint256 gysr = 0;
        if (data.length == 32) {
            assembly {
                gysr := calldataload(164)
            }
        }

        uint256 bonus = gysr.gysrBonus(shares, totalStakingShares, _usage);

        // do unstaking, first-in last-out, respecting time bonus
        uint256 shareSeconds;
        uint256 timeWeightedShareSeconds;
        (shareSeconds, timeWeightedShareSeconds) = _unstakeFirstInLastOut(
            account,
            shares
        );

        // compute and apply GYSR token bonus
        uint256 gysrWeightedShareSeconds =
            (bonus * timeWeightedShareSeconds) / 10**DECIMALS;

        // get reward in shares
        uint256 unlockedShares =
            totalShares(address(_token)) - lockedShares(address(_token));

        uint256 rewardShares =
            (unlockedShares * gysrWeightedShareSeconds) /
                (totalStakingShareSeconds + gysrWeightedShareSeconds);

        // reward
        if (rewardShares > 0) {
            _distribute(user, address(_token), rewardShares);

            // update usage
            uint256 ratio;
            if (gysr > 0) {
                emit GysrSpent(user, gysr);
                emit GysrVested(user, gysr);
                ratio = ((bonus - 10**DECIMALS) * 10**DECIMALS) / bonus;
            }
            uint256 weight =
                (shareSeconds * 10**DECIMALS) /
                    (totalStakingShareSeconds + shareSeconds);
            _usage =
                _usage -
                (weight * _usage) /
                10**DECIMALS +
                (weight * ratio) /
                10**DECIMALS;
        }

        return (gysr, gysr);
    }

    /**
     * @dev internal implementation of update method to
     * unlock tokens and do global accounting
     */
    function _update() private {
        _unlockTokens(address(_token));

        // global accounting
        totalStakingShareSeconds +=
            (block.timestamp - lastUpdated) *
            totalStakingShares;
        lastUpdated = block.timestamp;
    }

    /**
     * @dev helper function to actually execute unstaking, first-in last-out, 
     while computing and applying time bonus. This function also updates
     user and global totals for shares and share-seconds.
     * @param user address of user
     * @param shares number of staking shares to burn
     * @return raw share seconds burned
     * @return time bonus weighted share seconds
     */
    function _unstakeFirstInLastOut(address user, uint256 shares)
        private
        returns (uint256, uint256)
    {
        // redeem from most recent stake and go backwards in time.
        uint256 shareSecondsToBurn = 0;
        uint256 sharesLeftToBurn = shares;
        uint256 bonusWeightedShareSeconds = 0;
        Stake[] storage userStakes = stakes[user];
        while (sharesLeftToBurn > 0) {
            Stake storage lastStake = userStakes[userStakes.length - 1];
            uint256 stakeTime = block.timestamp - lastStake.timestamp;

            uint256 bonus = timeBonus(stakeTime);

            if (lastStake.shares <= sharesLeftToBurn) {
                // fully redeem a past stake
                bonusWeightedShareSeconds +=
                    (lastStake.shares * stakeTime * bonus) /
                    10**DECIMALS;
                shareSecondsToBurn += lastStake.shares * stakeTime;
                sharesLeftToBurn -= lastStake.shares;
                userStakes.pop();
            } else {
                // partially redeem a past stake
                bonusWeightedShareSeconds +=
                    (sharesLeftToBurn * stakeTime * bonus) /
                    10**DECIMALS;
                shareSecondsToBurn += sharesLeftToBurn * stakeTime;
                lastStake.shares -= sharesLeftToBurn;
                sharesLeftToBurn = 0;
            }
        }

        // update global totals
        totalStakingShareSeconds -= shareSecondsToBurn;
        totalStakingShares -= shares;

        return (shareSecondsToBurn, bonusWeightedShareSeconds);
    }
}
