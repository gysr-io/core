// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IPool.sol";

/**
 * @title Test stake-unstake contract
 * @dev mocked up flashloan attack to manipulate GYSR bonus usage
 */
contract TestStakeUnstake {
    event UsageCheck(uint256 timestamp, uint256 usage, uint256 balance);

    address private _pool;

    function target(address pool_) external {
        _pool = pool_;
        IPool pool = IPool(_pool);
        IERC20 tkn = IERC20(pool.stakingTokens()[0]);
        tkn.approve(pool.stakingModule(), 10**36);
    }

    function deposit(address token, uint256 amount) external {
        IERC20 tkn = IERC20(token);
        tkn.transferFrom(msg.sender, address(this), amount);
    }

    function withdraw(address token, uint256 amount) external {
        IERC20 tkn = IERC20(token);
        tkn.transfer(msg.sender, amount);
    }

    function execute(uint256 amount) external {
        IPool pool = IPool(_pool);
        emit UsageCheck(block.timestamp, pool.usage(), pool.stakingTotals()[0]);
        // <take out flash loan>
        pool.stake(amount, "", "");
        emit UsageCheck(block.timestamp, pool.usage(), pool.stakingTotals()[0]);
        // <trigger stake on another account>
        pool.unstake(amount, "", "");
        // <return flash loan>
        emit UsageCheck(block.timestamp, pool.usage(), pool.stakingTotals()[0]);
    }
}
