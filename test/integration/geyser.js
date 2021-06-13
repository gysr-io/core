// integrations tests for "Geyser" Pool
// made up of ERC20StakingModule and ERC20CompetitiveRewardModule

const { accounts, contract, web3 } = require('@openzeppelin/test-environment');
const { BN, time, expectEvent, expectRevert, constants, singletons } = require('@openzeppelin/test-helpers');
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

const Pool = contract.fromArtifact('Pool');
const PoolFactory = contract.fromArtifact('PoolFactory');
const GeyserToken = contract.fromArtifact('GeyserToken');
const ERC20StakingModuleFactory = contract.fromArtifact('ERC20StakingModuleFactory');
const ERC20StakingModule = contract.fromArtifact('ERC20StakingModule');
const ERC20CompetitiveRewardModuleFactory = contract.fromArtifact('ERC20CompetitiveRewardModuleFactory');
const ERC20CompetitiveRewardModule = contract.fromArtifact('ERC20CompetitiveRewardModule');
const TestToken = contract.fromArtifact('TestToken');
const TestLiquidityToken = contract.fromArtifact('TestLiquidityToken');

// need decent tolerance to account for potential timing error
const TOKEN_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);
const SHARE_DELTA = toFixedPointBigNumber(0.0001 * (10 ** 6), 10, DECIMALS);
const BONUS_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);


