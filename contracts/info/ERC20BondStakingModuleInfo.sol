/*
ERC20BondStakingModuleInfo

https://github.com/gysr-io/core

SPDX-License-Identifier: MIT
*/

pragma solidity 0.8.18;

import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "../interfaces/IStakingModuleInfo.sol";
import "../interfaces/IStakingModule.sol";
import "../interfaces/IRewardModule.sol";
import "../interfaces/IPool.sol";
import "../ERC20BondStakingModule.sol";

/**
 * @title ERC20 bond staking module info library
 *
 * @notice this library provides read-only convenience functions to query
 * additional information about the ERC20BondStakingModule contract.
 */
library ERC20BondStakingModuleInfo {
    using Strings for uint256;
    using Strings for address;

    uint256 public constant MAX_BONDS = 128;

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
        IStakingModule m = IStakingModule(module);

        addresses_ = m.tokens();
        names_ = new string[](addresses_.length);
        symbols_ = new string[](addresses_.length);
        decimals_ = new uint8[](addresses_.length);

        for (uint256 i; i < addresses_.length; ++i) {
            IERC20Metadata tkn = IERC20Metadata(addresses_[i]);
            names_[i] = tkn.name();
            symbols_[i] = tkn.symbol();
            decimals_[i] = tkn.decimals();
        }
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
        ERC20BondStakingModule m = ERC20BondStakingModule(module);
        uint256 count = m.balanceOf(addr);
        if (count > MAX_BONDS) count = MAX_BONDS;

        accounts_ = new bytes32[](count);
        shares_ = new uint256[](count);

        for (uint256 i; i < count; ++i) {
            uint256 id = m.ownerBonds(addr, i);
            (, , , uint256 debt) = m.bonds(id);
            accounts_[i] = bytes32(id);
            shares_[i] = debt;
        }
    }

    // -- ERC20BondStakingModuleInfo ----------------------------------------------

    /**
     * @notice provide the metadata URI for a bond position
     * @param module address of bond staking module
     * @param id bond position identifier
     */
    function metadata(
        address module,
        uint256 id,
        bytes calldata
    ) external view returns (string memory) {
        ERC20BondStakingModule m = ERC20BondStakingModule(module);

        // get bond data
        (address market, uint64 timestamp, uint256 principal, uint256 debt) = m
            .bonds(id);
        IERC20Metadata stk = IERC20Metadata(market);
        require(timestamp > 0, "bsmi1");

        // try to get reward data
        address reward;
        try IRewardModule(IPool(m.owner()).rewardModule()).tokens() returns (
            address[] memory r
        ) {
            if (r.length == 1) reward = r[0];
        } catch {}

        // svg
        bytes memory svg = abi.encodePacked(
            '<svg width="512"',
            ' height="512"',
            ' fill="',
            "white", //fg,
            '" font-size="24"',
            ' font-family="Monospace"',
            ' xmlns="http://www.w3.org/2000/svg">',
            '<rect x="0" y="0" width="100%" height="100%" style="fill:',
            "#080C42", //bg,
            '"<svg/>'
        );
        svg = abi.encodePacked(
            svg,
            '<text font-size="100%" y="10%" x="5%">',
            reward == address(0) ? "" : IERC20Metadata(reward).symbol(),
            " Bond Position</text>",
            '<text font-size="80%" y="18%" x="5%">Bond ID: ',
            id.toString(),
            "</text>"
        );
        svg = abi.encodePacked(
            svg,
            '<text font-size="60%" y="25%" x="5%">Principal token: ',
            stk.name(),
            "</text>",
            '<text font-size="60%" y="30%" x="5%">Remaining principal: ',
            (principal / 10 ** stk.decimals()).toString(),
            "</text>",
            '<text font-size="60%" y="35%" x="5%">Outstanding debt shares: ',
            (debt / 10 ** stk.decimals()).toString(),
            "</text>"
        );
        if (reward != address(0)) {
            svg = abi.encodePacked(
                svg,
                '<text font-size="60%" y="40%" x="5%">Reward token: ',
                IERC20Metadata(reward).name(),
                "</text>"
            );
        }
        svg = abi.encodePacked(svg, "</svg>");

        // attributes
        bytes memory attrs = abi.encodePacked(
            '{"principal_address":"',
            market.toHexString(),
            '","reward_address":"',
            reward.toHexString(),
            '","timestamp":',
            uint256(timestamp).toString(),
            ',"principal_shares":',
            principal.toString(),
            ',"debt_shares":',
            debt.toString(),
            "}"
        );

        // assemble metadata
        bytes memory data = abi.encodePacked(
            '{"name":"',
            reward == address(0) ? "" : IERC20Metadata(reward).symbol(),
            " Bond Position: ",
            id.toString(),
            '","description":"Bond position that was purchased with ',
            stk.name(),
            " and pays out in ",
            reward == address(0) ? "" : IERC20Metadata(reward).name(),
            '. Powered by GYSR Protocol.","image":"data:image/svg+xml;base64,',
            Base64.encode(svg),
            '","attributes":',
            attrs,
            "}"
        );
        return
            string(
                abi.encodePacked(
                    "data:application/json;base64,",
                    Base64.encode(data)
                )
            );
    }

    /**
     * @notice quote the debt share values to be issued for an amount of tokens
     * @param module address of bond staking module
     * @param token address of market
     * @param amount number of tokens to be deposited
     */
    function quote(
        address module,
        address token,
        uint256 amount
    ) external view returns (uint256) {
        ERC20BondStakingModule m = ERC20BondStakingModule(module);

        // get market
        (
            uint256 mprice,
            uint256 mcoeff,
            uint256 mmax,
            uint256 mcapacity,
            uint256 mprincipal,
            ,
            uint256 mdebt,
            uint256 mupdated
        ) = m.markets(token);
        require(mcapacity > 0, "bsmi2");

        // principal shares
        uint256 principal;

        IERC20 tkn = IERC20(token);
        uint256 total = tkn.balanceOf(address(this));

        // get staking shares at current rate
        principal = (mprincipal > 0)
            ? (mprincipal * amount) / total
            : amount * m.INITIAL_SHARES_PER_TOKEN();

        // estimate debt decay
        uint256 elapsed = block.timestamp - mupdated;
        uint256 period = m.period();
        if (elapsed < period) {
            mdebt = mdebt - (mdebt * elapsed) / period; // approximation, exact value lower bound
        } else {
            mdebt = 0;
        }

        // debt pricing
        uint256 debt = (principal * 1e18) / (mprice + (mcoeff * mdebt) / 1e18);
        require(debt <= mmax, "bsm6");
        require(debt <= mcapacity, "bsm7");

        return debt;
    }

    /**
     * @notice preview amount of deposit to be returned for an unstake
     * @param module address of bond staking module
     * @param id bond position identifier
     * @param amount number of tokens to be unstaked
     */
    function returnable(
        address module,
        uint256 id,
        uint256 amount
    ) external view returns (uint256) {
        // TODO
        return 0;
    }
}
