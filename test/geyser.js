// test module for Geyser

const { accounts, contract } = require('@openzeppelin/test-environment');
const { BN, time, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
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
const TestElasticToken = contract.fromArtifact('TestElasticToken')

// need decent tolerance to account for potential timing error
const TOKEN_DELTA = toFixedPointBigNumber(0.001, 10, DECIMALS);
const SHARE_DELTA = toFixedPointBigNumber(0.001 * (10 ** 6), 10, DECIMALS);


describe('geyser', function () {
  const [owner, org, alice, bob] = accounts;

  beforeEach('setup', async function () {
    this.gysr = await GeyserToken.new({ from: org });
    this.factory = await GeyserFactory.new(this.gysr.address, { from: org });
    this.reward = await TestToken.new({ from: org });
    this.staking = await TestLiquidityToken.new({ from: org });
    this.elastic = await TestElasticToken.new({ from: org });
  });

  describe('construction', function () {

    describe('when start bonus is greater than max bonus', function () {
      it('should fail to construct', async function () {
        await expectRevert(
          Geyser.new(
            this.staking.address,
            this.reward.address,
            bonus(1.0),
            bonus(0.5),
            days(90),
            this.gysr.address,
            { from: owner }
          ),
          'Geyser: initial time bonus greater than max'
        )
      });
    });

    describe('when initialized with valid constuctor arguments', function () {
      beforeEach(async function () {
        this.geyser = await Geyser.new(
          this.staking.address,
          this.reward.address,
          bonus(0.5),
          bonus(2.0),
          days(90),
          this.gysr.address,
          { from: owner }
        );
      });
      it('should create a Geyser object', async function () {
        expect(this.geyser).to.be.an('object');
      });
      it('should return the correct addresses for owner and tokens', async function () {
        expect(await this.geyser.owner()).to.equal(owner);
        expect(await this.geyser.token()).to.equal(this.staking.address);
        expect(await this.geyser.stakingToken()).to.equal(this.staking.address);
        expect(await this.geyser.rewardToken()).to.equal(this.reward.address);
      });
      it('should initialize bonus params properly', async function () {
        expect(await this.geyser.bonusMin()).to.be.bignumber.equal(bonus(0.5));
        expect(await this.geyser.bonusMax()).to.be.bignumber.equal(bonus(2.0));
        expect(await this.geyser.bonusPeriod()).to.be.bignumber.equal(new BN(60 * 60 * 24 * 90));
      });
      it('should have zero pool balances', async function () {
        expect(await this.geyser.totalStaked()).to.be.bignumber.equal(new BN(0));
        expect(await this.geyser.totalLocked()).to.be.bignumber.equal(new BN(0));
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.equal(new BN(0));
      });
      it('should have a 0 GYSR usage ratio', async function () {
        expect(await this.geyser.ratio()).to.be.bignumber.equal(new BN(0));
      });
    })
  });

  describe('funding', function () {

    beforeEach(async function () {
      this.geyser = await Geyser.new(
        this.staking.address,
        this.reward.address,
        bonus(0.5),
        bonus(2.0),
        days(90),
        this.gysr.address,
        { from: owner }
      );
    });

    describe('when not approved', function () {
      it('should fail', async function () {
        await this.reward.transfer(owner, tokens(10000), { from: org });
        await expectRevert(
          this.geyser.methods['fund(uint256,uint256)'](
            tokens(100), days(90), { from: owner }
          ),
          'ERC20: transfer amount exceeds allowance'
        );
      });
    });

    describe('when funding amount is larger than sender balance', function () {
      it('should fail', async function () {
        await this.reward.transfer(owner, tokens(100), { from: org });
        await this.reward.approve(this.geyser.address, tokens(100000), { from: owner });
        await expectRevert(
          this.geyser.methods['fund(uint256,uint256)'](
            tokens(200), days(90),
            { from: owner }
          ),
          'ERC20: transfer amount exceeds balance'
        );
      });
    });

    describe('when funding amount is zero', function () {
      it('should fail', async function () {
        await this.reward.transfer(owner, tokens(10000), { from: org });
        await this.reward.approve(this.geyser.address, tokens(100000), { from: owner });
        await expectRevert(
          this.geyser.methods['fund(uint256,uint256)'](
            tokens(0), days(90),
            { from: owner }
          ),
          'Geyser: funding amount is zero'
        );
      });
    });

    describe('when funding schedule start is in the past', function () {
      it('should fail', async function () {
        await this.reward.transfer(owner, tokens(10000), { from: org });
        await this.reward.approve(this.geyser.address, tokens(100000), { from: owner });
        const t = await time.latest();
        await expectRevert(
          this.geyser.methods['fund(uint256,uint256,uint256)'](
            tokens(100), days(90), t.sub(days(1)),
            { from: owner }
          ),
          'Geyser: funding start is past'
        );
      });
    });

    describe('when sender does not own Geyser', function () {
      it('should fail', async function () {
        await this.reward.transfer(bob, tokens(10000), { from: org });
        await this.reward.approve(this.geyser.address, tokens(100000), { from: bob });
        await expectRevert(
          this.geyser.methods['fund(uint256,uint256)'](
            tokens(100), days(90),
            { from: bob }
          ),
          'Ownable: caller is not the owner'
        );
      });
    });

    describe('when first succesfully funded', function () {

      beforeEach(async function () {
        await this.reward.transfer(owner, tokens(10000), { from: org });
        await this.reward.approve(this.geyser.address, tokens(100000), { from: owner });
        this.res = await this.geyser.methods['fund(uint256,uint256)'](
          tokens(1000), days(90),
          { from: owner }
        );
        this.t0 = await this.geyser.lastUpdated();
      });

      it('should emit RewardsFunded', async function () {
        expectEvent(
          this.res,
          'RewardsFunded',
          { amount: tokens(1000), start: this.t0, duration: days(90) }
        );
      });

      it('should increase total fundings count', async function () {
        expect(await this.geyser.fundingCount()).to.be.bignumber.equal(new BN(1));
      });

      it('should increase total locked', async function () {
        expect(await this.geyser.totalLocked()).to.be.bignumber.equal(tokens(1000));
      });

      it('should decrease user balance', async function () {
        expect(await this.reward.balanceOf(owner)).to.be.bignumber.equal(tokens(9000));
      });
    });

    describe('when funded again', function () {

      beforeEach(async function () {
        // first funding
        await this.reward.transfer(owner, tokens(10000), { from: org });
        await this.reward.approve(this.geyser.address, tokens(100000), { from: owner });
        await this.geyser.methods['fund(uint256,uint256)'](
          tokens(1000), days(90),
          { from: owner }
        );
        this.t0 = await this.geyser.lastUpdated();

        // fund again 45 days later
        await time.increaseTo(this.t0.add(days(45)));
        this.res = await this.geyser.methods['fund(uint256,uint256)'](
          tokens(1000), days(90),
          { from: owner }
        );
        this.t1 = await this.geyser.lastUpdated();
      });

      it('should emit RewardsFunded and RewardsUnlocked', async function () {
        expectEvent(
          this.res,
          'RewardsFunded',
          { amount: tokens(1000), start: this.t1, duration: days(90) }
        );
        const e = this.res.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
        expect(e.args.total).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
      });

      it('should increase total fundings count', async function () {
        expect(await this.geyser.fundingCount()).to.be.bignumber.equal(new BN(2));
      });

      it('should increase total locked', async function () {
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(1500), TOKEN_DELTA);
      });

      it('should decrease user balance', async function () {
        expect(await this.reward.balanceOf(owner)).to.be.bignumber.equal(tokens(8000));
      });
    });

    describe('when funded for future start', function () {
      beforeEach(async function () {
        await this.reward.transfer(owner, tokens(10000), { from: org });
        await this.reward.approve(this.geyser.address, tokens(100000), { from: owner });
        this.t0 = await time.latest();
        this.res = await this.geyser.methods['fund(uint256,uint256,uint256)'](
          tokens(1000), days(90), this.t0.add(days(30)),
          { from: owner }
        );
      });

      it('should emit RewardsFunded', async function () {
        expectEvent(
          this.res,
          'RewardsFunded',
          { amount: tokens(1000), start: this.t0.add(days(30)), duration: days(90) }
        );
      });

      it('should increase total fundings count', async function () {
        expect(await this.geyser.fundingCount()).to.be.bignumber.equal(new BN(1));
      });

      it('should increase total locked', async function () {
        expect(await this.geyser.totalLocked()).to.be.bignumber.equal(tokens(1000));
      });

      it('should decrease user balance', async function () {
        expect(await this.reward.balanceOf(owner)).to.be.bignumber.equal(tokens(9000));
      });

      it('should not increase unlocked rewards immediately', async function () {
        await time.increase(days(10));
        await this.geyser.update();
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.equal(tokens(0));
      });

      it('should start increasing unlocked rewards after start time hits', async function () {
        await time.increase(days(31));
        await this.geyser.update();
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.greaterThan(tokens(0));
      });

      it('should unlock rewards at correct rate', async function () {
        await time.increase(days(30 + 45));
        await this.geyser.update();
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
      });

      it('should unlock rewards at correct rate when there was a previous update()', async function () {
        await time.increaseTo(this.t0.add(days(10)));
        await this.geyser.update();
        await time.increaseTo(this.t0.add(days(30 + 45)));
        await this.geyser.update();
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
      });

    });

    describe('when funded again after first period expires', function () {
      beforeEach(async function () {
        // setup funding
        await this.reward.transfer(owner, tokens(10000), { from: org });
        await this.reward.approve(this.geyser.address, tokens(100000), { from: owner });

        // first funding
        await this.geyser.methods['fund(uint256,uint256)'](
          tokens(100), days(90), { from: owner }
        );
        this.t0 = await this.geyser.lastUpdated();

        // expire first period
        await time.increase(days(90));
        this.res0 = await this.geyser.clean({ from: owner });

        // fund again
        this.res1 = await this.geyser.methods['fund(uint256,uint256)'](
          tokens(500), days(180), { from: owner }
        );
      });

      it('should have 1 active funding schedule', async function () {
        expect(await this.geyser.fundingCount()).to.be.bignumber.equal(new BN(1));
      });

      it('should emit RewardsExpired on clean', async function () {
        expectEvent(
          this.res0,
          'RewardsExpired',
          { amount: tokens(100), start: this.t0, duration: days(90) }
        );
      });

      it('should emit RewardsFunded on fund', async function () {
        expectEvent(this.res1, 'RewardsFunded', { amount: tokens(500), duration: days(180) });
      });

      it('should have full first funding unlocked', async function () {
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.equal(tokens(100));
      });

      it('should have full second funding locked', async function () {
        expect(await this.geyser.totalLocked()).to.be.bignumber.equal(tokens(500));
      });
    });

    describe('when one of many schedules expire', function () {
      beforeEach(async function () {
        // setup funding
        await this.reward.transfer(owner, tokens(10000), { from: org });
        await this.reward.approve(this.geyser.address, tokens(100000), { from: owner });

        // create many funding schedules
        await this.geyser.methods['fund(uint256,uint256)'](
          tokens(100), days(90), { from: owner }
        );
        this.t0 = await this.geyser.lastUpdated();
        await this.geyser.methods['fund(uint256,uint256)'](
          tokens(200), days(30), { from: owner } // this one should expire
        );
        this.t1 = await this.geyser.lastUpdated();
        await this.geyser.methods['fund(uint256,uint256,uint256)'](
          tokens(400), days(180), this.t0.add(days(90)), { from: owner }
        );
        await this.geyser.methods['fund(uint256,uint256)'](
          tokens(800), days(180), { from: owner }
        );

        // expire second funding
        await time.increaseTo(this.t0.add(days(45)));
        this.res0 = await this.geyser.clean({ from: owner });

        // fund again
        this.res1 = await this.geyser.methods['fund(uint256,uint256)'](
          tokens(300), days(180), { from: owner }
        );

      });

      it('should have 4 active funding schedules', async function () {
        expect(await this.geyser.fundingCount()).to.be.bignumber.equal(new BN(4));
      });

      it('should emit RewardsExpired on clean', async function () {
        expectEvent(
          this.res0,
          'RewardsExpired',
          { amount: tokens(200), start: this.t1, duration: days(30) }
        );
      });

      it('should emit RewardsFunded on fund', async function () {
        expectEvent(this.res1, 'RewardsFunded', { amount: tokens(300), duration: days(180) });
      });

      it('should move last funding to expired index', async function () {
        expect((await this.geyser.fundings(0)).amount).to.be.bignumber.equal(tokens(100));
        expect((await this.geyser.fundings(1)).amount).to.be.bignumber.equal(tokens(800)); // last funding during expire
        expect((await this.geyser.fundings(2)).amount).to.be.bignumber.equal(tokens(400));
        expect((await this.geyser.fundings(3)).amount).to.be.bignumber.equal(tokens(300)); // new funding
      });

      it('should have expected amount of funding unlocked', async function () {
        // 45 days passed
        // (45/90)*100 + 200 + 0 + (45/180)*800
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(450), TOKEN_DELTA);
      });

      it('should have expected amount of funding locked', async function () {
        // includes new funding and locked future funding
        // 50 + 0(expired) + 400(future) + 600 + 300(new)
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(1350), TOKEN_DELTA);
      });

      it('should continue to unlock at expected rate to 90 days', async function () {
        // 90 days passed, 0 days on future funding, 45 days on new funding
        await time.increaseTo(this.t0.add(days(90)));
        await this.geyser.update();

        // 100 + 200 + 0 + 400 + 75
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(775), TOKEN_DELTA);
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(1025), TOKEN_DELTA);
      });

      it('should continue to unlock at expected rate to 180 days', async function () {
        // 180 days passed, 90 days on future funding, 135 days on new funding
        await time.increaseTo(this.t0.add(days(180)));
        await this.geyser.update();

        // 100 + 200 + 200 + 800 + 225
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(1525), TOKEN_DELTA);
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(275), TOKEN_DELTA);
      });

      it('should continue to unlock at expected rate incrementally', async function () {
        // increments to 90 days
        for (const d of [55, 60, 75, 90]) {
          await time.increaseTo(this.t0.add(days(d)));
          await this.geyser.update();
        }
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(775), TOKEN_DELTA);
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(1025), TOKEN_DELTA);

        // increments to 180 days
        for (const d of [91, 92, 135, 179, 180]) {
          await time.increaseTo(this.t0.add(days(d)));
          await this.geyser.update();
        }
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(1525), TOKEN_DELTA);
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(275), TOKEN_DELTA);
      });

    });

    describe('when multiple schedules expire', function () {
      beforeEach(async function () {
        // setup funding
        await this.reward.transfer(owner, tokens(10000), { from: org });
        await this.reward.approve(this.geyser.address, tokens(100000), { from: owner });

        // create many funding schedules
        await this.geyser.methods['fund(uint256,uint256)'](
          tokens(100), days(90), { from: owner }
        );
        this.t0 = await this.geyser.lastUpdated();
        await this.geyser.methods['fund(uint256,uint256)'](
          tokens(200), days(30), { from: owner } // this one should expire
        );
        this.t1 = await this.geyser.lastUpdated();
        await this.geyser.methods['fund(uint256,uint256,uint256)'](
          tokens(400), days(180), this.t0.add(days(90)), { from: owner }
        );
        await this.geyser.methods['fund(uint256,uint256)'](
          tokens(800), days(30), { from: owner } // this one should expire
        );
        this.t3 = await this.geyser.lastUpdated();

        // expire second and fourth fundings
        await time.increaseTo(this.t0.add(days(45)));
        this.res0 = await this.geyser.clean({ from: owner });

        // fund again
        this.res1 = await this.geyser.methods['fund(uint256,uint256)'](
          tokens(300), days(180), { from: owner }
        );

      });

      it('should have 3 active funding schedules', async function () {
        expect(await this.geyser.fundingCount()).to.be.bignumber.equal(new BN(3));
      });

      it('should emit multiple RewardsExpired on clean', async function () {
        expectEvent(
          this.res0,
          'RewardsExpired',
          { amount: tokens(200), start: this.t1, duration: days(30) }
        );
        expectEvent(
          this.res0,
          'RewardsExpired',
          { amount: tokens(800), start: this.t3, duration: days(30) }
        );
      });

      it('should emit RewardsFunded on fund', async function () {
        expectEvent(this.res1, 'RewardsFunded', { amount: tokens(300), duration: days(180) });
      });

      it('should properly reindex fundings', async function () {
        // last moved to second, but then also expires
        expect((await this.geyser.fundings(0)).amount).to.be.bignumber.equal(tokens(100));
        expect((await this.geyser.fundings(1)).amount).to.be.bignumber.equal(tokens(400));
        expect((await this.geyser.fundings(2)).amount).to.be.bignumber.equal(tokens(300)); // new funding
      });

      it('should have expected amount of funding unlocked', async function () {
        // 45 days passed
        // 50 + 200 + 0 + 800
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(1050), TOKEN_DELTA);
      });

      it('should have expected amount of funding locked', async function () {
        // includes new funding and locked future funding
        // 50 + 0(expired) + 400(future) + 0(expired) + 300(new)
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(750), TOKEN_DELTA);
      });

      it('should continue to unlock at expected rate to 90 days', async function () {
        // 90 days passed, 0 days on future funding, 45 days on new funding
        await time.increaseTo(this.t0.add(days(90)));
        await this.geyser.update();

        // 100 + 200 + 0 + 800 + 75
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(1175), TOKEN_DELTA);
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(625), TOKEN_DELTA);
      });

      it('should continue to unlock at expected rate to 180 days', async function () {
        // 180 days passed, 90 days on future funding, 135 days on new funding
        await time.increaseTo(this.t0.add(days(180)));
        await this.geyser.update();

        // 100 + 200 + 200 + 800 + 225
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(1525), TOKEN_DELTA);
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(275), TOKEN_DELTA);
      });

      it('should continue to unlock at expected rate incrementally', async function () {
        // increments to 90 days
        for (const d of [51, 63, 79, 90]) {
          await time.increaseTo(this.t0.add(days(d)));
          await this.geyser.update();
        }
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(1175), TOKEN_DELTA);
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(625), TOKEN_DELTA);

        // increments to 180 days
        for (const d of [115, 116, 135, 175, 180]) {
          await time.increaseTo(this.t0.add(days(d)));
          await this.geyser.update();
        }
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(1525), TOKEN_DELTA);
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(275), TOKEN_DELTA);
      });
    });

    describe('when number of active fundings is at max', function () {
      beforeEach(async function () {
        // setup funding
        await this.reward.transfer(owner, tokens(10000), { from: org });
        await this.reward.approve(this.geyser.address, tokens(100000), { from: owner });

        // fund max number of times
        for (var i = 0; i < 16; i++) {
          await this.geyser.methods['fund(uint256,uint256)'](
            tokens(100), days(90), { from: owner }
          );
        }

        // setup staking
        await this.staking.transfer(alice, tokens(1000), { from: org });
        await this.staking.approve(this.geyser.address, tokens(10000), { from: alice });
        await this.gysr.transfer(alice, tokens(10), { from: org });
        await this.gysr.approve(this.geyser.address, tokens(10000), { from: alice });
      });

      it('should revert transaction on additional funding', async function () {
        await expectRevert(
          this.geyser.methods['fund(uint256,uint256)'](
            tokens(100), days(90), { from: owner }
          ),
          'Geyser: exceeds max active funding schedules'
        );
      });

      it('should have 16 active funding schedules', async function () {
        expect(await this.geyser.fundingCount()).to.be.bignumber.equal(new BN(16));
      });

      it('gas cost of update() should be under 1M', async function () {
        const res = await this.geyser.update();
        expect(res.receipt.gasUsed).is.lessThan(10 ** 6);
      });

      it('gas cost of stake() should be under 1M', async function () {
        const res = await this.geyser.stake(tokens(100), [], { from: alice });
        expect(res.receipt.gasUsed).is.lessThan(10 ** 6);
      });

      it('gas cost of unstake() should be under 1M', async function () {
        await this.geyser.stake(tokens(100), [], { from: alice });
        await time.increase(days(30));
        const res = await this.geyser.methods['unstake(uint256,uint256,bytes)'](
          tokens(100), tokens(1), [], { from: alice }
        );
        expect(res.receipt.gasUsed).is.lessThan(10 ** 6);
      });
    });

    describe('when number of fundings is at max but one schedule expires', function () {
      beforeEach(async function () {
        // setup funding
        await this.reward.transfer(owner, tokens(10000), { from: org });
        await this.reward.approve(this.geyser.address, tokens(100000), { from: owner });

        // fund max number of times
        await this.geyser.methods['fund(uint256,uint256)'](
          tokens(100), days(30), { from: owner }
        );
        this.t0 = await this.geyser.lastUpdated();
        for (var i = 0; i < 15; i++) {
          await this.geyser.methods['fund(uint256,uint256)'](
            tokens(100), days(90), { from: owner }
          );
        }

        // setup staking
        await this.staking.transfer(alice, tokens(1000), { from: org });
        await this.staking.approve(this.geyser.address, tokens(10000), { from: alice });
        await this.gysr.transfer(alice, tokens(10), { from: org });
        await this.gysr.approve(this.geyser.address, tokens(10000), { from: alice });

        // expire first funding
        await time.increaseTo(this.t0.add(days(45)));
        this.res0 = await this.geyser.clean({ from: owner });

        // fund again
        this.res1 = await this.geyser.methods['fund(uint256,uint256)'](
          tokens(200), days(180), { from: owner }
        );
      });

      it('should have 16 active funding schedules', async function () {
        expect(await this.geyser.fundingCount()).to.be.bignumber.equal(new BN(16));
      });

      it('should emit RewardsExpired on clean', async function () {
        expectEvent(
          this.res0,
          'RewardsExpired',
          { amount: tokens(100), start: this.t0, duration: days(30) }
        );
      });

      it('should emit RewardsFunded on fund', async function () {
        expectEvent(this.res1, 'RewardsFunded', { amount: tokens(200), duration: days(180) });
      });

      it('should properly reindex fundings', async function () {
        expect((await this.geyser.fundings(0)).amount).to.be.bignumber.equal(tokens(100));
        expect((await this.geyser.fundings(0)).duration).to.be.bignumber.equal(days(90));
        expect((await this.geyser.fundings(15)).amount).to.be.bignumber.equal(tokens(200)); // new funding
        expect((await this.geyser.fundings(15)).duration).to.be.bignumber.equal(days(180));
      });

      it('should have expected amount of funding unlocked', async function () {
        // 45 days passed
        // 100 (expired) + 1/2 * 15 * 100
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(850), TOKEN_DELTA);
      });

      it('should have expected amount of funding locked', async function () {
        // 45 days passed, and 0 days on new funding
        // 1/2 * 15 * 100 + 200
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(950), TOKEN_DELTA);
      });

    });

  });

  describe('unlocking', function () {

    beforeEach(async function () {
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
      // setup funding
      await this.reward.transfer(owner, tokens(10000), { from: org });
      await this.reward.approve(this.geyser.address, tokens(100000), { from: owner });
    });

    describe('with a single 90-day funding schedule', function () {
      beforeEach(async function () {
        // fund 1000 tokens at 90 day unlocking
        await this.geyser.methods['fund(uint256,uint256)'](
          tokens(1000), days(90), { from: owner }
        );
        this.t0 = await this.geyser.lastUpdated();
      });

      it('should have zero unlocked initially', async function () {
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.equal(tokens(0));
      });

      it('should have 50% unlocked at 45 days', async function () {
        await time.increaseTo(this.t0.add(days(45)));
        const res = await this.geyser.update();

        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);

        const e = res.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
        expect(e.args.total).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
      });

      it('should have 90% unlocked at 81 days', async function () {
        await time.increaseTo(this.t0.add(days(81)));
        const res = await this.geyser.update();

        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(900), TOKEN_DELTA);
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(100), TOKEN_DELTA);

        const e = res.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(900), TOKEN_DELTA);
        expect(e.args.total).to.be.bignumber.closeTo(tokens(900), TOKEN_DELTA);
      });

      it('should have 100% unlocked at 90 days', async function () {
        await time.increaseTo(this.t0.add(days(90)));
        const res = await this.geyser.update();

        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(1000), TOKEN_DELTA);
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(0), TOKEN_DELTA);

        const e = res.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(1000), TOKEN_DELTA);
        expect(e.args.total).to.be.bignumber.closeTo(tokens(1000), TOKEN_DELTA);
      });

      it('should have 100% unlocked beyond 90 days', async function () {
        await time.increaseTo(this.t0.add(days(100)));
        const res = await this.geyser.update();
        // should be exact at this point
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.equal(tokens(1000));
        expect(await this.geyser.totalLocked()).to.be.bignumber.equal(tokens(0));
        expectEvent(res, 'RewardsUnlocked', { amount: tokens(1000), total: tokens(1000) });
      });

      it('should unlock in increments over time', async function () {
        // 50%
        await time.increaseTo(this.t0.add(days(45)));
        const res0 = await this.geyser.update();
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
        const e0 = res0.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e0.args.amount).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
        expect(e0.args.total).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);

        // 90%
        await time.increaseTo(this.t0.add(days(81)));
        const res1 = await this.geyser.update();
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(900), TOKEN_DELTA);
        const e1 = res1.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e1.args.amount).to.be.bignumber.closeTo(tokens(400), TOKEN_DELTA);
        expect(e1.args.total).to.be.bignumber.closeTo(tokens(900), TOKEN_DELTA);

        // 100%
        await time.increaseTo(this.t0.add(days(90)));
        const res2 = await this.geyser.update();
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(1000), TOKEN_DELTA);
        const e2 = res2.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e2.args.amount).to.be.bignumber.closeTo(tokens(100), TOKEN_DELTA);
        expect(e2.args.total).to.be.bignumber.closeTo(tokens(1000), TOKEN_DELTA);

        // 100% (beyond period)
        await time.increaseTo(this.t0.add(days(91)));
        await this.geyser.update();
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.equal(tokens(1000));
      });
    });

    describe('with a single 10-year funding schedule', function () {
      beforeEach(async function () {
        // fund 1000 tokens at 10 year unlocking
        await this.geyser.methods['fund(uint256,uint256)'](
          tokens(1000), days(10 * 365), { from: owner }
        );
        this.t0 = await this.geyser.lastUpdated();
      });

      it('should have zero unlocked initially', async function () {
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.equal(tokens(0));
      });

      it('should have 50% unlocked after 5 years', async function () {
        await time.increaseTo(this.t0.add(days(5 * 365)));
        const res = await this.geyser.update();

        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);

        const e = res.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
        expect(e.args.total).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
      });

      it('should have 90% unlocked after 9 years', async function () {
        await time.increaseTo(this.t0.add(days(9 * 365)));
        const res = await this.geyser.update();

        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(900), TOKEN_DELTA);
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(100), TOKEN_DELTA);

        const e = res.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(900), TOKEN_DELTA);
        expect(e.args.total).to.be.bignumber.closeTo(tokens(900), TOKEN_DELTA);
      });

      it('should have 100% unlocked after 10 years', async function () {
        await time.increaseTo(this.t0.add(days(10 * 365)));
        const res = await this.geyser.update();

        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(1000), TOKEN_DELTA);
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(0), TOKEN_DELTA);

        const e = res.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(1000), TOKEN_DELTA);
        expect(e.args.total).to.be.bignumber.closeTo(tokens(1000), TOKEN_DELTA);
      });

      it('should cleanup small remainder from integer math error', async function () {
        // h/t https://github.com/ampleforth/token-geyser

        // advance to 10 years minus 1 minute
        await time.increaseTo(this.t0.add(days(10 * 365)) - new BN(60));
        const res0 = await this.geyser.update()
        const e0 = res0.logs.filter(l => l.event === 'RewardsUnlocked')[0];

        // complete 10 year period
        await time.increaseTo(this.t0.add(days(10 * 365)) + new BN(5));
        const res1 = await this.geyser.update()
        const e1 = res1.logs.filter(l => l.event === 'RewardsUnlocked')[0];

        // ensure all tokens have been unlocked
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.equal(tokens(1000));
        expect(e0.args.amount.add(e1.args.amount)).to.be.bignumber.equal(tokens(1000));
      });
    });

    describe('with multiple funding schedules', function () {
      beforeEach(async function () {
        // fund 1000 tokens at 90 day unlocking
        await this.geyser.methods['fund(uint256,uint256)'](
          tokens(1000), days(90),
          { from: owner }
        );
        this.t0 = await this.geyser.lastUpdated();

        // fund 1000 tokens, over 180 day unlocking period, with 45 day delayed start
        await this.geyser.methods['fund(uint256,uint256,uint256)'](
          tokens(1000), days(180), this.t0.add(days(45)),
          { from: owner }
        );
      });

      it('should have 0% unlocked initially', async function () {
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(0), TOKEN_DELTA);
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(2000), TOKEN_DELTA);
      });

      it('should have 50% of first funding unlocked at 45 days', async function () {
        await time.increaseTo(this.t0.add(days(45)));
        const res = await this.geyser.update();

        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(500 + 1000), TOKEN_DELTA);

        const e = res.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
        expect(e.args.total).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);

        expect((await this.geyser.fundings(0)).unlocked).to.be.bignumber.closeTo(shares(500), SHARE_DELTA);
        expect((await this.geyser.fundings(1)).unlocked).to.be.bignumber.closeTo(shares(0), SHARE_DELTA);
      });

      it('should have 90% of first funding and 20% of second funding unlocked at 81 days', async function () {
        await time.increaseTo(this.t0.add(days(81)));
        const res = await this.geyser.update();

        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(900 + 200), TOKEN_DELTA);
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(100 + 800), TOKEN_DELTA);

        const e = res.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(1100), TOKEN_DELTA);
        expect(e.args.total).to.be.bignumber.closeTo(tokens(1100), TOKEN_DELTA);

        expect((await this.geyser.fundings(0)).unlocked).to.be.bignumber.closeTo(shares(900), SHARE_DELTA);
        expect((await this.geyser.fundings(1)).unlocked).to.be.bignumber.closeTo(shares(200), SHARE_DELTA);
      });

      it('should have 100% of first funding and 50% of second funding unlocked at 135 days', async function () {
        await time.increaseTo(this.t0.add(days(135)));
        const res = await this.geyser.update();

        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(1000 + 500), TOKEN_DELTA);
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(0 + 500), TOKEN_DELTA);

        const e = res.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(1500), TOKEN_DELTA);
        expect(e.args.total).to.be.bignumber.closeTo(tokens(1500), TOKEN_DELTA);

        expect((await this.geyser.fundings(0)).unlocked).to.be.bignumber.closeTo(shares(1000), SHARE_DELTA);
        expect((await this.geyser.fundings(1)).unlocked).to.be.bignumber.closeTo(shares(500), SHARE_DELTA);
      });

      it('should have 100% unlocked after 225 days', async function () {
        await time.increaseTo(this.t0.add(days(500)));
        const res = await this.geyser.update();

        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(2000), TOKEN_DELTA);
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(0), TOKEN_DELTA);

        const e = res.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(2000), TOKEN_DELTA);
        expect(e.args.total).to.be.bignumber.closeTo(tokens(2000), TOKEN_DELTA);

        expect((await this.geyser.fundings(0)).unlocked).to.be.bignumber.closeTo(shares(1000), SHARE_DELTA);
        expect((await this.geyser.fundings(1)).unlocked).to.be.bignumber.closeTo(shares(1000), SHARE_DELTA);
      });
    });

    describe('when funding period is 0 seconds', function () {
      beforeEach(async function () {
        // fund 1000 tokens at 00 day unlocking
        await this.geyser.methods['fund(uint256,uint256)'](
          tokens(1000), 0,
          { from: owner }
        );
        this.res = await this.geyser.update();
      });

      it('should emit RewardsUnlocked event', async function () {
        expectEvent(this.res, 'RewardsUnlocked', { amount: tokens(1000), total: tokens(1000) });
      });

      it('should have 100% of funding unlocked immediately', async function () {
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.equal(tokens(1000));
      });
    });
  });

  describe('gysr bonus', function () {

    describe('when no unstakes have been made', function () {
      beforeEach(async function () {
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
        await this.geyser.methods['fund(uint256,uint256)'](
          tokens(1000), days(180),
          { from: owner }
        );
      });

      it('should have 0.0 GYSR usage ratio', async function () {
        const ratio = await this.geyser.ratio();
        expect(ratio).to.be.bignumber.equal(new BN(0));
      });

      it('should return 3.0 bonus multiplier for 1.0 GYSR tokens', async function () {
        const x = 1.0;
        const mult = fromFixedPointBigNumber(await this.geyser.gysrBonus(tokens(x)), 10, 18);

        const multExpected = 1.0 + Math.log10((0.01 + x) / (0.01));
        expect(mult).to.be.approximately(multExpected, 0.000001);
      });

      it('should return 4.0 bonus multiplier for 10.0 GYSR tokens', async function () {
        const x = 10.0;
        const mult = fromFixedPointBigNumber(await this.geyser.gysrBonus(tokens(x)), 10, 18);

        const multExpected = 1.0 + Math.log10((0.01 + x) / (0.01));
        expect(mult).to.be.approximately(multExpected, 0.000001);
      });

      it('should return 9.0 bonus multiplier for 1.0M GYSR tokens', async function () {
        const x = 1000000.0;
        const mult = fromFixedPointBigNumber(await this.geyser.gysrBonus(tokens(x)), 10, 18);

        const multExpected = 1.0 + Math.log10((0.01 + x) / (0.01));
        expect(mult).to.be.approximately(multExpected, 0.000001);
      });
    });

    describe('when usage is at 0.5', function () {
      beforeEach(async function () {
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
        await this.geyser.methods['fund(uint256,uint256)'](
          tokens(1000), days(180),
          { from: owner }
        );
        const t0 = await this.geyser.lastUpdated();

        // alice acquires staking token and GYSR
        await this.staking.transfer(alice, tokens(1000), { from: org });
        await this.staking.approve(this.geyser.address, tokens(10000), { from: alice });
        await this.gysr.transfer(alice, tokens(100), { from: org });
        await this.gysr.approve(this.geyser.address, tokens(10000), { from: alice });

        // alice earns 100 reward tokens without GYSR
        await this.geyser.stake(tokens(10), [], { from: alice });
        await time.increaseTo(t0.add(days(18))); // unlocks 100
        await this.geyser.unstake(tokens(10), [], { from: alice });

        // alice earns 100 reward tokens using GYSR
        await this.geyser.stake(tokens(10), [], { from: alice });
        await time.increaseTo(t0.add(days(36))); // unlocks 100
        await this.geyser.methods['unstake(uint256,uint256,bytes)'](
          tokens(10), tokens(1), [],
          { from: alice }
        );
      });

      it('usage ratio should be 0.5', async function () {
        const ratio = fromFixedPointBigNumber(await this.geyser.ratio(), 10, 18);
        expect(ratio).to.be.approximately(0.5, 0.000001);
      });

      it('should return 1.3 bonus multiplier for 1.0 GYSR tokens', async function () {
        const x = 1.0;
        const ratio = fromFixedPointBigNumber(await this.geyser.ratio(), 10, 18);
        const mult = fromFixedPointBigNumber(await this.geyser.gysrBonus(tokens(x)), 10, 18);

        const multExpected = 1.0 + Math.log10((0.01 + x) / (0.01 + ratio));
        expect(mult).to.be.approximately(multExpected, 0.000001);
      });

      it('should return 2.29 bonus multiplier for 10.0 GYSR tokens', async function () {
        const x = 10.0;
        const ratio = fromFixedPointBigNumber(await this.geyser.ratio(), 10, 18);
        const mult = fromFixedPointBigNumber(await this.geyser.gysrBonus(tokens(x)), 10, 18);

        const multExpected = 1.0 + Math.log10((0.01 + x) / (0.01 + ratio));
        expect(mult).to.be.approximately(multExpected, 0.000001);
      });

      it('should return 7.29 bonus multiplier for 1.0M GYSR tokens', async function () {
        const x = 1000000.0;
        const ratio = fromFixedPointBigNumber(await this.geyser.ratio(), 10, 18);
        const mult = fromFixedPointBigNumber(await this.geyser.gysrBonus(tokens(x)), 10, 18);

        const multExpected = 1.0 + Math.log10((0.01 + x) / (0.01 + ratio));
        expect(mult).to.be.approximately(multExpected, 0.000001);
      });

    });
  });

  describe('time bonus', function () {

    describe('when configured with a 50-200% time bonus earned over 90 days', function () {

      beforeEach(async function () {
        // owner creates geyser
        this.geyser = await Geyser.new(
          this.staking.address,
          this.reward.address,
          bonus(0.5),
          bonus(2),
          days(90),
          this.gysr.address,
          { from: owner }
        );
        // owner funds geyser
        await this.reward.transfer(owner, tokens(10000), { from: org });
        await this.reward.approve(this.geyser.address, tokens(100000), { from: owner });
        await this.geyser.methods['fund(uint256,uint256)'](
          tokens(1000), days(180),
          { from: owner }
        );
      });

      it('should be 1.5x for t = 0', async function () {
        const mult = fromFixedPointBigNumber(await this.geyser.timeBonus(0), 10, 18);
        expect(mult).to.be.equal(1.5);
      });

      it('should be 2.0x for t = 30 days', async function () {
        const mult = fromFixedPointBigNumber(await this.geyser.timeBonus(days(30)), 10, 18);
        expect(mult).to.be.equal(2.0);
      });

      it('should be 2.5x for t = 60 days', async function () {
        const mult = fromFixedPointBigNumber(await this.geyser.timeBonus(days(60)), 10, 18);
        expect(mult).to.be.equal(2.5);
      });

      it('should be 3.0x for t = 90 days', async function () {
        const mult = fromFixedPointBigNumber(await this.geyser.timeBonus(days(90)), 10, 18);
        expect(mult).to.be.equal(3.0);
      });

      it('should be 3.0x for t > 90 days', async function () {
        const mult = fromFixedPointBigNumber(await this.geyser.timeBonus(days(150)), 10, 18);
        expect(mult).to.be.equal(3.0);
      });
    });

    describe('when configured with 0 day time bonus period', function () {

      beforeEach(async function () {
        // owner creates geyser
        this.geyser = await Geyser.new(
          this.staking.address,
          this.reward.address,
          bonus(0.5),
          bonus(2),
          days(0),
          this.gysr.address,
          { from: owner }
        );
        // owner funds geyser
        await this.reward.transfer(owner, tokens(10000), { from: org });
        await this.reward.approve(this.geyser.address, tokens(100000), { from: owner });
        await this.geyser.methods['fund(uint256,uint256)'](
          tokens(1000), days(180),
          { from: owner }
        );
      });

      it('should be max time bonus for t = 0', async function () {
        const mult = fromFixedPointBigNumber(await this.geyser.timeBonus(0), 10, 18);
        expect(mult).to.be.equal(3.0);
      });

      it('should be max time bonus for t > 0 days', async function () {
        const mult = fromFixedPointBigNumber(await this.geyser.timeBonus(days(30)), 10, 18);
        expect(mult).to.be.equal(3.0);
      });
    });

    describe('when configured with 0.0 max time bonus', function () {

      beforeEach(async function () {
        // owner creates geyser
        this.geyser = await Geyser.new(
          this.staking.address,
          this.reward.address,
          bonus(0.0),
          bonus(0.0),
          days(90),
          this.gysr.address,
          { from: owner }
        );
        // owner funds geyser
        await this.reward.transfer(owner, tokens(10000), { from: org });
        await this.reward.approve(this.geyser.address, tokens(100000), { from: owner });
        await this.geyser.methods['fund(uint256,uint256)'](
          tokens(1000), days(180),
          { from: owner }
        );
      });

      it('should be 1.0 time bonus for t = 0', async function () {
        const mult = fromFixedPointBigNumber(await this.geyser.timeBonus(0), 10, 18);
        expect(mult).to.be.equal(1.0);
      });

      it('should be 1.0 time bonus for 0 < t < period', async function () {
        const mult = fromFixedPointBigNumber(await this.geyser.timeBonus(days(30)), 10, 18);
        expect(mult).to.be.equal(1.0);
      });

      it('should be 1.0 time bonus for t = period', async function () {
        const mult = fromFixedPointBigNumber(await this.geyser.timeBonus(days(90)), 10, 18);
        expect(mult).to.be.equal(1.0);
      });

      it('should be 1.0 time bonus for t > period', async function () {
        const mult = fromFixedPointBigNumber(await this.geyser.timeBonus(days(120)), 10, 18);
        expect(mult).to.be.equal(1.0);
      });
    });
  });

  describe('withdraw', function () {

    beforeEach(async function () {
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
      await this.geyser.methods['fund(uint256,uint256)'](tokens(1000), days(180), { from: owner });
      // alice stakes 100 tokens
      await this.staking.transfer(alice, tokens(1000), { from: org });
      await this.staking.approve(this.geyser.address, tokens(10000), { from: alice });
      await this.geyser.stake(tokens(100), [], { from: alice });
      // alice acquires GYSR
      await this.gysr.transfer(alice, tokens(100), { from: org });
      await this.gysr.approve(this.geyser.address, tokens(10000), { from: alice });
      // time elapsed
      await time.increase(days(30));
    });


    describe('when GYSR balance is zero', function () {
      it('should fail', async function () {
        await expectRevert(
          this.geyser.withdraw(tokens(10), { from: owner }),
          'Geyser: withdraw amount exceeds balance'
        );
      });
    });

    describe('when withdraw amount is zero', function () {
      it('should fail', async function () {
        await expectRevert(
          this.geyser.withdraw(tokens(0), { from: owner }),
          'Geyser: withdraw amount is zero'
        );
      });
    });

    describe('when amount is greater than GYSR balance', function () {
      it('should fail', async function () {
        await this.geyser.methods['unstake(uint256,uint256,bytes)'](
          tokens(100), tokens(10), [], { from: alice }
        );
        await expectRevert(
          this.geyser.withdraw(tokens(11), { from: owner }),
          'Geyser: withdraw amount exceeds balance'
        );
      });
    });

    describe('when sender is not owner', function () {
      it('should fail', async function () {
        // alice spends 100 GYSR on unstaking operation
        await this.geyser.methods['unstake(uint256,uint256,bytes)'](
          tokens(100), tokens(10), [], { from: alice }
        );
        await expectRevert(
          this.geyser.withdraw(tokens(10), { from: alice }),
          'Ownable: caller is not the owner'
        );
      });
    });

    describe('when withdraw is successful', function () {

      beforeEach(async function () {
        // alice spends 10 GYSR on unstaking operation
        await this.geyser.methods['unstake(uint256,uint256,bytes)'](
          tokens(100), tokens(10), [],
          { from: alice }
        );
        // withdraw full 100 GYSR
        this.res = await this.geyser.withdraw(tokens(10), { from: owner });
      });

      it('should increase GYSR token balance for owner', async function () {
        expect(await this.gysr.balanceOf(owner)).to.be.bignumber.equal(tokens(10));
      });

      it('should decrease GYSR token balance for Geyser contract', async function () {
        expect(await this.gysr.balanceOf(this.geyser.address)).to.be.bignumber.equal(tokens(0));
      });

      it('should emit GYSR withdrawn event', async function () {
        expectEvent(this.res, 'GysrWithdrawn', { amount: tokens(10) });
      });

    });
  });

  describe('elastic reward token', function () {

    beforeEach(async function () {
      // owner creates geyser
      this.geyser = await Geyser.new(
        this.staking.address,
        this.elastic.address,
        bonus(0.0),
        bonus(1.0),
        days(30),
        this.gysr.address,
        { from: owner }
      );
      // owner funds geyser
      await this.elastic.transfer(owner, tokens(10000), { from: org });
      await this.elastic.approve(this.geyser.address, tokens(100000), { from: owner });
      await this.geyser.methods['fund(uint256,uint256)'](tokens(1000), days(180), { from: owner });
      this.t0 = await this.geyser.lastUpdated();

      // alice stakes 100 tokens
      await this.staking.transfer(alice, tokens(1000), { from: org });
      await this.staking.approve(this.geyser.address, tokens(10000), { from: alice });
      await this.geyser.stake(tokens(100), [], { from: alice });
    });

    describe('when supply expands', function () {

      beforeEach(async function () {
        // advance 45 days
        await time.increaseTo(this.t0.add(days(45)));
        this.res0 = await this.geyser.update();

        // expand
        await this.elastic.setCoefficient(toFixedPointBigNumber(1.1, 10, 18));

        // advance another 45 days
        await time.increaseTo(this.t0.add(days(90)));
        this.res1 = await this.geyser.update();

        // alice unstakes 25 tokens with 2x time multiplier
        // portion: (2.0 * 25) / (100 - 25 + 2.0 * 25) = 0.4
        this.res2 = await this.geyser.unstake(tokens(25), [], { from: alice });
      });

      it('should increase total locked', async function () {
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(1.1 * 500), TOKEN_DELTA);
      });

      it('should increase total unlocked', async function () {
        // 0.4 of unlocked already distributed
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(0.6 * 1.1 * 500), TOKEN_DELTA);
      });

      it('should unlock at standard rate originally', async function () {
        const e = this.res0.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(250), TOKEN_DELTA);
        expect(e.args.total).to.be.bignumber.closeTo(tokens(250), TOKEN_DELTA);
      });

      it('should unlock at increased rate after expansion', async function () {
        const e = this.res1.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(1.1 * 250), TOKEN_DELTA);
        expect(e.args.total).to.be.bignumber.closeTo(tokens(1.1 * 500), TOKEN_DELTA);
      });

      it('should emit increased reward event', async function () {
        expectEvent(
          this.res2,
          'Unstaked',
          { user: alice, amount: tokens(25), total: tokens(75) }
        );

        const e = this.res2.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(0.4 * 1.1 * 500), TOKEN_DELTA);
      });

      it('should distribute increased rewards', async function () {
        expect(await this.elastic.balanceOf(alice)).to.be.bignumber.closeTo(tokens(0.4 * 1.1 * 500), TOKEN_DELTA);
      });
    });

    describe('when supply decreases', function () {

      beforeEach(async function () {
        // advance 45 days
        await time.increaseTo(this.t0.add(days(45)));
        this.res0 = await this.geyser.update();

        // shrink
        await this.elastic.setCoefficient(toFixedPointBigNumber(0.75, 10, 18));

        // advance another 45 days
        await time.increaseTo(this.t0.add(days(90)));
        this.res1 = await this.geyser.update();

        // alice unstakes 25 tokens with 2x time multiplier
        // portion: (2.0 * 25) / (100 - 25 + 2.0 * 25) = 0.4
        this.res2 = await this.geyser.unstake(tokens(25), [], { from: alice });
      });

      it('should decrease total locked', async function () {
        expect(await this.geyser.totalLocked()).to.be.bignumber.closeTo(tokens(0.75 * 500), TOKEN_DELTA);
      });

      it('should decrease total unlocked', async function () {
        // 0.4 of unlocked already distributed
        expect(await this.geyser.totalUnlocked()).to.be.bignumber.closeTo(tokens(0.6 * 0.75 * 500), TOKEN_DELTA);
      });

      it('should unlock at standard rate originally', async function () {
        const e = this.res0.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(250), TOKEN_DELTA);
        expect(e.args.total).to.be.bignumber.closeTo(tokens(250), TOKEN_DELTA);
      });

      it('should unlock at decreased rate after expansion', async function () {
        const e = this.res1.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(0.75 * 250), TOKEN_DELTA);
        expect(e.args.total).to.be.bignumber.closeTo(tokens(0.75 * 500), TOKEN_DELTA);
      });

      it('should emit decreased reward event', async function () {
        expectEvent(
          this.res2,
          'Unstaked',
          { user: alice, amount: tokens(25), total: tokens(75) }
        );

        const e = this.res2.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(0.4 * 0.75 * 500), TOKEN_DELTA);
      });

      it('should distribute decreased rewards', async function () {
        expect(await this.elastic.balanceOf(alice)).to.be.bignumber.closeTo(tokens(0.4 * 0.75 * 500), TOKEN_DELTA);
      });
    });
  });

});