describe('Geyser integration', function () {
  const [owner, org, treasury, alice, bob, other] = accounts;

  beforeEach('setup', async function () {
    // base setup
    this.gysr = await GeyserToken.new({ from: org });
    this.factory = await PoolFactory.new(this.gysr.address, treasury, { from: org });
    this.stakingModuleFactory = await ERC20StakingModuleFactory.new({ from: org });
    this.rewardModuleFactory = await ERC20CompetitiveRewardModuleFactory.new({ from: org });
    this.stk = await TestLiquidityToken.new({ from: org });
    this.rew = await TestToken.new({ from: org });

    // encode sub factory arguments
    const stakingdata = web3.eth.abi.encodeParameter('address', this.stk.address);
    const rewarddata = web3.eth.abi.encodeParameters(
      ['address', 'uint256', 'uint256', 'uint256'],
      [this.rew.address, bonus(0.5).toString(), bonus(2.0).toString(), days(90).toString()]
    );

    // whitelist sub factories
    await this.factory.setWhitelist(this.stakingModuleFactory.address, new BN(1), { from: org });
    await this.factory.setWhitelist(this.rewardModuleFactory.address, new BN(2), { from: org });

    // create pool
    const res = await this.factory.create(
      this.stakingModuleFactory.address,
      this.rewardModuleFactory.address,
      stakingdata,
      rewarddata,
      { from: owner }
    );
    const addr = res.logs.filter(l => l.event === 'PoolCreated')[0].args.pool;
    this.pool = await Pool.at(addr);

    // get references to submodules
    this.staking = await ERC20StakingModule.at(await this.pool.stakingModule());
    this.reward = await ERC20CompetitiveRewardModule.at(await this.pool.rewardModule());

    // owner funds pool
    await this.rew.transfer(owner, tokens(10000), { from: org });
    await this.rew.approve(this.reward.address, tokens(100000), { from: owner });
    await this.reward.methods['fund(uint256,uint256)'](tokens(1000), days(200), { from: owner });
    this.t0 = await this.reward.lastUpdated()
  });

  describe('stake', function () {

    describe('when token transfer has not been approved', function () {
      it('should fail', async function () {
        await this.stk.transfer(alice, tokens(1000), { from: org });
        await expectRevert(
          this.pool.stake(tokens(1), [], [], { from: alice }),
          'ERC20: transfer amount exceeds allowance'
        );
      });
    });

    describe('when token transfer allowance is insufficient', function () {
      it('should fail', async function () {
        await this.stk.transfer(alice, tokens(1000), { from: org });
        await this.stk.approve(this.staking.address, tokens(100), { from: alice });
        await expectRevert(
          this.pool.stake(tokens(101), [], [], { from: alice }),
          'ERC20: transfer amount exceeds allowance'
        );
      });
    });

    describe('when token balance is insufficient', function () {
      it('should fail', async function () {
        await this.stk.transfer(alice, tokens(1000), { from: org });
        await this.stk.approve(this.staking.address, tokens(100000), { from: alice });
        await expectRevert(
          this.pool.stake(tokens(1001), [], [], { from: alice }),
          'ERC20: transfer amount exceeds balance'
        );
      });
    });

    describe('when the amount is 0', function () {
      it('should fail', async function () {
        await this.stk.transfer(alice, tokens(1000), { from: org });
        await this.stk.approve(this.staking.address, tokens(100000), { from: alice });
        await expectRevert(
          this.pool.stake(tokens(0), [], [], { from: alice }),
          'sm1' // ERC20StakingModule: stake amount is zero
        );
      });
    });

    describe('when the stake is successful', function () {
      beforeEach('alice stakes', async function () {
        await this.stk.transfer(alice, tokens(1000), { from: org });
        await this.stk.approve(this.staking.address, tokens(100000), { from: alice });
        this.res = await this.pool.stake(tokens(100), [], [], { from: alice });
      });

      it('should decrease staking token balance of user', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(900));
      });

      it('should increase token balance of staking module', async function () {
        expect(await this.stk.balanceOf(this.staking.address)).to.be.bignumber.equal(tokens(100));
      });

      it('should increase total staking balances', async function () {
        expect((await this.pool.stakingTotals())[0]).to.be.bignumber.equal(tokens(100));
      });

      it('should update staking balances for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(100));
      });

      it('should emit Staked event', async function () {
        expectEvent(
          this.res,
          'Staked',
          { user: alice, token: this.stk.address, amount: tokens(100), shares: shares(100) }
        );
      });

      it('report gas', async function () {
        reportGas('Pool', 'stake', 'geyser', this.res)
      });
    });


    describe('when two users have staked', function () {

      beforeEach('alice and bob stake', async function () {
        await this.stk.transfer(alice, tokens(1000), { from: org });
        await this.stk.transfer(bob, tokens(1000), { from: org });
        await this.stk.approve(this.staking.address, tokens(100000), { from: alice });
        await this.stk.approve(this.staking.address, tokens(100000), { from: bob });
        this.res0 = await this.pool.stake(tokens(100), [], [], { from: alice });
        this.res1 = await this.pool.stake(tokens(500), [], [], { from: bob });
      });

      it('should decrease each user staking token balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(900));
        expect(await this.stk.balanceOf(bob)).to.be.bignumber.equal(tokens(500));
      });

      it('should increase token balance of staking module', async function () {
        expect(await this.stk.balanceOf(this.staking.address)).to.be.bignumber.equal(tokens(600));
      });

      it('should increase total staking balances', async function () {
        expect((await this.pool.stakingTotals())[0]).to.be.bignumber.equal(tokens(600));
      });

      it('should update staking balances for each user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(100));
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(tokens(500));
      });

      it('should update the total staked shares for each user', async function () {
        expect(await this.staking.shares(alice)).to.be.bignumber.equal(shares(100));
        expect(await this.staking.shares(bob)).to.be.bignumber.equal(shares(500));
      });

      it('should combine to increase the total staking shares', async function () {
        expect(await this.staking.totalShares()).to.be.bignumber.equal(shares(600));
      });

      it('should emit each Staked event', async function () {
        expectEvent(
          this.res0,
          'Staked',
          { user: alice, token: this.stk.address, amount: tokens(100), shares: shares(100) }
        );
        expectEvent(
          this.res1,
          'Staked',
          { user: bob, token: this.stk.address, amount: tokens(500), shares: shares(500) }
        );
      });
    });
  });


  describe('unstake', function () {

    beforeEach('staking and holding', async function () {
      // funding and approval
      await this.stk.transfer(alice, tokens(1000), { from: org });
      await this.stk.transfer(bob, tokens(1000), { from: org });
      await this.stk.approve(this.staking.address, tokens(100000), { from: alice });
      await this.stk.approve(this.staking.address, tokens(100000), { from: bob });

      // alice stakes 100 tokens at 10 days
      await time.increaseTo(this.t0.add(days(10)));
      await this.pool.stake(tokens(100), [], [], { from: alice });

      // bob stakes 100 tokens at 40 days
      await time.increaseTo(this.t0.add(days(40)));
      await this.pool.stake(tokens(100), [], [], { from: bob });

      // alice stakes another 100 tokens at 70 days
      await time.increaseTo(this.t0.add(days(70)));
      await this.pool.stake(tokens(100), [], [], { from: alice });

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
          this.pool.unstake(tokens(0), [], [], { from: alice }),
          'sm3' // ERC20StakingModule: unstake amount is zero
        );
      });
    });

    describe('when unstake amount is greater than user total', function () {
      it('should fail', async function () {
        await expectRevert(
          this.pool.unstake(tokens(300), [], [], { from: alice }),
          'sm6' // ERC20StakingModule: unstake amount exceeds balance
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
        this.res = await this.pool.unstake(tokens(200), [], [], { from: alice });
      });

      it('should return staking token to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

      it('should update the total staked for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(0));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion * 500), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion) * 500), TOKEN_DELTA
        );
      });

      it('should not increase pool GYSR usage', async function () {
        expect(await this.pool.usage()).to.be.bignumber.equal(new BN(0));
      });

      it('should emit Unstaked event', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: tokens(200), shares: shares(200) }
        );
      });

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion * 500), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.portion * 500), SHARE_DELTA);
      });

      it('should have no remaining stakes for user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
      });

      it('report gas', async function () {
        reportGas('Pool', 'unstake', 'geyser', this.res)
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
        this.res = await this.pool.unstake(tokens(150), [], [], { from: alice });
      });

      it('should return staking token to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(950));
      });

      it('should update the total staked for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(50));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion * 500), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion) * 500), TOKEN_DELTA
        );
      });

      it('should emit Unstaked event', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: tokens(150), shares: shares(150) }
        );
      });

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion * 500), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.portion * 500), SHARE_DELTA);
      });

      it('should have one remaining stake for user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should unstake first-in last-out', async function () {
        const stake = await this.reward.stakes(alice, 0);
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
        await this.pool.unstake(tokens(150), [], [], { from: alice });
        this.remainder = fromFixedPointBigNumber(await this.reward.totalUnlocked(), 10, DECIMALS);

        // do second unstake
        this.res = await this.pool.unstake(tokens(50), [], [], { from: alice });
      });

      it('should return remaining staking token to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

      it('should update the total staked for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(0));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion0 * 500 + this.portion1 * this.remainder), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion1) * this.remainder), TOKEN_DELTA
        );
      });

      it('should emit Unstaked event', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: tokens(50), shares: shares(50) }
        );
      });

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion1 * this.remainder), TOKEN_DELTA);
      });

      it('should have no remaining stakes for user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
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
        await this.pool.unstake(tokens(150), [], [], { from: alice });
        this.remainder = fromFixedPointBigNumber(await this.reward.totalUnlocked(), 10, DECIMALS);

        // bob unstakes
        this.res = await this.pool.unstake(tokens(100), [], [], { from: bob });
      });

      it('should return staking tokens to first user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(950));
      });

      it('should return staking tokens to second user balance', async function () {
        expect(await this.stk.balanceOf(bob)).to.be.bignumber.equal(tokens(1000));
      });

      it('should update the total staked for first user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(50));
      });

      it('should update the total staked for second user', async function () {
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(tokens(0));
      });

      it('should disburse expected amount of reward token to first user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion0 * 500), TOKEN_DELTA
        );
      });

      it('should disburse expected amount of reward token to second user', async function () {
        expect(await this.rew.balanceOf(bob)).to.be.bignumber.closeTo(
          tokens(this.portion1 * this.remainder), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion1) * this.remainder), TOKEN_DELTA
        );
      });

      it('should emit Unstaked event', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: bob, token: this.stk.address, amount: tokens(100), shares: shares(100) }
        );
      });

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion1 * this.remainder), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.portion1 * this.remainder), SHARE_DELTA);
      });

      it('should have no remaining stakes for second user', async function () {
        expect(await this.reward.stakeCount(bob)).to.be.bignumber.equal(new BN(0));
      });

      it('should reward alice more than bob', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.greaterThan(
          await this.rew.balanceOf(bob)
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
        await this.pool.unstake(tokens(75), [], [], { from: bob });
        this.remainder = fromFixedPointBigNumber(await this.reward.totalUnlocked(), 10, DECIMALS);

        // alice unstakes
        this.res = await this.pool.unstake(tokens(150), [], [], { from: alice });
      });

      it('should return staking tokens to first user balance', async function () {
        expect(await this.stk.balanceOf(bob)).to.be.bignumber.equal(tokens(975));
      });

      it('should return staking tokens to second user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(950));
      });

      it('should update the total staked for first user', async function () {
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(tokens(25));
      });

      it('should update the total staked for second user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(50));
      });

      it('should disburse expected amount of reward token to first user', async function () {
        expect(await this.rew.balanceOf(bob)).to.be.bignumber.closeTo(
          tokens(this.portion0 * 500), TOKEN_DELTA
        );
      });

      it('should disburse expected amount of reward token to second user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion1 * this.remainder), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion1) * this.remainder), TOKEN_DELTA
        );
      });

      it('should emit Unstaked event', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: tokens(150), shares: shares(150) }
        );
      });

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion1 * this.remainder), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.portion1 * this.remainder), SHARE_DELTA);
      });

      it('should have one remaining stake for first user', async function () {
        expect(await this.reward.stakeCount(bob)).to.be.bignumber.equal(new BN(1));
      });

      it('should have one remaining stake for second user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should reward bob more than alice', async function () {
        expect(await this.rew.balanceOf(bob)).to.be.bignumber.greaterThan(
          await this.rew.balanceOf(alice)
        );
      });
    });

  });


  describe('unstake with GYSR', function () {

    beforeEach('staking and holding', async function () {
      // funding and approval
      await this.stk.transfer(alice, tokens(1000), { from: org });
      await this.stk.transfer(bob, tokens(1000), { from: org });
      await this.stk.approve(this.staking.address, tokens(100000), { from: alice });
      await this.stk.approve(this.staking.address, tokens(100000), { from: bob });
      await this.gysr.transfer(alice, tokens(10), { from: org });
      await this.gysr.transfer(bob, tokens(10), { from: org });
      await this.gysr.approve(this.pool.address, tokens(100000), { from: alice });
      await this.gysr.approve(this.pool.address, tokens(100000), { from: bob });

      // alice stakes 100 tokens at 10 days
      await time.increaseTo(this.t0.add(days(10)));
      await this.pool.stake(tokens(100), [], [], { from: alice });

      // bob stakes 100 tokens at 40 days
      await time.increaseTo(this.t0.add(days(40)));
      await this.pool.stake(tokens(100), [], [], { from: bob });

      // alice stakes another 100 tokens at 70 days
      await time.increaseTo(this.t0.add(days(70)));
      await this.pool.stake(tokens(100), [], [], { from: alice });

      // advance last 30 days (below)

      // summary
      // 100 days elapsed
      // tokens unlocked: 500 (1000 @ 200 days)
      // time bonus: 0.5 -> 2.0 over 90 days
      // alice: 100 staked for 90 days, 100 staked for 30 days, 12000 staking days
      // bob: 100 staked for 60 days, 6000 staking days
      // total: 18000 share days
    });

    describe('when GYSR amount is greater than user total', function () {
      it('should fail', async function () {
        // encode gysr amount as bytes
        const data = web3.eth.abi.encodeParameter('uint256', tokens(20).toString());

        await expectRevert(
          this.pool.unstake(tokens(200), [], data, { from: alice }),
          'ERC20: transfer amount exceeds balance.'
        );
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

        this.res = await this.pool.unstake(tokens(200), [], data, { from: alice });
      });

      it('should return staking token to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

      it('should update the total staked for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(0));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion * 500), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion) * 500), TOKEN_DELTA
        );
      });

      it('should increase reward module GYSR usage', async function () {
        expect(await this.reward.usage()).to.be.bignumber.closeTo(bonus(this.usage), BONUS_DELTA);
      });

      it('should increase pool GYSR usage', async function () {
        expect(await this.pool.usage()).to.be.bignumber.closeTo(bonus(this.usage), BONUS_DELTA);
      });

      it('should transfer GYSR to Pool contract', async function () {
        expect(await this.gysr.balanceOf(this.pool.address)).to.be.bignumber.equal(tokens(0.8));
      });

      it('should fully vest GYSR spent', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(0.8));
      });

      it('should transfer GYSR fee to treasury', async function () {
        expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(tokens(0.2));
      });

      it('should decrease GYSR balance of user', async function () {
        expect(await this.gysr.balanceOf(alice)).to.be.bignumber.equal(tokens(9.0));
      });

      it('should emit Unstaked event', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: tokens(200), shares: shares(200) }
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

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion * 500), TOKEN_DELTA);
      });

      it('report gas', async function () {
        reportGas('Pool', 'unstake', 'with GYSR', this.res)
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

        // do unstake
        this.res = await this.pool.unstake(tokens(150), [], data, { from: alice });
      });

      it('should return staking token to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(950));
      });

      it('should update the total staked for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(50));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion * 500), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion) * 500), TOKEN_DELTA
        );
      });

      it('should increase reward module GYSR usage', async function () {
        expect(await this.reward.usage()).to.be.bignumber.closeTo(bonus(this.usage), BONUS_DELTA);
      });

      it('should increase pool GYSR usage', async function () {
        expect(await this.pool.usage()).to.be.bignumber.closeTo(bonus(this.usage), BONUS_DELTA);
      });

      it('should transfer GYSR to Pool contract', async function () {
        expect(await this.gysr.balanceOf(this.pool.address)).to.be.bignumber.equal(tokens(0.8));
      });

      it('should fully vest GYSR spent', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(0.8));
      });

      it('should transfer GYSR fee to treasury', async function () {
        expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(tokens(0.2));
      });

      it('should decrease GYSR balance of user', async function () {
        expect(await this.gysr.balanceOf(alice)).to.be.bignumber.equal(tokens(9.0));
      });

      it('should emit Unstaked event', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: tokens(150), shares: shares(150) }
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

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion * 500), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.portion * 500), SHARE_DELTA);
      });

      it('should have one remaining stake for user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should unstake first-in last-out', async function () {
        const stake = await this.reward.stakes(alice, 0);
        expect(stake.timestamp).to.be.bignumber.closeTo(this.t0.add(days(10)), new BN(1));
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
        // gysr bonus: 1.0 tokens, at 0.13 usage, unstaking 50/150 total
        const mult1 = 1.0 + Math.log10(1.0 + (1.5 / 50.0) * 1.0 / (0.01 + usage0));
        const raw1 = 50 * 90;
        const inflated1 = mult1 * raw1 * 3.0;
        this.portion1 = inflated1 / (18000 - raw0 - raw1 + inflated1);
        const w1 = raw1 / (18000 - raw0);
        this.usage1 = usage0 - w1 * usage0 + w1 * (mult1 - 1.0) / mult1;

        // advance last 30 days
        await time.increaseTo(this.t0.add(days(100)));

        // encode gysr amount as bytes
        const data = web3.eth.abi.encodeParameter('uint256', tokens(1).toString());

        // do first unstake
        await this.pool.unstake(tokens(150), [], data, { from: alice });
        this.remainder = fromFixedPointBigNumber(await this.reward.totalUnlocked(), 10, DECIMALS);

        // do second unstake
        this.res = await this.pool.unstake(tokens(50), [], data, { from: alice });
      });

      it('should return remaining staking token to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

      it('should update the total staked for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(0));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion0 * 500 + this.portion1 * this.remainder), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion1) * this.remainder), TOKEN_DELTA
        );
      });

      it('should increase reward module GYSR usage', async function () {
        expect(await this.reward.usage()).to.be.bignumber.closeTo(bonus(this.usage1), BONUS_DELTA);
      });

      it('should increase pool GYSR usage', async function () {
        expect(await this.pool.usage()).to.be.bignumber.closeTo(bonus(this.usage1), BONUS_DELTA);
      });

      it('should transfer GYSR to Pool contract', async function () {
        expect(await this.gysr.balanceOf(this.pool.address)).to.be.bignumber.closeTo(tokens(1.6), TOKEN_DELTA);
      });

      it('should fully vest GYSR spent', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(1.6));
      });

      it('should transfer GYSR fee to treasury', async function () {
        expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(tokens(0.4));
      });

      it('should decrease GYSR balance of user', async function () {
        expect(await this.gysr.balanceOf(alice)).to.be.bignumber.equal(tokens(8.0));
      });

      it('should emit Unstaked event', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: tokens(50), shares: shares(50) }
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

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion1 * this.remainder), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.portion1 * this.remainder), SHARE_DELTA);
      });

      it('should have no remaining stakes for user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
      });

    });


    describe('when fee is lowered', function () {
      beforeEach(async function () {
        // update fee
        await this.factory.setFee(bonus(0.1), { from: org });

        // encode gysr amount as bytes
        const data = web3.eth.abi.encodeParameter('uint256', tokens(1).toString());

        // spend gysr as usual
        await this.pool.unstake(tokens(200), [], data, { from: alice });
      });

      it('should transfer higher portion of GYSR to Pool contract', async function () {
        expect(await this.gysr.balanceOf(this.pool.address)).to.be.bignumber.equal(tokens(0.9));
      });

      it('should fully vest GYSR spent', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(0.9));
      });

      it('should transfer lowered GYSR fee to treasury', async function () {
        expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(tokens(0.1));
      });

      it('should decrease GYSR balance of user by same amount', async function () {
        expect(await this.gysr.balanceOf(alice)).to.be.bignumber.equal(tokens(9.0));
      });
    });

    describe('when fee is set to zero', function () {
      beforeEach(async function () {
        // update fee
        await this.factory.setFee(bonus(0.0), { from: org });

        // encode gysr amount as bytes
        const data = web3.eth.abi.encodeParameter('uint256', tokens(1).toString());

        // spend gysr as usual
        await this.pool.unstake(tokens(200), [], data, { from: alice });
      });

      it('should transfer all GYSR to Pool contract', async function () {
        expect(await this.gysr.balanceOf(this.pool.address)).to.be.bignumber.equal(tokens(1.0));
      });

      it('should fully vest GYSR spent', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(1.0));
      });

      it('should not transfer any GYSR to treasury', async function () {
        expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(tokens(0.0));
      });

      it('should decrease GYSR balance of user by same amount', async function () {
        expect(await this.gysr.balanceOf(alice)).to.be.bignumber.equal(tokens(9.0));
      });
    });

    describe('when treasury address is changed', function () {
      beforeEach(async function () {
        // update treasury
        await this.factory.setTreasury(other, { from: org });

        // encode gysr amount as bytes
        const data = web3.eth.abi.encodeParameter('uint256', tokens(1).toString());

        // spend gysr as usual
        await this.pool.unstake(tokens(200), [], data, { from: alice });
      });

      it('should transfer GYSR to Pool contract', async function () {
        expect(await this.gysr.balanceOf(this.pool.address)).to.be.bignumber.equal(tokens(0.8));
      });

      it('should fully vest GYSR spent', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(0.8));
      });

      it('should not transfer any GYSR to original treasury', async function () {
        expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(tokens(0.0));
      });

      it('should transfer GYSR fee to new treasury address', async function () {
        expect(await this.gysr.balanceOf(other)).to.be.bignumber.equal(tokens(0.2));
      });

      it('should decrease GYSR balance of user by same amount', async function () {
        expect(await this.gysr.balanceOf(alice)).to.be.bignumber.equal(tokens(9.0));
      });
    });

  });

  describe('claim', function () {

    beforeEach('staking and holding', async function () {
      // funding and approval
      await this.stk.transfer(alice, tokens(1000), { from: org });
      await this.stk.transfer(bob, tokens(1000), { from: org });
      await this.stk.approve(this.staking.address, tokens(100000), { from: alice });
      await this.stk.approve(this.staking.address, tokens(100000), { from: bob });

      // alice stakes 100 tokens at 10 days
      await time.increaseTo(this.t0.add(days(10)));
      await this.pool.stake(tokens(100), [], [], { from: alice });

      // bob stakes 100 tokens at 40 days
      await time.increaseTo(this.t0.add(days(40)));
      await this.pool.stake(tokens(100), [], [], { from: bob });

      // alice stakes another 100 tokens at 70 days
      await time.increaseTo(this.t0.add(days(70)));
      await this.pool.stake(tokens(100), [], [], { from: alice });

      // advance last 30 days (below)

      // summary
      // 100 days elapsed
      // tokens unlocked: 500 (1000 @ 200 days)
      // time bonus: 0.5 -> 2.0 over 90 days
      // alice: 100 staked for 90 days, 100 staked for 30 days, 12000 staking days
      // bob: 100 staked for 60 days, 6000 staking days
      // total: 18000 share days
    });

    describe('when claim amount is zero', function () {
      it('should fail', async function () {
        await expectRevert(
          this.pool.claim(tokens(0), [], [], { from: alice }),
          'sm3' // ERC20StakingModule: claim amount is zero
        );
      });
    });

    describe('when claim amount is greater than user total', function () {
      it('should fail', async function () {
        await expectRevert(
          this.pool.claim(tokens(300), [], [], { from: alice }),
          'sm6' // ERC20StakingModule: claim amount exceeds balance
        );
      });
    });

    describe('when one user claims against all shares', function () {
      beforeEach(async function () {
        // expect 3.0 multiplier on first stake, and 2.0 multiplier on second stake
        const inflated = 100 * 90 * 3.0 + 100 * 30 * 2.0;
        this.portion = inflated / (18000 - 12000 + inflated);

        // advance last 30 days
        await time.increaseTo(this.t0.add(days(100)));

        // claim all
        this.res = await this.pool.claim(tokens(200), [], [], { from: alice });
      });

      it('should not return staking token to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(800));
      });

      it('should not affect the staking balance for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(200));
      });

      it('should still have one stake for user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion * 500), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion) * 500), TOKEN_DELTA
        );
      });

      it('should emit Claimed event', async function () {
        expectEvent(
          this.res,
          'Claimed',
          { user: alice, token: this.stk.address, amount: tokens(200), shares: shares(200) }
        );
      });

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion * 500), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.portion * 500), SHARE_DELTA);
      });

      it('report gas', async function () {
        reportGas('Pool', 'claim', 'geyser', this.res)
      });
    });

    describe('when one user claims with GYSR', function () {

      beforeEach(async function () {
        // acquire gysr tokens
        await this.gysr.transfer(alice, tokens(10), { from: org });
        await this.gysr.approve(this.pool.address, tokens(100000), { from: alice });

        // expect 3.0 time multiplier on first stake, and time 2.0 multiplier on second stake
        // gysr bonus: 5.0 tokens at 0.0 usage, unstaking 200/300 total
        const mult = 1.0 + Math.log10(1.0 + (0.01 * 300 / 200) * 5.0 / (0.01 + 0.0));
        const raw = 100 * 90 + 100 * 30;
        const inflated = mult * (100 * 90 * 3.0 + 100 * 30 * 2.0);
        this.portion = inflated / (18000 - raw + inflated);
        this.usage = (raw / 18000) * (mult - 1.0) / mult;

        // advance last 30 days
        await time.increaseTo(this.t0.add(days(100)));

        // encode gysr amount as bytes
        const data = web3.eth.abi.encodeParameter('uint256', tokens(5).toString());

        // advance last 30 days
        await time.increaseTo(this.t0.add(days(100)));

        // claim all
        this.res = await this.pool.claim(tokens(200), [], data, { from: alice });
      });

      it('should not return staking token to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(800));
      });

      it('should not affect the staking balance for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(200));
      });

      it('should still have one stake for user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion * 500), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion) * 500), TOKEN_DELTA
        );
      });

      it('should vest spent GYSR and update pool balance', async function () {
        expect(await this.pool.gysrBalance()).to.be.bignumber.equal(tokens(4.0));
      });

      it('should transfer GYSR fee to treasury', async function () {
        expect(await this.gysr.balanceOf(treasury)).to.be.bignumber.equal(tokens(1.0));
      });

      it('should increase pool GYSR usage', async function () {
        expect(await this.pool.usage()).to.be.bignumber.closeTo(bonus(this.usage), BONUS_DELTA);
      });

      it('should emit Claimed event', async function () {
        expectEvent(
          this.res,
          'Claimed',
          { user: alice, token: this.stk.address, amount: tokens(200), shares: shares(200) }
        );
      });

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion * 500), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.portion * 500), SHARE_DELTA);
      });

      it('should emit GysrSpent event', async function () {
        expectEvent(
          this.res,
          'GysrSpent',
          { user: alice, amount: tokens(5.0) }
        );
      });

      it('should emit GysrVested event', async function () {
        expectEvent(
          this.res,
          'GysrVested',
          { user: alice, amount: tokens(5.0) }
        );
      });

      it('report gas', async function () {
        reportGas('Pool', 'claim', 'geyser', this.res)
      });
    });

    describe('when alice claims first', function () {
      beforeEach(async function () {
        // alice partial claim
        // expect 50% of first stake to be returned at a 3.0 multiplier
        // expect full second stake to be returned at a 2.0 multiplier
        const raw0 = 50 * 90 + 100 * 30;
        const inflated0 = 50 * 90 * 3.0 + 100 * 30 * 2.0;
        this.portion0 = inflated0 / (18000 - raw0 + inflated0);

        // bob full claim
        // expect 2.5 multiplier on stake
        const raw1 = 100 * 60;
        const inflated1 = raw1 * 2.5;
        this.portion1 = inflated1 / (18000 - raw0 - raw1 + inflated1);

        // advance last 30 days
        await time.increaseTo(this.t0.add(days(100)));

        // alice claims
        await this.pool.claim(tokens(150), [], [], { from: alice });
        this.remainder = fromFixedPointBigNumber(await this.reward.totalUnlocked(), 10, DECIMALS);

        // bob claims
        this.res = await this.pool.claim(tokens(100), [], [], { from: bob });
      });

      it('should not return staking tokens to first user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(800));
      });

      it('should not return staking tokens to second user balance', async function () {
        expect(await this.stk.balanceOf(bob)).to.be.bignumber.equal(tokens(900));
      });

      it('should not affect total staked for first user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(200));
      });

      it('should not affect total staked for second user', async function () {
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(tokens(100));
      });

      it('should have two stakes for first user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(2));
      });

      it('should have one stake for second user', async function () {
        expect(await this.reward.stakeCount(bob)).to.be.bignumber.equal(new BN(1));
      });

      it('should disburse expected amount of reward token to first user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion0 * 500), TOKEN_DELTA
        );
      });

      it('should disburse expected amount of reward token to second user', async function () {
        expect(await this.rew.balanceOf(bob)).to.be.bignumber.closeTo(
          tokens(this.portion1 * this.remainder), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion1) * this.remainder), TOKEN_DELTA
        );
      });

      it('should emit Claimed event', async function () {
        expectEvent(
          this.res,
          'Claimed',
          { user: bob, token: this.stk.address, amount: tokens(100), shares: shares(100) }
        );
      });

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion1 * this.remainder), TOKEN_DELTA);
      });

      it('should reward alice more than bob', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.greaterThan(
          await this.rew.balanceOf(bob)
        );
      });
    });

    describe('when bob claims first', function () {
      beforeEach(async function () {
        // bob partial claim
        // expect 2.5 multiplier
        const raw0 = 75 * 60;
        const inflated0 = raw0 * 2.5;
        this.portion0 = inflated0 / (18000 - raw0 + inflated0);

        // alice partial claim
        // expect second stake to be returned at a 2.0 multiplier
        const raw1 = 50 * 90 + 100 * 30;
        const inflated1 = 50 * 90 * 3.0 + 100 * 30 * 2.0;
        this.portion1 = inflated1 / (18000 - raw0 - raw1 + inflated1);

        // advance last 30 days
        await time.increaseTo(this.t0.add(days(100)));

        // bob claims
        await this.pool.claim(tokens(75), [], [], { from: bob });
        this.remainder = fromFixedPointBigNumber(await this.reward.totalUnlocked(), 10, DECIMALS);

        // alice claims
        this.res = await this.pool.claim(tokens(150), [], [], { from: alice });
      });

      it('should not return staking tokens to first user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(800));
      });

      it('should not return staking tokens to second user balance', async function () {
        expect(await this.stk.balanceOf(bob)).to.be.bignumber.equal(tokens(900));
      });

      it('should not affect total staked for first user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(200));
      });

      it('should not affect total staked for second user', async function () {
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(tokens(100));
      });

      it('should have two stakes for first user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(2));
      });

      it('should have two stakes for second user', async function () {
        expect(await this.reward.stakeCount(bob)).to.be.bignumber.equal(new BN(2));
      });

      it('should disburse expected amount of reward token to first user', async function () {
        expect(await this.rew.balanceOf(bob)).to.be.bignumber.closeTo(
          tokens(this.portion0 * 500), TOKEN_DELTA
        );
      });

      it('should disburse expected amount of reward token to second user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion1 * this.remainder), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion1) * this.remainder), TOKEN_DELTA
        );
      });

      it('should emit Claimed event', async function () {
        expectEvent(
          this.res,
          'Claimed',
          { user: alice, token: this.stk.address, amount: tokens(150), shares: shares(150) }
        );
      });

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion1 * this.remainder), TOKEN_DELTA);
      });

      it('should reward bob more than alice', async function () {
        expect(await this.rew.balanceOf(bob)).to.be.bignumber.greaterThan(
          await this.rew.balanceOf(alice)
        );
      });
    });

  });


  describe('unstake with single user', function () {

    beforeEach('staking and holding', async function () {
      // funding and approval
      await this.stk.transfer(alice, tokens(1000), { from: org });
      await this.stk.approve(this.staking.address, tokens(100000), { from: alice });
      await this.stk.approve(this.staking.address, tokens(100000), { from: bob });

      // alice stakes 100 tokens at 0 days
      await this.pool.stake(tokens(100), [], [], { from: alice });

      // advance 50 days
      await time.increaseTo(this.t0.add(days(50)));
      await this.pool.update();

      // summary
      // 50 days elapsed
      // tokens unlocked: 250 (1000 @ 200 days)
      // alice has all shares
    });

    describe('when user unstakes all shares', function () {
      beforeEach(async function () {
        this.res = await this.pool.unstake(tokens(100), [], [], { from: alice });
      });

      it('should emit Unstaked event', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: tokens(100), shares: shares(100) }
        );
      });

      it('should emit RewardsDistributed event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(250), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(250), SHARE_DELTA);
      });

      it('should return staking token to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

      it('should distribute full unlocked rewards to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(tokens(250), TOKEN_DELTA);
      });

    });

    describe('when user unstakes multiple times, one large, one very small', function () {
      beforeEach(async function () {
        this.res0 = await this.pool.unstake(tokens(100).sub(new BN(1)), [], [], { from: alice });
        this.res1 = await this.pool.unstake(new BN(1), [], [], { from: alice });
      });

      it('large unstake should emit Unstaked event', async function () {
        expectEvent(
          this.res0,
          'Unstaked',
          {
            user: alice,
            token: this.stk.address,
            amount: tokens(100).sub(new BN(1)),
            shares: tokens(100).sub(new BN(1)).mul(new BN(10 ** 6))
          }
        );
      });

      it('large unstake should emit RewardsDistributed event', async function () {
        const e = this.res0.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(250), TOKEN_DELTA);
      });

      it('small unstake should emit Unstaked event', async function () {
        expectEvent(
          this.res1,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: new BN(1), shares: new BN(10 ** 6) }
        );
      });

      it('small unstake should emit RewardsDistributed event', async function () {
        const e = this.res1.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(0), TOKEN_DELTA);
      });

      it('should return all staking token to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

      it('should distribute full unlocked rewards to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(tokens(250), TOKEN_DELTA);
      });
    });

  });

});

