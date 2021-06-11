// unit tests for ERC20FriendlyRewardModule

const { accounts, contract, web3 } = require('@openzeppelin/test-environment');
const { BN, time, expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const {
  tokens,
  bonus,
  days,
  shares,
  now,
  toFixedPointBigNumber,
  fromFixedPointBigNumber,
  reportGas,
  DECIMALS
} = require('../util/helper');

const printDebug = (log) => {
  console.log(log.args.a.toString())
  console.log(log.args.b.toString())
  console.log(log.args.c.toString())
  console.log(log.args.d.toString())
  console.log(log.args.e.toString())
}

const ERC20FriendlyRewardModule = contract.fromArtifact('ERC20FriendlyRewardModule');
const TestToken = contract.fromArtifact('TestToken');
const TestElasticToken = contract.fromArtifact('TestElasticToken')
const TestFeeToken = contract.fromArtifact('TestFeeToken');

// need decent tolerance to account for potential timing error
const TOKEN_DELTA = toFixedPointBigNumber(0.001, 10, DECIMALS);
const SHARE_DELTA = toFixedPointBigNumber(0.001 * (10 ** 6), 10, DECIMALS);
const BONUS_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);


describe('ERC20FriendlyRewardModule', function () {
  const [org, owner, bob, alice, factory, other] = accounts;

  beforeEach('setup', async function () {
    this.token = await TestToken.new({ from: org });
    this.elastic = await TestElasticToken.new({ from: org });
    this.feeToken = await TestFeeToken.new({ from: org });
  });

  describe('construction', function () {

    describe('when vestingStart is greater than 1', function () {
      it('should fail to construct', async function () {
        await expectRevert(
          ERC20FriendlyRewardModule.new(
            this.token.address,
            bonus(1.1),
            days(90),
            factory,
            { from: owner }
          ),
          'frm1' // ERC20FriendlyRewardModule: vesting start is greater than 1
        )
      });
    });

    describe('when initialized with valid constructor arguments', function () {
      beforeEach(async function () {
        this.module = await ERC20FriendlyRewardModule.new(
          this.token.address,
          bonus(0.5),
          days(90),
          factory,
          { from: owner }
        );
      });
      it('should create an ERC20FriendlyRewardModule object', async function () {
        expect(this.module).to.be.an('object');
        expect(this.module.constructor.name).to.be.equal('TruffleContract');
      });

      it('should return the correct addresses for owner and token', async function () {
        expect(await this.module.owner()).to.equal(owner);
        expect((await this.module.tokens())[0]).to.equal(this.token.address);
      });

      it('should initialize bonus params properly', async function () {
        expect(await this.module.vestingStart()).to.be.bignumber.equal(bonus(0.5));
        expect(await this.module.vestingPeriod()).to.be.bignumber.equal(new BN(60 * 60 * 24 * 90));
      });

      it('should have zero reward balances', async function () {
        expect((await this.module.balances())[0]).to.be.bignumber.equal(new BN(0));
        expect(await this.module.totalLocked()).to.be.bignumber.equal(new BN(0));
        expect(await this.module.totalUnlocked()).to.be.bignumber.equal(new BN(0));
      });

      it('should have zero earning balances', async function () {
        expect(await this.module.totalRawStakingShares()).to.be.bignumber.equal(new BN(0));
        expect(await this.module.totalStakingShares()).to.be.bignumber.equal(new BN(0));
      });

      it('should have a 0 GYSR usage ratio', async function () {
        expect(await this.module.usage()).to.be.bignumber.equal(new BN(0));
      });
    })
  });


  describe('time vesting', function () {

    describe('when configured with a starting 50% vesting over 90 days', function () {

      beforeEach(async function () {
        // owner creates module
        this.module = await ERC20FriendlyRewardModule.new(
          this.token.address,
          bonus(0.5),
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

      it('should be 0.5x for t = 0', async function () {
        const mult = fromFixedPointBigNumber(await this.module.timeVestingCoefficient(await now()), 10, 18);
        expect(mult).to.be.equal(0.5);
      });

      it('should be 0.75x for t = 45 days', async function () {
        const mult = fromFixedPointBigNumber(await this.module.timeVestingCoefficient((await now()).sub(days(45))), 10, 18);
        expect(mult).to.be.equal(0.75);
      });

      it('should be 1x for t = 90 days', async function () {
        const mult = fromFixedPointBigNumber(await this.module.timeVestingCoefficient((await now()).sub(days(90))), 10, 18);
        expect(mult).to.be.equal(1);
      });

      it('should be 1x for t > 90 days', async function () {
        const mult = fromFixedPointBigNumber(await this.module.timeVestingCoefficient((await now()).sub(days(150))), 10, 18);
        expect(mult).to.be.equal(1);
      });
    });

    describe('when configured with 0 day vesting period', function () {

      beforeEach(async function () {
        // owner creates module
        this.module = await ERC20FriendlyRewardModule.new(
          this.token.address,
          bonus(0.5),
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

      it('should be 100% vested for t = 0', async function () {
        const mult = fromFixedPointBigNumber(await this.module.timeVestingCoefficient(await now()), 10, 18);
        expect(mult).to.be.equal(1);
      });

      it('should be 100% vested for t > 0 days', async function () {
        const mult = fromFixedPointBigNumber(await this.module.timeVestingCoefficient((await now()).sub(days(30))), 10, 18);
        expect(mult).to.be.equal(1);
      });
    });

    describe('when configured with vestingStart at 100%', function () {

      beforeEach(async function () {
        // owner creates module
        this.module = await ERC20FriendlyRewardModule.new(
          this.token.address,
          bonus(1),
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

      it('should be 100% vested for t = 0', async function () {
        const mult = fromFixedPointBigNumber(await this.module.timeVestingCoefficient(0), 10, 18);
        expect(mult).to.be.equal(1.0);
      });

      it('should be 100% vested for 0 < t < period', async function () {
        const mult = fromFixedPointBigNumber(await this.module.timeVestingCoefficient(days(30)), 10, 18);
        expect(mult).to.be.equal(1.0);
      });

      it('should be 100% vested for t = period', async function () {
        const mult = fromFixedPointBigNumber(await this.module.timeVestingCoefficient(days(90)), 10, 18);
        expect(mult).to.be.equal(1.0);
      });

      it('should be 100% vested for t > period', async function () {
        const mult = fromFixedPointBigNumber(await this.module.timeVestingCoefficient(days(120)), 10, 18);
        expect(mult).to.be.equal(1.0);
      });
    });
  });

  describe('stake without GYSR', function () {
    beforeEach('setup', async function () {
      // owner creates module
      this.module = await ERC20FriendlyRewardModule.new(
        this.token.address,
        bonus(0),
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

      this.res = await this.module.stake(alice, alice, shares(200), [], { from: owner });
    });

    it('should have a single stake for that user', async function () {
      expect(await this.module.stakeCount(alice)).to.be.bignumber.equal(new BN(1));
    });

    it('should update total raw staking shares', async function () {
      expect(await this.module.totalRawStakingShares()).to.be.bignumber.equal(shares(200));
    });

    it('should have the same total staking shares as raw staking shares', async function () {
      const raw = await this.module.totalRawStakingShares();
      expect(await this.module.totalStakingShares()).to.be.bignumber.equal(raw);
    });

    it('should not emit GysrSpent', async function () {
      const e = this.res.logs.filter(l => l.event === 'GysrSpent');
      expect(e.length).eq(0);
    });

    it('should not emit GysrVested', async function () {
      const e = this.res.logs.filter(l => l.event === 'GysrVested');
      expect(e.length).eq(0);
    });

    it('report gas', async function () {
      reportGas('ERC20FriendlyRewardModule', 'stake', '', this.res)
    });
  })

  describe('stake with GYSR', function () {

    beforeEach('setup', async function () {
      // owner creates module
      this.module = await ERC20FriendlyRewardModule.new(
        this.token.address,
        bonus(0),
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
    })

    describe('when gysr amount not encoded correctly', function () {
      it('should revert', async function () {
        const data = "0x0de0b6b3a7640000"; // not a full 32 bytes
        await expectRevert(
          this.module.stake(alice, alice, shares(100), data, { from: owner }),
          'frm2' // ERC20FriendlyRewardModule: invalid data
        )
      });
    });

    describe('when a user stakes with a valid amount of gysr', function () {
      beforeEach(async function () {
        const gysr = 0.01 // reduced because of proportion to total staked
        const r = 0.01 // ratio is 0
        const x = 1 + gysr / r
        this.mult = 1 + Math.log10(x)

        const data = web3.eth.abi.encodeParameter('uint256', tokens(1).toString());
        this.res = await this.module.stake(alice, alice, tokens(100), data, { from: owner })
      });

      it('should have a single stake for that user', async function () {
        expect(await this.module.stakeCount(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should update total raw staking shares', async function () {
        expect(await this.module.totalRawStakingShares()).to.be.bignumber.equal(tokens(100));
      });

      it('should have total staking shares = total raw staking shares x mult', async function () {
        const raw = await this.module.totalRawStakingShares();
        expect(await this.module.totalStakingShares()).to.be.bignumber.closeTo(raw.mul(tokens(this.mult)).div(tokens(1)), TOKEN_DELTA);
      });

      it('should increase GYSR usage', async function () {
        expect(await this.module.usage()).to.be.bignumber.closeTo(bonus((this.mult - 1.0) / this.mult), BONUS_DELTA);
      });

      it('should emit GysrSpent event', async function () {
        expectEvent(
          this.res,
          'GysrSpent',
          { user: alice, amount: tokens(1) }
        );
      });

      it('report gas', async function () {
        reportGas('ERC20FriendlyRewardModule', 'stake', 'with GYSR', this.res)
      });
    });
  });

  describe('Unstake', function () {
    describe('In a module with no vesting', function () {
      beforeEach(async function () {
        // owner creates module
        this.module = await ERC20FriendlyRewardModule.new(
          this.token.address,
          bonus(1),
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

        const gysr = 0.01 // reduced because of proportion to total staked
        const r = 0.01 // ratio is 0
        const x = 1 + gysr / r
        this.mult = 1 + Math.log10(x) // 1.3010299956639813

        // alice stakes 100 tokens at 10 days with a 1.3x multiplier
        await time.increaseTo(this.t0.add(days(10)));
        const data = web3.eth.abi.encodeParameter('uint256', tokens(1).toString());
        let result = await this.module.stake(alice, alice, shares(100), data, { from: owner });
        this.t1 = await this.module.lastUpdated();

        // bob stakes 100 tokens at 40 days
        await time.increaseTo(this.t0.add(days(40)));
        result = await this.module.stake(bob, bob, shares(100), [], { from: owner });

        // alice stakes another 100 tokens at 80 days
        await time.increaseTo(this.t0.add(days(80)));
        await this.module.stake(alice, alice, shares(100), [], { from: owner });

        // advance last 20 days
        await time.increaseTo(this.t0.add(days(100)));

        // DAYS 0 - 40
        this.aliceRewardTotal = 1000 / 5 // 1/5th of time elapsed

        // DAYS 40 - 80
        // alice accrued 1.3 x 100 / 230 x 200 rewards = ~113.04 in the next 40 days
        this.aliceRewardTotal += 1000 / 5 * (100 * this.mult) / (100 * this.mult + 100)
        // bob accrued 100 / 230 x 200 rewards = ~86.96 in those same 40 days
        this.bobRewardTotal = 1000 / 5 * 100 / (100 * this.mult + 100) // 1/5th of time elapsed

        // DAYS 80 - 100
        // alice accrued (1.3 x 100 + 100) / 330 x 100 rewards = ~69.69 in the next 20 days
        this.aliceRewardTotal += 1000 / 10 * (100 * this.mult + 100) / (100 * this.mult + 200) // 1/10th of time elapsed
        // bob accrued 100 / 330 x 100 rewards = ~30.3 in the next 20 days
        this.bobRewardTotal += 1000 / 10 * (100) / (100 * this.mult + 200) // 1/10th of time elapsed

        // alice total @ 100 days = ~382.7888269893189
        // bob total @ 100 days = ~117.26
      });

      describe('when one user unstakes all shares', function () {

        beforeEach(async function () {
          this.aliceExpectedReward = this.aliceRewardTotal
          this.res = await this.module.unstake(alice, alice, shares(200), [], { from: owner })
        });

        it('should have no remaining stakes for user', async function () {
          expect(await this.module.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
        });

        it('should disburse expected amount of reward token to user', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
            tokens(this.aliceExpectedReward), TOKEN_DELTA
          );
        });

        it('should reduce amount of reward token in unlocked pool', async function () {
          expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(
            tokens(this.bobRewardTotal), TOKEN_DELTA
          );
        });

        it('should emit reward event', async function () {
          const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
          expect(e.args.user).eq(alice);
          expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceRewardTotal), TOKEN_DELTA);
        });

        it('should emit GysrVested event', async function () {
          expectEvent(
            this.res,
            'GysrVested',
            { user: alice, amount: tokens(1) }
          );
        });

        it('report gas', async function () {
          reportGas('ERC20FriendlyRewardModule', 'unstake', 'multi stake with GYSR', this.res)
        });
      });

      describe('when one user unstakes some shares', function () {

        beforeEach(async function () {
          // alice accrued (100) / 330 x 100 rewards = ~30.3 in the last 20 days from stake 2
          this.aliceExpectedReward = 1000 / 10 * (100) / (100 * this.mult + 200)
          // alice accrued (25 * 1.3) / 330 x 100 rewards = ~9.84 in the last 20 days from stake 1
          this.aliceExpectedReward += 1000 / 10 * (25 * this.mult) / (100 * this.mult + 200)
          // alice accrued (25 * 1.3) / 230 x 200 rewards = ~28.26 in the previous days
          this.aliceExpectedReward += 1000 / 5 * (25 * this.mult) / (100 * this.mult + 100)
          this.aliceExpectedReward += 1000 / 5 / 4 // original 40 days x 1/4 of stake unstaked

          this.res = await this.module.unstake(alice, alice, shares(125), [], { from: owner });
        });

        it('should still have 1 stake leftover', async function () {
          expect(await this.module.stakeCount(alice)).to.be.bignumber.equal(new BN(1));
        });

        it('should disburse expected amount of reward token to user', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
            tokens(this.aliceExpectedReward), TOKEN_DELTA
          );
        });

        it('should reduce amount of reward token in unlocked pool', async function () {
          expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(
            tokens(this.aliceRewardTotal - this.aliceExpectedReward + this.bobRewardTotal), TOKEN_DELTA
          );
        });

        it('should emit reward event', async function () {
          const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
          expect(e.args.user).eq(alice);
          expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceExpectedReward), TOKEN_DELTA);
        });

        it('should emit GysrVested event', async function () {
          expectEvent(
            this.res,
            'GysrVested',
            { user: alice, amount: tokens(0.25) }
          );
        });
      });

      describe('when two users unstake all shares', function () {

        beforeEach(async function () {
          this.bobExpectedReward = this.bobRewardTotal
          this.res1 = await this.module.unstake(bob, bob, shares(100), [], { from: owner });

          this.aliceExpectedReward = this.aliceRewardTotal
          this.res2 = await this.module.unstake(alice, alice, shares(200), [], { from: owner });
        });

        it('should have no remaining stakes for users', async function () {
          expect(await this.module.stakeCount(bob)).to.be.bignumber.equal(new BN(0));
          expect(await this.module.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
        });

        it('should disburse expected amount of reward token to user', async function () {
          expect(await this.token.balanceOf(bob)).to.be.bignumber.closeTo(
            tokens(this.bobExpectedReward), TOKEN_DELTA
          );
          expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
            tokens(this.aliceExpectedReward), TOKEN_DELTA
          );
        });

        it('should reduce amount of reward token in unlocked pool', async function () {
          expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(
            tokens(0), TOKEN_DELTA
          );
        });

        it('should emit reward event', async function () {
          const e1 = this.res1.logs.filter(l => l.event === 'RewardsDistributed')[0];
          expect(e1.args.user).eq(bob);
          expect(e1.args.amount).to.be.bignumber.closeTo(tokens(this.bobExpectedReward), TOKEN_DELTA);

          const e2 = this.res2.logs.filter(l => l.event === 'RewardsDistributed')[0];
          expect(e2.args.user).eq(alice);
          expect(e2.args.amount).to.be.bignumber.closeTo(tokens(this.aliceExpectedReward), TOKEN_DELTA);
        });

        it('should emit GysrVested event', async function () {
          expectEvent(
            this.res2,
            'GysrVested',
            { user: alice, amount: tokens(1) }
          );
        });
      });
    });

    describe('In a module with a vesting schedule', function () {
      beforeEach(async function () {
        // owner creates module
        this.module = await ERC20FriendlyRewardModule.new(
          this.token.address,
          bonus(0),
          days(80),
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

        const gysr = 0.01 // reduced because of proportion to total staked
        const r = 0.01 // ratio is 0
        const x = 1 + gysr / r
        this.mult = 1 + Math.log10(x) // 1.3010299956639813

        // alice stakes 100 tokens at 10 days with a 1.3x multiplier
        await time.increaseTo(this.t0.add(days(10)));
        const data = web3.eth.abi.encodeParameter('uint256', tokens(1).toString());
        let result = await this.module.stake(alice, alice, shares(100), data, { from: owner });
        this.t1 = await this.module.lastUpdated();

        // bob stakes 100 tokens at 40 days
        await time.increaseTo(this.t0.add(days(40)));
        result = await this.module.stake(bob, bob, shares(100), [], { from: owner });

        // alice stakes another 100 tokens at 80 days
        await time.increaseTo(this.t0.add(days(80)));
        await this.module.stake(alice, alice, shares(100), [], { from: owner });

        // advance last 20 days
        await time.increaseTo(this.t0.add(days(100)));

        // DAYS 0 - 40
        this.aliceRewardTotal = 1000 / 5 // 1/5th of time elapsed

        // DAYS 40 - 80
        // alice accrued 1.3 x 100 / 230 x 200 rewards = ~113.04 in the next 40 days
        this.aliceRewardTotal += 1000 / 5 * (100 * this.mult) / (100 * this.mult + 100)
        // bob accrued 100 x 75% / 230 x 200 rewards = ~65.22 in those same 40 days
        this.bobRewardTotal = 1000 / 5 * 100 * .75 / (100 * this.mult + 100) // 1/5th of time elapsed, 75% vested
        this.bobRewardUnpenalized = 1000 / 5 * 100 / (100 * this.mult + 100)

        // DAYS 80 - 100
        // alice accrued (1.3 x 100 + 100 x 25%) / 330 x 100 rewards = ~46.96 in the next 20 days
        this.aliceRewardTotal += 1000 / 10 * (100 * this.mult) / (100 * this.mult + 200) // 1/10th of time elapsed, 100% vested
        this.aliceRewardTotal += 1000 / 10 * (100 * .25) / (100 * this.mult + 200) // 1/10th of time elapsed, 25% vested
        // bob accrued 100 x 75% / 330 x 100 rewards = ~22.72 in the next 20 days
        this.bobRewardTotal += 1000 / 10 * (100 * .75) / (100 * this.mult + 200) // 1/10th of time elapsed, 75% vested
        this.bobRewardUnpenalized += 1000 / 10 * 100 / (100 * this.mult + 200)

        // assuming they are the first to unstake...
        // alice total @ 100 days = ~360.7888269893189
        // bob total @ 100 days = ~87.94 (non-penalized: 117.26)
      });

      describe('when one user unstakes all shares', function () {

        beforeEach(async function () {
          this.aliceExpectedReward = this.aliceRewardTotal
          this.res = await this.module.unstake(alice, alice, shares(200), [], { from: owner })
        });

        it('should have no remaining stakes for user', async function () {
          expect(await this.module.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
        });

        it('should disburse expected amount of reward token to user', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
            tokens(this.aliceExpectedReward), TOKEN_DELTA
          );
        });

        it('should reduce amount of reward token in unlocked pool', async function () {
          expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(
            tokens(500 - this.aliceExpectedReward), TOKEN_DELTA
          );
        });

        it('should emit reward event', async function () {
          const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
          expect(e.args.user).eq(alice);
          expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceRewardTotal), TOKEN_DELTA);
        });

        it('should emit GysrVested event', async function () {
          expectEvent(
            this.res,
            'GysrVested',
            { user: alice, amount: tokens(1) }
          );
        });
      });

      describe('when one user unstakes some shares', function () {

        beforeEach(async function () {
          // alice accrued (100 x 25%) / 330 x 100 rewards = ~7.57 in the last 20 days from stake 2 with 25% vested
          this.aliceExpectedReward = 1000 / 10 * (50 * .25) / (100 * this.mult + 200)
          this.res = await this.module.unstake(alice, alice, shares(50), [], { from: owner });
        });

        it('should still have 1 stake leftover', async function () {
          expect(await this.module.stakeCount(alice)).to.be.bignumber.equal(new BN(2));
        });

        it('should disburse expected amount of reward token to user', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
            tokens(this.aliceExpectedReward), TOKEN_DELTA
          );
        });

        it('should reduce amount of reward token in unlocked pool', async function () {
          expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(
            tokens(500 - this.aliceExpectedReward), TOKEN_DELTA
          );
        });

        it('should emit reward event', async function () {
          const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
          expect(e.args.user).eq(alice);
          expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceExpectedReward), TOKEN_DELTA);
        });
      });

      describe('when two users unstake all shares', function () {

        beforeEach(async function () {
          this.bobExpectedReward = this.bobRewardTotal
          this.res1 = await this.module.unstake(bob, bob, shares(100), [], { from: owner });
          let bobDust = this.bobRewardUnpenalized - this.bobExpectedReward

          this.aliceExpectedReward = this.aliceRewardTotal
          this.aliceExpectedReward += bobDust * (100 * this.mult + .25 * 100) / (100 * this.mult + 100)
          this.res2 = await this.module.unstake(alice, alice, shares(200), [], { from: owner });
        });

        it('should have no remaining stakes for users', async function () {
          expect(await this.module.stakeCount(bob)).to.be.bignumber.equal(new BN(0));
          expect(await this.module.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
        });

        it('should disburse expected amount of reward token to user', async function () {
          expect(await this.token.balanceOf(bob)).to.be.bignumber.closeTo(
            tokens(this.bobExpectedReward), TOKEN_DELTA
          );
          expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
            tokens(this.aliceExpectedReward), TOKEN_DELTA
          );
        });

        it('should reduce amount of reward token in unlocked pool', async function () {
          expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(
            tokens(500 - this.aliceExpectedReward - this.bobExpectedReward), TOKEN_DELTA
          );
        });

        it('should emit reward event', async function () {
          const e1 = this.res1.logs.filter(l => l.event === 'RewardsDistributed')[0];
          expect(e1.args.user).eq(bob);
          expect(e1.args.amount).to.be.bignumber.closeTo(tokens(this.bobExpectedReward), TOKEN_DELTA);

          const e2 = this.res2.logs.filter(l => l.event === 'RewardsDistributed')[0];
          expect(e2.args.user).eq(alice);
          expect(e2.args.amount).to.be.bignumber.closeTo(tokens(this.aliceExpectedReward), TOKEN_DELTA);
        });

        it('should emit GysrVested event', async function () {
          expectEvent(
            this.res2,
            'GysrVested',
            { user: alice, amount: tokens(1) }
          );
        });

      });
    });
  });

  describe('claim', function () {

    beforeEach('setup', async function () {

      // owner creates module
      this.module = await ERC20FriendlyRewardModule.new(
        this.token.address,
        bonus(1),
        days(0),
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

      const gysr = 0.01 // reduced because of proportion to total staked
      const r = 0.01 // ratio is 0
      const x = 1 + gysr / r
      this.mult = 1 + Math.log10(x) // 1.3010299956639813


      // alice stakes 100 tokens at 10 days with a 1.3x multiplier
      await time.increaseTo(this.t0.add(days(10)));
      const data = web3.eth.abi.encodeParameter('uint256', tokens(1).toString());
      let result = await this.module.stake(alice, alice, shares(100), data, { from: owner });
      this.t1 = await this.module.lastUpdated();
      this.gysr = 1

      // bob stakes 100 tokens at 40 days
      await time.increaseTo(this.t0.add(days(40)));
      result = await this.module.stake(bob, bob, shares(100), [], { from: owner });

      // alice stakes another 100 tokens at 80 days
      await time.increaseTo(this.t0.add(days(80)));
      await this.module.stake(alice, alice, shares(100), [], { from: owner });
      this.t2 = await this.module.lastUpdated()

      // advance last 20 days
      await time.increaseTo(this.t0.add(days(100)));

      // DAYS 0 - 40
      this.aliceRewardTotal = 1000 / 5 // 1/5th of time elapsed

      // DAYS 40 - 80
      // alice accrued 1.3 x 100 / 230 x 200 rewards = ~113.04 in the next 40 days
      this.aliceRewardTotal += 1000 / 5 * (100 * this.mult) / (100 * this.mult + 100)
      // bob accrued 100 / 230 x 200 rewards = ~86.96 in those same 40 days
      this.bobRewardTotal = 1000 / 5 * 100 / (100 * this.mult + 100) // 1/5th of time elapsed

      // DAYS 80 - 100
      // alice accrued (1.3 x 100 + 100) / 330 x 100 rewards = ~69.69 in the next 20 days
      this.aliceRewardTotal += 1000 / 10 * (100 * this.mult + 100) / (100 * this.mult + 200) // 1/10th of time elapsed
      // bob accrued 100 / 330 x 100 rewards = ~30.3 in the next 20 days
      this.bobRewardTotal += 1000 / 10 * (100) / (100 * this.mult + 200) // 1/10th of time elapsed

      // alice total @ 100 days = ~382.7888269893189
      // bob total @ 100 days = ~117.26
    });

    describe('when one user claims on all shares', function () {

      beforeEach(async function () {
        this.aliceExpectedReward = this.aliceRewardTotal
        // claim
        this.res = await this.module.claim(alice, alice, shares(200), [], { from: owner });
        this.t3 = await this.module.lastUpdated();
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
        expect((await this.module.stakes(alice, 0)).timestamp).to.be.bignumber.equal(this.t3);
      });

      it('should reset GYSR for user stake', async function () {
        expect((await this.module.stakes(alice, 0)).gysr).to.be.bignumber.equal(new BN(0));
      });

      it('should reset bonus for user stake', async function () {
        expect((await this.module.stakes(alice, 0)).bonus).to.be.bignumber.equal(bonus(1));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.aliceExpectedReward), TOKEN_DELTA
        );
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(
          tokens(500 - this.aliceExpectedReward), TOKEN_DELTA
        );
      });

      it('should emit reward event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceExpectedReward), TOKEN_DELTA);
      });

      it('should emit GysrVested event', async function () {
        expectEvent(
          this.res,
          'GysrVested',
          { user: alice, amount: tokens(1) }
        );
      });

      it('report gas', async function () {
        reportGas('ERC20FriendlyRewardModule', 'claim', '', this.res)
      });

    });

    describe('when one user claims with more shares than the last stake', function () {

      beforeEach(async function () {
        this.aliceExpectedReward = 1000 / 10 * (100 + 50 * this.mult) / (100 * this.mult + 200)
        this.aliceExpectedReward += 1000 / 5 * (50 * this.mult) / (100 * this.mult + 100)
        this.aliceExpectedReward += 1000 / 5 * (50 * this.mult) / (100 * this.mult)
        // claim
        this.res = await this.module.claim(alice, alice, shares(150), [], { from: owner });
        this.t3 = await this.module.lastUpdated();
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
        expect((await this.module.stakes(alice, 1)).timestamp).to.be.bignumber.equal(this.t3);
      });

      it('should maintain timestamp for first stake', async function () {
        expect((await this.module.stakes(alice, 0)).timestamp).to.be.bignumber.equal(this.t1);
      });

      it('should reset GYSR for new stake', async function () {
        expect((await this.module.stakes(alice, 1)).gysr).to.be.bignumber.equal(new BN(0));
      });

      it('should use half of GYSR for first stake', async function () {
        expect((await this.module.stakes(alice, 0)).gysr).to.be.bignumber.equal(tokens(this.gysr / 2));
      });

      it('should reset bonus for new stake', async function () {
        expect((await this.module.stakes(alice, 1)).gysr).to.be.bignumber.equal(new BN(0));
      });

      it('should maintain bonus for user stake', async function () {
        expect((await this.module.stakes(alice, 0)).bonus).to.be.bignumber.closeTo(
          bonus(this.mult), TOKEN_DELTA
        );
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.aliceExpectedReward), TOKEN_DELTA
        );
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(
          tokens(500 - this.aliceExpectedReward), TOKEN_DELTA
        );
      });

      it('should emit reward event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceExpectedReward), TOKEN_DELTA);
      });

      it('should emit GysrVested event', async function () {
        expectEvent(
          this.res,
          'GysrVested',
          { user: alice, amount: tokens(0.5) }
        );
      });
    });

    describe('when one user claims with fewer shares than the last stake', function () {

      beforeEach(async function () {
        this.aliceExpectedReward = 1000 / 10 * (75) / (100 * this.mult + 200)
        // claim
        this.res = await this.module.claim(alice, alice, shares(75), [], { from: owner });
        this.t3 = await this.module.lastUpdated();
      });

      it('should have same number of overall stakes for user', async function () {
        expect(await this.module.stakeCount(alice)).to.be.bignumber.equal(new BN(3));
      });

      it('should not effect the first stakes shares', async function () {
        expect((await this.module.stakes(alice, 0)).shares).to.be.bignumber.equal(shares(100));
      });

      it('should reduce share amount of second stake', async function () {
        expect((await this.module.stakes(alice, 1)).shares).to.be.bignumber.closeTo(
          shares(25), SHARE_DELTA
        );
      });

      it('should create new stake with claimed shares', async function () {
        expect((await this.module.stakes(alice, 2)).shares).to.be.bignumber.closeTo(
          shares(75), SHARE_DELTA
        );
      });

      it('should reset timestamp for new stake', async function () {
        expect((await this.module.stakes(alice, 2)).timestamp).to.be.bignumber.equal(this.t3);
      });

      it('should maintain timestamp for second stake', async function () {
        expect((await this.module.stakes(alice, 1)).timestamp).to.be.bignumber.equal(this.t2);
      });

      it('should maintain timestamp for first stake', async function () {
        expect((await this.module.stakes(alice, 0)).timestamp).to.be.bignumber.equal(this.t1);
      });

      it('should reset GYSR for new stake', async function () {
        expect((await this.module.stakes(alice, 2)).gysr).to.be.bignumber.equal(new BN(0));
      });

      it('should not effect GYSR of first stake', async function () {
        expect((await this.module.stakes(alice, 0)).gysr).to.be.bignumber.equal(tokens(this.gysr));
      });

      it('should reset bonus for new stake', async function () {
        expect((await this.module.stakes(alice, 2)).gysr).to.be.bignumber.equal(new BN(0));
      });

      it('should maintain bonus for user stake', async function () {
        expect((await this.module.stakes(alice, 0)).bonus).to.be.bignumber.closeTo(
          bonus(this.mult), TOKEN_DELTA
        );
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.aliceExpectedReward), TOKEN_DELTA
        );
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(
          tokens(500 - this.aliceExpectedReward), TOKEN_DELTA
        );
      });

      it('should emit reward event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceExpectedReward), TOKEN_DELTA);
      });
    });

    describe('when one user claims multiple times', function () {

      beforeEach(async function () {
        //first claim
        this.aliceExpectedReward = 1000 / 10 * (100 + 50 * this.mult) / (100 * this.mult + 200)
        this.aliceExpectedReward += 1000 / 5 * (50 * this.mult) / (100 * this.mult + 100)
        this.aliceExpectedReward += 1000 / 5 * (50 * this.mult) / (100 * this.mult)

        this.secondClaimReward = 1000 / 10 * (50 * this.mult) / (100 * this.mult + 200)
        this.secondClaimReward += 1000 / 5 * (50 * this.mult) / (100 * this.mult + 100)
        this.secondClaimReward += 1000 / 5 * (50 * this.mult) / (100 * this.mult)
        //second claim
        this.aliceExpectedReward += this.secondClaimReward
        // claim
        await this.module.claim(alice, alice, shares(150), [], { from: owner })
        this.res = await this.module.claim(alice, alice, shares(200), [], { from: owner });
        this.t3 = await this.module.lastUpdated();
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
        expect((await this.module.stakes(alice, 0)).timestamp).to.be.bignumber.equal(this.t3);
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.aliceExpectedReward), TOKEN_DELTA
        );
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(
          tokens(500 - this.aliceExpectedReward), TOKEN_DELTA
        );
      });

      it('should emit reward event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.secondClaimReward), TOKEN_DELTA);
      });

      it('should emit GysrVested event', async function () {
        expectEvent(
          this.res,
          'GysrVested',
          { user: alice, amount: tokens(0.5) }
        );
      });

    });

    describe('when one user claims on all shares and spends GYSR', function () {

      beforeEach(async function () {
        this.aliceExpectedReward = this.aliceRewardTotal
        // claim
        const data = web3.eth.abi.encodeParameter('uint256', tokens(2).toString());
        this.res = await this.module.claim(alice, alice, shares(200), data, { from: owner });
        this.t3 = await this.module.lastUpdated();

        const gysr = 0.03 // reduced because of proportion to total staked (200 / 300)
        const r = 0.01 // ratio is 0
        const x = 1 + gysr / r
        this.newMult = 1 + Math.log10(x) // 1.6020599913279625
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
        expect((await this.module.stakes(alice, 0)).timestamp).to.be.bignumber.equal(this.t3);
      });

      it('should set GYSR to new value', async function () {
        expect((await this.module.stakes(alice, 0)).gysr).to.be.bignumber.equal(tokens(2));
      });

      it('should set bonus to new value', async function () {
        expect((await this.module.stakes(alice, 0)).bonus).to.be.bignumber.closeTo(
          bonus(this.newMult), TOKEN_DELTA
        );
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.aliceExpectedReward), TOKEN_DELTA
        );
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(
          tokens(500 - this.aliceExpectedReward), TOKEN_DELTA
        );
      });

      it('should emit reward event', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceExpectedReward), TOKEN_DELTA);
      });

      it('should emit GysrVested event', async function () {
        expectEvent(
          this.res,
          'GysrVested',
          { user: alice, amount: tokens(1) }
        );
      });

      it('should emit GysrSpent event', async function () {
        expectEvent(
          this.res,
          'GysrSpent',
          { user: alice, amount: tokens(2) }
        );
      });
    });
  });


  describe('user and account differ', function () {

    beforeEach('setup', async function () {

      // owner creates module
      this.module = await ERC20FriendlyRewardModule.new(
        this.token.address,
        bonus(0.0),
        days(40),
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

      // alice stakes 100 tokens w/ 10 GYSR at 10 days, under account address
      await time.increaseTo(this.t0.add(days(10)));
      const data0 = web3.eth.abi.encodeParameter('uint256', tokens(10).toString());
      this.res0 = await this.module.stake(other, alice, shares(100), data0, { from: owner });

      // bob stakes 100 tokens w/ 5 GYSR at 40 days
      const data1 = web3.eth.abi.encodeParameter('uint256', tokens(5).toString());
      await time.increaseTo(this.t0.add(days(40)));
      await this.module.stake(bob, bob, shares(100), data1, { from: owner });

      // alice stakes another 100 tokens at 80 days
      await time.increaseTo(this.t0.add(days(80)));
      await this.module.stake(other, alice, shares(100), [], { from: owner });

      // advance last 20 days (below)

      // days 0-40
      // 200 rewards unlocked
      // alice: 100 staked w/ 10 GYSR
      this.aliceRewardTotal = 200;
      this.mult0 = 1.0 + Math.log10(1.0 + 0.01 * 10.0 / (0.01 + 0.0));
      const usage0 = (this.mult0 - 1.0) / this.mult0;

      // days 40-80
      // 200 reards unlocked
      // alice 100 staked w/ 10 GYSR
      // bob 100 staked w/ 5 GYSR
      this.mult1 = 1.0 + Math.log10(1.0 + (0.01 * 200.0 / 100.0) * 5.0 / (0.01 + usage0));
      this.aliceRewardTotal += 200 * this.mult0 * 100 / (this.mult0 * 100 + this.mult1 * 100);
      this.bobRewardTotal = 200 * this.mult1 * 100 / (this.mult0 * 100 + this.mult1 * 100);

      // days 80-100
      // 100 rewards unlocked
      // alice 200 staked (100 w/ 10 GYSR @ 100% vest, 100 @ 50% vest)
      // bob 100 staked w/ 5 GYSR
      this.alicePenalty = 100 * 0.5 * 100 / (100 + this.mult0 * 100 + this.mult1 * 100);
      this.aliceRewardTotal += 100 * (this.mult0 * 100 + 0.5 * 100) / (100 + this.mult0 * 100 + this.mult1 * 100);
      this.bobRewardTotal += 100 * this.mult1 * 100 / (100 + this.mult0 * 100 + this.mult1 * 100);
    });

    describe('when user and account differ', function () {

      it('should have two stakes for account', async function () {
        expect(await this.module.stakeCount(other)).to.be.bignumber.equal(new BN(2));
      });

      it('should have no stakes for user', async function () {
        expect(await this.module.stakeCount(alice)).to.be.bignumber.equal(new BN(0));
      });

      it('should have GYSR applied to first stake for account', async function () {
        expect((await this.module.stakes(other, 0)).gysr).to.be.bignumber.equal(tokens(10));
      });

      it('should have multiplier applied to first stake for account', async function () {
        expect((await this.module.stakes(other, 0)).bonus).to.be.bignumber.closeTo(bonus(this.mult0), BONUS_DELTA);
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
        // advance last 20 days
        await time.increaseTo(this.t0.add(days(100)));

        // unstake
        this.res = await this.module.unstake(other, alice, shares(200), [], { from: owner });
      });

      it('should have no remaining stakes for account', async function () {
        expect(await this.module.stakeCount(other)).to.be.bignumber.equal(new BN(0));
      });

      it('should disburse expected amount of reward token to user', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
          tokens(this.aliceRewardTotal), TOKEN_DELTA
        );
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(
          tokens(500 - this.aliceRewardTotal), TOKEN_DELTA
        );
      });

      it('should leave unvested rewards as dust', async function () {
        expect(await this.module.rewardDust()).to.be.bignumber.closeTo(shares(this.alicePenalty), TOKEN_DELTA);
      });

      it('should emit GysrSpent event for user during stake', async function () {
        expectEvent(
          this.res0,
          'GysrSpent',
          { user: alice, amount: tokens(10) }
        );
      });

      it('should emit GysrVested event for user during unstake', async function () {
        expectEvent(
          this.res,
          'GysrVested',
          { user: alice, amount: tokens(10) }
        );
      });

      it('should emit reward event for user', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceRewardTotal), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.aliceRewardTotal), SHARE_DELTA);
      });
    });

    describe('when another user unstakes against transferred account position', function () {

      beforeEach(async function () {
        // advance last 20 days
        await time.increaseTo(this.t0.add(days(100)));

        // unstake
        this.res = await this.module.unstake(other, bob, shares(200), [], { from: owner });
      });

      it('should have no remaining stakes for account', async function () {
        expect(await this.module.stakeCount(other)).to.be.bignumber.equal(new BN(0));
      });

      it('should not affect other positions of new user', async function () {
        expect(await this.module.stakeCount(bob)).to.be.bignumber.equal(new BN(1));
      });

      it('should disburse expected amount of reward token to new user', async function () {
        expect(await this.token.balanceOf(bob)).to.be.bignumber.closeTo(
          tokens(this.aliceRewardTotal), TOKEN_DELTA
        );
      });

      it('should not disburse any reward token to original user', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(new BN(0));
      });

      it('should reduce amount of reward token in unlocked pool', async function () {
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(
          tokens(500 - this.aliceRewardTotal), TOKEN_DELTA
        );
      });

      it('should leave unvested rewards as dust', async function () {
        expect(await this.module.rewardDust()).to.be.bignumber.closeTo(shares(this.alicePenalty), TOKEN_DELTA);
      });

      it('should emit GysrSpent event for original user during stake', async function () {
        expectEvent(
          this.res0,
          'GysrSpent',
          { user: alice, amount: tokens(10) }
        );
      });

      it('should emit GysrVested event for new user during unstake', async function () {
        expectEvent(
          this.res,
          'GysrVested',
          { user: bob, amount: tokens(10) }
        );
      });

      it('should emit reward event for new user', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(this.aliceRewardTotal), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(this.aliceRewardTotal), SHARE_DELTA);
      });
    });

  });

});
