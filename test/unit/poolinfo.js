// test module for PoolInfo contract

const { artifacts, web3 } = require('hardhat');
const { BN, time, expectRevert } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const {
  tokens,
  bonus,
  days,
  shares,
  e6,
  bytes32,
  DECIMALS,
} = require('../util/helper');

const Pool = artifacts.require('Pool');
const ERC20StakingModule = artifacts.require('ERC20StakingModule');
const ERC721StakingModule = artifacts.require('ERC721StakingModule');

const ERC20StakingModuleInfo = artifacts.require('ERC20StakingModuleInfo');
const ERC721StakingModuleInfo = artifacts.require('ERC721StakingModuleInfo');
const ERC20CompetitiveRewardModule = artifacts.require('ERC20CompetitiveRewardModule');
const ERC20CompetitiveRewardModuleInfo = artifacts.require('ERC20CompetitiveRewardModuleInfo');
const ERC20FriendlyRewardModuleInfo = artifacts.require('ERC20FriendlyRewardModuleInfo');
const ERC20FriendlyRewardModule = artifacts.require('ERC20FriendlyRewardModule');

const PoolFactory = artifacts.require('PoolFactory');
const GeyserToken = artifacts.require('GeyserToken');
const Configuration = artifacts.require('Configuration');
const PoolInfo = artifacts.require('PoolInfo');
const TestToken = artifacts.require('TestToken');
const TestLiquidityToken = artifacts.require('TestLiquidityToken');
const TestERC721 = artifacts.require('TestERC721');