describe('staking when unfunded', function () {
  const [owner, org, treasury, alice, bob] = accounts;

  beforeEach('setup', async function () {
    // base setup
    this.gysr = await GeyserToken.new({ from: org });
    this.factory = await PoolFactory.new(this.gysr.address, treasury, { from: org });
    this.stakingModuleFactory = await ERC20StakingModuleFactory.new({ from: org });
    this.rewardModuleFactory = await ERC20CompetitiveRewardModuleFactory.new({ from: org });
    this.stk = await TestLiquidityToken.new({ from: org });
    this.rew = await TestToken.new({ from: org });

    // encode sub factory arguments
    const stakingdata = web3.eth.abi.encodeParameter('address', this.stk.address);
    const rewarddata = web3.eth.abi.encodeParameters(
      ['address', 'uint256', 'uint256', 'uint256'],
      [this.rew.address, bonus(0.5).toString(), bonus(2.0).toString(), days(90).toString()]
    );

    // whitelist sub factories
    await this.factory.setWhitelist(this.stakingModuleFactory.address, new BN(1), { from: org });
    await this.factory.setWhitelist(this.rewardModuleFactory.address, new BN(2), { from: org });

    // create pool
    const res = await this.factory.create(
      this.stakingModuleFactory.address,
      this.rewardModuleFactory.address,
      stakingdata,
      rewarddata,
      { from: owner }
    );
    const addr = res.logs.filter(l => l.event === 'PoolCreated')[0].args.pool;
    this.pool = await Pool.at(addr);

    // get references to submodules
    this.staking = await ERC20StakingModule.at(await this.pool.stakingModule());
    this.reward = await ERC20CompetitiveRewardModule.at(await this.pool.rewardModule());

    // (no funding)

    // acquire staking tokens and approval
    await this.stk.transfer(alice, tokens(1000), { from: org });
    await this.stk.transfer(bob, tokens(1000), { from: org });
    await this.stk.approve(this.staking.address, tokens(100000), { from: alice });
    await this.stk.approve(this.staking.address, tokens(100000), { from: bob });
  });

  describe('stake', function () {

    describe('when multiple users stake', function () {

      beforeEach('alice and bob stake', async function () {
        this.res0 = await this.pool.stake(tokens(100), [], [], { from: alice });
        this.res1 = await this.pool.stake(tokens(500), [], [], { from: bob });
      });

      it('should decrease each user staking token balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(900));
        expect(await this.stk.balanceOf(bob)).to.be.bignumber.equal(tokens(500));
      });

      it('should combine to increase total staked', async function () {
        expect((await this.pool.stakingTotals())[0]).to.be.bignumber.equal(tokens(600));
      });

      it('should update the total staked tokens for each user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(100));
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(tokens(500));
      });

      it('should update the total staked shares for each user', async function () {
        expect(await this.staking.shares(alice)).to.be.bignumber.equal(shares(100));
        expect(await this.staking.shares(bob)).to.be.bignumber.equal(shares(500));
      });

      it('should combine to increase the total staking shares', async function () {
        expect(await this.staking.totalShares()).to.be.bignumber.equal(shares(600));
      });

      it('should emit each Staked event', async function () {
        expectEvent(
          this.res0,
          'Staked',
          { user: alice, amount: tokens(100), shares: shares(100) }
        );
        expectEvent(
          this.res1,
          'Staked',
          { user: bob, amount: tokens(500), shares: shares(500) }
        );
      });

    });

  });

  describe('earn', function () {

    describe('when multiple users are accruing rewards', function () {

      beforeEach(async function () {
        // alice and bob stake
        await this.pool.stake(tokens(100), [], [], { from: alice });
        await this.pool.stake(tokens(500), [], [], { from: bob });
        this.t0 = await this.reward.lastUpdated();

        // advance 30 days
        await time.increaseTo(this.t0.add(days(30)));

        // update
        await this.pool.update({ from: alice });
        this.t1 = await this.reward.lastUpdated();
      });

      it('should update users earned share seconds', async function () {
        const stake0 = await this.reward.stakes(alice, 0);
        expect(stake0.shares.mul(this.t1.sub(stake0.timestamp))).to.be.bignumber.closeTo(
          shares(100 * 30 * 24 * 60 * 60),
          shares(100) // one share second
        );

        const stake1 = await this.reward.stakes(bob, 0);
        expect(stake1.shares.mul(this.t1.sub(stake1.timestamp))).to.be.bignumber.closeTo(
          shares(500 * 30 * 24 * 60 * 60),
          shares(500) // one share second
        );
      });

      it('should update total share seconds', async function () {
        expect(await this.reward.totalStakingShareSeconds()).to.be.bignumber.closeTo(
          shares(600 * 30 * 24 * 60 * 60),
          shares(600) // one share second
        );
      });
    });
  });


  describe('unstake', function () {

    describe('when one user unstakes all shares', function () {

      beforeEach(async function () {
        // alice and bob stake
        await this.pool.stake(tokens(100), [], [], { from: alice });
        await this.pool.stake(tokens(100), [], [], { from: bob });
        this.t0 = await this.reward.lastUpdated();

        // advance 30 days
        await time.increaseTo(this.t0.add(days(30)));

        // do unstake
        this.res = await this.pool.unstake(tokens(100), [], [], { from: alice });
      });

      it('should return staking token to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

      it('should update the total staked for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(0));
      });

      it('should not disburse any reward token to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.equal(tokens(0));
      });

      it('should emit unstake event', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: tokens(100), shares: shares(100) }
        );
      });

      it('should not emit reward event', async function () {
        expect(this.res.logs.filter(l => l.event === 'RewardsDistributed').length).to.be.equal(0);
      });

      it('should have no remaining stakes for user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
      });

    });

  });

});

