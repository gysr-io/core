// unit tests for ERC20CompetitiveRewardModule

const { accounts, contract, web3 } = require('@openzeppelin/test-environment');
const { BN, time, expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const {
  tokens,
  bonus,
  days,
  shares,
  toFixedPointBigNumber,
  fromFixedPointBigNumber,
  reportGas,
  DECIMALS
} = require('../util/helper');

const ERC20CompetitiveRewardModule = contract.fromArtifact('ERC20CompetitiveRewardModule');
const TestToken = contract.fromArtifact('TestToken');
const TestElasticToken = contract.fromArtifact('TestElasticToken')
const TestFeeToken = contract.fromArtifact('TestFeeToken');

// need decent tolerance to account for potential timing error
const TOKEN_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);
const SHARE_DELTA = toFixedPointBigNumber(0.0001 * (10 ** 6), 10, DECIMALS);
const BONUS_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);


describe('ERC20CompetitiveRewardModule', function () {
  const [org, owner, bob, alice, other, factory] = accounts;

  beforeEach('setup', async function () {
    this.token = await TestToken.new({ from: org });
    this.elastic = await TestElasticToken.new({ from: org });
    this.feeToken = await TestFeeToken.new({ from: org });
  });

  describe('construction', function () {

    describe('when start bonus is greater than max bonus', function () {
      it('should fail to construct', async function () {
        await expectRevert(
          ERC20CompetitiveRewardModule.new(
            this.token.address,
            bonus(1.0),
            bonus(0.5),
            days(90),
            factory,
            { from: owner }
          ),
          'crm1' // ERC20CompetitiveRewardModule: initial time bonus greater than max
        )
      });
    });

    describe('when initialized with valid constructor arguments', function () {
      beforeEach(async function () {
        this.module = await ERC20CompetitiveRewardModule.new(
          this.token.address,
          bonus(0.5),
          bonus(2.0),
          days(90),
          factory,
          { from: owner }
        );
      });
      it('should create an ERC20CompetitiveRewardModule object', async function () {
        expect(this.module).to.be.an('object');
        expect(this.module.constructor.name).to.be.equal('TruffleContract');
      });

      it('should return the correct addresses for owner and token', async function () {
        expect(await this.module.owner()).to.equal(owner);
        expect((await this.module.tokens())[0]).to.equal(this.token.address);
      });

      it('should initialize bonus params properly', async function () {
        expect(await this.module.bonusMin()).to.be.bignumber.equal(bonus(0.5));
        expect(await this.module.bonusMax()).to.be.bignumber.equal(bonus(2.0));
        expect(await this.module.bonusPeriod()).to.be.bignumber.equal(new BN(60 * 60 * 24 * 90));
      });

      it('should have zero reward balances', async function () {
        expect((await this.module.balances())[0]).to.be.bignumber.equal(new BN(0));
        expect(await this.module.totalLocked()).to.be.bignumber.equal(new BN(0));
        expect(await this.module.totalUnlocked()).to.be.bignumber.equal(new BN(0));
      });

      it('should have zero earning balances', async function () {
        expect(await this.module.totalStakingShares()).to.be.bignumber.equal(new BN(0));
        expect(await this.module.totalStakingShareSeconds()).to.be.bignumber.equal(new BN(0));
      });

      it('should have a 0 GYSR usage ratio', async function () {
        expect(await this.module.usage()).to.be.bignumber.equal(new BN(0));
      });
    })
  });


  describe('time bonus', function () {

    describe('when configured with a 50-200% time bonus earned over 90 days', function () {

      beforeEach(async function () {
        // owner creates module
        this.module = await ERC20CompetitiveRewardModule.new(
          this.token.address,
          bonus(0.5),
          bonus(2.0),
          days(90),
          factory,
          { from: owner }
        );

        // owner funds module
        await this.token.transfer(owner, tokens(10000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: owner });
        await this.module.methods['fund(uint256,uint256)'](
          tokens(1000), days(180),
          { from: owner }
        );
      });

      it('should be 1.5x for t = 0', async function () {
        const mult = fromFixedPointBigNumber(await this.module.timeBonus(0), 10, 18);
        expect(mult).to.be.equal(1.5);
      });

      it('should be 2.0x for t = 30 days', async function () {
        const mult = fromFixedPointBigNumber(await this.module.timeBonus(days(30)), 10, 18);
        expect(mult).to.be.equal(2.0);
      });

      it('should be 2.5x for t = 60 days', async function () {
        const mult = fromFixedPointBigNumber(await this.module.timeBonus(days(60)), 10, 18);
        expect(mult).to.be.equal(2.5);
      });

      it('should be 3.0x for t = 90 days', async function () {
        const mult = fromFixedPointBigNumber(await this.module.timeBonus(days(90)), 10, 18);
        expect(mult).to.be.equal(3.0);
      });

      it('should be 3.0x for t > 90 days', async function () {
        const mult = fromFixedPointBigNumber(await this.module.timeBonus(days(150)), 10, 18);
        expect(mult).to.be.equal(3.0);
      });
    });

    describe('when configured with 0 day time bonus period', function () {

      beforeEach(async function () {
        // owner creates module
        this.module = await ERC20CompetitiveRewardModule.new(
          this.token.address,
          bonus(0.5),
          bonus(2.0),
          days(0),
          factory,
          { from: owner }
        );

        // owner funds module
        await this.token.transfer(owner, tokens(10000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: owner });
        await this.module.methods['fund(uint256,uint256)'](
          tokens(1000), days(180),
          { from: owner }
        );
      });

      it('should be max time bonus for t = 0', async function () {
        const mult = fromFixedPointBigNumber(await this.module.timeBonus(0), 10, 18);
        expect(mult).to.be.equal(3.0);
      });

      it('should be max time bonus for t > 0 days', async function () {
        const mult = fromFixedPointBigNumber(await this.module.timeBonus(days(30)), 10, 18);
        expect(mult).to.be.equal(3.0);
      });
    });

    describe('when configured with 0.0 max time bonus', function () {

      beforeEach(async function () {
        // owner creates module
        this.module = await ERC20CompetitiveRewardModule.new(
          this.token.address,
          bonus(0.0),
          bonus(0.0),
          days(90),
          factory,
          { from: owner }
        );

        // owner funds module
        await this.token.transfer(owner, tokens(10000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: owner });
        await this.module.methods['fund(uint256,uint256)'](
          tokens(1000), days(180),
          { from: owner }
        );
      });

      it('should be 1.0 time bonus for t = 0', async function () {
        const mult = fromFixedPointBigNumber(await this.module.timeBonus(0), 10, 18);
        expect(mult).to.be.equal(1.0);
      });

      it('should be 1.0 time bonus for 0 < t < period', async function () {
        const mult = fromFixedPointBigNumber(await this.module.timeBonus(days(30)), 10, 18);
        expect(mult).to.be.equal(1.0);
      });

      it('should be 1.0 time bonus for t = period', async function () {
        const mult = fromFixedPointBigNumber(await this.module.timeBonus(days(90)), 10, 18);
        expect(mult).to.be.equal(1.0);
      });

      it('should be 1.0 time bonus for t > period', async function () {
        const mult = fromFixedPointBigNumber(await this.module.timeBonus(days(120)), 10, 18);
        expect(mult).to.be.equal(1.0);
      });
    });
  });


  describe('unstake with GYSR', function () {

    beforeEach('setup', async function () {

      // owner creates module
      this.module = await ERC20CompetitiveRewardModule.new(
        this.token.address,
        bonus(0.5),
        bonus(2.0),
        days(90),
        factory,
        { from: owner }
      );

      // owner funds module
      await this.token.transfer(owner, tokens(10000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.methods['fund(uint256,uint256)'](
        tokens(1000), days(200),
        { from: owner }
      );
      this.t0 = await this.module.lastUpdated();

      // alice stakes 100 tokens at 10 days
      await time.increaseTo(this.t0.add(days(10)));
      await this.module.stake(alice, alice, shares(100), [], { from: owner });
      this.t1 = await this.module.lastUpdated();

      // bob stakes 100 tokens at 40 days
      await time.increaseTo(this.t0.add(days(40)));
      await this.module.stake(bob, bob, shares(100), [], { from: owner });

      // alice stakes another 100 tokens at 70 days
      await time.increaseTo(this.t0.add(days(70)));
      await this.module.stake(alice, alice, shares(100), [], { from: owner });

      // advance last 30 days (below)

      // summary
      // 100 days elapsed
      // tokens unlocked: 500 (1000 @ 200 days)
      // time bonus: 0.5 -> 2.0 over 90 days
      // alice: 100 staked for 90 days, 100 staked for 30 days, 12000 staking days
      // bob: 100 staked for 60 days, 6000 staking days
      // total: 18000 share days
    });

    describe('when gysr amount not encoded correctly', function () {

      it('should revert', async function () {
        const data = "0x0de0b6b3a7640000"; // not a full 32 bytes
        await expectRevert(
          this.module.unstake(alice, alice, shares(200), data, { from: owner }),
          'crm2' // ERC20CompetitiveRewardModule: invalid data
        )
      });
    });

    describe('when one user unstakes all shares', function () {

      beforeEach(async function () {
        // expect 3.0x time multiplier on first stake, 2.0x time multiplier on second stake
        // gysr bonus: 1.0 tokens, at initial 0.0 usage, unstaking 200/300 total
        const mult = 1.0 + Math.log10(1.0 + (3.0 / 200.0) * 1.0 / (0.01 + 0.0));
        const raw = 100 * 90 + 100 * 30;
        const inflated = mult * (100 * 90 * 3.0 + 100 * 30 * 2.0);
        this.portion = inflated / (18000 - raw + inflated);
        this.usage = (raw / 18000) * (mult - 1.0) / mult;

        // advance last 30 days
        await time.increaseTo(this.t0.add(days(100)));

        // encode gysr amount as bytes
        const data = web3.eth.abi.encodeParameter('uint256', tokens(1).toString());

        // unstake
        this.res = await this.module.unstake(alice, alice, shares(200), data, { from: owner });
      });

      it('should have no remaining stakes for user', async function () {
        expect(await this.module.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion * 500), TOKEN_DELTA
        );
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion) * 500), TOKEN_DELTA
        );
      });

      it('should increase GYSR usage', async function () {
        expect(await this.module.usage()).to.be.bignumber.closeTo(bonus(this.usage), BONUS_DELTA);
      });

      it('should emit GysrSpent event', async function () {
        expectEvent(
          this.res,
          'GysrSpent',
          { user: alice, amount: tokens(1) }
        );
      });

      it('should emit GysrVested event', async function () {
        expectEvent(
          this.res,
          'GysrVested',
          { user: alice, amount: tokens(1) }
        );
      });

      it('should emit reward event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion * 500), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.portion * 500), SHARE_DELTA);
      });

      it('report gas', async function () {
        reportGas('ERC20CompetitiveRewardModule', 'unstake', 'with GYSR', this.res)
      });
    });

    describe('when one user unstakes some shares', function () {

      beforeEach(async function () {
        // first-in last-out
        // expect 50% of first stake to be returned at a 3.0 multiplier
        // expect full second stake to be returned at a 2.0 multiplier
        // gysr bonus: 1.0 tokens, at initial 0 usage, unstaking 150/300 total
        const mult = 1.0 + Math.log10(1.0 + (3.0 / 150.0) * 1.0 / (0.01 + 0.0));
        const raw = 50 * 90 + 100 * 30;
        const inflated = mult * (50 * 90 * 3.0 + 100 * 30 * 2.0);
        this.portion = inflated / (18000 - raw + inflated);
        this.usage = (raw / 18000) * (mult - 1.0) / mult;

        // advance last 30 days
        await time.increaseTo(this.t0.add(days(100)));

        // encode gysr amount as bytes
        const data = web3.eth.abi.encodeParameter('uint256', tokens(1).toString());

        // unstake
        this.res = await this.module.unstake(alice, alice, shares(150), data, { from: owner });
      });

      it('should have one stake remaining for user', async function () {
        expect(await this.module.stakeCount(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should reduce share amount of remaining stake', async function () {
        expect((await this.module.stakes(alice, 0)).shares).to.be.bignumber.closeTo(
          shares(50), SHARE_DELTA
        );
      });

      it('should unstake first-in last-out', async function () {
        expect((await this.module.stakes(alice, 0)).timestamp).to.be.bignumber.equal(this.t1);
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion * 500), TOKEN_DELTA
        );
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion) * 500), TOKEN_DELTA
        );
      });

      it('should emit GysrSpent event', async function () {
        expectEvent(
          this.res,
          'GysrSpent',
          { user: alice, amount: tokens(1) }
        );
      });

      it('should emit GysrVested event', async function () {
        expectEvent(
          this.res,
          'GysrVested',
          { user: alice, amount: tokens(1) }
        );
      });

      it('should increase GYSR usage', async function () {
        expect(await this.module.usage()).to.be.bignumber.closeTo(bonus(this.usage), BONUS_DELTA);
      });

      it('should emit reward event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion * 500), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.portion * 500), SHARE_DELTA);
      });
    });

    describe('when one user unstakes multiple times', function () {

      beforeEach(async function () {
        // first unstake
        // expect 50% of first stake to be returned at a 3.0 multiplier
        // expect full second stake to be returned at a 2.0 multiplier
        // gysr bonus: 1.0 tokens, at initial 0 usage, unstaking 150/300 total
        const mult0 = 1.0 + Math.log10(1.0 + (3.0 / 150.0) * 1.0 / (0.01 + 0.0));
        const raw0 = 50 * 90 + 100 * 30;
        const inflated0 = mult0 * (50 * 90 * 3.0 + 100 * 30 * 2.0);
        this.portion0 = inflated0 / (18000 - raw0 + inflated0);
        const usage0 = (raw0 / 18000) * (mult0 - 1.0) / mult0;

        // second unstake
        // expect 3.0 multiplier on last 50% of first stake
        // gysr bonus: 5.0 tokens, at 0.13 usage, unstaking 50/150 total
        const mult1 = 1.0 + Math.log10(1.0 + (1.5 / 50.0) * 5.0 / (0.01 + usage0));
        const raw1 = 50 * 90;
        const inflated1 = mult1 * raw1 * 3.0;
        this.portion1 = inflated1 / (18000 - raw0 - raw1 + inflated1);
        const w1 = raw1 / (18000 - raw0);
        this.usage1 = usage0 - w1 * usage0 + w1 * (mult1 - 1.0) / mult1;

        // advance last 30 days
        await time.increaseTo(this.t0.add(days(100)));

        // encode gysr amount as bytes
        const data0 = web3.eth.abi.encodeParameter('uint256', tokens(1).toString());

        // do first unstake
        await this.module.unstake(alice, alice, shares(150), data0, { from: owner });
        this.remainder = fromFixedPointBigNumber(await this.module.totalUnlocked(), 10, DECIMALS);

        // encode gysr amount as bytes
        const data1 = web3.eth.abi.encodeParameter('uint256', tokens(5).toString());

        // do second unstake
        this.res = await this.module.unstake(alice, alice, shares(50), data1, { from: owner });
      });

      it('should have no remaining stakes for user', async function () {
        expect(await this.module.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion0 * 500 + this.portion1 * this.remainder), TOKEN_DELTA
        );
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion1) * this.remainder), TOKEN_DELTA
        );
      });

      it('should increase GYSR usage', async function () {
        expect(await this.module.usage()).to.be.bignumber.closeTo(bonus(this.usage1), BONUS_DELTA);
      });

      it('should emit gysr spending event', async function () {
        expectEvent(
          this.res,
          'GysrSpent',
          { user: alice, amount: tokens(5) }
        );
      });

      it('should emit GysrVested event', async function () {
        expectEvent(
          this.res,
          'GysrVested',
          { user: alice, amount: tokens(5) }
        );
      });

      it('should emit reward event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion1 * this.remainder), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.portion1 * this.remainder), SHARE_DELTA);
      });

    });

  });

  describe('claim with GYSR', function () {

    beforeEach('setup', async function () {

      // owner creates module
      this.module = await ERC20CompetitiveRewardModule.new(
        this.token.address,
        bonus(0.5),
        bonus(2.0),
        days(90),
        factory,
        { from: owner }
      );

      // owner funds module
      await this.token.transfer(owner, tokens(10000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.methods['fund(uint256,uint256)'](
        tokens(1000), days(200),
        { from: owner }
      );
      this.t0 = await this.module.lastUpdated();

      // alice stakes 100 tokens at 10 days
      await time.increaseTo(this.t0.add(days(10)));
      await this.module.stake(alice, alice, shares(100), [], { from: owner });
      this.t1 = await this.module.lastUpdated();

      // bob stakes 100 tokens at 40 days
      await time.increaseTo(this.t0.add(days(40)));
      await this.module.stake(bob, bob, shares(100), [], { from: owner });

      // alice stakes another 100 tokens at 70 days
      await time.increaseTo(this.t0.add(days(70)));
      await this.module.stake(alice, alice, shares(100), [], { from: owner });

      // advance last 30 days (below)

      // summary
      // 100 days elapsed
      // tokens unlocked: 500 (1000 @ 200 days)
      // time bonus: 0.5 -> 2.0 over 90 days
      // alice: 100 staked for 90 days, 100 staked for 30 days, 12000 staking days
      // bob: 100 staked for 60 days, 6000 staking days
      // total: 18000 share days
    });

    describe('when gysr amount not encoded correctly', function () {

      it('should revert', async function () {
        const data = "0x0de0b6b3a7640000"; // not a full 32 bytes
        await expectRevert(
          this.module.unstake(alice, alice, shares(200), data, { from: owner }),
          'crm2' // ERC20CompetitiveRewardModule: invalid data
        )
      });
    });

    describe('when one user claims on all shares', function () {

      beforeEach(async function () {
        // expect 3.0x time multiplier on first stake, 2.0x time multiplier on second stake
        // gysr bonus: 1.0 tokens, at initial 0.0 usage, claiming 200/300 total
        const mult = 1.0 + Math.log10(1.0 + (3.0 / 200.0) * 1.0 / (0.01 + 0.0));
        const raw = 100 * 90 + 100 * 30;
        const inflated = mult * (100 * 90 * 3.0 + 100 * 30 * 2.0);
        this.portion = inflated / (18000 - raw + inflated);
        this.usage = (raw / 18000) * (mult - 1.0) / mult;

        // advance last 30 days
        await time.increaseTo(this.t0.add(days(100)));

        // encode gysr amount as bytes
        const data = web3.eth.abi.encodeParameter('uint256', tokens(1).toString());

        // claim
        this.res = await this.module.claim(alice, alice, shares(200), data, { from: owner });
        this.t2 = await this.module.lastUpdated();
      });

      it('should collapse position into single stake', async function () {
        expect(await this.module.stakeCount(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should combine share amount into single stake', async function () {
        expect((await this.module.stakes(alice, 0)).shares).to.be.bignumber.equal(
          shares(200)
        );
      });

      it('should reset timestamp for user stake', async function () {
        expect((await this.module.stakes(alice, 0)).timestamp).to.be.bignumber.equal(this.t2);
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion * 500), TOKEN_DELTA
        );
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion) * 500), TOKEN_DELTA
        );
      });

      it('should increase GYSR usage', async function () {
        expect(await this.module.usage()).to.be.bignumber.closeTo(bonus(this.usage), BONUS_DELTA);
      });

      it('should emit gysr spending event', async function () {
        expectEvent(
          this.res,
          'GysrSpent',
          { user: alice, amount: tokens(1) }
        );
      });

      it('should emit GysrVested event', async function () {
        expectEvent(
          this.res,
          'GysrVested',
          { user: alice, amount: tokens(1) }
        );
      });

      it('should emit reward event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion * 500), TOKEN_DELTA);
      });

      it('report gas', async function () {
        reportGas('ERC20CompetitiveRewardModule', 'claim', 'with GYSR', this.res)
      });
    });

    describe('when one user claims with more shares than the last stake', function () {

      beforeEach(async function () {
        // first-in last-out
        // expect 50% of first stake to be returned at a 3.0 multiplier
        // expect full second stake to be returned at a 2.0 multiplier
        // gysr bonus: 1.0 tokens, at initial 0 usage, claiming 150/300 total
        const mult = 1.0 + Math.log10(1.0 + (3.0 / 150.0) * 1.0 / (0.01 + 0.0));
        const raw = 50 * 90 + 100 * 30;
        const inflated = mult * (50 * 90 * 3.0 + 100 * 30 * 2.0);
        this.portion = inflated / (18000 - raw + inflated);
        this.usage = (raw / 18000) * (mult - 1.0) / mult;

        // advance last 30 days
        await time.increaseTo(this.t0.add(days(100)));

        // encode gysr amount as bytes
        const data = web3.eth.abi.encodeParameter('uint256', tokens(1).toString());

        // claim
        this.res = await this.module.claim(alice, alice, shares(150), data, { from: owner });
        this.t2 = await this.module.lastUpdated();
      });

      it('should have same number of overall stakes for user', async function () {
        expect(await this.module.stakeCount(alice)).to.be.bignumber.equal(new BN(2));
      });

      it('should reduce share amount of first stake', async function () {
        expect((await this.module.stakes(alice, 0)).shares).to.be.bignumber.closeTo(
          shares(50), SHARE_DELTA
        );
      });

      it('should increase share amount of new stake', async function () {
        expect((await this.module.stakes(alice, 1)).shares).to.be.bignumber.closeTo(
          shares(150), SHARE_DELTA
        );
      });

      it('should reset timestamp for new stake', async function () {
        expect((await this.module.stakes(alice, 1)).timestamp).to.be.bignumber.equal(this.t2);
      });

      it('should maintain timestamp for first stake', async function () {
        expect((await this.module.stakes(alice, 0)).timestamp).to.be.bignumber.equal(this.t1);
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion * 500), TOKEN_DELTA
        );
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion) * 500), TOKEN_DELTA
        );
      });

      it('should increase GYSR usage', async function () {
        expect(await this.module.usage()).to.be.bignumber.closeTo(bonus(this.usage), BONUS_DELTA);
      });

      it('should emit GysrSpent event', async function () {
        expectEvent(
          this.res,
          'GysrSpent',
          { user: alice, amount: tokens(1) }
        );
      });

      it('should emit GysrVested event', async function () {
        expectEvent(
          this.res,
          'GysrVested',
          { user: alice, amount: tokens(1) }
        );
      });

      it('should emit reward event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion * 500), TOKEN_DELTA);
      });
    });

    describe('when one user claims with fewer shares than the last stake', function () {

      beforeEach(async function () {
        // first-in last-out
        // expect 75% of second stake to be returned at a 2.0 multiplier
        // gysr bonus: 1.0 tokens, at initial 0 usage, claiming on 75/300 total
        const mult = 1.0 + Math.log10(1.0 + (3.0 / 75.0) * 1.0 / (0.01 + 0.0));
        const raw = 75 * 30;
        const inflated = mult * 2.0 * raw;
        this.portion = inflated / (18000 - raw + inflated);
        this.usage = (raw / 18000) * (mult - 1.0) / mult;

        // advance last 30 days
        await time.increaseTo(this.t0.add(days(100)));

        // encode gysr amount as bytes
        const data = web3.eth.abi.encodeParameter('uint256', tokens(1).toString());

        // claim
        this.res = await this.module.claim(alice, alice, shares(75), data, { from: owner });
        this.t2 = await this.module.lastUpdated();
      });

      it('should add an additional stake for user', async function () {
        expect(await this.module.stakeCount(alice)).to.be.bignumber.equal(new BN(3));
      });

      it('should move share amount to new stake', async function () {
        expect((await this.module.stakes(alice, 2)).shares).to.be.bignumber.closeTo(
          shares(75), SHARE_DELTA
        );
      });

      it('should reduce share amount of second stake', async function () {
        expect((await this.module.stakes(alice, 1)).shares).to.be.bignumber.closeTo(
          shares(25), SHARE_DELTA
        );
      });

      it('should not affect share amount of first stake', async function () {
        expect((await this.module.stakes(alice, 0)).shares).to.be.bignumber.closeTo(
          shares(100), SHARE_DELTA
        );
      });

      it('should reset timestamp for new stake', async function () {
        expect((await this.module.stakes(alice, 2)).timestamp).to.be.bignumber.equal(this.t2);
      });

      it('should maintain timestamp for first stake', async function () {
        expect((await this.module.stakes(alice, 0)).timestamp).to.be.bignumber.equal(this.t1);
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion * 500), TOKEN_DELTA
        );
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion) * 500), TOKEN_DELTA
        );
      });

      it('should increase GYSR usage', async function () {
        expect(await this.module.usage()).to.be.bignumber.closeTo(bonus(this.usage), BONUS_DELTA);
      });

      it('should emit GysrSpent event', async function () {
        expectEvent(
          this.res,
          'GysrSpent',
          { user: alice, amount: tokens(1) }
        );
      });

      it('should emit GysrVested event', async function () {
        expectEvent(
          this.res,
          'GysrVested',
          { user: alice, amount: tokens(1) }
        );
      });

      it('should emit reward event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion * 500), TOKEN_DELTA);
      });
    });

    describe('when one user claims multiple times', function () {

      beforeEach(async function () {
        // first claim
        // expect 50% of first stake to be returned at a 3.0 multiplier
        // expect full second stake to be returned at a 2.0 multiplier
        // gysr bonus: 1.0 tokens, at initial 0 usage, claiming on 150/300 total
        const mult0 = 1.0 + Math.log10(1.0 + (3.0 / 150.0) * 1.0 / (0.01 + 0.0));
        const raw0 = 50 * 90 + 100 * 30;
        const inflated0 = mult0 * (50 * 90 * 3.0 + 100 * 30 * 2.0);
        this.portion0 = inflated0 / (18000 - raw0 + inflated0);
        const usage0 = (raw0 / 18000) * (mult0 - 1.0) / mult0;

        // second claim
        // have to claim all to get to the "first-in" 50 shares
        // but expect no additional rewards from the part we already claimed on
        // expect 3.0 multiplier on last 50% of first stake
        // gysr bonus: 5.0 tokens, at 0.13 usage, claiming on 200/300 total
        const mult1 = 1.0 + Math.log10(1.0 + (3.0 / 200.0) * 5.0 / (0.01 + usage0));
        const raw1 = 50 * 90;
        const inflated1 = mult1 * raw1 * 3.0;
        this.portion1 = inflated1 / (18000 - raw0 - raw1 + inflated1);
        const w1 = raw1 / (18000 - raw0);
        this.usage1 = usage0 - w1 * usage0 + w1 * (mult1 - 1.0) / mult1;

        // advance last 30 days
        await time.increaseTo(this.t0.add(days(100)));

        // encode gysr amount as bytes
        const data0 = web3.eth.abi.encodeParameter('uint256', tokens(1).toString());

        // do first unstake
        await this.module.claim(alice, alice, shares(150), data0, { from: owner });
        this.remainder = fromFixedPointBigNumber(await this.module.totalUnlocked(), 10, DECIMALS);

        // encode gysr amount as bytes
        const data1 = web3.eth.abi.encodeParameter('uint256', tokens(5).toString());

        // do second claim
        this.res = await this.module.claim(alice, alice, shares(200), data1, { from: owner });
        this.t2 = await this.module.lastUpdated();
      });

      it('should now have one collapsed stake for user', async function () {
        expect(await this.module.stakeCount(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should combine share amount into single stake', async function () {
        expect((await this.module.stakes(alice, 0)).shares).to.be.bignumber.equal(
          shares(200)
        );
      });

      it('should reset timestamp for user stake', async function () {
        expect((await this.module.stakes(alice, 0)).timestamp).to.be.bignumber.equal(this.t2);
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion0 * 500 + this.portion1 * this.remainder), TOKEN_DELTA
        );
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion1) * this.remainder), TOKEN_DELTA
        );
      });

      it('should increase GYSR usage', async function () {
        expect(await this.module.usage()).to.be.bignumber.closeTo(bonus(this.usage1), BONUS_DELTA);
      });

      it('should emit gysr spending event', async function () {
        expectEvent(
          this.res,
          'GysrSpent',
          { user: alice, amount: tokens(5) }
        );
      });

      it('should emit GysrVested event', async function () {
        expectEvent(
          this.res,
          'GysrVested',
          { user: alice, amount: tokens(5) }
        );
      });

      it('should emit reward event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion1 * this.remainder), TOKEN_DELTA);
      });

    });
  });

  describe('user and account differ', function () {

    beforeEach('setup', async function () {

      // owner creates module
      this.module = await ERC20CompetitiveRewardModule.new(
        this.token.address,
        bonus(0.5),
        bonus(2.0),
        days(90),
        factory,
        { from: owner }
      );

      // owner funds module
      await this.token.transfer(owner, tokens(10000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.methods['fund(uint256,uint256)'](
        tokens(1000), days(200),
        { from: owner }
      );
      this.t0 = await this.module.lastUpdated();

      // alice stakes 100 tokens at 10 days, under account address
      await time.increaseTo(this.t0.add(days(10)));
      await this.module.stake(other, alice, shares(100), [], { from: owner });
      this.t1 = await this.module.lastUpdated();

      // bob stakes 100 tokens at 40 days
      await time.increaseTo(this.t0.add(days(40)));
      await this.module.stake(bob, bob, shares(100), [], { from: owner });

      // alice stakes another 100 tokens at 70 days, under account address
      await time.increaseTo(this.t0.add(days(70)));
      await this.module.stake(other, alice, shares(100), [], { from: owner });

      // advance last 30 days (below)

      // summary
      // 100 days elapsed
      // tokens unlocked: 500 (1000 @ 200 days)
      // time bonus: 0.5 -> 2.0 over 90 days
      // alice: 100 staked for 90 days, 100 staked for 30 days, 12000 staking days
      // bob: 100 staked for 60 days, 6000 staking days
      // total: 18000 share days
    });

    describe('when user and account differ', function () {

      it('should have two stakes for account', async function () {
        expect(await this.module.stakeCount(other)).to.be.bignumber.equal(new BN(2));
      });

      it('should have no stakes for user', async function () {
        expect(await this.module.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
      });

    });

    describe('when user is passed as account', function () {

      it('should revert', async function () {
        await expectRevert(
          this.module.unstake(alice, alice, shares(200), [], { from: owner }),
          'revert'  // insufficient balance, this would be caught upstream
        )
      });
    });

    describe('when user unstakes all shares against account', function () {

      beforeEach(async function () {
        // expect 3.0x time multiplier on first stake, 2.0x time multiplier on second stake
        // gysr bonus: 1.0 tokens, at initial 0.0 usage, unstaking 200/300 total
        const mult = 1.0 + Math.log10(1.0 + (3.0 / 200.0) * 1.0 / (0.01 + 0.0));
        const raw = 100 * 90 + 100 * 30;
        const inflated = mult * (100 * 90 * 3.0 + 100 * 30 * 2.0);
        this.portion = inflated / (18000 - raw + inflated);
        this.usage = (raw / 18000) * (mult - 1.0) / mult;

        // advance last 30 days
        await time.increaseTo(this.t0.add(days(100)));

        // encode gysr amount as bytes
        const data = web3.eth.abi.encodeParameter('uint256', tokens(1).toString());

        // unstake
        this.res = await this.module.unstake(other, alice, shares(200), data, { from: owner });
      });

      it('should have no remaining stakes for account', async function () {
        expect(await this.module.stakeCount(other)).to.be.bignumber.equal(new BN(0));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion * 500), TOKEN_DELTA
        );
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion) * 500), TOKEN_DELTA
        );
      });

      it('should increase GYSR usage', async function () {
        expect(await this.module.usage()).to.be.bignumber.closeTo(bonus(this.usage), BONUS_DELTA);
      });

      it('should emit GysrSpent event for user', async function () {
        expectEvent(
          this.res,
          'GysrSpent',
          { user: alice, amount: tokens(1) }
        );
      });

      it('should emit GysrVested event for user', async function () {
        expectEvent(
          this.res,
          'GysrVested',
          { user: alice, amount: tokens(1) }
        );
      });

      it('should emit reward event for user', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion * 500), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.portion * 500), SHARE_DELTA);
      });
    });

    describe('when another user unstakes against transferred account position', function () {

      beforeEach(async function () {
        // expect 3.0x time multiplier on first stake, 2.0x time multiplier on second stake
        // gysr bonus: 1.0 tokens, at initial 0.0 usage, unstaking 200/300 total
        const mult = 1.0 + Math.log10(1.0 + (3.0 / 200.0) * 1.0 / (0.01 + 0.0));
        const raw = 100 * 90 + 100 * 30;
        const inflated = mult * (100 * 90 * 3.0 + 100 * 30 * 2.0);
        this.portion = inflated / (18000 - raw + inflated);
        this.usage = (raw / 18000) * (mult - 1.0) / mult;

        // advance last 30 days
        await time.increaseTo(this.t0.add(days(100)));

        // encode gysr amount as bytes
        const data = web3.eth.abi.encodeParameter('uint256', tokens(1).toString());

        // unstake
        this.res = await this.module.unstake(other, bob, shares(200), data, { from: owner });
      });

      it('should have no remaining stakes for account', async function () {
        expect(await this.module.stakeCount(other)).to.be.bignumber.equal(new BN(0));
      });

      it('should not affect other positions of new user', async function () {
        expect(await this.module.stakeCount(bob)).to.be.bignumber.equal(new BN(1));
      });

      it('should disburse expected amount of reward token to new user', async function () {
        expect(await this.token.balanceOf(bob)).to.be.bignumber.closeTo(
          tokens(this.portion * 500), TOKEN_DELTA
        );
      });

      it('should not disburse any reward token to original user', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(new BN(0));
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion) * 500), TOKEN_DELTA
        );
      });

      it('should increase GYSR usage', async function () {
        expect(await this.module.usage()).to.be.bignumber.closeTo(bonus(this.usage), BONUS_DELTA);
      });

      it('should emit GysrSpent event for new user', async function () {
        expectEvent(
          this.res,
          'GysrSpent',
          { user: bob, amount: tokens(1) }
        );
      });

      it('should emit GysrVested event for new user', async function () {
        expectEvent(
          this.res,
          'GysrVested',
          { user: bob, amount: tokens(1) }
        );
      });

      it('should emit reward event for new user', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion * 500), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.portion * 500), SHARE_DELTA);
      });
    });

  });
});
