// test module for staking against Geyser

const { accounts, contract } = require('@openzeppelin/test-environment');
const { BN, time, expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const {
  tokens,
  bonus,
  days,
  shares,
  toFixedPointBigNumber,
  fromFixedPointBigNumber,
  DECIMALS
} = require('./util/helper');

const Geyser = contract.fromArtifact('Geyser');
const GeyserFactory = contract.fromArtifact('GeyserFactory');
const GeyserToken = contract.fromArtifact('GeyserToken');
const TestToken = contract.fromArtifact('TestToken');
const TestLiquidityToken = contract.fromArtifact('TestLiquidityToken');

// need decent tolerance to account for potential timing error
const TOKEN_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);
const SHARE_DELTA = toFixedPointBigNumber(0.0001 * (10 ** 6), 10, DECIMALS);


describe('staking', function () {
  const [owner, org, alice, bob] = accounts;

  beforeEach('setup', async function () {
    // base setup
    this.gysr = await GeyserToken.new({ from: org });
    this.factory = await GeyserFactory.new(this.gysr.address, { from: org });
    this.reward = await TestToken.new({ from: org });
    this.staking = await TestLiquidityToken.new({ from: org });
    // owner creates geyser
    this.geyser = await Geyser.new(
      this.staking.address,
      this.reward.address,
      bonus(0.5),
      bonus(2.0),
      days(90),
      this.gysr.address,
      { from: owner }
    );
    // owner funds geyser
    await this.reward.transfer(owner, tokens(10000), { from: org });
    await this.reward.approve(this.geyser.address, tokens(100000), { from: owner });
    await this.geyser.methods['fund(uint256,uint256)'](tokens(1000), days(200), { from: owner });
    this.t0 = await this.geyser.lastUpdated()
  });

  describe('stake', function () {

    describe('when token transfer has not been approved', function () {
      it('should fail', async function () {
        await this.staking.transfer(alice, tokens(1000), { from: org });
        await expectRevert(
          this.geyser.stake(tokens(1), [], { from: alice }),
          'ERC20: transfer amount exceeds allowance'
        );
      });
    });

    describe('when token transfer allowance is insufficient', function () {
      it('should fail', async function () {
        await this.staking.transfer(alice, tokens(1000), { from: org });
        await this.staking.approve(this.geyser.address, tokens(100), { from: alice });
        await expectRevert(
          this.geyser.stake(tokens(101), [], { from: alice }),
          'ERC20: transfer amount exceeds allowance'
        );
      });
    });

    describe('when token balance is insufficient', function () {
      it('should fail', async function () {
        await this.staking.transfer(alice, tokens(1000), { from: org });
        await this.staking.approve(this.geyser.address, tokens(100000), { from: alice });
        await expectRevert(
          this.geyser.stake(tokens(1001), [], { from: alice }),
          'ERC20: transfer amount exceeds balance'
        );
      });
    });

    describe('when the amount is 0', function () {
      it('should fail', async function () {
        await this.staking.transfer(alice, tokens(1000), { from: org });
        await this.staking.approve(this.geyser.address, tokens(100000), { from: alice });
        await expectRevert(
          this.geyser.stake(tokens(0), [], { from: alice }),
          'Geyser: stake amount is zero'
        );
      });
    });

    describe('when the stake is successful', function () {
      beforeEach('alice stakes', async function () {
        await this.staking.transfer(alice, tokens(1000), { from: org });
        await this.staking.approve(this.geyser.address, tokens(100000), { from: alice });
        this.res = await this.geyser.stake(tokens(100), [], { from: alice });
      });
      it('should decrease user staking token balance', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(tokens(900));
      });

      it('should increase total staked', async function () {
        expect(await this.geyser.totalStaked()).to.be.bignumber.equal(tokens(100));
      });

      it('should update the total staked for user', async function () {
        expect(await this.geyser.totalStakedFor(alice)).to.be.bignumber.equal(tokens(100));
      });

      it('should emit Staked event', async function () {
        expectEvent(
          this.res,
          'Staked',
          {
            user: alice,
            amount: tokens(100),
            total: tokens(100)
          });
      });

    });


    describe('when two users have staked', function () {

      beforeEach('alice and bob stake', async function () {
        await this.staking.transfer(alice, tokens(1000), { from: org });
        await this.staking.transfer(bob, tokens(1000), { from: org });
        await this.staking.approve(this.geyser.address, tokens(100000), { from: alice });
        await this.staking.approve(this.geyser.address, tokens(100000), { from: bob });
        this.res0 = await this.geyser.stake(tokens(100), [], { from: alice });
        this.res1 = await this.geyser.stake(tokens(500), [], { from: bob });
      });

      it('should decrease each user staking token balance', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(tokens(900));
        expect(await this.staking.balanceOf(bob)).to.be.bignumber.equal(tokens(500));
      });

      it('should combine to increase total staked', async function () {
        expect(await this.geyser.totalStaked()).to.be.bignumber.equal(tokens(600));
      });

      it('should update the total staked tokens for each user', async function () {
        expect(await this.geyser.totalStakedFor(alice)).to.be.bignumber.equal(tokens(100));
        expect(await this.geyser.totalStakedFor(bob)).to.be.bignumber.equal(tokens(500));
      });

      it('should update the total staked shares for each user', async function () {
        expect((await this.geyser.userTotals(alice)).shares).to.be.bignumber.equal(shares(100));
        expect((await this.geyser.userTotals(bob)).shares).to.be.bignumber.equal(shares(500));
      });

      it('should combine to increase the total staking shares', async function () {
        expect(await this.geyser.totalStakingShares()).to.be.bignumber.equal(shares(600));
      });

      it('should emit each Staked event', async function () {
        expectEvent(
          this.res0,
          'Staked',
          { user: alice, amount: tokens(100), total: tokens(100) }
        );
        expectEvent(
          this.res1,
          'Staked',
          { user: bob, amount: tokens(500), total: tokens(500) }
        );
      });
    });
  });


  describe('stake for', function () {

    describe('when the beneficiary is zero address', function () {
      it('should fail', async function () {
        await expectRevert(
          this.geyser.stakeFor(constants.ZERO_ADDRESS, tokens(10), []),
          'Geyser: beneficiary is zero address'
        );
      });
    });

    describe('when the stake for is successful ', function () {
      beforeEach('alice stakes for bob', async function () {
        await this.staking.transfer(alice, tokens(1000), { from: org });
        await this.staking.approve(this.geyser.address, tokens(100000), { from: alice });
        this.res = await this.geyser.stakeFor(bob, tokens(200), [], { from: alice });
      });

      it('should decrease sender staking token balance', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(tokens(800));
        expect(await this.staking.balanceOf(bob)).to.be.bignumber.equal(tokens(0)); // this was always 0
      });

      it('should updated the total staked on behalf of the beneficiary', async function () {
        expect(await this.geyser.totalStakedFor(alice)).to.be.bignumber.equal(tokens(0));
        expect(await this.geyser.totalStakedFor(bob)).to.be.bignumber.equal(tokens(200));
      });

      it('should emit Staked event with bob as user', async function () {
        expectEvent(
          this.res,
          'Staked',
          { user: bob, amount: tokens(200), total: tokens(200) }
        );
      });
    });
  });


  describe('preview', function () {

    beforeEach(async function () {
      // funding and approval
      await this.staking.transfer(alice, tokens(1000), { from: org });
      await this.staking.transfer(bob, tokens(1000), { from: org });
      await this.staking.approve(this.geyser.address, tokens(100000), { from: alice });
      await this.staking.approve(this.geyser.address, tokens(100000), { from: bob });

      // alice stakes 100 tokens at 10 days
      await time.increaseTo(this.t0.add(days(10)));
      await this.geyser.stake(tokens(100), [], { from: alice });

      // bob stakes 1000 tokens at 10 days
      await this.geyser.stake(tokens(1000), [], { from: bob });

      // alice stakes another 300 tokens at 70 days
      await time.increaseTo(this.t0.add(days(70)));
      await this.geyser.stake(tokens(300), [], { from: alice });

      // advance last 30 days (below)

      // summary
      // 100 days elapsed
      // tokens unlocked: 500 (1000 @ 200 days)
      // time bonus: 0.5 -> 2.0 over 90 days
      // alice: 100 staked for 90 days, 300 staked for 30 days, 18000 staking days
      // bob: 1000 staked for 90 days, 90000 staking days
      // total: 108000 staking days
    });

    describe('when preview unstake amount is greater than user total', function () {
      it('should fail', async function () {
        await expectRevert(
          this.geyser.preview(alice, tokens(500), tokens(0)),
          'Geyser: preview amount exceeds balance'
        );
      });
    });

    describe('when preview unstake amount is zero', function () {
      beforeEach(async function () {
        await time.increaseTo(this.t0.add(days(100)));
        this.res = await this.geyser.preview(alice, tokens(0), tokens(0));
      });

      it('should return zero for reward', async function () {
        expect(this.res[0]).to.be.bignumber.equal(tokens(0));
      });

      it('should return zero for bonus', async function () {
        expect(this.res[1]).to.be.bignumber.equal(bonus(0));
      });

      it('should return zero for share seconds burned', async function () {
        expect(this.res[2]).to.be.bignumber.equal(shares(0));
      });

      it('should return 50% for expected total unlocked', async function () {
        expect(this.res[3]).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
      });
    });

    describe('when user previews unstake of full balance and update() has occurred', function () {
      beforeEach(async function () {
        await time.increaseTo(this.t0.add(days(100)));
        await this.geyser.update();
        this.res = await this.geyser.preview(alice, tokens(400), tokens(0));
      });

      it('should have 50% of rewards unlocked', async function () {
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
      });

      it('should return 1/3 total unlocked for expected boosted reward', async function () {
        // alice boosted: 18000 * 2.5x time bonus = 45000
        // portion of total boosted: 45000 / (90000 + 45000) = 1/3
        expect(this.res[0]).to.be.bignumber.closeTo(tokens(1 / 3 * 500), TOKEN_DELTA);
      });

      it('should return 2.5x for expected bonus', async function () {
        // 1/2 alice's staking shares seconds at 2.0x and 1/2 at 3.0x
        expect(this.res[1]).to.be.bignumber.closeTo(bonus(2.5), TOKEN_DELTA);
      });

      it('should return total for expected share seconds burned', async function () {
        expect(this.res[2]).to.be.bignumber.closeTo(
          shares(24 * 60 * 60 * 18000),
          shares(1 * 400) // one share second
        );
      });

      it('should return 50% for expected total unlocked', async function () {
        expect(this.res[3]).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
      });
    });

    describe('when user previews unstake of full balance and update() has NOT occurred', function () {
      beforeEach(async function () {
        await time.increaseTo(this.t0.add(days(100)));
        this.res = await this.geyser.preview(alice, tokens(400), tokens(0));
      });

      it('should have 35% of rewards unlocked', async function () {
        // 1000 tokens total, 70 / 200 days elapsed at last update
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(350), TOKEN_DELTA);
      });

      it('should return 1/3 total unlocked for expected boosted reward', async function () {
        // alice boosted: 18000 * 2.5x time bonus = 45000
        // portion of total boosted: 45000 / (90000 + 45000) = 1/3
        expect(this.res[0]).to.be.bignumber.closeTo(tokens(1 / 3 * 500), TOKEN_DELTA);
      });

      it('should return 2.5x for expected bonus', async function () {
        // 1/2 alice's staking shares seconds at 2.0x and 1/2 at 3.0x
        expect(this.res[1]).to.be.bignumber.closeTo(bonus(2.5), TOKEN_DELTA);
      });

      it('should return total for expected share seconds burned', async function () {
        expect(this.res[2]).to.be.bignumber.closeTo(
          shares(24 * 60 * 60 * 18000),
          shares(1 * 400) // one share second
        );
      });

      it('should return 50% for expected total unlocked', async function () {
        expect(this.res[3]).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
      });
    });

    describe('when preview unstake amount is partial balance', function () {
      beforeEach(async function () {
        await time.increaseTo(this.t0.add(days(100)));
        this.res = await this.geyser.preview(alice, tokens(200), tokens(0));
      });

      it('should return about 10% total unlocked for expected boosted reward', async function () {
        // alice boosted: 200 tokens * 30 days * 2.0x time bonus = 12000
        const inflated = 200 * 30 * 2.0;
        const portion = inflated / (108000 - 6000 + inflated);
        expect(this.res[0]).to.be.bignumber.closeTo(tokens(portion * 500), TOKEN_DELTA);
      });

      it('should return 2x for expected bonus', async function () {
        // most recent shares at 30 days
        expect(this.res[1]).to.be.bignumber.closeTo(bonus(2.0), TOKEN_DELTA);
      });

      it('should return 1/3 total for expected share seconds burned', async function () {
        expect(this.res[2]).to.be.bignumber.closeTo(
          shares(24 * 60 * 60 * 6000),
          shares(1 * 400) // one share second
        );
      });

      it('should return 50% for expected total unlocked', async function () {
        expect(this.res[3]).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
      });
    });

    describe('when user previews unstake with GYSR', function () {
      beforeEach(async function () {
        await time.increaseTo(this.t0.add(days(100)));
        this.res = await this.geyser.preview(alice, tokens(400), tokens(10));
        // gysr bonus at 10 tokens w/ 0.0 usage = ~4x
        this.mult = 1.0 + Math.log10((0.01 + 10.0) / (0.01 + 0.0));
      });

      it('should return 2/3 total unlocked for expected boosted reward', async function () {
        // alice boosted: 18000 * 4x gysr bonus * 2.5 time bonus = 180000
        // portion of total boosted: 180000 / (90000 + 180000) = ~2/3
        const inflated = 18000 * this.mult * 2.5;
        const portion = inflated / (108000 - 18000 + inflated);
        expect(this.res[0]).to.be.bignumber.closeTo(tokens(portion * 500), TOKEN_DELTA);
      });

      it('should return 10x for expected overall bonus', async function () {
        // 2.5x time bonus * 4x gysr bonus
        expect(this.res[1]).to.be.bignumber.closeTo(bonus(this.mult * 2.5), TOKEN_DELTA);
      });

      it('should return total for expected share seconds burned', async function () {
        expect(this.res[2]).to.be.bignumber.closeTo(
          shares(24 * 60 * 60 * 18000),
          shares(1 * 400) // one share second
        );
      });

      it('should return 50% for expected total unlocked', async function () {
        expect(this.res[3]).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
      });
    });
  });

  describe('unstake', function () {

    beforeEach('staking and holding', async function () {
      // funding and approval
      await this.staking.transfer(alice, tokens(1000), { from: org });
      await this.staking.transfer(bob, tokens(1000), { from: org });
      await this.staking.approve(this.geyser.address, tokens(100000), { from: alice });
      await this.staking.approve(this.geyser.address, tokens(100000), { from: bob });

      // alice stakes 100 tokens at 10 days
      await time.increaseTo(this.t0.add(days(10)));
      await this.geyser.stake(tokens(100), [], { from: alice });

      // bob stakes 100 tokens at 40 days
      await time.increaseTo(this.t0.add(days(40)));
      await this.geyser.stake(tokens(100), [], { from: bob });

      // alice stakes another 100 tokens at 70 days
      await time.increaseTo(this.t0.add(days(70)));
      await this.geyser.stake(tokens(100), [], { from: alice });

      // advance last 30 days (below)

      // summary
      // 100 days elapsed
      // tokens unlocked: 500 (1000 @ 200 days)
      // time bonus: 0.5 -> 2.0 over 90 days
      // alice: 100 staked for 90 days, 100 staked for 30 days, 12000 staking days
      // bob: 100 staked for 60 days, 6000 staking days
      // total: 18000 share days
    });

    describe('when unstake amount is zero', function () {
      it('should fail', async function () {
        await expectRevert(
          this.geyser.unstake(tokens(0), [], { from: alice }),
          'Geyser: unstake amount is zero'
        );
      });
    });

    describe('when unstake amount is greater than user total', function () {
      it('should fail', async function () {
        await expectRevert(
          this.geyser.unstake(tokens(300), [], { from: alice }),
          'Geyser: unstake amount exceeds balance'
        );
      });
    });

    describe('when one user unstakes all shares', function () {
      beforeEach(async function () {
        // expect 3.0 multiplier on first stake, and 2.0 multiplier on second stake
        const inflated = 100 * 90 * 3.0 + 100 * 30 * 2.0;
        this.portion = inflated / (18000 - 12000 + inflated);

        // advance last 30 days
        await time.increaseTo(this.t0.add(days(100)));

        // do unstake
        this.res = await this.geyser.unstake(tokens(200), [], { from: alice });
      });

      it('should return staking token to user balance', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

      it('should update the total staked for user', async function () {
        expect(await this.geyser.totalStakedFor(alice)).to.be.bignumber.equal(tokens(0));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.reward.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion * 500), TOKEN_DELTA
        );
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion) * 500), TOKEN_DELTA
        );
      });

      it('should emit unstake and reward events', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, amount: tokens(200), total: tokens(0) }
        );

        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion * 500), TOKEN_DELTA);
      });

      it('should have no remaining stakes for user', async function () {
        expect(await this.geyser.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
      });
    });

    describe('when one user unstakes some shares', function () {
      beforeEach(async function () {
        // first-in last-out
        // expect 50% of first stake to be returned at a 3.0 multiplier
        // expect full second stake to be returned at a 2.0 multiplier
        const raw = 50 * 90 + 100 * 30;
        const inflated = 50 * 90 * 3.0 + 100 * 30 * 2.0;
        this.portion = inflated / (18000 - raw + inflated);

        // advance last 30 days
        await time.increaseTo(this.t0.add(days(100)));

        // do unstake
        this.res = await this.geyser.unstake(tokens(150), [], { from: alice });
      });

      it('should return staking token to user balance', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(tokens(950));
      });

      it('should update the total staked for user', async function () {
        expect(await this.geyser.totalStakedFor(alice)).to.be.bignumber.equal(tokens(50));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.reward.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion * 500), TOKEN_DELTA
        );
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion) * 500), TOKEN_DELTA
        );
      });

      it('should emit unstake and reward events', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, amount: tokens(150), total: tokens(50) }
        );

        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion * 500), TOKEN_DELTA);
      });

      it('should have one remaining stake for user', async function () {
        expect(await this.geyser.stakeCount(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should unstake first-in last-out', async function () {
        const stake = await this.geyser.userStakes(alice, 0);
        expect(stake.timestamp).to.be.bignumber.closeTo(this.t0.add(days(10)), new BN(1));
      });
    });

    describe('when one user unstakes multiple times', function () {
      beforeEach(async function () {
        // first unstake
        // expect 50% of first stake to be returned at a 3.0 multiplier
        // expect full second stake to be returned at a 2.0 multiplier
        const raw0 = 50 * 90 + 100 * 30;
        const inflated0 = 50 * 90 * 3.0 + 100 * 30 * 2.0;
        this.portion0 = inflated0 / (18000 - raw0 + inflated0);

        // second unstake
        // expect 3.0 multiplier on last 50% of first stake
        const raw1 = 50 * 90;
        const inflated1 = raw1 * 3.0;
        this.portion1 = inflated1 / (18000 - raw0 - raw1 + inflated1);

        // advance last 30 days
        await time.increaseTo(this.t0.add(days(100)));

        // do first unstake
        await this.geyser.unstake(tokens(150), [], { from: alice });
        this.remainder = fromFixedPointBigNumber(await this.geyser.totalUnlocked(), 10, DECIMALS);

        // do second unstake
        this.res = await this.geyser.unstake(tokens(50), [], { from: alice });
      });

      it('should return remaining staking token to user balance', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

      it('should update the total staked for user', async function () {
        expect(await this.geyser.totalStakedFor(alice)).to.be.bignumber.equal(tokens(0));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.reward.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion0 * 500 + this.portion1 * this.remainder), TOKEN_DELTA
        );
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion1) * this.remainder), TOKEN_DELTA
        );
      });

      it('should emit unstake and reward events', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, amount: tokens(50), total: tokens(0) }
        );

        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion1 * this.remainder), TOKEN_DELTA);
      });

      it('should have no remaining stakes for user', async function () {
        expect(await this.geyser.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
      });

    });

    describe('when alice unstakes first', function () {
      beforeEach(async function () {
        // alice partial unstake
        // expect 50% of first stake to be returned at a 3.0 multiplier
        // expect full second stake to be returned at a 2.0 multiplier
        const raw0 = 50 * 90 + 100 * 30;
        const inflated0 = 50 * 90 * 3.0 + 100 * 30 * 2.0;
        this.portion0 = inflated0 / (18000 - raw0 + inflated0);

        // bob full unstake
        // expect 2.5 multiplier on stake
        const raw1 = 100 * 60;
        const inflated1 = raw1 * 2.5;
        this.portion1 = inflated1 / (18000 - raw0 - raw1 + inflated1);

        // advance last 30 days
        await time.increaseTo(this.t0.add(days(100)));

        // alice unstakes
        await this.geyser.unstake(tokens(150), [], { from: alice });
        this.remainder = fromFixedPointBigNumber(await this.geyser.totalUnlocked(), 10, DECIMALS);

        // bob unstakes
        this.res = await this.geyser.unstake(tokens(100), [], { from: bob });
      });

      it('should return staking tokens to first user balance', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(tokens(950));
      });

      it('should return staking tokens to second user balance', async function () {
        expect(await this.staking.balanceOf(bob)).to.be.bignumber.equal(tokens(1000));
      });

      it('should update the total staked for first user', async function () {
        expect(await this.geyser.totalStakedFor(alice)).to.be.bignumber.equal(tokens(50));
      });

      it('should update the total staked for second user', async function () {
        expect(await this.geyser.totalStakedFor(bob)).to.be.bignumber.equal(tokens(0));
      });

      it('should disburse expected amount of reward token to first user', async function () {
        expect(await this.reward.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion0 * 500), TOKEN_DELTA
        );
      });

      it('should disburse expected amount of reward token to second user', async function () {
        expect(await this.reward.balanceOf(bob)).to.be.bignumber.closeTo(
          tokens(this.portion1 * this.remainder), TOKEN_DELTA
        );
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion1) * this.remainder), TOKEN_DELTA
        );
      });

      it('should emit unstake and reward events', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: bob, amount: tokens(100), total: tokens(0) }
        );

        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(bob);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion1 * this.remainder), TOKEN_DELTA);
      });

      it('should have no remaining stakes for second user', async function () {
        expect(await this.geyser.stakeCount(bob)).to.be.bignumber.equal(new BN(0));
      });

      it('should reward alice more than bob', async function () {
        expect(await this.reward.balanceOf(alice)).to.be.bignumber.greaterThan(
          await this.reward.balanceOf(bob)
        );
      });
    });

    describe('when bob unstakes first', function () {
      beforeEach(async function () {
        // bob partial unstake
        // expect 2.5 multiplier
        const raw0 = 75 * 60;
        const inflated0 = raw0 * 2.5;
        this.portion0 = inflated0 / (18000 - raw0 + inflated0);

        // alice partial unstake
        // expect second stake to be returned at a 2.0 multiplier
        const raw1 = 50 * 90 + 100 * 30;
        const inflated1 = 50 * 90 * 3.0 + 100 * 30 * 2.0;
        this.portion1 = inflated1 / (18000 - raw0 - raw1 + inflated1);

        // advance last 30 days
        await time.increaseTo(this.t0.add(days(100)));

        // bob unstakes
        await this.geyser.unstake(tokens(75), [], { from: bob });
        this.remainder = fromFixedPointBigNumber(await this.geyser.totalUnlocked(), 10, DECIMALS);

        // alice unstakes
        this.res = await this.geyser.unstake(tokens(150), [], { from: alice });
      });

      it('should return staking tokens to first user balance', async function () {
        expect(await this.staking.balanceOf(bob)).to.be.bignumber.equal(tokens(975));
      });

      it('should return staking tokens to second user balance', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(tokens(950));
      });

      it('should update the total staked for first user', async function () {
        expect(await this.geyser.totalStakedFor(bob)).to.be.bignumber.equal(tokens(25));
      });

      it('should update the total staked for second user', async function () {
        expect(await this.geyser.totalStakedFor(alice)).to.be.bignumber.equal(tokens(50));
      });

      it('should disburse expected amount of reward token to first user', async function () {
        expect(await this.reward.balanceOf(bob)).to.be.bignumber.closeTo(
          tokens(this.portion0 * 500), TOKEN_DELTA
        );
      });

      it('should disburse expected amount of reward token to second user', async function () {
        expect(await this.reward.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion1 * this.remainder), TOKEN_DELTA
        );
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion1) * this.remainder), TOKEN_DELTA
        );
      });

      it('should emit unstake and reward events', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, amount: tokens(150), total: tokens(50) }
        );

        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion1 * this.remainder), TOKEN_DELTA);
      });

      it('should have one remaining stake for first user', async function () {
        expect(await this.geyser.stakeCount(bob)).to.be.bignumber.equal(new BN(1));
      });

      it('should have one remaining stake for second user', async function () {
        expect(await this.geyser.stakeCount(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should reward bob more than alice', async function () {
        expect(await this.reward.balanceOf(bob)).to.be.bignumber.greaterThan(
          await this.reward.balanceOf(alice)
        );
      });
    });

  });


  describe('unstake with GYSR', function () {

    beforeEach('staking and holding', async function () {
      // funding and approval
      await this.staking.transfer(alice, tokens(1000), { from: org });
      await this.staking.transfer(bob, tokens(1000), { from: org });
      await this.staking.approve(this.geyser.address, tokens(100000), { from: alice });
      await this.staking.approve(this.geyser.address, tokens(100000), { from: bob });
      await this.gysr.transfer(alice, tokens(10), { from: org });
      await this.gysr.transfer(bob, tokens(10), { from: org });
      await this.gysr.approve(this.geyser.address, tokens(100000), { from: alice });
      await this.gysr.approve(this.geyser.address, tokens(100000), { from: bob });

      // alice stakes 100 tokens at 10 days
      await time.increaseTo(this.t0.add(days(10)));
      await this.geyser.stake(tokens(100), [], { from: alice });

      // bob stakes 100 tokens at 40 days
      await time.increaseTo(this.t0.add(days(40)));
      await this.geyser.stake(tokens(100), [], { from: bob });

      // alice stakes another 100 tokens at 70 days
      await time.increaseTo(this.t0.add(days(70)));
      await this.geyser.stake(tokens(100), [], { from: alice });

      // advance last 30 days (below)

      // summary
      // 100 days elapsed
      // tokens unlocked: 500 (1000 @ 200 days)
      // time bonus: 0.5 -> 2.0 over 90 days
      // alice: 100 staked for 90 days, 100 staked for 30 days, 12000 staking days
      // bob: 100 staked for 60 days, 6000 staking days
      // total: 18000 share days
    });

    describe('when GYSR amount is between 0.0 and 1.0', function () {
      it('should fail', async function () {
        await expectRevert(
          this.geyser.methods['unstake(uint256,uint256,bytes)'](
            tokens(200), tokens(0.5), [], { from: alice }
          ),
          'Geyser: GYSR amount is between 0 and 1'
        );
      });
    });

    describe('when GYSR amount is greater than user total', function () {
      it('should fail', async function () {
        await expectRevert(
          this.geyser.methods['unstake(uint256,uint256,bytes)'](
            tokens(200), tokens(20), [], { from: alice }
          ),
          'ERC20: transfer amount exceeds balance.'
        );
      });
    });

    describe('when one user unstakes all shares', function () {
      beforeEach(async function () {
        // expect 3.0x time multiplier on first stake, 2.0x time multiplier on second stake
        // expect 3.0x gysr bonus for 1.0 tokens at initial 0 usage
        const mult = 1.0 + Math.log10((0.01 + 1.0) / (0.01 + 0.0));
        const inflated = mult * (100 * 90 * 3.0 + 100 * 30 * 2.0);
        this.portion = inflated / (18000 - 12000 + inflated);

        // advance last 30 days
        await time.increaseTo(this.t0.add(days(100)));

        this.res = await this.geyser.methods['unstake(uint256,uint256,bytes)'](
          tokens(200), tokens(1), [], { from: alice }
        );
      });

      it('should return staking token to user balance', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

      it('should update the total staked for user', async function () {
        expect(await this.geyser.totalStakedFor(alice)).to.be.bignumber.equal(tokens(0));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.reward.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion * 500), TOKEN_DELTA
        );
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion) * 500), TOKEN_DELTA
        );
      });

      it('should transfer GYSR to Geyser contract ', async function () {
        expect(await this.gysr.balanceOf(this.geyser.address)).to.be.bignumber.equal(tokens(1.0));
      });

      it('should decrease GYSR balance of user', async function () {
        expect(await this.gysr.balanceOf(alice)).to.be.bignumber.equal(tokens(9.0));
      });

      it('should emit unstake, gysr, and reward events', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, amount: tokens(200), total: tokens(0) }
        );

        expectEvent(
          this.res,
          'GysrSpent',
          { user: alice, amount: tokens(1) }
        );

        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion * 500), TOKEN_DELTA);
      });
    });

    describe('when one user unstakes some shares', function () {

      beforeEach(async function () {
        // first-in last-out
        // expect 50% of first stake to be returned at a 3.0 multiplier
        // expect full second stake to be returned at a 2.0 multiplier
        // expect 3.0x gysr bonus for 1.0 tokens at initial 0 usage
        const mult = 1.0 + Math.log10((0.01 + 1.0) / (0.01 + 0.0));
        const raw = 50 * 90 + 100 * 30;
        const inflated = mult * (50 * 90 * 3.0 + 100 * 30 * 2.0);
        this.portion = inflated / (18000 - raw + inflated);

        // advance last 30 days
        await time.increaseTo(this.t0.add(days(100)));

        // do unstake
        this.res = await this.geyser.methods['unstake(uint256,uint256,bytes)'](
          tokens(150), tokens(1), [], { from: alice }
        );
      });

      it('should return staking token to user balance', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(tokens(950));
      });

      it('should update the total staked for user', async function () {
        expect(await this.geyser.totalStakedFor(alice)).to.be.bignumber.equal(tokens(50));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.reward.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion * 500), TOKEN_DELTA
        );
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion) * 500), TOKEN_DELTA
        );
      });

      it('should transfer GYSR to Geyser contract ', async function () {
        expect(await this.gysr.balanceOf(this.geyser.address)).to.be.bignumber.equal(tokens(1.0));
      });

      it('should decrease GYSR balance of user', async function () {
        expect(await this.gysr.balanceOf(alice)).to.be.bignumber.equal(tokens(9.0));
      });

      it('should emit unstake, gysr, and reward events', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, amount: tokens(150), total: tokens(50) }
        );

        expectEvent(
          this.res,
          'GysrSpent',
          { user: alice, amount: tokens(1) }
        );

        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion * 500), TOKEN_DELTA);
      });

      it('should have one remaining stake for user', async function () {
        expect(await this.geyser.stakeCount(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should unstake first-in last-out', async function () {
        const stake = await this.geyser.userStakes(alice, 0);
        expect(stake.timestamp).to.be.bignumber.closeTo(this.t0.add(days(10)), new BN(1));
      });
    });

    describe('when one user unstakes multiple times', function () {
      beforeEach(async function () {
        // first unstake
        // expect 50% of first stake to be returned at a 3.0 multiplier
        // expect full second stake to be returned at a 2.0 multiplier
        // expect 3.0x gysr bonus for 1.0 tokens at initial 0 usage
        const mult0 = 1.0 + Math.log10((0.01 + 1.0) / (0.01 + 0.0));
        const raw0 = 50 * 90 + 100 * 30;
        const inflated0 = mult0 * (50 * 90 * 3.0 + 100 * 30 * 2.0);
        this.portion0 = inflated0 / (18000 - raw0 + inflated0);

        // second unstake
        // expect 3.0 multiplier on last 50% of first stake
        // expect 2.0x gysr bonus for 1.0 tokens at initial 1.0 usage
        const mult1 = 1.0 + Math.log10((0.01 + 1.0) / (0.01 + 1.0));
        const raw1 = 50 * 90;
        const inflated1 = mult1 * raw1 * 3.0;
        this.portion1 = inflated1 / (18000 - raw0 - raw1 + inflated1);

        // advance last 30 days
        await time.increaseTo(this.t0.add(days(100)));

        // do first unstake
        await this.geyser.methods['unstake(uint256,uint256,bytes)'](
          tokens(150), tokens(1), [], { from: alice }
        );
        this.remainder = fromFixedPointBigNumber(await this.geyser.totalUnlocked(), 10, DECIMALS);

        // do second unstake
        this.res = await this.geyser.methods['unstake(uint256,uint256,bytes)'](
          tokens(50), tokens(1), [], { from: alice }
        );
      });

      it('should return remaining staking token to user balance', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

      it('should update the total staked for user', async function () {
        expect(await this.geyser.totalStakedFor(alice)).to.be.bignumber.equal(tokens(0));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.reward.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion0 * 500 + this.portion1 * this.remainder), TOKEN_DELTA
        );
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion1) * this.remainder), TOKEN_DELTA
        );
      });

      it('should transfer GYSR to Geyser contract ', async function () {
        expect(await this.gysr.balanceOf(this.geyser.address)).to.be.bignumber.equal(tokens(2.0));
      });

      it('should decrease GYSR balance of user', async function () {
        expect(await this.gysr.balanceOf(alice)).to.be.bignumber.equal(tokens(8.0));
      });

      it('should emit unstake, gysr, and reward events', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, amount: tokens(50), total: tokens(0) }
        );

        expectEvent(
          this.res,
          'GysrSpent',
          { user: alice, amount: tokens(1) }
        );

        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion1 * this.remainder), TOKEN_DELTA);
      });

      it('should have no remaining stakes for user', async function () {
        expect(await this.geyser.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
      });

    });

  });


  describe('unstake with single user', function () {

    beforeEach('staking and holding', async function () {
      // funding and approval
      await this.staking.transfer(alice, tokens(1000), { from: org });
      await this.staking.approve(this.geyser.address, tokens(100000), { from: alice });
      await this.staking.approve(this.geyser.address, tokens(100000), { from: bob });

      // alice stakes 100 tokens at 0 days
      await this.geyser.stake(tokens(100), [], { from: alice });

      // advance 50 days
      await time.increaseTo(this.t0.add(days(50)));
      await this.geyser.update();

      // summary
      // 50 days elapsed
      // tokens unlocked: 250 (1000 @ 200 days)
      // alice has all shares
    });

    describe('when user unstakes all shares', function () {
      beforeEach(async function () {
        this.res = await this.geyser.unstake(tokens(100), [], { from: alice });
      });

      it('should emit unstake and reward events', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, amount: tokens(100), total: tokens(0) }
        );

        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(250), TOKEN_DELTA);
      });

      it('should return staking token to user balance', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

      it('should distribute full unlocked rewards to user', async function () {
        expect(await this.reward.balanceOf(alice)).to.be.bignumber.closeTo(tokens(250), TOKEN_DELTA);
      });

    });

    describe('when user unstakes multiple times, one large, one very small', function () {
      beforeEach(async function () {
        this.res0 = await this.geyser.unstake(tokens(100).sub(new BN(1)), [], { from: alice });
        this.res1 = await this.geyser.unstake(new BN(1), [], { from: alice });
      });

      it('large unstake should emit unstake and reward events', async function () {
        expectEvent(
          this.res0,
          'Unstaked',
          { user: alice, amount: tokens(100).sub(new BN(1)), total: new BN(1) }
        );

        const e = this.res0.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
      });

      it('small unstake should emit unstake and reward events', async function () {
        expectEvent(
          this.res1,
          'Unstaked',
          { user: alice, amount: new BN(1), total: tokens(0) }
        );

        const e = this.res1.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
      });

      it('should return all staking token to user balance', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

      it('should distribute full unlocked rewards to user', async function () {
        expect(await this.reward.balanceOf(alice)).to.be.bignumber.closeTo(tokens(250), TOKEN_DELTA);
      });
    });

  });

});