describe('staking against Boiler', function () {
  const [owner, org, treasury, alice, bob] = accounts;

  beforeEach('setup', async function () {

    // base setup
    this.gysr = await GeyserToken.new({ from: org });
    this.factory = await PoolFactory.new(this.gysr.address, treasury, { from: org });
    this.stakingModuleFactory = await ERC20StakingModuleFactory.new({ from: org });
    this.rewardModuleFactory = await ERC20CompetitiveRewardModuleFactory.new({ from: org });
    this.stk = await TestLiquidityToken.new({ from: org });
    this.rew = await TestToken.new({ from: org });

    // encode sub factory arguments
    const stakingdata = web3.eth.abi.encodeParameter('address', this.stk.address);
    const rewarddata = web3.eth.abi.encodeParameters(
      ['address', 'uint256', 'uint256', 'uint256'],
      [this.rew.address, bonus(0.5).toString(), bonus(2.0).toString(), days(90).toString()]
    );

    // whitelist sub factories
    await this.factory.setWhitelist(this.stakingModuleFactory.address, new BN(1), { from: org });
    await this.factory.setWhitelist(this.rewardModuleFactory.address, new BN(2), { from: org });

    // create pool
    const res = await this.factory.create(
      this.stakingModuleFactory.address,
      this.rewardModuleFactory.address,
      stakingdata,
      rewarddata,
      { from: owner }
    );
    const addr = res.logs.filter(l => l.event === 'PoolCreated')[0].args.pool;
    this.pool = await Pool.at(addr);

    // get references to submodules
    this.staking = await ERC20StakingModule.at(await this.pool.stakingModule());
    this.reward = await ERC20CompetitiveRewardModule.at(await this.pool.rewardModule());

    // fund for future start to configure as "Boiler"
    await this.rew.transfer(owner, tokens(10000), { from: org });
    await this.rew.approve(this.reward.address, tokens(100000), { from: owner });
    this.t0 = await time.latest();
    await this.reward.methods['fund(uint256,uint256,uint256)'](
      tokens(1000), days(90), this.t0.add(days(40)),
      { from: owner }
    );

    // acquire staking tokens and approval
    await this.stk.transfer(alice, tokens(1000), { from: org });
    await this.stk.transfer(bob, tokens(1000), { from: org });
    await this.stk.approve(this.staking.address, tokens(100000), { from: alice });
    await this.stk.approve(this.staking.address, tokens(100000), { from: bob });
  });

  describe('stake', function () {

    describe('when multiple users stake', function () {

      beforeEach('alice and bob stake', async function () {
        this.res0 = await this.pool.stake(tokens(100), [], [], { from: alice });
        this.res1 = await this.pool.stake(tokens(500), [], [], { from: bob });
      });

      it('should decrease each user staking token balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(900));
        expect(await this.stk.balanceOf(bob)).to.be.bignumber.equal(tokens(500));
      });

      it('should combine to increase total staked', async function () {
        expect((await this.pool.stakingTotals())[0]).to.be.bignumber.equal(tokens(600));
      });

      it('should update the total staked tokens for each user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(100));
        expect((await this.pool.stakingBalances(bob))[0]).to.be.bignumber.equal(tokens(500));
      });

      it('should update the total staked shares for each user', async function () {
        expect(await this.staking.shares(alice)).to.be.bignumber.equal(shares(100));
        expect(await this.staking.shares(bob)).to.be.bignumber.equal(shares(500));
      });

      it('should combine to increase the total staking shares', async function () {
        expect(await this.staking.totalShares()).to.be.bignumber.equal(shares(600));
      });

      it('should emit each Staked event', async function () {
        expectEvent(
          this.res0,
          'Staked',
          { user: alice, amount: tokens(100), shares: shares(100) }
        );
        expectEvent(
          this.res1,
          'Staked',
          { user: bob, amount: tokens(500), shares: shares(500) }
        );
      });

    });

  });

  describe('earn', function () {

    describe('when multiple users are accruing rewards', function () {

      beforeEach(async function () {
        // alice and bob stake
        await time.increaseTo(this.t0.add(days(10)));
        await this.pool.stake(tokens(100), [], [], { from: alice });
        await this.pool.stake(tokens(500), [], [], { from: bob });

        // advance 30 days
        await time.increaseTo(this.t0.add(days(40)));

        // update
        await this.pool.update({ from: alice });
        this.t1 = await this.reward.lastUpdated();
      });

      it('should update users earned share seconds', async function () {
        const stake0 = await this.reward.stakes(alice, 0);
        expect(stake0.shares.mul(this.t1.sub(stake0.timestamp))).to.be.bignumber.closeTo(
          shares(100 * 30 * 24 * 60 * 60),
          shares(100) // one share second
        );

        const stake1 = await this.reward.stakes(bob, 0);
        expect(stake1.shares.mul(this.t1.sub(stake1.timestamp))).to.be.bignumber.closeTo(
          shares(500 * 30 * 24 * 60 * 60),
          shares(500) // one share second
        );
      });

      it('should update total share seconds', async function () {
        expect(await this.reward.totalStakingShareSeconds()).to.be.bignumber.closeTo(
          shares(600 * 30 * 24 * 60 * 60),
          shares(600) // one share second
        );
      });
    });
  });


  describe('unstake', function () {

    describe('when one user unstakes all shares before funding start', function () {

      beforeEach(async function () {
        // alice and bob stake at day 10
        await time.increaseTo(this.t0.add(days(10)));
        await this.pool.stake(tokens(100), [], [], { from: alice });
        await this.pool.stake(tokens(100), [], [], { from: bob });

        // advance 15 days
        await time.increaseTo(this.t0.add(days(25)));

        // do unstake
        this.res = await this.pool.unstake(tokens(100), [], [], { from: alice });
      });

      it('should return staking token to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

      it('should update the total staked for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(0));
      });

      it('should not disburse any reward token to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.equal(tokens(0));
      });

      it('should emit unstake event', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, amount: tokens(100), shares: shares(100) }
        );
      });

      it('should not emit reward event', async function () {
        expect(this.res.logs.filter(l => l.event === 'RewardsDistributed').length).to.be.equal(0);
      });

      it('should have no remaining stakes for user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
      });

    });

    describe('when one user unstakes all shares 30 days into funding start', function () {

      beforeEach(async function () {
        // alice and bob stake at day 10
        await time.increaseTo(this.t0.add(days(10)));
        await this.pool.stake(tokens(100), [], [], { from: alice });
        await this.pool.stake(tokens(100), [], [], { from: bob });

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
        this.res = await this.pool.unstake(tokens(100), [], [], { from: alice });
      });

      it('should return staking token to user balance', async function () {
        expect(await this.stk.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
      });

      it('should update the total staked for user', async function () {
        expect((await this.pool.stakingBalances(alice))[0]).to.be.bignumber.equal(tokens(0));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.rew.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.portion * this.unlocked), TOKEN_DELTA
        );
      });

      it('should reduce unlocked amount in reward module', async function () {
        expect(await this.reward.totalUnlocked()).to.be.bignumber.closeTo(
          tokens((1.0 - this.portion) * this.unlocked), TOKEN_DELTA
        );
      });

      it('should emit unstake and reward events', async function () {
        expectEvent(
          this.res,
          'Unstaked',
          { user: alice, token: this.stk.address, amount: tokens(100), shares: shares(100) }
        );

        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.rew.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.portion * this.unlocked), TOKEN_DELTA);
      });

      it('should have no remaining stakes for user', async function () {
        expect(await this.reward.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
      });

    });

  });

});
