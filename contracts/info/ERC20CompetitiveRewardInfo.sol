/*
Info library for the ERC20 Competitive Reward Module

https://github.com/gysr-io/core

SPDX-License-Identifier: MIT
*/

pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "../interfaces/IRewardModule.sol";
import "../ERC20CompetitiveRewardModule.sol";
import "../GysrUtils.sol";

library ERC20CompetitiveRewardInfo {
    using GysrUtils for uint256;

    /**
     * @notice convenience function to get token metadata in a single call
     * @param module address of reward module
     * @return name
     * @return symbol
     * @return decimals
     */
    function token(address module)
        public
        view
        returns (
            string memory,
            string memory,
            uint8
        )
    {
        IRewardModule m = IRewardModule(module);
        IERC20Metadata tkn = IERC20Metadata(m.tokens()[0]);
        return (tkn.name(), tkn.symbol(), tkn.decimals());
    }

    /**
     * @notice preview estimated rewards
     * @param module address of reward module
     * @param addr account address of interest for preview
     * @param shares number of shares that would be unstaked
     * @param gysr number of GYSR tokens that would be applied
     * @return estimated reward
     * @return estimated time multiplier
     * @return estimated gysr multiplier
     */
    function rewards(
        address module,
        address addr,
        uint256 shares,
        uint256 gysr
    )
        public
        view
        returns (
            uint256,
            uint256,
            uint256
        )
    {
        ERC20CompetitiveRewardModule m = ERC20CompetitiveRewardModule(module);

        // get associated share seconds
        uint256 rawShareSeconds;
        uint256 bonusShareSeconds;
        (rawShareSeconds, bonusShareSeconds) = userShareSeconds(
            module,
            addr,
            shares
        );
        uint256 timeBonus = (bonusShareSeconds * 1e18) / rawShareSeconds;

        // apply gysr bonus
        uint256 gysrBonus =
            gysr.gysrBonus(shares, m.totalStakingShares(), m.usage());
        bonusShareSeconds = (gysrBonus * bonusShareSeconds) / 1e18;

        // compute rewards based on expected updates
        uint256 reward =
            (unlocked(module) * bonusShareSeconds) /
                (totalShareSeconds(module) +
                    bonusShareSeconds -
                    rawShareSeconds);

        return (reward, timeBonus, gysrBonus);
    }

    /**
     * @notice compute effective unlocked rewards
     * @param module address of reward module
     * @return estimated current unlocked rewards
     */
    function unlocked(address module) public view returns (uint256) {
        ERC20CompetitiveRewardModule m = ERC20CompetitiveRewardModule(module);

        // compute expected updates to global totals
        uint256 deltaUnlocked = 0;
        address tkn = m.tokens()[0];
        uint256 totalLockedShares = m.lockedShares(tkn);
        if (totalLockedShares != 0) {
            uint256 sharesToUnlock = 0;
            for (uint256 i = 0; i < m.fundingCount(tkn); i++) {
                sharesToUnlock = sharesToUnlock + m.unlockable(tkn, i);
            }
            deltaUnlocked =
                (sharesToUnlock * m.totalLocked()) /
                totalLockedShares;
        }
        return m.totalUnlocked() + deltaUnlocked;
    }

    /**
     * @notice compute user share seconds for given number of shares
     * @param module module contract address
     * @param addr user address
     * @param shares number of shares
     * @return raw share seconds
     * @return time bonus share seconds
     */
    function userShareSeconds(
        address module,
        address addr,
        uint256 shares
    ) public view returns (uint256, uint256) {
        ERC20CompetitiveRewardModule m = ERC20CompetitiveRewardModule(module);

        uint256 rawShareSeconds = 0;
        uint256 timeBonusShareSeconds = 0;

        // compute first-in-last-out, time bonus weighted, share seconds
        uint256 i = m.stakeCount(addr) - 1;
        while (shares > 0) {
            uint256 s;
            uint256 time;
            (s, time) = m.stakes(addr, i);
            time = block.timestamp - time;

            if (s < shares) {
                rawShareSeconds = rawShareSeconds + (s * time);
                timeBonusShareSeconds =
                    timeBonusShareSeconds +
                    ((s * time * m.timeBonus(time)) / 1e18);
                shares = shares - s;
            } else {
                rawShareSeconds = rawShareSeconds + (shares * time);
                timeBonusShareSeconds =
                    timeBonusShareSeconds +
                    ((shares * time * m.timeBonus(time)) / 1e18);
                break;
            }
            // this will throw on underflow
            i = i - 1;
        }
        return (rawShareSeconds, timeBonusShareSeconds);
    }

    /**
     * @notice compute total expected share seconds for a rewards module
     * @param module address for reward module
     * @return expected total shares seconds
     */
    function totalShareSeconds(address module) public view returns (uint256) {
        ERC20CompetitiveRewardModule m = ERC20CompetitiveRewardModule(module);

        return
            m.totalStakingShareSeconds() +
            (block.timestamp - m.lastUpdated()) *
            m.totalStakingShares();
    }
}
