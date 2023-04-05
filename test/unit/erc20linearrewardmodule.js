// unit tests for ERC20LinearRewardModule

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
  reportGas,
  setupTime,
  DECIMALS
} = require('../util/helper');

const ERC20LinearRewardModule = artifacts.require('ERC20LinearRewardModule');
const TestToken = artifacts.require('TestToken');
const TestElasticToken = artifacts.require('TestElasticToken')
const TestFeeToken = artifacts.require('TestFeeToken');
const Configuration = artifacts.require('Configuration');

// need decent tolerance to account for potential timing error
const TOKEN_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);
const SHARE_DELTA = toFixedPointBigNumber(0.0001 * (10 ** 6), 10, DECIMALS);
const BONUS_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);


describe('ERC20LinearRewardModule', function () {
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
          ERC20LinearRewardModule.new(
            this.token.address,
            days(0),
            e18(0.0001),
            this.config.address,
            factory,
            { from: owner }
          ),
          'lrm1'
        )
      });
    });

    describe('when rate is zero', function () {
      it('should fail to construct', async function () {
        await expectRevert(
          ERC20LinearRewardModule.new(
            this.token.address,
            days(30),
            e18(0),
            this.config.address,
            factory,
            { from: owner }
          ),
          'lrm2'
        )
      });
    });

    describe('when initialized', function () {
      beforeEach(async function () {
        this.module = await ERC20LinearRewardModule.new(
          this.token.address,
          days(30),
          e18(1),
          this.config.address,
          factory,
          { from: owner }
        );
      });

      it('should create an ERC20LinearRewardModule object', async function () {
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

      it('should set distribution period', async function () {
        expect(await this.module.period()).to.be.bignumber.equal(days(30));
      });

      it('should set distribution rate', async function () {
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
      this.module = await ERC20LinearRewardModule.new(
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
          'lrm4'
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
        this.t0 = await this.module.lastUpdated();
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
        expect(await this.module.rewardShares()).to.be.bignumber.equal(shares(1000));
      });

      it('should emit RewardsFunded', async function () {
        expectEvent(
          this.res,
          'RewardsFunded',
          { token: this.token.address, amount: tokens(1000), shares: shares(1000), timestamp: this.t0 }
        );
      });

    });

    describe('when funded by non controller', function () {

      beforeEach(async function () {
        // owner funds module
        await this.token.transfer(bob, tokens(10000), { from: org });
        await this.token.approve(this.module.address, tokens(1000), { from: bob });
        this.res = await this.module.fund(tokens(123), { from: bob });
        this.t0 = await this.module.lastUpdated();
      });

      it('should increase module token balance', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.equal(tokens(123));
      });

      it('should decrease user token balance', async function () {
        expect(await this.token.balanceOf(bob)).to.be.bignumber.equal(tokens(9877));
      });

      it('should increase reward balance', async function () {
        expect((await this.module.balances())[0]).to.be.bignumber.equal(tokens(123));
      });

      it('should increase reward shares', async function () {
        expect(await this.module.rewardShares()).to.be.bignumber.equal(shares(123));
      });

      it('should emit RewardsFunded', async function () {
        expectEvent(
          this.res,
          'RewardsFunded',
          { token: this.token.address, amount: tokens(123), shares: shares(123), timestamp: this.t0 }
        );
      });

    });

  });


  describe('stake', function () {

    describe('when configured with a 14 day period', function () {

      beforeEach(async function () {
        // owner creates module
        this.module = await ERC20LinearRewardModule.new(
          this.token.address,
          days(14),
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

        // 1000 tokens over 14 days ~= 0.00083 tokens/sec
      });

      describe('when stake exceeds budget', function () {
        it('should revert', async function () {
          await this.module.stake(bytes32(alice), alice, shares(0.0005), [], { from: owner });
          await expectRevert(
            this.module.stake(bytes32(bob), bob, shares(0.0004), [], { from: owner }),
            'lrm3'
          )
        });
      });

      describe('when stake exceeds budget due to time elapsed', function () {
        it('should revert', async function () {
          await this.module.stake(bytes32(alice), alice, shares(0.0005), [], { from: owner });
          await time.increase(days(7));
          await expectRevert(
            this.module.stake(bytes32(bob), bob, shares(0.0002), [], { from: owner }),
            'lrm3'
          )
        });
      });

      describe('when one user stakes', function () {

        beforeEach(async function () {
          // create stake for alice @ 0.0005 tokens/sec
          this.res = await this.module.stake(bytes32(alice), alice, shares(0.0005), [], { from: owner });
          this.e0 = await this.module.elapsed();
        });

        it('should increase total staking shares', async function () {
          expect(await this.module.stakingShares()).to.be.bignumber.equal(shares(0.0005));
        });

        it('should set user position shares', async function () {
          expect((await this.module.positions(bytes32(alice))).shares).to.be.bignumber.equal(shares(0.0005));
        });

        it('should set user position timestamp', async function () {
          expect((await this.module.positions(bytes32(alice))).timestamp).to.be.bignumber.equal(this.e0);
        });

        it('should set user position earned', async function () {
          expect((await this.module.positions(bytes32(alice))).earned).to.be.bignumber.equal(new BN(0));
        });

        it('report gas', async function () {
          reportGas('ERC20LinearRewardModule', 'stake', 'single', this.res)
        });

      });

      describe('when multiple users stake', function () {

        beforeEach(async function () {
          // create stake for alice @ 0.0005 tokens/sec
          this.res0 = await this.module.stake(bytes32(alice), alice, shares(0.0005), [], { from: owner });
          this.e0 = await this.module.elapsed();
          this.t0 = await this.module.lastUpdated();

          // create stake for bob @ 0.0003 tokens/sec
          this.res1 = await this.module.stake(bytes32(bob), bob, shares(0.0003), [], { from: owner });
          this.e1 = await this.module.elapsed();
        });

        it('should increase total staking shares', async function () {
          expect(await this.module.stakingShares()).to.be.bignumber.equal(shares(0.0008));
        });

        it('should set alice position shares', async function () {
          expect((await this.module.positions(bytes32(alice))).shares).to.be.bignumber.equal(shares(0.0005));
        });

        it('should set alice position timestamp', async function () {
          expect((await this.module.positions(bytes32(alice))).timestamp).to.be.bignumber.equal(this.e0);
        });

        it('should set alice position earned', async function () {
          expect((await this.module.positions(bytes32(alice))).earned).to.be.bignumber.equal(new BN(0));
        });

        it('should set bob position shares', async function () {
          expect((await this.module.positions(bytes32(bob))).shares).to.be.bignumber.equal(shares(0.0003));
        });

        it('should set bob position timestamp', async function () {
          expect((await this.module.positions(bytes32(bob))).timestamp).to.be.bignumber.equal(this.e1);
        });

        it('should set bob position earned', async function () {
          expect((await this.module.positions(bytes32(bob))).earned).to.be.bignumber.equal(new BN(0));
        });

      });

      describe('when one user stakes multiple times', function () {

        beforeEach(async function () {
          // create stake for alice @ 0.0005 tokens/sec
          this.res0 = await this.module.stake(bytes32(alice), alice, shares(0.0005), [], { from: owner });
          this.e0 = await this.module.elapsed();
          this.t0 = await this.module.lastUpdated();
          await setupTime(this.t0, days(1));

          // increase stake for alice @ 0.0001 tokens/sec
          this.res1 = await this.module.stake(bytes32(alice), alice, shares(0.0001), [], { from: owner });
          this.e1 = await this.module.elapsed();
        });

        it('should increase user position shares', async function () {
          expect((await this.module.positions(bytes32(alice))).shares).to.be.bignumber.equal(shares(0.0006));
        });

        it('should update user position timestamp', async function () {
          expect((await this.module.positions(bytes32(alice))).timestamp).to.be.bignumber.equal(this.e1);
        });

        it('should update user position earned', async function () {
          const earned = shares(0.0005).mul(this.e1.sub(this.e0));
          expect((await this.module.positions(bytes32(alice))).earned).to.be.bignumber.equal(earned);
        });

        it('should update total earned', async function () {
          const a = shares(0.0005).mul(this.e1.sub(this.e0));
          expect(await this.module.earned()).to.be.bignumber.equal(a);
        });

        it('report gas', async function () {
          reportGas('ERC20LinearRewardModule', 'stake', 'again', this.res1)
        });

      });

    });

  });

  describe('earn', function () {

    beforeEach(async function () {
      // owner creates module
      this.module = await ERC20LinearRewardModule.new(
        this.token.address,
        days(14),
        e18(1),
        this.config.address,
        factory,
        { from: owner }
      );

      // owner funds module
      await this.token.transfer(owner, tokens(10000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.fund(tokens(1000), { from: owner });

      // create stake for alice @ 0.0004 tokens/sec
      await this.module.stake(bytes32(alice), alice, shares(0.0004), [], { from: owner });
      this.t0 = await this.module.lastUpdated()
      this.e0 = await this.module.elapsed()

      // advance 3 days
      await setupTime(this.t0, days(3));

      // create stake for bob @ 0.0003 tokens/sec
      await this.module.stake(bytes32(bob), bob, shares(0.0003), [], { from: owner });
    });


    describe('when time elapsed is within budget', function () {

      beforeEach(async function () {
        // advance another 4 days
        await setupTime(this.t0, days(7));
        this.res = await this.module.update(bytes32(alice), alice, [], { from: owner });
      });

      it('should increase time elapsed accumulator linearly', async function () {
        expect((await this.module.elapsed()).sub(this.e0)).to.be.bignumber.closeTo(
          days(7),
          new BN(1)
        );
      });

      it('should increase outstanding earned accumulator linearly', async function () {
        expect(await this.module.earned()).to.be.bignumber.closeTo(
          shares(0.0004 * 3 * 86400 + 0.0007 * 4 * 86400),
          shares(0.0011)
        );
      });

      it('should decrease budget linearly', async function () {
        expect((await this.module.balances())[0]).to.be.bignumber.closeTo(
          tokens(1000 - 0.0004 * 3 * 86400 - 0.0007 * 4 * 86400),
          tokens(0.0011)
        );
      });

      it('report gas', async function () {
        reportGas('ERC20LinearRewardModule', 'update', 'linear', this.res)
      });

    });

    describe('when time elapsed is beyond budget', function () {

      beforeEach(async function () {
        // advance to 21 days
        await setupTime(this.t0, days(21));
        this.res = await this.module.update(bytes32(alice), alice, [], { from: owner });
      });

      it('should increase time elapsed accumulator to cap', async function () {
        expect((await this.module.elapsed()).sub(this.e0)).to.be.bignumber.closeTo(
          new BN(3 * 86400 + (1000 - 0.0004 * 3 * 86400) / 0.0007),
          new BN(1)
        );
      });

      it('should increase outstanding earned accumulator to cap', async function () {
        expect(await this.module.earned()).to.be.bignumber.closeTo(shares(1000), shares(0.0007));
        // note: can have some dust here when balance is too small to cover even one second
      });

      it('should decrease budget to zero', async function () {
        expect((await this.module.balances())[0]).to.be.bignumber.closeTo(new BN(0), shares(0.0007));
      });

      it('report gas', async function () {
        reportGas('ERC20LinearRewardModule', 'update', 'depleted', this.res)
      });

    });


    describe('when budget is depleted and refilled', function () {

      beforeEach(async function () {
        // advance to 21 days
        await setupTime(this.t0, days(21));
        await this.module.update(bytes32(alice), alice, [], { from: owner });

        // refill and advance another 5 days
        await this.module.fund(tokens(2000), { from: owner });
        this.t1 = await this.module.lastUpdated();
        await setupTime(this.t1, days(5));
        await this.module.update(bytes32(alice), alice, [], { from: owner });
      });

      it('should increase time elapsed accumulator linearly from previous cap', async function () {
        expect((await this.module.elapsed()).sub(this.e0)).to.be.bignumber.closeTo(
          new BN(3 * 86400 + (1000 - 0.0004 * 3 * 86400) / 0.0007).add(days(5)),
          new BN(2));
      });

      it('should increase earned accumulator linearly from previous cap', async function () {
        expect(await this.module.earned()).to.be.bignumber.closeTo(
          shares(1000).add(shares(0.0007).mul(days(5))),
          shares(0.001)
        );
      });

      it('should decrease refilled budget linearly', async function () {
        expect((await this.module.balances())[0]).to.be.bignumber.closeTo(
          tokens(2000).sub(tokens(0.0007).mul(days(5))),
          tokens(0.001)
        );
      });

    });

  });


  describe('unstake', function () {

    beforeEach(async function () {
      // owner creates module
      this.module = await ERC20LinearRewardModule.new(
        this.token.address,
        days(90),
        e18(1),
        this.config.address,
        factory,
        { from: owner }
      );

      // owner funds module
      await this.token.transfer(owner, tokens(10000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.fund(tokens(4000), { from: owner });
      await time.increase(days(1));
      // 4000 tokens over 90 days ~= 0.00051 tokens/sec

      // create stake for alice @ 0.0003 tokens/sec
      await this.module.stake(bytes32(alice), alice, shares(0.0003), [], { from: owner });
      this.t0 = await this.module.lastUpdated();

      // advance 3 days
      await setupTime(this.t0, days(3));

      // create stake for bob @ 0.0002 tokens/sec
      await this.module.stake(bytes32(bob), bob, shares(0.0002), [], { from: owner });

      // deplete tokens
      await setupTime(this.t0, days(100));
      this.dt0 = 3 * 86400 + (4000 - (0.0003 * days(3))) / 0.0005;

      // fund again
      await this.module.fund(tokens(6000), { from: owner });
      this.t1 = await this.module.lastUpdated();

      // increase rate for alice
      await this.module.stake(bytes32(alice), alice, shares(0.0002), [], { from: owner });

      // advance another 30 days
      await setupTime(this.t1, days(30));
    });

    describe('when one user unstakes all', function () {

      beforeEach(async function () {
        // alice unstakes all
        this.res = await this.module.unstake(bytes32(alice), alice, alice, shares(0.0005), [], { from: owner });
      });

      it('should delete user position', async function () {
        const pos = await this.module.positions(bytes32(alice));
        expect(pos.shares).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
      });

      it('should decrease total staking shares', async function () {
        expect(await this.module.stakingShares()).to.be.bignumber.equal(shares(0.0002));
      });

      it('should decrease reward shares', async function () {
        const r = 0.0003 * this.dt0 + 0.0005 * days(30);
        expect(await this.module.rewardShares()).to.be.bignumber.closeTo(
          shares(10000 - r),
          shares(0.0008)
        );
      });

      it('should decrease oustanding earned shares', async function () {
        const r = 0.0002 * (this.dt0 - 3 * 86400) + 0.0002 * days(30);
        expect(await this.module.earned()).to.be.bignumber.closeTo(
          shares(r),
          shares(0.0002)
        );
      });

      it('should decrease module reward token balance', async function () {
        const r = 0.0003 * this.dt0 + 0.0005 * days(30);
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.closeTo(
          tokens(10000 - r),
          tokens(0.0008)
        );
      });

      it('should increase user reward token balance', async function () {
        const r = 0.0003 * this.dt0 + 0.0005 * days(30);
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(r),
          tokens(0.0008)
        );
      });

      it('should emit RewardsDistributed event', async function () {
        const r = 0.0003 * this.dt0 + 0.0005 * days(30);
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(r), tokens(0.0008));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(r), shares(0.0008));
      });

      it('report gas', async function () {
        reportGas('ERC20LinearRewardModule', 'unstake', 'all', this.res)
      });

    });

    describe('when one user unstakes some shares', function () {

      beforeEach(async function () {
        // alice unstakes all
        this.res = await this.module.unstake(bytes32(alice), alice, alice, shares(0.0004), [], { from: owner });
        this.e0 = await this.module.elapsed();
      });

      it('should decrease user position shares', async function () {
        expect((await this.module.positions(bytes32(alice))).shares).to.be.bignumber.equal(shares(0.0001));
      });

      it('should reset user position timestamp', async function () {
        expect((await this.module.positions(bytes32(alice))).timestamp).to.be.bignumber.equal(this.e0);
      });

      it('should reset user position earned', async function () {
        expect((await this.module.positions(bytes32(alice))).earned).to.be.bignumber.equal(new BN(0));
      });

      it('should decrease total staking shares', async function () {
        expect(await this.module.stakingShares()).to.be.bignumber.equal(shares(0.0003));
      });

      it('should decrease reward shares', async function () {
        const r = 0.0003 * this.dt0 + 0.0005 * days(30);
        expect(await this.module.rewardShares()).to.be.bignumber.closeTo(
          shares(10000 - r),
          shares(0.0005)  // could be a few seconds off
        );
      });

      it('should decrease oustanding earned shares', async function () {
        const r = 0.0002 * (this.dt0 - 3 * 86400) + 0.0002 * days(30);
        expect(await this.module.earned()).to.be.bignumber.closeTo(
          shares(r),
          shares(0.0002)
        );
      });

      it('should decrease module reward token balance', async function () {
        const r = 0.0003 * this.dt0 + 0.0005 * days(30);
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.closeTo(
          tokens(10000 - r),
          tokens(0.0008)
        );
      });

      it('should distribute all pending rewards to user', async function () {
        const r = 0.0003 * this.dt0 + 0.0005 * days(30);
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(r),
          tokens(0.0008)
        );
      });

      it('should emit RewardsDistributed event', async function () {
        const r = 0.0003 * this.dt0 + 0.0005 * days(30);
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(r), tokens(0.0008));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(r), shares(0.0008));
      });

      it('report gas', async function () {
        reportGas('ERC20LinearRewardModule', 'unstake', 'some', this.res)
      });

    });

    describe('when one user unstakes multiple times', function () {

      beforeEach(async function () {
        // alice unstakes some
        this.res0 = await this.module.unstake(bytes32(alice), alice, alice, shares(0.0003), [], { from: owner });

        // advance time by another 7 days
        await setupTime(this.t1, days(37));

        // alice unstakes remaining
        this.res1 = await this.module.unstake(bytes32(alice), alice, alice, shares(0.0002), [], { from: owner });
      });

      it('should delete user position', async function () {
        const pos = await this.module.positions(bytes32(alice));
        expect(pos.shares).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
      });

      it('should decrease total staking shares', async function () {
        expect(await this.module.stakingShares()).to.be.bignumber.equal(shares(0.0002));
      });

      it('should decrease reward shares by combined amount', async function () {
        const r = 0.0003 * this.dt0 + 0.0005 * days(30) + 0.0002 * days(7);
        expect(await this.module.rewardShares()).to.be.bignumber.closeTo(
          shares(10000 - r),
          shares(0.0007)
        );
      });

      it('should decrease oustanding earned shares by combined amount', async function () {
        const r = 0.0002 * (this.dt0 - 3 * 86400) + 0.0002 * days(37);
        expect(await this.module.earned()).to.be.bignumber.closeTo(
          shares(r),
          shares(0.0002)
        );
      });

      it('should decrease module reward token balance by combined amount ', async function () {
        const r = 0.0003 * this.dt0 + 0.0005 * days(30) + 0.0002 * days(7);
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.closeTo(
          tokens(10000 - r),
          tokens(0.0007)
        );
      });

      it('should increase user reward token balance by combined amount', async function () {
        const r = 0.0003 * this.dt0 + 0.0005 * days(30) + 0.0002 * days(7);
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(r),
          tokens(0.0007)
        );
      });

      it('should emit first RewardsDistributed event', async function () {
        const r = 0.0003 * this.dt0 + 0.0005 * days(30);
        const e = this.res0.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(r), tokens(0.0005));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(r), shares(0.0005));
      });

      it('should emit second RewardsDistributed event', async function () {
        const r = 0.0002 * days(7);
        const e = this.res1.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(r), tokens(2 * 0.0002));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(r), shares(2 * 0.0002));
      });

    });

    describe('when multiple users unstake', function () {

      beforeEach(async function () {
        // alice unstakes
        this.res0 = await this.module.unstake(bytes32(alice), alice, alice, shares(0.0005), [], { from: owner });
        this.t2 = await this.module.lastUpdated();

        // advance time
        await setupTime(this.t2, days(7));

        // bob unstakes
        this.res1 = await this.module.unstake(bytes32(bob), bob, bob, shares(0.0002), [], { from: owner });
      });

      it('should delete alice user position', async function () {
        const pos = await this.module.positions(bytes32(alice));
        expect(pos.shares).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
      });

      it('should delete bob user position', async function () {
        const pos = await this.module.positions(bytes32(bob));
        expect(pos.shares).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
      });

      it('should zero total staking shares', async function () {
        expect(await this.module.stakingShares()).to.be.bignumber.equal(new BN(0));
      });

      it('should decrease reward shares by combined amount', async function () {
        const r = 4000 + 0.0007 * days(30) + 0.0002 * days(7);
        expect(await this.module.rewardShares()).to.be.bignumber.closeTo(
          shares(10000 - r),
          shares(0.0009)
        );
      });

      it('should zero oustanding earned shares', async function () {
        expect(await this.module.earned()).to.be.bignumber.equal(new BN(0));
      });

      it('should decrease pool reward token balance by combined amount ', async function () {
        const r = 4000 + 0.0007 * days(30) + 0.0002 * days(7);
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.closeTo(
          tokens(10000 - r),
          tokens(0.0009)
        );
      });

      it('should increase alice reward token balance', async function () {
        const r = 0.0003 * this.dt0 + 0.0005 * days(30);
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(r),
          tokens(0.0005)
        );
      });

      it('should increase bob reward token balance', async function () {
        const r = 0.0002 * (this.dt0 - 3 * 86400) + 0.0002 * days(37);
        expect(await this.token.balanceOf(bob)).to.be.bignumber.closeTo(
          tokens(r),
          tokens(0.0002)
        );
      });

      it('should emit alice RewardsDistributed event', async function () {
        const r = 0.0003 * this.dt0 + 0.0005 * days(30);
        const e = this.res0.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(r), tokens(0.0005));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(r), shares(0.0005));
      });

      it('should emit bob RewardsDistributed event', async function () {
        const r = 0.0002 * (this.dt0 - 3 * 86400) + 0.0002 * days(37);
        const e = this.res1.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(r), tokens(0.0002));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(r), shares(0.0002));
      });

    });

  });

  describe('claim', function () {

    beforeEach(async function () {

      // owner creates module
      this.module = await ERC20LinearRewardModule.new(
        this.token.address,
        days(14),
        e18(0.002), // custom rate
        this.config.address,
        factory,
        { from: owner }
      );

      // owner funds module
      await this.token.transfer(owner, tokens(10000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.fund(tokens(1000), { from: owner });
      await time.increase(days(1));
      // 1000 tokens over 14 days ~= 0.000827 tokens/sec

      // create stake for alice @ 0.00004 tokens/sec
      await this.module.stake(bytes32(alice), alice, shares(0.02), [], { from: owner });
      this.t0 = await this.module.lastUpdated();
      this.e0 = await this.module.elapsed();

      // advance 7 days
      await setupTime(this.t0, days(7));

      // create stake for bob @ 0.00003 tokens/sec
      await this.module.stake(bytes32(bob), bob, shares(0.015), [], { from: owner });

      // advance another 14 days
      await setupTime(this.t0, days(21));
    });


    describe('when one user claims', function () {

      beforeEach(async function () {
        // alice claims
        this.res = await this.module.claim(bytes32(alice), alice, alice, shares(0.02), [], { from: owner });
        this.e = await this.module.elapsed();
      });

      it('should reset user position', async function () {
        const pos = await this.module.positions(bytes32(alice));
        expect(pos.shares).to.be.bignumber.equal(shares(0.02));
        expect(pos.timestamp).to.be.bignumber.equal(this.e);
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
      });

      it('should not affect total staking shares', async function () {
        expect(await this.module.stakingShares()).to.be.bignumber.equal(shares(0.035));
      });

      it('should decrease reward shares', async function () {
        const r = 0.002 * 0.02 * days(21);
        expect(await this.module.rewardShares()).to.be.bignumber.closeTo(
          shares(1000 - r),
          shares(0.00004)
        );
      });

      it('should decrease oustanding earned shares', async function () {
        const r = 0.0015 * 0.02 * days(14);
        expect(await this.module.earned()).to.be.bignumber.closeTo(
          shares(r),
          shares(0.00004)
        );
      });

      it('should decrease module reward token balance', async function () {
        const r = 0.002 * 0.02 * days(21);
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.closeTo(
          tokens(1000 - r),
          tokens(0.00004)
        );
      });

      it('should increase user reward token balance', async function () {
        const r = 0.002 * 0.02 * days(21);
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(r),
          tokens(0.00004)
        );
      });

      it('should emit RewardsDistributed event', async function () {
        const r = 0.002 * 0.02 * days(21);
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(r), tokens(0.00004));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(r), shares(0.00004));
      });

      it('report gas', async function () {
        reportGas('ERC20LinearRewardModule', 'claim', '', this.res)
      });

    });


    describe('when multiple users claim', function () {

      beforeEach(async function () {
        // bob claims
        this.res0 = await this.module.claim(bytes32(bob), bob, bob, shares(0), [], { from: owner });
        this.e0 = await this.module.elapsed();

        // alice unstakes
        this.res1 = await this.module.claim(bytes32(alice), alice, alice, shares(0), [], { from: owner });
        this.e1 = await this.module.elapsed();
      });

      it('should reset bob user position', async function () {
        const pos = await this.module.positions(bytes32(bob));
        expect(pos.shares).to.be.bignumber.equal(shares(0.015));
        expect(pos.timestamp).to.be.bignumber.equal(this.e0);
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
      });

      it('should reset alice user position', async function () {
        const pos = await this.module.positions(bytes32(alice));
        expect(pos.shares).to.be.bignumber.equal(shares(0.02));
        expect(pos.timestamp).to.be.bignumber.equal(this.e1);
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
      });

      it('should not affect total staking shares', async function () {
        expect(await this.module.stakingShares()).to.be.bignumber.equal(shares(0.035));
      });

      it('should decrease reward shares by combined amount', async function () {
        const r = 0.002 * 0.02 * days(21) + 0.002 * 0.015 * days(14);
        expect(await this.module.rewardShares()).to.be.bignumber.closeTo(
          shares(1000 - r),
          shares(2 * 0.00007)
        );
      });

      it('should zero oustanding earned shares', async function () {
        expect(await this.module.earned()).to.be.bignumber.closeTo(new BN(0), shares(0.00003));
      });

      it('should decrease pool reward token balance by combined amount ', async function () {
        const r = 0.002 * 0.02 * days(21) + 0.002 * 0.015 * days(14);
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.closeTo(
          tokens(1000 - r),
          tokens(2 * 0.00007)
        );
      });

      it('should increase bob reward token balance', async function () {
        const r = 0.002 * 0.015 * days(14);
        expect(await this.token.balanceOf(bob)).to.be.bignumber.closeTo(
          tokens(r),
          tokens(0.00003001)
        );
      });

      it('should increase alice reward token balance', async function () {
        const r = 0.002 * 0.02 * days(21);
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(r),
          tokens(2 * 0.00004) // 2 seconds * 0.00004
        );
      });

      it('should emit bob RewardsDistributed event', async function () {
        const r = 0.002 * 0.015 * days(14);
        const e = this.res0.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(r), tokens(0.00003001));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(r), shares(0.00003001));
      });

      it('should emit alice RewardsDistributed event', async function () {
        const r = 0.002 * 0.02 * days(21);
        const e = this.res1.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(r), tokens(0.00008)); // 2 seconds * 0.00004
        expect(e.args.shares).to.be.bignumber.closeTo(shares(r), shares(0.00008));
      });

    });
  });


  describe('withdraw', function () {

    beforeEach(async function () {

      // owner creates module
      this.module = await ERC20LinearRewardModule.new(
        this.token.address,
        days(14),
        e18(1),
        this.config.address,
        factory,
        { from: owner }
      );

      // owner funds module
      await this.token.transfer(owner, tokens(10000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.fund(tokens(1000), { from: owner });
      // 1000 tokens over 14 days ~= 0.000827 tokens/sec

      // create stake for alice @ 0.0004 tokens/sec
      await this.module.stake(bytes32(alice), alice, shares(0.0004), [], { from: owner });
      this.t0 = await this.module.lastUpdated();

      // advance 7 days
      await setupTime(this.t0, days(7));
      // earned: ~242 tokens, committed: ~484 tokens
    });

    describe('when amount is zero', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.withdraw(tokens(0), { from: owner }),
          'lrm5'
        )
      });
    });

    describe('when amount exceeds total balance', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.withdraw(tokens(1100), { from: owner }),
          'lrm6'
        )
      });
    });

    describe('when amount exceeds committed budget', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.withdraw(tokens(300), { from: owner }),
          'lrm7'
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
        this.res = await this.module.withdraw(tokens(200), { from: owner });
      });

      it('should decrease reward shares', async function () {
        expect(await this.module.rewardShares()).to.be.bignumber.equal(shares(800));
      });

      it('should not affect oustanding earned shares', async function () {
        const r = 0.0004 * days(7);
        expect(await this.module.earned()).to.be.bignumber.closeTo(
          shares(r),
          shares(0.0004)
        );
      });

      it('should decrease module reward token balance', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.equal(tokens(800));
      });

      it('should increase controller reward token balance', async function () {
        expect(await this.token.balanceOf(owner)).to.be.bignumber.equal(tokens(9200));
      });

      it('should emit RewardsWithdrawn event', async function () {
        expectEvent(
          this.res,
          'RewardsWithdrawn',
          { token: this.token.address, amount: tokens(200), shares: shares(200) }
        );
      });

      it('should still let users earn remaining tokens', async function () {
        await setupTime(this.t0, days(28));
        await this.module.update(bytes32(alice), alice, [], { from: owner });
        expect(await this.module.earned()).to.be.bignumber.equal(shares(800));
      });

    });

  });


  describe('elastic reward token', function () {

    beforeEach(async function () {
      // owner creates module
      this.module = await ERC20LinearRewardModule.new(
        this.elastic.address,
        days(30),
        e18(1),
        this.config.address,
        factory,
        { from: owner }
      );

      // owner funds module
      await this.elastic.transfer(owner, tokens(10000), { from: org });
      await this.elastic.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.fund(tokens(1000), { from: owner });
      await time.increase(days(1));
      // 1000 tokens over 30 days ~= 0.000386 tokens/sec

      // create stake for alice @ 0.0001 tokens/sec
      await this.module.stake(bytes32(alice), alice, shares(0.0001), [], { from: owner });
      this.t0 = await this.module.lastUpdated();
    });

    describe('when supply expands', function () {

      beforeEach(async function () {
        // expand
        await time.increase(days(1));
        await this.elastic.setCoefficient(e18(1.1));

        // advance to 7 days
        await setupTime(this.t0, days(7));

        // alice claims
        this.res0 = await this.module.claim(bytes32(alice), alice, alice, shares(0.0001), [], { from: owner });

        // withdraw
        this.res1 = await this.module.withdraw(tokens(500), { from: owner });

        // fund again
        await setupTime(this.t0, days(14));
        this.res2 = await this.module.fund(tokens(200), { from: owner });
      });

      it('should increase module reward token balance', async function () {
        const r = 1.1 * 0.0001 * days(7);
        expect(await this.elastic.balanceOf(this.module.address)).to.be.bignumber.closeTo(
          tokens(1.1 * 1000 - r - 500 + 200),
          tokens(2 * 0.00012)
        );
      });

      it('should increase rewards budget', async function () {
        const r = 1.1 * 0.0001 * days(14);
        expect((await this.module.balances())[0]).to.be.bignumber.closeTo(
          tokens(1.1 * 1000 - r - 500 + 200),
          tokens(2 * 0.00012)
        );
      });

      it('should not affect existing reward shares', async function () {
        expect(await this.module.rewardShares()).to.be.bignumber.closeTo(
          shares(1000 - 0.0001 * days(7) - 500 / 1.1 + 200 / 1.1),
          shares(2 * 0.00012)
        );
      });

      it('should distribute increased rewards', async function () {
        expect(await this.elastic.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(1.1 * 0.0001 * days(7)),
          tokens(2 * 0.00012)
        );
      });

      it('should emit reward event with increased amount and original shares', async function () {
        const e = this.res0.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.elastic.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(1.1 * 0.0001 * days(7)), tokens(0.00012));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(0.0001 * days(7)), shares(0.0001));
      });

      it('should emit RewardsWithdrawn with decreased burned shares', async function () {
        const e = this.res1.logs.filter(l => l.event === 'RewardsWithdrawn')[0];
        expect(e.args.token).eq(this.elastic.address);
        expect(e.args.amount).to.be.bignumber.equal(tokens(500));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(500 / 1.1), SHARE_DELTA);
      });

      it('should emit RewardsFunded with decreased minted shares', async function () {
        const e = this.res2.logs.filter(l => l.event === 'RewardsFunded')[0];
        expect(e.args.token).eq(this.elastic.address);
        expect(e.args.amount).to.be.bignumber.equal(tokens(200));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(200 / 1.1), SHARE_DELTA);
      });

    });


    describe('when supply decreases', function () {

      beforeEach(async function () {
        // shrink
        await time.increase(days(1));
        await this.elastic.setCoefficient(e18(0.75));

        // advance to 7 days
        await setupTime(this.t0, days(7));

        // alice claims
        this.res0 = await this.module.claim(bytes32(alice), alice, alice, shares(0.0001), [], { from: owner });

        // withdraw
        this.res1 = await this.module.withdraw(tokens(500), { from: owner });

        // fund again
        await setupTime(this.t0, days(14));
        this.res2 = await this.module.fund(tokens(200), { from: owner });
      });

      it('should decrease module reward token balance', async function () {
        const r = 0.75 * 0.0001 * days(7);
        expect(await this.elastic.balanceOf(this.module.address)).to.be.bignumber.closeTo(
          tokens(0.75 * 1000 - r - 500 + 200),
          tokens(0.0002)
        );
      });

      it('should decrease rewards budget', async function () {
        const r = 0.75 * 0.0001 * days(14);
        expect((await this.module.balances())[0]).to.be.bignumber.closeTo(
          tokens(0.75 * 1000 - r - 500 + 200),
          tokens(0.0002)
        );
      });

      it('should not affect existing reward shares', async function () {
        expect(await this.module.rewardShares()).to.be.bignumber.closeTo(
          shares(1000 - 0.0001 * days(7) - 500 / 0.75 + 200 / 0.75),
          shares(0.0001)
        );
      });

      it('should distribute decreased rewards', async function () {
        expect(await this.elastic.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(0.75 * 0.0001 * days(7)),
          tokens(0.000075)
        );
      });

      it('should emit reward event with decreased amount and original shares', async function () {
        const e = this.res0.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.elastic.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(0.75 * 0.0001 * days(7)), tokens(0.000075));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(0.0001 * days(7)), shares(0.0001));
      });

      it('should emit RewardsWithdrawn with increased burned shares', async function () {
        const e = this.res1.logs.filter(l => l.event === 'RewardsWithdrawn')[0];
        expect(e.args.token).eq(this.elastic.address);
        expect(e.args.amount).to.be.bignumber.equal(tokens(500));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(500 / 0.75), SHARE_DELTA);
      });

      it('should emit RewardsFunded with increased minted shares', async function () {
        const e = this.res2.logs.filter(l => l.event === 'RewardsFunded')[0];
        expect(e.args.token).eq(this.elastic.address);
        expect(e.args.amount).to.be.bignumber.equal(tokens(200));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(200 / 0.75), SHARE_DELTA);
      });

    });
  });

  describe('split address handling', function () {

    beforeEach(async function () {

      // owner creates module
      this.module = await ERC20LinearRewardModule.new(
        this.token.address,
        days(14),
        e18(1),
        this.config.address,
        factory,
        { from: owner }
      );

      // owner funds module
      await this.token.transfer(owner, tokens(10000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.fund(tokens(2000), { from: owner });
      await time.increase(days(1));

      // create stake for alice under separate account @ 0.0005 tokens/sec
      await this.module.stake(bytes32(other), alice, shares(0.0005), [], { from: owner });
      this.t0 = await this.module.lastUpdated();
      this.e0 = await this.module.elapsed();

      // advance 7 days
      await setupTime(this.t0, days(7));

      // create stake for bob @ 0.0003 tokens/sec
      await this.module.stake(bytes32(bob), bob, shares(0.0003), [], { from: owner });

      // advance another 14 days
      await setupTime(this.t0, days(21));
    });

    describe('when sender and account differ', function () {

      it('should set account position shares', async function () {
        expect((await this.module.positions(bytes32(other))).shares).to.be.bignumber.equal(shares(0.0005));
      });

      it('should set account position timestamp', async function () {
        expect((await this.module.positions(bytes32(other))).timestamp).to.be.bignumber.equal(this.e0);
      });

      it('should set account position earned', async function () {
        expect((await this.module.positions(bytes32(other))).earned).to.be.bignumber.equal(new BN(0));
      });

      it('should have no position shares for sender', async function () {
        expect((await this.module.positions(bytes32(alice))).shares).to.be.bignumber.equal(new BN(0));
      });

    });

    describe('when sender is passed as account for unstake', function () {

      it('should revert', async function () {
        await expectRevert(
          this.module.unstake(bytes32(alice), alice, alice, shares(0.0005), [], { from: owner }),
          'revert'  // insufficient shares, this would be caught upstream
        )
      });
    });

    describe('when user unstakes all shares against account', function () {

      beforeEach(async function () {
        // alice unstakes all
        this.res = await this.module.unstake(bytes32(other), alice, alice, shares(0.0005), [], { from: owner });
      });

      it('should delete account position', async function () {
        const pos = await this.module.positions(bytes32(other));
        expect(pos.shares).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
      });

      it('should decrease total staking shares', async function () {
        expect(await this.module.stakingShares()).to.be.bignumber.equal(shares(0.0003));
      });

      it('should decrease reward shares', async function () {
        const r = 0.0005 * days(21);
        expect(await this.module.rewardShares()).to.be.bignumber.closeTo(
          shares(2000 - r),
          shares(0.0005)
        );
      });

      it('should decrease oustanding earned shares', async function () {
        const r = 0.0003 * days(14);
        expect(await this.module.earned()).to.be.bignumber.closeTo(
          shares(r),
          shares(0.0003)
        );
      });

      it('should decrease module reward token balance', async function () {
        const r = 0.0005 * days(21);
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.closeTo(
          tokens(2000 - r),
          tokens(0.0005)
        );
      });

      it('should increase user reward token balance', async function () {
        const r = 0.0005 * days(21);
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(r),
          tokens(0.0005)
        );
      });

      it('should not increase account reward token balance', async function () {
        expect(await this.token.balanceOf(other)).to.be.bignumber.equal(new BN(0));
      });

      it('should emit RewardsDistributed event', async function () {
        const r = 0.0005 * days(21);
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(r), tokens(0.0005));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(r), shares(0.0005));
      });
    });

    describe('when account, sender, and receiver all differ for unstake', function () {

      beforeEach(async function () {
        // alice unstakes all
        this.res = await this.module.unstake(bytes32(other), alice, charlie, shares(0.0005), [], { from: owner });
      });

      it('should delete account position', async function () {
        const pos = await this.module.positions(bytes32(other));
        expect(pos.shares).to.be.bignumber.equal(new BN(0));
        expect(pos.timestamp).to.be.bignumber.equal(new BN(0));
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
      });

      it('should decrease total staking shares', async function () {
        expect(await this.module.stakingShares()).to.be.bignumber.equal(shares(0.0003));
      });

      it('should decrease reward shares', async function () {
        const r = 0.0005 * days(21);
        expect(await this.module.rewardShares()).to.be.bignumber.closeTo(
          shares(2000 - r),
          shares(0.0005)
        );
      });

      it('should decrease oustanding earned shares', async function () {
        const r = 0.0003 * days(14);
        expect(await this.module.earned()).to.be.bignumber.closeTo(
          shares(r),
          shares(0.0003)
        );
      });

      it('should decrease module reward token balance', async function () {
        const r = 0.0005 * days(21);
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.closeTo(
          tokens(2000 - r),
          tokens(0.0005)
        );
      });

      it('should increase receiver reward token balance', async function () {
        const r = 0.0005 * days(21);
        expect(await this.token.balanceOf(charlie)).to.be.bignumber.closeTo(
          tokens(r),
          tokens(0.0005)
        );
      });

      it('should not increase account reward token balance', async function () {
        expect(await this.token.balanceOf(other)).to.be.bignumber.equal(new BN(0));
      });

      it('should not increase sender reward token balance', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(new BN(0));
      });

      it('should emit RewardsDistributed event for receiver', async function () {
        const r = 0.0005 * days(21);
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(charlie);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(r), tokens(0.0005));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(r), shares(0.0005));
      });
    });

    describe('when account, sender, and receiver all differ for claim', function () {

      beforeEach(async function () {
        // alice unstakes all
        this.res = await this.module.claim(bytes32(other), alice, charlie, shares(0.0005), [], { from: owner });
        this.e1 = await this.module.elapsed();
      });

      it('should reset account position', async function () {
        const pos = await this.module.positions(bytes32(other));
        expect(pos.shares).to.be.bignumber.equal(shares(0.0005));
        expect(pos.timestamp).to.be.bignumber.equal(this.e1);
        expect(pos.earned).to.be.bignumber.equal(new BN(0));
      });

      it('should not change total staking shares', async function () {
        expect(await this.module.stakingShares()).to.be.bignumber.equal(shares(0.0008));
      });

      it('should decrease reward shares', async function () {
        const r = 0.0005 * days(21);
        expect(await this.module.rewardShares()).to.be.bignumber.closeTo(
          shares(2000 - r),
          shares(0.0005)
        );
      });

      it('should decrease oustanding earned shares', async function () {
        const r = 0.0003 * days(14);
        expect(await this.module.earned()).to.be.bignumber.closeTo(
          shares(r),
          shares(0.0003)
        );
      });

      it('should decrease module reward token balance', async function () {
        const r = 0.0005 * days(21);
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.closeTo(
          tokens(2000 - r),
          tokens(0.0005)
        );
      });

      it('should increase receiver reward token balance', async function () {
        const r = 0.0005 * days(21);
        expect(await this.token.balanceOf(charlie)).to.be.bignumber.closeTo(
          tokens(r),
          tokens(0.0005)
        );
      });

      it('should not increase account reward token balance', async function () {
        expect(await this.token.balanceOf(other)).to.be.bignumber.equal(new BN(0));
      });

      it('should not increase sender reward token balance', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(new BN(0));
      });

      it('should emit RewardsDistributed event for receiver', async function () {
        const r = 0.0005 * days(21);
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(charlie);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(r), tokens(0.0005));
        expect(e.args.shares).to.be.bignumber.closeTo(shares(r), shares(0.0005));
      });
    });

  });

});