describe('staking when unfunded', function () {
  const [owner, org, alice, bob] = accounts;

  beforeEach('setup', async function () {
    // base setup
    this.gysr = await GeyserToken.new({ from: org });
    this.factory = await GeyserFactory.new(this.gysr.address, { from: org });
    this.reward = await TestToken.new({ from: org });
    this.staking = await TestLiquidityToken.new({ from: org });
    // owner creates geyser
    this.geyser = await Geyser.new(
      this.staking.address,
      this.reward.address,
      bonus(0.5),
      bonus(2.0),
      days(90),
      this.gysr.address,
      { from: owner }
    );
    // (no funding)

    // acquire staking tokens and approval
    await this.staking.transfer(alice, tokens(1000), { from: org });
    await this.staking.transfer(bob, tokens(1000), { from: org });
    await this.staking.approve(this.geyser.address, tokens(100000), { from: alice });
    await this.staking.approve(this.geyser.address, tokens(100000), { from: bob });
  });

  describe('stake', function () {

    describe('when multiple users stake', function () {

      beforeEach('alice and bob stake', async function () {
        this.res0 = await this.geyser.stake(tokens(100), [], { from: alice });
        this.res1 = await this.geyser.stake(tokens(500), [], { from: bob });
      });

      it('should decrease each user staking token balance', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(tokens(900));
        expect(await this.staking.balanceOf(bob)).to.be.bignumber.equal(tokens(500));
      });

      it('should combine to increase total staked', async function () {
        expect(await this.geyser.totalStaked()).to.be.bignumber.equal(tokens(600));
      });

      it('should update the total staked tokens for each user', async function () {
        expect(await this.geyser.totalStakedFor(alice)).to.be.bignumber.equal(tokens(100));
        expect(await this.geyser.totalStakedFor(bob)).to.be.bignumber.equal(tokens(500));
      });

      it('should update the total staked shares for each user', async function () {
        expect((await this.geyser.userTotals(alice)).shares).to.be.bignumber.equal(shares(100));
        expect((await this.geyser.userTotals(bob)).shares).to.be.bignumber.equal(shares(500));
      });

      it('should combine to increase the total staking shares', async function () {
        expect(await this.geyser.totalStakingShares()).to.be.bignumber.equal(shares(600));
      });

      it('should emit each Staked event', async function () {
        expectEvent(
          this.res0,
          'Staked',
          { user: alice, amount: tokens(100), total: tokens(100) }
        );
        expectEvent(
          this.res1,
          'Staked',
          { user: bob, amount: tokens(500), total: tokens(500) }
        );
      });

    });

  });

  describe('earn', function () {

    describe('when multiple users are accruing rewards', function () {

      beforeEach(async function () {
        // alice and bob stake
        await this.geyser.stake(tokens(100), [], { from: alice });
        await this.geyser.stake(tokens(500), [], { from: bob });
        this.t0 = await this.geyser.lastUpdated();

        // advance 30 days
        await time.increaseTo(this.t0.add(days(30)));

        // update (user totals only updated for sender)
        await this.geyser.update({ from: alice });
        await this.geyser.update({ from: bob });
      });

      it('should update users earned share seconds', async function () {
        expect((await this.geyser.userTotals(alice)).shareSeconds).to.be.bignumber.closeTo(
          shares(100 * 30 * 24 * 60 * 60),
          shares(100) // one share second
        );
        expect((await this.geyser.userTotals(bob)).shareSeconds).to.be.bignumber.closeTo(
          shares(500 * 30 * 24 * 60 * 60),
          shares(500) // one share second
        );
      });

      it('should update total share seconds', async function () {
        expect(await this.geyser.totalStakingShareSeconds()).to.be.bignumber.closeTo(
          shares(600 * 30 * 24 * 60 * 60),
          shares(600) // one share second
        );
      });
    });
  });

  describe('preview', function () {

    describe('when previewing full unstake', function () {

      beforeEach(async function () {
        // alice stakes
        await this.geyser.stake(tokens(100), [], { from: alice });
        this.t0 = await this.geyser.lastUpdated();

        // advance 30 days
        await time.increaseTo(this.t0.add(days(30)));

        // preview
        this.res = await this.geyser.methods['preview()']({ from: alice });
      });

      it('should return zero for reward', async function () {
        expect(this.res[0]).to.be.bignumber.equal(tokens(0));
      });

      it('should return 2.0x for bonus', async function () {
        expect(this.res[1]).to.be.bignumber.closeTo(bonus(2.0), TOKEN_DELTA);
      });

      it('should return full share seconds burned', async function () {
        expect(this.res[2]).to.be.bignumber.closeTo(
          shares(100 * 30 * 24 * 60 * 60),
          shares(100) // one share second
        );
      });

      it('should return zero for total unlocked', async function () {
        expect(this.res[3]).to.be.bignumber.equal(tokens(0));
      });
    });

  });

  describe('unstake', function () {

    describe('when one user unstakes all shares', function () {

      beforeEach(async function () {
        // alice and bob stake
        await this.geyser.stake(tokens(100), [], { from: alice });
        await this.geyser.stake(tokens(100), [], { from: bob });
        this.t0 = await this.geyser.lastUpdated();

        // advance 30 days
        await time.increaseTo(this.t0.add(days(30)));

        // do unstake
        this.res = await this.geyser.unstake(tokens(100), [], { from: alice });
      });

      it('should return staking token to user balance', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

      it('should update the total staked for user', async function () {
        expect(await this.geyser.totalStakedFor(alice)).to.be.bignumber.equal(tokens(0));
      });

      it('should not disburse any reward token to user', async function () {
        expect(await this.reward.balanceOf(alice)).to.be.bignumber.equal(tokens(0));
      });

      it('should emit unstake event', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, amount: tokens(100), total: tokens(0) }
        );
      });

      it('should not emit reward event', async function () {
        expect(this.res.logs.filter(l => l.event === 'RewardsDistributed').length).to.be.equal(0);
      });

      it('should have no remaining stakes for user', async function () {
        expect(await this.geyser.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
      });

    });

  });

});

