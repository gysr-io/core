/*
ERC20StakingModuleInfo

https://github.com/gysr-io/core

SPDX-License-Identifier: MIT
*/

pragma solidity 0.8.18;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "../interfaces/IStakingModuleInfo.sol";
import "../interfaces/IStakingModule.sol";
import "../ERC20StakingModule.sol";
import "./TokenUtilsInfo.sol";

/**
 * @title ERC20 staking module info library
 *
 * @notice this library provides read-only convenience functions to query
 * additional information about the ERC20StakingModule contract.
 */
library ERC20StakingModuleInfo {
    using TokenUtilsInfo for IERC20;

    // -- IStakingModuleInfo --------------------------------------------------

    /**
     * @notice convenience function to get all token metadata in a single call
     * @param module address of reward module
     * @return addresses_
     * @return names_
     * @return symbols_
     * @return decimals_
     */
    function tokens(
        address module
    )
        external
        view
        returns (
            address[] memory addresses_,
            string[] memory names_,
            string[] memory symbols_,
            uint8[] memory decimals_
        )
    {
        addresses_ = new address[](1);
        names_ = new string[](1);
        symbols_ = new string[](1);
        decimals_ = new uint8[](1);
        (addresses_[0], names_[0], symbols_[0], decimals_[0]) = token(module);
    }

    /**
     * @notice get all staking positions for user
     * @param module address of staking module
     * @param addr user address of interest
     * @param data additional encoded data
     * @return accounts_
     * @return shares_
     */
    function positions(
        address module,
        address addr,
        bytes calldata data
    )
        external
        view
        returns (bytes32[] memory accounts_, uint256[] memory shares_)
    {
        uint256 s = shares(module, addr, 0);
        if (s > 0) {
            accounts_ = new bytes32[](1);
            shares_ = new uint256[](1);
            accounts_[0] = bytes32(uint256(uint160(addr)));
            shares_[0] = s;
        }
    }

    // -- ERC20StakingModuleInfo ----------------------------------------------

    /**
     * @notice convenience function to get token metadata in a single call
     * @param module address of staking module
     * @return address
     * @return name
     * @return symbol
     * @return decimals
     */
    function token(
        address module
    ) public view returns (address, string memory, string memory, uint8) {
        IStakingModule m = IStakingModule(module);
        IERC20Metadata tkn = IERC20Metadata(m.tokens()[0]);
        return (address(tkn), tkn.name(), tkn.symbol(), tkn.decimals());
    }

    /**
     * @notice quote the share value for an amount of tokens
     * @param module address of staking module
     * @param addr account address of interest
     * @param amount number of tokens. if zero, return entire share balance
     * @return number of shares
     */
    function shares(
        address module,
        address addr,
        uint256 amount
    ) public view returns (uint256) {
        ERC20StakingModule m = ERC20StakingModule(module);

        // return all user shares
        if (amount == 0) {
            return m.shares(addr);
        }

        uint256 totalShares = m.totalShares();
        require(totalShares > 0, "smi1");

        // convert token amount to shares
        IERC20 tkn = IERC20(m.tokens()[0]);
        uint256 s = tkn.getShares(module, totalShares, amount);

        require(s > 0, "smi2");
        require(m.shares(addr) >= s, "smi3");

        return s;
    }

    /**
     * @notice get shares per token
     * @param module address of staking module
     * @return current shares per token
     */
    function sharesPerToken(address module) public view returns (uint256) {
        ERC20StakingModule m = ERC20StakingModule(module);

        uint256 totalShares = m.totalShares();
        if (totalShares == 0) {
            return 1e24;
        }

        IERC20 tkn = IERC20(m.tokens()[0]);
        return tkn.getShares(module, totalShares, 1e18);
    }
}
