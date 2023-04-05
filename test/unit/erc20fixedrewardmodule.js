// unit tests for ERC20FixedRewardModule

const { artifacts, web3 } = require('hardhat');
const { BN, time, expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const {
  tokens,
  e18,
  days,
  shares,
  bytes32,
  toFixedPointBigNumber,
  fromFixedPointBigNumber,
  setupTime,
  DECIMALS
} = require('../util/helper');

const ERC20FixedRewardModule = artifacts.require('ERC20FixedRewardModule');
const TestToken = artifacts.require('TestToken');
const TestElasticToken = artifacts.require('TestElasticToken')
const TestFeeToken = artifacts.require('TestFeeToken');
const Configuration = artifacts.require('Configuration');

// need decent tolerance to account for potential timing error
const TOKEN_DELTA = toFixedPointBigNumber(0.001, 10, DECIMALS);
const SHARE_DELTA = toFixedPointBigNumber(0.001 * (10 ** 6), 10, DECIMALS);
const BONUS_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);


describe('ERC20FixedRewardModule', function () {
  let org, owner, alice, bob, charlie, other, factory;
  before(async function () {
    [org, owner, alice, bob, charlie, other, factory] = await web3.eth.getAccounts();
  });

  beforeEach('setup', async function () {
    this.token = await TestToken.new({ from: org });
    this.elastic = await TestElasticToken.new({ from: org });
    this.feeToken = await TestFeeToken.new({ from: org });
    this.config = await Configuration.new({ from: org });
  });

  describe('construction', function () {

    describe('when period is zero', function () {
      it('should fail to construct', async function () {
        await expectRevert(
          ERC20FixedRewardModule.new(
            this.token.address,
            days(0),
            e18(0.0001),
            this.config.address,
            factory,
            { from: owner }
          ),
          'xrm1'
        )
      });
    });

    describe('when rate is zero', function () {
      it('should fail to construct', async function () {
        await expectRevert(
          ERC20FixedRewardModule.new(
            this.token.address,
            days(30),
            e18(0),
            this.config.address,
            factory,
            { from: owner }
          ),
          'xrm2'
        )
      });
    });

    describe('when initialized', function () {
      beforeEach(async function () {
        this.module = await ERC20FixedRewardModule.new(
          this.token.address,
          days(30),
          e18(1),
          this.config.address,
          factory,
          { from: owner }
        );
      });

      it('should create an ERC20FixedRewardModule object', async function () {
        expect(this.module).to.be.an('object');
        expect(this.module.constructor.name).to.be.equal('TruffleContract');
      });

      it('should set owner as sender', async function () {
        expect(await this.module.owner()).to.equal(owner);
      });

      it('should set token address', async function () {
        expect((await this.module.tokens())[0]).to.equal(this.token.address);
      });

      it('should set factory address', async function () {
        expect(await this.module.factory()).to.equal(factory);
      });

      it('should set vesting period', async function () {
        expect(await this.module.period()).to.be.bignumber.equal(days(30));
      });

      it('should set fixed reward rate', async function () {
        expect(await this.module.rate()).to.be.bignumber.equal(e18(1));
      });

      it('should have zero reward budget', async function () {
        expect((await this.module.balances())[0]).to.be.bignumber.equal(new BN(0));
      });

      it('should always return a zero GYSR usage ratio', async function () {
        expect(await this.module.usage()).to.be.bignumber.equal(new BN(0));
      });
    })
  });


  describe('fund', function () {

    beforeEach(async function () {
      // owner creates module
      this.module = await ERC20FixedRewardModule.new(
        this.token.address,
        days(30),
        e18(1),
        this.config.address,
        factory,
        { from: owner }
      );
    });

    describe('when amount is zero', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.fund(tokens(0), { from: owner }),
          'xrm4'
        )
      });
    });

    describe('when token transfer not approved', function () {
      it('should fail', async function () {
        await this.token.transfer(owner, tokens(10000), { from: org });
        await expectRevert(
          this.module.fund(tokens(1000), { from: owner }),
          'ERC20: insufficient allowance'
        )
      });
    });

    describe('when amount exceeds sender balance', function () {
      it('should fail', async function () {
        await this.token.transfer(owner, tokens(10000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: owner });
        await expectRevert(
          this.module.fund(tokens(12000), { from: owner }),
          'ERC20: transfer amount exceeds balance'
        )
      });
    });

    describe('when funded', function () {

      beforeEach(async function () {
        // owner funds module
        await this.token.transfer(owner, tokens(10000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: owner });
        this.res = await this.module.fund(tokens(1000), { from: owner });
      });

      it('should increase module token balance', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.equal(tokens(1000));
      });

      it('should decrease user token balance', async function () {
        expect(await this.token.balanceOf(owner)).to.be.bignumber.equal(tokens(9000));
      });

      it('should increase reward balance', async function () {
        expect((await this.module.balances())[0]).to.be.bignumber.equal(tokens(1000));
      });

      it('should increase reward shares', async function () {
        expect(await this.module.rewards()).to.be.bignumber.equal(shares(1000));
      });

      it('should emit RewardsFunded', async function () {
        expectEvent(
          this.res,
          'RewardsFunded',
          { token: this.token.address, amount: tokens(1000), shares: shares(1000) }
        );
      });

    });

    describe('when funded by non controller', function () {

      beforeEach(async function () {
        // owner funds module
        await this.token.transfer(alice, tokens(5000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: alice });
        this.res = await this.module.fund(tokens(456), { from: alice });
      });

      it('should increase module token balance', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.equal(tokens(456));
      });

      it('should decrease caller token balance', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(tokens(4544));
      });

      it('should increase reward balance', async function () {
        expect((await this.module.balances())[0]).to.be.bignumber.equal(tokens(456));
      });

      it('should increase reward shares', async function () {
        expect(await this.module.rewards()).to.be.bignumber.equal(shares(456));
      });

      it('should emit RewardsFunded', async function () {
        expectEvent(
          this.res,
          'RewardsFunded',
          { token: this.token.address, amount: tokens(456), shares: shares(456) }
        );
      });

    });

  });


  describe('stake', function () {

    beforeEach(async function () {
      // owner creates module
      this.module = await ERC20FixedRewardModule.new(
        this.token.address,
        days(10),
        e18(1),
        this.config.address,
        factory,
        { from: owner }
      );

      // owner funds module
      await this.token.transfer(owner, tokens(10000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.fund(tokens(1000), { from: owner });
      await time.increase(days(1));
    });

    describe('when stake exceeds budget', function () {
      it('should revert', async function () {
        await expectRevert(
          this.module.stake(bytes32(bob), bob, shares(1001), [], { from: owner }),
          'xrm3'
        )
      });
    });

    describe('when stake exceeds budget due to existing obligation', function () {
      it('should revert', async function () {
        await this.module.stake(bytes32(alice), alice, shares(500), [], { from: owner });
        await expectRevert(
          this.module.stake(bytes32(bob), bob, shares(600), [], { from: owner }),
          'xrm3'
        )
      });
    });

    describe('when one user stakes', function () {

      beforeEach(async function () {
        // create stake for alice with 200 token reward
        this.res = await this.module.stake(bytes32(alice), alice, shares(200), [], { from: owner });
        this.t0 = (await this.module.positions(bytes32(alice))).timestamp;
      });

      it('should increase total reward debt', async function () {
        expect(await this.module.debt()).to.be.bignumber.equal(shares(200));
      });

      it('should decrease available reward balance', async function () {
        expect((await this.module.balances())[0]).to.be.bignumber.equal(tokens(800));
      });

      it('should create user position stake', async function () {
        const pos = await this.module.positions(bytes32(alice));
        expect(pos.shares).to.be.bignumber.equal(shares(200));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(this.t0);
        expect(pos.updated).to.be.bignumber.equal(this.t0);
      });

    });

    describe('when multiple users stake', function () {

      beforeEach(async function () {
        // create stake for alice with 200 token reward
        this.res0 = await this.module.stake(bytes32(alice), alice, shares(200), [], { from: owner });
        this.t0 = (await this.module.positions(bytes32(alice))).timestamp;

        // create stake for bob with 100 token reward
        this.res1 = await this.module.stake(bytes32(bob), bob, shares(100), [], { from: owner });
        this.t1 = (await this.module.positions(bytes32(bob))).timestamp;
      });

      it('should increase total reward debt', async function () {
        expect(await this.module.debt()).to.be.bignumber.equal(shares(300));
      });

      it('should decrease available reward balance', async function () {
        expect((await this.module.balances())[0]).to.be.bignumber.equal(tokens(700));
      });

      it('should create alice position stake', async function () {
        const pos = await this.module.positions(bytes32(alice));
        expect(pos.shares).to.be.bignumber.equal(shares(200));
        expect(pos.vested).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(this.t0);
        expect(pos.updated).to.be.bignumber.equal(this.t0);
      });

      it('should create bob position stake', async function () {
        const pos = await this.module.positions(bytes32(bob));
        expect(pos.shares).to.be.bignumber.equal(shares(100));
        expect(pos.vested).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(this.t1);
        expect(pos.updated).to.be.bignumber.equal(this.t1);
      });

    });

    describe('when one user stakes multiple times', function () {

      beforeEach(async function () {
        // create stake for alice with 200 token reward
        this.res0 = await this.module.stake(bytes32(alice), alice, shares(200), [], { from: owner });
        this.t0 = (await this.module.positions(bytes32(alice))).timestamp;
        await setupTime(this.t0, days(1));

        // increase stake for alice by 50 tokens
        this.res0 = await this.module.stake(bytes32(alice), alice, shares(50), [], { from: owner });
        this.t1 = (await this.module.positions(bytes32(alice))).timestamp;
      });

      it('should increase total reward debt', async function () {
        expect(await this.module.debt()).to.be.bignumber.equal(shares(250));
      });

      it('should decrease available reward balance', async function () {
        expect((await this.module.balances())[0]).to.be.bignumber.equal(tokens(750));
      });

      it('should increase and update user position', async function () {
        const pos = await this.module.positions(bytes32(alice));
        expect(pos.shares).to.be.bignumber.equal(shares(250));
        expect(pos.vested).to.be.bignumber.equal(shares(20));
        expect(pos.earned).to.be.bignumber.equal(shares(20));
        expect(pos.timestamp).to.be.bignumber.equal(this.t1);
        expect(pos.updated).to.be.bignumber.equal(this.t1);
      });

    });

    describe('when one user stakes again after fully vested', function () {

      beforeEach(async function () {
        // create stake for alice with 125 token reward
        this.res0 = await this.module.stake(bytes32(alice), alice, shares(125), [], { from: owner });
        this.t0 = (await this.module.positions(bytes32(alice))).timestamp;
        await setupTime(this.t0, days(20));

        // increase stake for alice by 75 tokens
        this.res0 = await this.module.stake(bytes32(alice), alice, shares(75), [], { from: owner });
        this.t1 = (await this.module.positions(bytes32(alice))).timestamp;
      });

      it('should increase total reward debt', async function () {
        expect(await this.module.debt()).to.be.bignumber.equal(shares(200));
      });

      it('should decrease available reward balance', async function () {
        expect((await this.module.balances())[0]).to.be.bignumber.equal(tokens(800));
      });

      it('should increase and update user position', async function () {
        const pos = await this.module.positions(bytes32(alice));
        expect(pos.shares).to.be.bignumber.equal(shares(200));
        expect(pos.vested).to.be.bignumber.equal(shares(125));
        expect(pos.earned).to.be.bignumber.equal(shares(125));
        expect(pos.timestamp).to.be.bignumber.equal(this.t1);
        expect(pos.updated).to.be.bignumber.equal(this.t1);
      });

    });

  });


  describe('unstake', function () {

    beforeEach(async function () {
      // owner creates module
      this.module = await ERC20FixedRewardModule.new(
        this.token.address,
        days(10),
        e18(1),
        this.config.address,
        factory,
        { from: owner }
      );

      // owner funds module
      await this.token.transfer(owner, tokens(10000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.fund(tokens(1000), { from: owner });
      await time.increase(days(1));

      // create stake for alice with 200 token reward
      await this.module.stake(bytes32(alice), alice, shares(200), [], { from: owner });
      this.t0 = (await this.module.positions(bytes32(alice))).timestamp;

      // create stake for bob with 100 token reward
      await setupTime(this.t0, days(2));
      await this.module.stake(bytes32(bob), bob, shares(100), [], { from: owner });
      this.t1 = (await this.module.positions(bytes32(bob))).timestamp;

      // create new stake for alice with 50 token reward, rollover 40 unvested from original position
      await setupTime(this.t0, days(8));
      await this.module.stake(bytes32(alice), alice, shares(50), [], { from: owner });
      this.t2 = (await this.module.positions(bytes32(alice))).timestamp;
    });

    describe('when one user unstakes all', function () {

      beforeEach(async function () {
        // alice unstakes all
        await setupTime(this.t0, days(13));
        this.res = await this.module.unstake(bytes32(alice), alice, alice, shares(250), [], { from: owner });
        // reward: 0.8 * 200 + 0.5 * (50 + 40) = 205
      });

      it('should delete user position', async function () {
        const pos = await this.module.positions(bytes32(alice));
        expect(pos.shares).to.be.bignumber.equal(new BN(0));
        expect(pos.vested).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(new BN(0));
        expect(pos.updated).to.be.bignumber.equal(new BN(0));
      });

      it('should decrease total debt', async function () {
        expect(await this.module.debt()).to.be.bignumber.equal(shares(100));
      });

      it('should increase available reward balance by unvested amount', async function () {
        expect((await this.module.balances())[0]).to.be.bignumber.closeTo(tokens(695), TOKEN_DELTA);
      });

      it('should decrease reward shares', async function () {
        expect(await this.module.rewards()).to.be.bignumber.closeTo(shares(795), SHARE_DELTA);
      });

      it('should decrease module reward token balance', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.closeTo(tokens(795), TOKEN_DELTA);
      });

      it('should increase user reward token balance', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(tokens(205), TOKEN_DELTA);
      });

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(205), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(205), SHARE_DELTA);
      });

    });

    describe('when one user unstakes some', function () {

      beforeEach(async function () {
        // alice unstakes some
        await setupTime(this.t0, days(13));
        this.res = await this.module.unstake(bytes32(alice), alice, alice, shares(100), [], { from: owner });
        this.t3 = (await this.module.positions(bytes32(alice))).updated;
        // reward: 0.8 * 200 + 0.5 * (50 + 40) = 205
        // vested: 160 - 100 = 60
      });

      it('should decrease and update user position', async function () {
        const pos = await this.module.positions(bytes32(alice));
        expect(pos.shares).to.be.bignumber.equal(shares(150));
        expect(pos.vested).to.be.bignumber.equal(shares(60));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(this.t2);
        expect(pos.updated).to.be.bignumber.equal(this.t3);
      });

      it('should increment updated timestamp on user position', async function () {
        const pos = await this.module.positions(bytes32(alice));
        expect(pos.updated.sub(pos.timestamp)).to.be.bignumber.closeTo(days(5), new BN(1));
      });

      it('should decrease total debt', async function () {
        expect(await this.module.debt()).to.be.bignumber.closeTo(shares(145), SHARE_DELTA);
      });

      it('should not affect available reward balance', async function () {
        expect((await this.module.balances())[0]).to.be.bignumber.closeTo(tokens(650), TOKEN_DELTA);
      });

      it('should decrease reward shares', async function () {
        expect(await this.module.rewards()).to.be.bignumber.closeTo(shares(795), SHARE_DELTA);
      });

      it('should decrease module reward token balance', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.closeTo(tokens(795), TOKEN_DELTA);
      });

      it('should increase user reward token balance', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(tokens(205), TOKEN_DELTA);
      });

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(205), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(205), SHARE_DELTA);
      });

    });

    describe('when one user unstakes multiple times', function () {

      beforeEach(async function () {
        // alice unstakes some
        await setupTime(this.t0, days(13));
        this.res0 = await this.module.unstake(bytes32(alice), alice, alice, shares(100), [], { from: owner });
        this.t3 = (await this.module.positions(bytes32(alice))).updated;
        // reward: 0.8 * 200 + 0.5 * (50 + 40) = 205
        // vested: 160 - 100 = 60

        // alice unstakes more
        await setupTime(this.t0, days(15));
        this.res1 = await this.module.unstake(bytes32(alice), alice, alice, shares(80), [], { from: owner });
        this.t4 = (await this.module.positions(bytes32(alice))).updated;
        // reward: 0.2 * 90 = 18
        // vested: 60 - 80 = -20
        // lost debt: 0.3 * -20 = -6

        // alice unstakes remainder fully vested
        await setupTime(this.t0, days(20));
        this.res2 = await this.module.unstake(bytes32(alice), alice, alice, shares(70), [], { from: owner });
        this.t5 = (await this.module.positions(bytes32(alice))).updated;
        // reward: 0.3 * 70 = 21
      });

      it('should delete user position', async function () {
        const pos = await this.module.positions(bytes32(alice));
        expect(pos.shares).to.be.bignumber.equal(new BN(0));
        expect(pos.vested).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(new BN(0));
        expect(pos.updated).to.be.bignumber.equal(new BN(0));
      });

      it('should decrease total debt', async function () {
        expect(await this.module.debt()).to.be.bignumber.equal(shares(100));
      });

      it('should increase available reward balance by lost unvested amount', async function () {
        expect((await this.module.balances())[0]).to.be.bignumber.closeTo(tokens(656), TOKEN_DELTA);
      });

      it('should decrease reward shares', async function () {
        expect(await this.module.rewards()).to.be.bignumber.closeTo(shares(756), SHARE_DELTA);
      });

      it('should decrease module reward token balance', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.closeTo(tokens(756), TOKEN_DELTA);
      });

      it('should increase user reward token balance', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(tokens(244), TOKEN_DELTA);
      });

      it('should emit first RewardsDistributed event', async function () {
        const e = this.res0.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(205), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(205), SHARE_DELTA);
      });

      it('should emit seconds RewardsDistributed event', async function () {
        const e = this.res1.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(18), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(18), SHARE_DELTA);
      });

      it('should emit third RewardsDistributed event', async function () {
        const e = this.res2.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(21), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(21), SHARE_DELTA);
      });

    });


    describe('when multiple users unstake', function () {

      beforeEach(async function () {
        // bob unstakes
        await setupTime(this.t0, days(13));
        this.res0 = await this.module.unstake(bytes32(bob), bob, bob, shares(100), [], { from: owner });
        this.t3 = (await this.module.positions(bytes32(bob))).updated;
        // reward: 100

        // alice unstakes some
        await setupTime(this.t0, days(15));
        this.res1 = await this.module.unstake(bytes32(alice), alice, alice, shares(50), [], { from: owner });
        this.t4 = (await this.module.positions(bytes32(alice))).updated;
        // reward: 0.8 * 200 + 0.7 * (50 + 40) = 223
        // vested: 160 - 50 = 110
      });

      it('should delete bob position', async function () {
        const pos = await this.module.positions(bytes32(bob));
        expect(pos.shares).to.be.bignumber.equal(new BN(0));
        expect(pos.vested).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(new BN(0));
        expect(pos.updated).to.be.bignumber.equal(new BN(0));
      });

      it('should decrease and update alice position', async function () {
        const pos = await this.module.positions(bytes32(alice));
        expect(pos.shares).to.be.bignumber.equal(shares(200));
        expect(pos.vested).to.be.bignumber.closeTo(shares(110), SHARE_DELTA);
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(this.t2);
        expect(pos.updated).to.be.bignumber.closeTo(this.t0.add(days(15)), new BN(1));
      });

      it('should decrease total debt', async function () {
        expect(await this.module.debt()).to.be.bignumber.closeTo(shares(27), SHARE_DELTA);
      });

      it('should not affect available reward balance', async function () {
        expect((await this.module.balances())[0]).to.be.bignumber.closeTo(tokens(650), TOKEN_DELTA);
      });

      it('should decrease reward shares', async function () {
        expect(await this.module.rewards()).to.be.bignumber.closeTo(shares(677), SHARE_DELTA);
      });

      it('should decrease module reward token balance', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.closeTo(tokens(677), TOKEN_DELTA);
      });

      it('should increase bob reward token balance', async function () {
        expect(await this.token.balanceOf(bob)).to.be.bignumber.closeTo(tokens(100), TOKEN_DELTA);
      });

      it('should increase alice reward token balance', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(tokens(223), TOKEN_DELTA);
      });

      it('should emit bob RewardsDistributed event', async function () {
        const e = this.res0.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.equal(tokens(100));
        expect(e.args.shares).to.be.bignumber.equal(shares(100));
      });

      it('should emit alice RewardsDistributed event', async function () {
        const e = this.res1.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(223), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(223), SHARE_DELTA);
      });

    });

  });


  describe('claim', function () {

    beforeEach(async function () {
      // owner creates module
      this.module = await ERC20FixedRewardModule.new(
        this.token.address,
        days(10),
        e18(5), // 5.0 reward shares per staking share
        this.config.address,
        factory,
        { from: owner }
      );

      // owner funds module
      await this.token.transfer(owner, tokens(10000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.fund(tokens(1000), { from: owner });
      await time.increase(days(1));

      // create stake for alice with 200 token reward
      await this.module.stake(bytes32(alice), alice, shares(40), [], { from: owner });
      this.t0 = (await this.module.positions(bytes32(alice))).timestamp;

      // create stake for bob with 100 token reward
      await setupTime(this.t0, days(2));
      await this.module.stake(bytes32(bob), bob, shares(20), [], { from: owner });
      this.t1 = (await this.module.positions(bytes32(bob))).timestamp;

      // create new stake for alice with 50 token reward, rollover 40 unvested from original position
      await setupTime(this.t0, days(8));
      await this.module.stake(bytes32(alice), alice, shares(10), [], { from: owner });
      this.t2 = (await this.module.positions(bytes32(alice))).timestamp;
    });

    describe('when one user claims', function () {

      beforeEach(async function () {
        // alice unstakes all
        await setupTime(this.t0, days(13));
        this.res = await this.module.claim(bytes32(alice), alice, alice, new BN(0), [], { from: owner });
        // reward: 0.8 * 200 + 0.5 * (50 + 40) = 205
      });

      it('should update user position', async function () {
        const pos = await this.module.positions(bytes32(alice));
        expect(pos.shares).to.be.bignumber.equal(shares(50)); // staking share units
        expect(pos.vested).to.be.bignumber.closeTo(shares(32), SHARE_DELTA);
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(this.t2);
        expect(pos.updated).to.be.bignumber.closeTo(this.t0.add(days(13)), new BN(1));
      });

      it('should decrease total debt', async function () {
        expect(await this.module.debt()).to.be.bignumber.closeTo(shares(145), SHARE_DELTA);
      });

      it('should not affect available reward balance', async function () {
        expect((await this.module.balances())[0]).to.be.bignumber.closeTo(tokens(650), TOKEN_DELTA);
      });

      it('should decrease reward shares', async function () {
        expect(await this.module.rewards()).to.be.bignumber.closeTo(shares(795), SHARE_DELTA);
      });

      it('should decrease module reward token balance', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.closeTo(tokens(795), TOKEN_DELTA);
      });

      it('should increase user reward token balance', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(tokens(205), TOKEN_DELTA);
      });

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(205), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(205), SHARE_DELTA);
      });

    });


    describe('when one user claims multiple times', function () {

      beforeEach(async function () {
        // alice claims
        await setupTime(this.t0, days(13));
        this.res0 = await this.module.claim(bytes32(alice), alice, alice, new BN(0), [], { from: owner });
        // reward: 0.8 * 200 + 0.5 * (50 + 40) = 205

        // alice claims
        await setupTime(this.t0, days(20));
        this.res1 = await this.module.claim(bytes32(alice), alice, alice, new BN(0), [], { from: owner });
        // reward remainder: 45
      });

      it('should update user position', async function () {
        const pos = await this.module.positions(bytes32(alice));
        expect(pos.shares).to.be.bignumber.equal(shares(50));
        expect(pos.vested).to.be.bignumber.equal(shares(32));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(this.t2);
        expect(pos.updated).to.be.bignumber.equal(this.t2.add(days(10))); // should be exact
      });

      it('should decrease total debt by alice remainder', async function () {
        expect(await this.module.debt()).to.be.bignumber.equal(shares(100));
      });

      it('should not affect available reward balance', async function () {
        expect((await this.module.balances())[0]).to.be.bignumber.closeTo(tokens(650), TOKEN_DELTA);
      });

      it('should decrease reward shares', async function () {
        expect(await this.module.rewards()).to.be.bignumber.closeTo(shares(750), SHARE_DELTA);
      });

      it('should decrease module reward token balance', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.closeTo(tokens(750), TOKEN_DELTA);
      });

      it('should increase user reward token balance', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(tokens(250), TOKEN_DELTA);
      });

      it('should emit first RewardsDistributed event', async function () {
        const e = this.res0.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(205), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(205), SHARE_DELTA);
      });

      it('should emit second RewardsDistributed event', async function () {
        const e = this.res1.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(45), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(45), SHARE_DELTA);
      });

    });

    describe('when multiple users claim', function () {

      beforeEach(async function () {
        // alice claims
        await setupTime(this.t0, days(10));
        this.res0 = await this.module.claim(bytes32(alice), alice, alice, new BN(0), [], { from: owner });
        // reward: 0.8 * 200 + 0.2 * (50 + 40) = 178

        // bob claims
        await setupTime(this.t0, days(11));
        this.res1 = await this.module.claim(bytes32(bob), bob, bob, new BN(0), [], { from: owner });
        // reward: 0.9 * 100 = 90
      });

      it('should update alice position', async function () {
        const pos = await this.module.positions(bytes32(alice));
        expect(pos.shares).to.be.bignumber.equal(shares(50)); // staking shares
        expect(pos.vested).to.be.bignumber.equal(shares(32));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(this.t2);
        expect(pos.updated).to.be.bignumber.closeTo(this.t0.add(days(10)), new BN(1));
      });

      it('should update bob position', async function () {
        const pos = await this.module.positions(bytes32(bob));
        expect(pos.shares).to.be.bignumber.equal(shares(20)); // staking shares
        expect(pos.vested).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(this.t1);
        expect(pos.updated).to.be.bignumber.closeTo(this.t0.add(days(11)), new BN(1));
      });

      it('should decrease total debt by combined payout', async function () {
        expect(await this.module.debt()).to.be.bignumber.closeTo(shares(82), SHARE_DELTA);
      });

      it('should not affect available reward balance', async function () {
        expect((await this.module.balances())[0]).to.be.bignumber.closeTo(tokens(650), TOKEN_DELTA);
      });

      it('should decrease reward shares', async function () {
        expect(await this.module.rewards()).to.be.bignumber.closeTo(shares(732), SHARE_DELTA);
      });

      it('should decrease module reward token balance', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.closeTo(tokens(732), TOKEN_DELTA);
      });

      it('should increase alice reward token balance', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(tokens(178), TOKEN_DELTA);
      });

      it('should increase bob reward token balance', async function () {
        expect(await this.token.balanceOf(bob)).to.be.bignumber.closeTo(tokens(90), TOKEN_DELTA);
      });

      it('should emit alice RewardsDistributed event', async function () {
        const e = this.res0.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(178), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(178), SHARE_DELTA);
      });

      it('should emit bob RewardsDistributed event', async function () {
        const e = this.res1.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(90), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(90), SHARE_DELTA);
      });

    });

  });


  describe('withdraw', function () {

    beforeEach(async function () {
      // owner creates module
      this.module = await ERC20FixedRewardModule.new(
        this.token.address,
        days(10),
        e18(1),
        this.config.address,
        factory,
        { from: owner }
      );

      // owner funds module
      await this.token.transfer(owner, tokens(10000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.fund(tokens(1000), { from: owner });
      await time.increase(days(1));

      // create stake for alice with 200 token reward
      await this.module.stake(bytes32(alice), alice, shares(200), [], { from: owner });
      this.t0 = (await this.module.positions(bytes32(alice))).timestamp;
    });

    describe('when amount is zero', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.withdraw(tokens(0), { from: owner }),
          'xrm5'
        )
      });
    });

    describe('when amount exceeds total balance', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.withdraw(tokens(1100), { from: owner }),
          'xrm6'
        )
      });
    });

    describe('when amount exceeds budget', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.withdraw(tokens(805), { from: owner }),
          'xrm7'
        )
      });
    });

    describe('when sender does not control module', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.withdraw(tokens(200), { from: alice }),
          'oc2'
        )
      });
    });


    describe('when controller withdraws excess funds', function () {

      beforeEach(async function () {
        this.res = await this.module.withdraw(tokens(500), { from: owner });
      });

      it('should decrease reward shares', async function () {
        expect(await this.module.rewards()).to.be.bignumber.equal(shares(500));
      });

      it('should not affect oustanding debt', async function () {
        expect(await this.module.debt()).to.be.bignumber.equal(shares(200));
      });

      it('should decrease module reward token balance', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.equal(tokens(500));
      });

      it('should increase controller reward token balance', async function () {
        expect(await this.token.balanceOf(owner)).to.be.bignumber.equal(tokens(9500));
      });

      it('should emit RewardsWithdrawn event', async function () {
        expectEvent(
          this.res,
          'RewardsWithdrawn',
          { token: this.token.address, amount: tokens(500), shares: shares(500) }
        );
      });

      it('should still let users stake for remaining tokens', async function () {
        await setupTime(this.t0, days(3));
        await this.module.stake(bytes32(bob), bob, shares(300), [], { from: owner });
        expect(await this.module.debt()).to.be.bignumber.equal(shares(500));
      });

      it('should still let users claim rewards on existing positions', async function () {
        await setupTime(this.t0, days(15));
        await this.module.unstake(bytes32(alice), alice, alice, shares(200), [], { from: owner });
        expect(await this.module.rewards()).to.be.bignumber.equal(shares(300));
        expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(tokens(200));
      });

    });

  });

});