describe('staking against Boiler', function () {
  const [owner, org, alice, bob] = accounts;

  beforeEach('setup', async function () {
    // base setup
    this.gysr = await GeyserToken.new({ from: org });
    this.factory = await GeyserFactory.new(this.gysr.address, { from: org });
    this.reward = await TestToken.new({ from: org });
    this.staking = await TestLiquidityToken.new({ from: org });
    // owner creates geyser
    this.geyser = await Geyser.new(
      this.staking.address,
      this.reward.address,
      bonus(0.5),
      bonus(2.0),
      days(90),
      this.gysr.address,
      { from: owner }
    );
    // fund for future start to configure as "Boiler"
    await this.reward.transfer(owner, tokens(10000), { from: org });
    await this.reward.approve(this.geyser.address, tokens(100000), { from: owner });
    this.t0 = await time.latest();
    await this.geyser.methods['fund(uint256,uint256,uint256)'](
      tokens(1000), days(90), this.t0.add(days(40)),
      { from: owner }
    );

    // acquire staking tokens and approval
    await this.staking.transfer(alice, tokens(1000), { from: org });
    await this.staking.transfer(bob, tokens(1000), { from: org });
    await this.staking.approve(this.geyser.address, tokens(100000), { from: alice });
    await this.staking.approve(this.geyser.address, tokens(100000), { from: bob });
  });

  describe('stake', function () {

    describe('when multiple users stake', function () {

      beforeEach('alice and bob stake', async function () {
        this.res0 = await this.geyser.stake(tokens(100), [], { from: alice });
        this.res1 = await this.geyser.stake(tokens(500), [], { from: bob });
      });

      it('should decrease each user staking token balance', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(tokens(900));
        expect(await this.staking.balanceOf(bob)).to.be.bignumber.equal(tokens(500));
      });

      it('should combine to increase total staked', async function () {
        expect(await this.geyser.totalStaked()).to.be.bignumber.equal(tokens(600));
      });

      it('should update the total staked tokens for each user', async function () {
        expect(await this.geyser.totalStakedFor(alice)).to.be.bignumber.equal(tokens(100));
        expect(await this.geyser.totalStakedFor(bob)).to.be.bignumber.equal(tokens(500));
      });

      it('should update the total staked shares for each user', async function () {
        expect((await this.geyser.userTotals(alice)).shares).to.be.bignumber.equal(shares(100));
        expect((await this.geyser.userTotals(bob)).shares).to.be.bignumber.equal(shares(500));
      });

      it('should combine to increase the total staking shares', async function () {
        expect(await this.geyser.totalStakingShares()).to.be.bignumber.equal(shares(600));
      });

      it('should emit each Staked event', async function () {
        expectEvent(
          this.res0,
          'Staked',
          { user: alice, amount: tokens(100), total: tokens(100) }
        );
        expectEvent(
          this.res1,
          'Staked',
          { user: bob, amount: tokens(500), total: tokens(500) }
        );
      });

    });

  });

  describe('earn', function () {

    describe('when multiple users are accruing rewards', function () {

      beforeEach(async function () {
        // alice and bob stake
        await this.geyser.stake(tokens(100), [], { from: alice });
        await this.geyser.stake(tokens(500), [], { from: bob });
        this.t0 = await this.geyser.lastUpdated();

        // advance 30 days
        await time.increaseTo(this.t0.add(days(30)));

        // update (user totals only updated for sender)
        await this.geyser.update({ from: alice });
        await this.geyser.update({ from: bob });
      });

      it('should update users earned share seconds', async function () {
        expect((await this.geyser.userTotals(alice)).shareSeconds).to.be.bignumber.closeTo(
          shares(100 * 30 * 24 * 60 * 60),
          shares(100) // one share second
        );
        expect((await this.geyser.userTotals(bob)).shareSeconds).to.be.bignumber.closeTo(
          shares(500 * 30 * 24 * 60 * 60),
          shares(500) // one share second
        );
      });

      it('should update total share seconds', async function () {
        expect(await this.geyser.totalStakingShareSeconds()).to.be.bignumber.closeTo(
          shares(600 * 30 * 24 * 60 * 60),
          shares(600) // one share second
        );
      });
    });
  });

  describe('preview', function () {

    describe('when previewing full unstake before funding start', function () {

      beforeEach(async function () {
        // alice stakes at day 10
        await time.increaseTo(this.t0.add(days(10)));
        await this.geyser.stake(tokens(100), [], { from: alice });

        // advance 15 days
        await time.increaseTo(this.t0.add(days(25)));

        // preview
        this.res = await this.geyser.methods['preview()']({ from: alice });
      });

      it('should return zero for reward', async function () {
        expect(this.res[0]).to.be.bignumber.closeTo(tokens(0), TOKEN_DELTA);
      });

      it('should return 1.75x for bonus', async function () {
        expect(this.res[1]).to.be.bignumber.closeTo(bonus(1.75), TOKEN_DELTA);
      });

      it('should return full share seconds burned', async function () {
        expect(this.res[2]).to.be.bignumber.closeTo(
          shares(100 * 15 * 24 * 60 * 60),
          shares(100) // one share second
        );
      });

      it('should return zero for total unlocked', async function () {
        expect(this.res[3]).to.be.bignumber.closeTo(tokens(0), TOKEN_DELTA);
      });
    });

    describe('when previewing full unstake 30 days into funding', function () {

      beforeEach(async function () {
        // alice stakes at day 10
        await time.increaseTo(this.t0.add(days(10)));
        await this.geyser.stake(tokens(100), [], { from: alice });

        // advance 60 days
        await time.increaseTo(this.t0.add(days(70)));

        // preview
        this.res = await this.geyser.methods['preview()']({ from: alice });
      });

      it('should return full unlocked for expected reward', async function () {
        expect(this.res[0]).to.be.bignumber.closeTo(tokens(1 / 3 * 1000), TOKEN_DELTA);
      });

      it('should return 2.5x for bonus', async function () {
        expect(this.res[1]).to.be.bignumber.closeTo(bonus(2.5), TOKEN_DELTA);
      });

      it('should return full share seconds burned', async function () {
        expect(this.res[2]).to.be.bignumber.closeTo(
          shares(100 * 60 * 24 * 60 * 60),
          shares(100) // one share second
        );
      });

      it('should return 1/3 funding for total unlocked', async function () {
        expect(this.res[3]).to.be.bignumber.closeTo(tokens(1 / 3 * 1000), TOKEN_DELTA);
      });
    });

  });

  describe('unstake', function () {

    describe('when one user unstakes all shares before funding start', function () {

      beforeEach(async function () {
        // alice and bob stake at day 10
        await time.increaseTo(this.t0.add(days(10)));
        await this.geyser.stake(tokens(100), [], { from: alice });
        await this.geyser.stake(tokens(100), [], { from: bob });

        // advance 15 days
        await time.increaseTo(this.t0.add(days(25)));

        // do unstake
        this.res = await this.geyser.unstake(tokens(100), [], { from: alice });
      });

      it('should return staking token to user balance', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

      it('should update the total staked for user', async function () {
        expect(await this.geyser.totalStakedFor(alice)).to.be.bignumber.equal(tokens(0));
      });

      it('should not disburse any reward token to user', async function () {
        expect(await this.reward.balanceOf(alice)).to.be.bignumber.equal(tokens(0));
      });

      it('should emit unstake event', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, amount: tokens(100), total: tokens(0) }
        );
      });

      it('should not emit reward event', async function () {
        expect(this.res.logs.filter(l => l.event === 'RewardsDistributed').length).to.be.equal(0);
      });

      it('should have no remaining stakes for user', async function () {
        expect(await this.geyser.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
      });

    });

    describe('when one user unstakes all shares 30 days into funding start', function () {

      beforeEach(async function () {
        // alice and bob stake at day 10
        await time.increaseTo(this.t0.add(days(10)));
        await this.geyser.stake(tokens(100), [], { from: alice });
        await this.geyser.stake(tokens(100), [], { from: bob });

        // alice: 6000 share days
        // bob: 6000 share days
        // total: 12000 share days
        // bonus: 2.5x at 60 days
        // unlocked: 1/3 of 1000 at 30 days into period
        this.portion = 2.5 * 6000 / (12000 - 6000 + 2.5 * 6000);
        this.unlocked = 1 / 3 * 1000;

        // advance 60 days
        await time.increaseTo(this.t0.add(days(70)));

        // do unstake
        this.res = await this.geyser.unstake(tokens(100), [], { from: alice });
      });

      it('should return staking token to user balance', async function () {
        expect(await this.staking.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

      it('should update the total staked for user', async function () {
        expect(await this.geyser.totalStakedFor(alice)).to.be.bignumber.equal(tokens(0));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.reward.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion * this.unlocked), TOKEN_DELTA
        );
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion) * this.unlocked), TOKEN_DELTA
        );
      });

      it('should emit unstake and reward events', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, amount: tokens(100), total: tokens(0) }
        );

        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion * this.unlocked), TOKEN_DELTA);
      });

      it('should have no remaining stakes for user', async function () {
        expect(await this.geyser.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
      });

    });

  });

});