describe('PoolInfo', function () {
  let
    owner,
    org,
    treasury,
    erc20stakingFactory,
    erc721stakingFactory,
    competitiveFactory,
    friendlyFactory,
    alice,
    bob,
    other;
  before(async function () {
    [
      owner,
      org,
      treasury,
      erc20stakingFactory,
      erc721stakingFactory,
      competitiveFactory,
      friendlyFactory,
      alice,
      bob,
      other,
    ] = await web3.eth.getAccounts();
  });


  beforeEach('setup', async function () {
    // base setup
    this.gysr = await GeyserToken.new({ from: org });
    this.config = await Configuration.new({ from: org });
    this.factory = await PoolFactory.new(this.gysr.address, treasury, { from: org });
    this.rew = await TestToken.new({ from: org });
    this.stk = await TestLiquidityToken.new({ from: org });
    this.info = await PoolInfo.new({ from: org });
    this.erc20stakingmoduleinfo = await ERC20StakingModuleInfo.new({ from: org });
    this.erc721stakingmoduleinfo = await ERC721StakingModuleInfo.new({ from: org });
    this.erc20friendlyrewardmoduleinfo = await ERC20FriendlyRewardModuleInfo.new({ from: org });
    this.erc20competitiverewardmoduleinfo = await ERC20CompetitiveRewardModuleInfo.new({ from: org });

    // staking module
    this.staking = await ERC20StakingModule.new(
      this.stk.address,
      erc20stakingFactory,
      { from: owner }
    );

    // reward module
    this.reward = await ERC20CompetitiveRewardModule.new(
      this.rew.address,
      bonus(0.5),
      bonus(2.0),
      days(90),
      this.config.address,
      competitiveFactory,
      { from: owner }
    );

    // create pool
    this.pool = await Pool.new(
      this.staking.address,
      this.reward.address,
      this.gysr.address,
      this.config.address,
      { from: owner }
    );
    await this.staking.transferOwnership(this.pool.address, { from: owner });
    await this.reward.transferOwnership(this.pool.address, { from: owner });

    // register module types with info libraries
    await this.info.register(erc20stakingFactory, this.erc20stakingmoduleinfo.address, { from: org });
    await this.info.register(erc721stakingFactory, this.erc721stakingmoduleinfo.address, { from: org });
    await this.info.register(competitiveFactory, this.erc20competitiverewardmoduleinfo.address, { from: org });
    await this.info.register(friendlyFactory, this.erc20friendlyrewardmoduleinfo.address, { from: org });
  });

  describe('when getting module info', function () {
    beforeEach(async function () {
      this.res = await this.info.modules(this.pool.address);
    });

    it('should return staking module address as first argument', async function () {
      expect(this.res[0]).to.equal(this.staking.address);
    });

    it('should return reward module address as second argument', async function () {
      expect(this.res[1]).to.equal(this.reward.address);
    });

    it('should return staking module factory address (i.e. module type) as third argument', async function () {
      expect(this.res[2]).to.equal(erc20stakingFactory);
    });

    it('should return reward module factory address (i.e. module type) as fourth argument', async function () {
      expect(this.res[3]).to.equal(competitiveFactory);
    });
  });

  describe('when user has 0 shares', function () {
    beforeEach(async function () {
      this.res = await this.info.rewards(this.pool.address, alice, [], []);
    });

    it('should return zero', async function () {
      expect(this.res[0]).to.be.bignumber.equal(new BN(0));
    });
  });

  describe('when previewing rewards for ERC20CompetitiveRewardModule', function () {
    beforeEach(async function () {
      // acquire staking tokens and approval
      await this.stk.transfer(alice, tokens(1000), { from: org });
      await this.stk.approve(this.staking.address, tokens(100000), { from: alice });

      // owner funds module
      await this.rew.transfer(owner, tokens(10000), { from: org });
      await this.rew.approve(this.reward.address, tokens(100000), { from: owner });
      await this.reward.methods['fund(uint256,uint256)'](
        tokens(1000),
        days(200),
        { from: owner }
      );

      // alice stakes 100 tokens
      await this.pool.stake(tokens(100), [], [], { from: alice });

      // advance time
      await time.increase(days(30));
    });

    it('should return expected reward amount', async function () {
      const rewards = await this.info.rewards(this.pool.address, alice, [], []);
      const preview = await this.erc20competitiverewardmoduleinfo.preview(
        this.reward.address,
        bytes32(alice),
        shares(100),
        0
      );
      expect(rewards[0]).to.be.bignumber.equal(preview[0]);
    });
  });


  describe('when previewing rewards for ERC20FriendlyRewardModule', function () {
    beforeEach(async function () {
      // staking module
      this.staking = await ERC20StakingModule.new(
        this.stk.address,
        erc20stakingFactory,
        { from: owner }
      );

      // reward module 
      this.reward = await ERC20FriendlyRewardModule.new(
        this.rew.address,
        bonus(0.0),
        days(0),
        this.config.address,
        friendlyFactory,
        { from: owner }
      );

      // create pool
      this.pool = await Pool.new(
        this.staking.address,
        this.reward.address,
        this.gysr.address,
        this.config.address,
        { from: owner }
      );
      await this.staking.transferOwnership(this.pool.address, { from: owner });
      await this.reward.transferOwnership(this.pool.address, { from: owner });

      // acquire staking tokens and approval
      await this.stk.transfer(alice, tokens(1000), { from: org });
      await this.stk.approve(this.staking.address, tokens(100000), { from: alice });

      // owner funds module
      await this.rew.transfer(owner, tokens(10000), { from: org });
      await this.rew.approve(this.reward.address, tokens(100000), { from: owner });
      await this.reward.methods['fund(uint256,uint256)'](
        tokens(1000),
        days(200),
        { from: owner }
      );

      // alice stakes 100 tokens
      await this.pool.stake(tokens(100), [], [], { from: alice });

      // advance time
      await time.increase(days(30));
    });

    it('should return expected reward amount', async function () {
      const rewards = await this.info.rewards(this.pool.address, alice, [], []);
      const preview = await this.erc20friendlyrewardmoduleinfo.preview(
        this.reward.address,
        bytes32(alice),
        shares(100)
      );
      expect(rewards[0]).to.be.bignumber.equal(preview[0]);
    });
  });


  describe('when previewing rewards with ERC721StakingModule', function () {
    beforeEach(async function () {
      // staking module
      this.stk = await TestERC721.new({ from: org });
      this.staking = await ERC721StakingModule.new(
        this.stk.address,
        erc721stakingFactory,
        { from: owner }
      );

      // reward module
      this.reward = await ERC20CompetitiveRewardModule.new(
        this.rew.address,
        bonus(0.5),
        bonus(2.0),
        days(90),
        this.config.address,
        competitiveFactory,
        { from: owner }
      );

      // create pool
      this.pool = await Pool.new(
        this.staking.address,
        this.reward.address,
        this.gysr.address,
        this.factory.address,
        { from: owner }
      );
      await this.staking.transferOwnership(this.pool.address, { from: owner });
      await this.reward.transferOwnership(this.pool.address, { from: owner });

      // claim tokens and do approval
      await this.stk.mint(10, { from: alice });
      await this.stk.setApprovalForAll(this.staking.address, true, { from: alice });

      // owner funds module
      await this.rew.transfer(owner, tokens(10000), { from: org });
      await this.rew.approve(this.reward.address, tokens(100000), { from: owner });
      await this.reward.methods['fund(uint256,uint256)'](
        tokens(1000),
        days(200),
        { from: owner }
      );

      // alice stakes 3 nfts
      const data0 = web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256'], [1, 2, 8]);
      this.res0 = await this.pool.stake(3, data0, [], { from: alice });

      // advance time
      await time.increase(days(30));
    });

    it('should return expected reward amount', async function () {
      const rewards = await this.info.rewards(this.pool.address, alice, [], []);
      const preview = await this.erc20competitiverewardmoduleinfo.preview(
        this.reward.address,
        bytes32(alice),
        e6(3),
        0
      );
      expect(rewards[0]).to.be.bignumber.equal(preview[0]);
    });
  });


  describe('when non controller tries to register a module', function () {
    it('should fail', async function () {
      await expectRevert(
        this.info.register(competitiveFactory, other, { from: alice }),
        'oc2' // OwnerController: caller is not the controller
      );
    });
  });

  describe('when controller registers a module', function () {
    beforeEach(async function () {
      await this.info.register(competitiveFactory, other, { from: org });
    });

    it('should update mapping to info library', async function () {
      expect(await this.info.registry(competitiveFactory)).to.equal(other);
    });
  });

});
