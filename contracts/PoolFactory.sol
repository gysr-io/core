/*
Pool Factory

This implements the Pool factory contract which allows any user to
easily configure and deploy their own Pool

https://github.com/gysr-io/core

SPDX-License-Identifier: MIT
*/

pragma solidity ^0.8.4;

import "./interfaces/IPoolFactory.sol";
import "./interfaces/IModuleFactory.sol";
import "./interfaces/IStakingModule.sol";
import "./interfaces/IRewardModule.sol";
import "./OwnerController.sol";
import "./Pool.sol";

contract PoolFactory is IPoolFactory, OwnerController {
    // events
    event PoolCreated(address indexed user, address pool);
    event FeeUpdated(uint256 previous, uint256 updated);
    event TreasuryUpdated(address previous, address updated);
    event WhitelistUpdated(
        address indexed factory,
        uint256 previous,
        uint256 updated
    );

    // types
    enum ModuleFactoryType {Unknown, Staking, Reward}

    // constants
    uint256 public constant MAX_FEE = 20 * 10**16; // 20%

    // fields
    mapping(address => bool) public map;
    address[] public list;
    address private _gysr;
    address private _treasury;
    uint256 private _fee;
    mapping(address => ModuleFactoryType) public whitelist;

    /**
     * @param gysr_ address of GYSR token
     */
    constructor(address gysr_, address treasury_) {
        _gysr = gysr_;
        _treasury = treasury_;
        _fee = MAX_FEE;
    }

    /**
     * @notice create a new Pool
     * @param staking address of factory that will be used to create staking module
     * @param reward address of factory that will be used to create reward module
     * @param stakingdata construction data for staking module factory
     * @param rewarddata construction data for reward module factory
     * @return address of newly created Pool
     */
    function create(
        address staking,
        address reward,
        bytes calldata stakingdata,
        bytes calldata rewarddata
    ) external returns (address) {
        // validate
        require(whitelist[staking] == ModuleFactoryType.Staking, "f1");
        require(whitelist[reward] == ModuleFactoryType.Reward, "f2");

        // create modules
        address stakingModule =
            IModuleFactory(staking).createModule(stakingdata);
        address rewardModule = IModuleFactory(reward).createModule(rewarddata);

        // create pool
        Pool pool = new Pool(stakingModule, rewardModule, _gysr, address(this));

        // set access
        pool.transferOwnership(msg.sender);
        IStakingModule(stakingModule).transferControl(msg.sender);
        IStakingModule(stakingModule).transferOwnership(address(pool));
        IRewardModule(rewardModule).transferControl(msg.sender);
        IRewardModule(rewardModule).transferOwnership(address(pool));

        // bookkeeping
        map[address(pool)] = true;
        list.push(address(pool));

        // output
        emit PoolCreated(msg.sender, address(pool));
        return address(pool);
    }

    /**
     * @inheritdoc IPoolFactory
     */
    function treasury() external view override returns (address) {
        return _treasury;
    }

    /**
     * @inheritdoc IPoolFactory
     */
    function fee() external view override returns (uint256) {
        return _fee;
    }

    /**
     * @notice update the GYSR treasury address
     * @param treasury_ new value for treasury address
     */
    function setTreasury(address treasury_) external {
        requireController();
        emit TreasuryUpdated(_treasury, treasury_);
        _treasury = treasury_;
    }

    /**
     * @notice update the global GYSR spending fee
     * @param fee_ new value for GYSR spending fee
     */
    function setFee(uint256 fee_) external {
        requireController();
        require(fee_ <= MAX_FEE, "f3");
        emit FeeUpdated(_fee, fee_);
        _fee = fee_;
    }

    /**
     * @notice set the whitelist status of a module factory
     * @param factory_ address of module factory
     * @param type_ updated whitelist status for module
     */
    function setWhitelist(address factory_, uint256 type_) external {
        requireController();
        require(type_ <= uint256(ModuleFactoryType.Reward), "f4");
        emit WhitelistUpdated(factory_, uint256(whitelist[factory_]), type_);
        whitelist[factory_] = ModuleFactoryType(type_);
    }

    /**
     * @return total number of Pools created by the factory
     */
    function count() public view returns (uint256) {
        return list.length;
    }
}
