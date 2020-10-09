/*
Staking interface

EIP-900 staking interface

https://github.com/gysr-io/core

h/t https://github.com/ethereum/EIPs/blob/master/EIPS/eip-900.md

SPDX-License-Identifier: MIT
*/

pragma solidity ^0.6.12;

interface IStaking {
    // events
    event Staked(
        address indexed user,
        uint256 amount,
        uint256 total,
        bytes data
    );
    event Unstaked(
        address indexed user,
        uint256 amount,
        uint256 total,
        bytes data
    );

    /**
     * @notice stakes a certain amount of tokens, transferring this amount from
     the user to the contract
     * @param amount number of tokens to stake
     */
    function stake(uint256 amount, bytes calldata) external;

    /**
     * @notice stakes a certain amount of tokens for an address, transfering this
     amount from the caller to the contract, on behalf of the specified address
     * @param user beneficiary address
     * @param amount number of tokens to stake
     */
    function stakeFor(
        address user,
        uint256 amount,
        bytes calldata
    ) external;

    /**
     * @notice unstakes a certain amount of tokens, returning these tokens
     to the user
     * @param amount number of tokens to unstake
     */
    function unstake(uint256 amount, bytes calldata) external;

    /**
     * @param addr the address of interest
     * @return the current total of tokens staked for an address
     */
    function totalStakedFor(address addr) external view returns (uint256);

    /**
     * @return the current total amount of tokens staked by all users
     */
    function totalStaked() external view returns (uint256);

    /**
     * @return the staking token for this staking contract
     */
    function token() external view returns (address);

    /**
     * @return true if the staking contract support history
     */
    function supportsHistory() external pure returns (bool);
}
