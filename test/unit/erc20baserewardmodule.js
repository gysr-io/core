// unit tests for ERC20CompetitiveRewardModule

const { accounts, contract } = require('@openzeppelin/test-environment');
const { BN, time, expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const {
  tokens,
  bonus,
  days,
  shares,
  toFixedPointBigNumber,
  reportGas,
  DECIMALS
} = require('../util/helper');

const ERC20CompetitiveRewardModule = contract.fromArtifact('ERC20CompetitiveRewardModule');
const GeyserToken = contract.fromArtifact('GeyserToken');
const TestToken = contract.fromArtifact('TestToken');
const TestLiquidityToken = contract.fromArtifact('TestLiquidityToken');
const TestElasticToken = contract.fromArtifact('TestElasticToken')
const TestFeeToken = contract.fromArtifact('TestFeeToken');

// need decent tolerance to account for potential timing error
const TOKEN_DELTA = toFixedPointBigNumber(0.001, 10, DECIMALS);
const SHARE_DELTA = toFixedPointBigNumber(0.001 * (10 ** 6), 10, DECIMALS);


describe('ERC20BaseRewardModule', function () {
  const [org, owner, controller, bob, alice, factory] = accounts;

  beforeEach('setup', async function () {
    this.gysr = await GeyserToken.new({ from: org });
    this.token = await TestToken.new({ from: org });
    this.elastic = await TestElasticToken.new({ from: org });
    this.feeToken = await TestFeeToken.new({ from: org });
  });


  describe('funding', function () {

    beforeEach(async function () {
      this.module = await ERC20CompetitiveRewardModule.new(
        this.token.address,
        bonus(0.5),
        bonus(2.0),
        days(90),
        factory,
        { from: owner }
      );
      //await this.module.transferControl(controller, { from: owner });
    });

    describe('when not approved', function () {
      it('should fail', async function () {
        await this.token.transfer(owner, tokens(10000), { from: org });
        await expectRevert(
          this.module.methods['fund(uint256,uint256)'](
            tokens(100), days(90), { from: owner }
          ),
          'ERC20: transfer amount exceeds allowance'
        );
      });
    });

    describe('when funding amount is larger than sender balance', function () {
      it('should fail', async function () {
        await this.token.transfer(owner, tokens(100), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: owner });
        await expectRevert(
          this.module.methods['fund(uint256,uint256)'](
            tokens(200), days(90),
            { from: owner }
          ),
          'ERC20: transfer amount exceeds balance'
        );
      });
    });

    describe('when funding amount is zero', function () {
      it('should fail', async function () {
        await this.token.transfer(owner, tokens(10000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: owner });
        await expectRevert(
          this.module.methods['fund(uint256,uint256)'](
            tokens(0), days(90),
            { from: owner }
          ),
          'rm1' // ERC20BaseRewardModule: funding amount is zero
        );
      });
    });

    describe('when funding schedule start is in the past', function () {
      it('should fail', async function () {
        await this.token.transfer(owner, tokens(10000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: owner });
        const t = await time.latest();
        await expectRevert(
          this.module.methods['fund(uint256,uint256,uint256)'](
            tokens(100), days(90), t.sub(days(1)),
            { from: owner }
          ),
          'rm2' // ERC20BaseRewardModule: funding start is past
        );
      });
    });

    describe('when sender does not control module', function () {
      it('should fail', async function () {
        await this.token.transfer(bob, tokens(10000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: bob });
        await expectRevert(
          this.module.methods['fund(uint256,uint256)'](
            tokens(100), days(90),
            { from: bob }
          ),
          'oc2' // OwnerController: caller is not the controller
        );
      });
    });

    describe('when first succesfully funded', function () {

      beforeEach(async function () {
        await this.token.transfer(owner, tokens(10000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: owner });
        this.res = await this.module.methods['fund(uint256,uint256)'](
          tokens(1000), days(90),
          { from: owner }
        );
        this.t0 = await this.module.lastUpdated();
      });

      it('should emit RewardsFunded', async function () {
        expectEvent(
          this.res,
          'RewardsFunded',
          { token: this.token.address, amount: tokens(1000), shares: shares(1000), timestamp: this.t0 }
        );
      });

      it('should increase total fundings count', async function () {
        expect(await this.module.fundingCount(this.token.address)).to.be.bignumber.equal(new BN(1));
      });

      it('should increase total locked', async function () {
        expect(await this.module.totalLocked()).to.be.bignumber.equal(tokens(1000));
      });

      it('should decrease user balance', async function () {
        expect(await this.token.balanceOf(owner)).to.be.bignumber.equal(tokens(9000));
      });
    });

    describe('when funded again', function () {

      beforeEach(async function () {
        // first funding
        await this.token.transfer(owner, tokens(10000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: owner });
        await this.module.methods['fund(uint256,uint256)'](
          tokens(1000), days(90),
          { from: owner }
        );
        this.t0 = await this.module.lastUpdated();

        // fund again 45 days later
        await time.increaseTo(this.t0.add(days(45)));
        this.res = await this.module.methods['fund(uint256,uint256)'](
          tokens(1000), days(90),
          { from: owner }
        );
        this.t1 = await this.module.lastUpdated();
      });

      it('should emit RewardsFunded and RewardsUnlocked', async function () {
        expectEvent(
          this.res,
          'RewardsFunded',
          { token: this.token.address, amount: tokens(1000), timestamp: this.t1 }
        );
        const e = this.res.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.token).to.equal(this.token.address);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(500), SHARE_DELTA);
      });

      it('should increase total fundings count', async function () {
        expect(await this.module.fundingCount(this.token.address)).to.be.bignumber.equal(new BN(2));
      });

      it('should increase total locked', async function () {
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(1500), TOKEN_DELTA);
      });

      it('should decrease user balance', async function () {
        expect(await this.token.balanceOf(owner)).to.be.bignumber.equal(tokens(8000));
      });
    });

    describe('when funded for future start', function () {
      beforeEach(async function () {
        await this.token.transfer(owner, tokens(10000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: owner });
        this.t0 = await time.latest();
        this.res = await this.module.methods['fund(uint256,uint256,uint256)'](
          tokens(1000), days(90), this.t0.add(days(30)),
          { from: owner }
        );
      });

      it('should emit RewardsFunded', async function () {
        expectEvent(
          this.res,
          'RewardsFunded',
          { token: this.token.address, amount: tokens(1000), shares: shares(1000), timestamp: this.t0.add(days(30)) }
        );
      });

      it('should increase total fundings count', async function () {
        expect(await this.module.fundingCount(this.token.address)).to.be.bignumber.equal(new BN(1));
      });

      it('should increase total locked', async function () {
        expect(await this.module.totalLocked()).to.be.bignumber.equal(tokens(1000));
      });

      it('should decrease user balance', async function () {
        expect(await this.token.balanceOf(owner)).to.be.bignumber.equal(tokens(9000));
      });

      it('should not increase unlocked rewards immediately', async function () {
        await time.increase(days(10));
        await this.module.update(constants.ZERO_ADDRESS, { from: owner });
        expect(await this.module.totalUnlocked()).to.be.bignumber.equal(tokens(0));
      });

      it('should start increasing unlocked rewards after start time hits', async function () {
        await time.increase(days(31));
        await this.module.update(constants.ZERO_ADDRESS, { from: owner });
        expect(await this.module.totalUnlocked()).to.be.bignumber.greaterThan(tokens(0));
      });

      it('should unlock rewards at correct rate', async function () {
        await time.increase(days(30 + 45));
        await this.module.update(constants.ZERO_ADDRESS, { from: owner });
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
      });

      it('should unlock rewards at correct rate when there was a previous update()', async function () {
        await time.increaseTo(this.t0.add(days(10)));
        await this.module.update(constants.ZERO_ADDRESS, { from: owner });
        await time.increaseTo(this.t0.add(days(30 + 45)));
        await this.module.update(constants.ZERO_ADDRESS, { from: owner });
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
      });

    });

    describe('when funded again after first period expires', function () {
      beforeEach(async function () {
        // setup funding
        await this.token.transfer(owner, tokens(10000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: owner });

        // first funding
        await this.module.methods['fund(uint256,uint256)'](
          tokens(100), days(90), { from: owner }
        );
        this.t0 = await this.module.lastUpdated();

        // expire first period
        await time.increase(days(90));
        this.res0 = await this.module.clean({ from: owner });

        // fund again
        this.res1 = await this.module.methods['fund(uint256,uint256)'](
          tokens(500), days(180), { from: owner }
        );
        this.t1 = await this.module.lastUpdated();
      });

      it('should have 1 active funding schedule', async function () {
        expect(await this.module.fundingCount(this.token.address)).to.be.bignumber.equal(new BN(1));
      });

      it('should emit RewardsExpired on clean', async function () {
        expectEvent(
          this.res0,
          'RewardsExpired',
          { token: this.token.address, amount: tokens(100), timestamp: this.t0 }
        );
      });

      it('should emit RewardsFunded on fund', async function () {
        expectEvent(
          this.res1,
          'RewardsFunded',
          { token: this.token.address, amount: tokens(500), shares: shares(500), timestamp: this.t1 }
        );
      });

      it('should have full first funding unlocked', async function () {
        expect(await this.module.totalUnlocked()).to.be.bignumber.equal(tokens(100));
      });

      it('should have full second funding locked', async function () {
        expect(await this.module.totalLocked()).to.be.bignumber.equal(tokens(500));
      });
    });

    describe('when one of many schedules expire', function () {
      beforeEach(async function () {
        // setup funding
        await this.token.transfer(owner, tokens(10000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: owner });

        // create many funding schedules
        await this.module.methods['fund(uint256,uint256)'](
          tokens(100), days(90), { from: owner }
        );
        this.t0 = await this.module.lastUpdated();
        await this.module.methods['fund(uint256,uint256)'](
          tokens(200), days(30), { from: owner } // this one should expire
        );
        this.t1 = await this.module.lastUpdated();
        await this.module.methods['fund(uint256,uint256,uint256)'](
          tokens(400), days(180), this.t0.add(days(90)), { from: owner }
        );
        await this.module.methods['fund(uint256,uint256)'](
          tokens(800), days(180), { from: owner }
        );

        // expire second funding
        await time.increaseTo(this.t0.add(days(45)));
        this.res0 = await this.module.clean({ from: owner });

        // fund again
        this.res1 = await this.module.methods['fund(uint256,uint256)'](
          tokens(300), days(180), { from: owner }
        );

      });

      it('should have 4 active funding schedules', async function () {
        expect(await this.module.fundingCount(this.token.address)).to.be.bignumber.equal(new BN(4));
      });

      it('should emit RewardsExpired on clean', async function () {
        expectEvent(
          this.res0,
          'RewardsExpired',
          { token: this.token.address, amount: tokens(200), shares: shares(200), timestamp: this.t1 }
        );
      });

      it('should emit RewardsFunded on fund', async function () {
        expectEvent(
          this.res1,
          'RewardsFunded',
          { token: this.token.address, amount: tokens(300), shares: shares(300) }
        );
      });

      it('should move last funding to expired index', async function () {
        expect((await this.module.fundings(this.token.address, 0)).amount).to.be.bignumber.equal(tokens(100));
        expect((await this.module.fundings(this.token.address, 1)).amount).to.be.bignumber.equal(tokens(800)); // last funding during expire
        expect((await this.module.fundings(this.token.address, 2)).amount).to.be.bignumber.equal(tokens(400));
        expect((await this.module.fundings(this.token.address, 3)).amount).to.be.bignumber.equal(tokens(300)); // new funding
      });

      it('should have expected amount of funding unlocked', async function () {
        // 45 days passed
        // (45/90)*100 + 200 + 0 + (45/180)*800
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(450), TOKEN_DELTA);
      });

      it('should have expected amount of funding locked', async function () {
        // includes new funding and locked future funding
        // 50 + 0(expired) + 400(future) + 600 + 300(new)
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(1350), TOKEN_DELTA);
      });

      it('should continue to unlock at expected rate to 90 days', async function () {
        // 90 days passed, 0 days on future funding, 45 days on new funding
        await time.increaseTo(this.t0.add(days(90)));
        await this.module.update(constants.ZERO_ADDRESS, { from: owner });

        // 100 + 200 + 0 + 400 + 75
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(775), TOKEN_DELTA);
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(1025), TOKEN_DELTA);
      });

      it('should continue to unlock at expected rate to 180 days', async function () {
        // 180 days passed, 90 days on future funding, 135 days on new funding
        await time.increaseTo(this.t0.add(days(180)));
        await this.module.update(constants.ZERO_ADDRESS, { from: owner });

        // 100 + 200 + 200 + 800 + 225
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(1525), TOKEN_DELTA);
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(275), TOKEN_DELTA);
      });

      it('should continue to unlock at expected rate incrementally', async function () {
        // increments to 90 days
        for (const d of [55, 60, 75, 90]) {
          await time.increaseTo(this.t0.add(days(d)));
          await this.module.update(constants.ZERO_ADDRESS, { from: owner });
        }
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(775), TOKEN_DELTA);
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(1025), TOKEN_DELTA);

        // increments to 180 days
        for (const d of [91, 92, 135, 179, 180]) {
          await time.increaseTo(this.t0.add(days(d)));
          await this.module.update(constants.ZERO_ADDRESS, { from: owner });
        }
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(1525), TOKEN_DELTA);
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(275), TOKEN_DELTA);
      });

    });

    describe('when multiple schedules expire', function () {
      beforeEach(async function () {
        // setup funding
        await this.token.transfer(owner, tokens(10000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: owner });

        // create many funding schedules
        await this.module.methods['fund(uint256,uint256)'](
          tokens(100), days(90), { from: owner }
        );
        this.t0 = await this.module.lastUpdated();
        await this.module.methods['fund(uint256,uint256)'](
          tokens(200), days(30), { from: owner } // this one should expire
        );
        this.t1 = await this.module.lastUpdated();
        await this.module.methods['fund(uint256,uint256,uint256)'](
          tokens(400), days(180), this.t0.add(days(90)), { from: owner }
        );
        await this.module.methods['fund(uint256,uint256)'](
          tokens(800), days(30), { from: owner } // this one should expire
        );
        this.t3 = await this.module.lastUpdated();

        // expire second and fourth fundings
        await time.increaseTo(this.t0.add(days(45)));
        this.res0 = await this.module.clean({ from: owner });

        // fund again
        this.res1 = await this.module.methods['fund(uint256,uint256)'](
          tokens(300), days(180), { from: owner }
        );

      });

      it('should have 3 active funding schedules', async function () {
        expect(await this.module.fundingCount(this.token.address)).to.be.bignumber.equal(new BN(3));
      });

      it('should emit multiple RewardsExpired on clean', async function () {
        expectEvent(
          this.res0,
          'RewardsExpired',
          { token: this.token.address, amount: tokens(200), timestamp: this.t1 }
        );
        expectEvent(
          this.res0,
          'RewardsExpired',
          { token: this.token.address, amount: tokens(800), timestamp: this.t3 }
        );
      });

      it('should emit RewardsFunded on fund', async function () {
        expectEvent(this.res1, 'RewardsFunded', { token: this.token.address, amount: tokens(300) });
      });

      it('should properly reindex fundings', async function () {
        // last moved to second, but then also expires
        expect((await this.module.fundings(this.token.address, 0)).amount).to.be.bignumber.equal(tokens(100));
        expect((await this.module.fundings(this.token.address, 1)).amount).to.be.bignumber.equal(tokens(400));
        expect((await this.module.fundings(this.token.address, 2)).amount).to.be.bignumber.equal(tokens(300)); // new funding
      });

      it('should have expected amount of funding unlocked', async function () {
        // 45 days passed
        // 50 + 200 + 0 + 800
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(1050), TOKEN_DELTA);
      });

      it('should have expected amount of funding locked', async function () {
        // includes new funding and locked future funding
        // 50 + 0(expired) + 400(future) + 0(expired) + 300(new)
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(750), TOKEN_DELTA);
      });

      it('should continue to unlock at expected rate to 90 days', async function () {
        // 90 days passed, 0 days on future funding, 45 days on new funding
        await time.increaseTo(this.t0.add(days(90)));
        await this.module.update(constants.ZERO_ADDRESS, { from: owner });

        // 100 + 200 + 0 + 800 + 75
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(1175), TOKEN_DELTA);
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(625), TOKEN_DELTA);
      });

      it('should continue to unlock at expected rate to 180 days', async function () {
        // 180 days passed, 90 days on future funding, 135 days on new funding
        await time.increaseTo(this.t0.add(days(180)));
        await this.module.update(constants.ZERO_ADDRESS, { from: owner });

        // 100 + 200 + 200 + 800 + 225
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(1525), TOKEN_DELTA);
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(275), TOKEN_DELTA);
      });

      it('should continue to unlock at expected rate incrementally', async function () {
        // increments to 90 days
        for (const d of [51, 63, 79, 90]) {
          await time.increaseTo(this.t0.add(days(d)));
          await this.module.update(constants.ZERO_ADDRESS, { from: owner });
        }
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(1175), TOKEN_DELTA);
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(625), TOKEN_DELTA);

        // increments to 180 days
        for (const d of [115, 116, 135, 175, 180]) {
          await time.increaseTo(this.t0.add(days(d)));
          await this.module.update(constants.ZERO_ADDRESS, { from: owner });
        }
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(1525), TOKEN_DELTA);
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(275), TOKEN_DELTA);
      });
    });

    describe('when number of active fundings is at max', function () {
      beforeEach(async function () {
        // setup funding
        await this.token.transfer(owner, tokens(10000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: owner });

        // fund max number of times
        for (var i = 0; i < 16; i++) {
          await this.module.methods['fund(uint256,uint256)'](
            tokens(100), days(90), { from: owner }
          );
        }

        // approve gysr
        await this.gysr.transfer(alice, tokens(10), { from: org });
        await this.gysr.approve(this.module.address, tokens(10000), { from: alice });
      });

      it('should revert transaction on additional funding', async function () {
        await expectRevert(
          this.module.methods['fund(uint256,uint256)'](
            tokens(100), days(90), { from: owner }
          ),
          'rm3' // ERC20BaseRewardModule: exceeds max active funding schedules
        );
      });

      it('should have 16 active funding schedules', async function () {
        expect(await this.module.fundingCount(this.token.address)).to.be.bignumber.equal(new BN(16));
      });

      it('gas cost of update() should be under 1M', async function () {
        const res = await this.module.update(constants.ZERO_ADDRESS, { from: owner });
        expect(res.receipt.gasUsed).is.lessThan(10 ** 6);
        reportGas('ERC20CompetitiveRewardModule', 'update', 'max fundings', res)
      });

      it('gas cost of stake() should be under 1M', async function () {
        const res = await this.module.stake(alice, alice, shares(100), [], { from: owner });
        expect(res.receipt.gasUsed).is.lessThan(10 ** 6);
        reportGas('ERC20CompetitiveRewardModule', 'stake', 'max fundings', res)
      });

      it('gas cost of unstake() should be under 1M', async function () {
        await this.module.stake(alice, alice, shares(100), [], { from: owner });
        await time.increase(days(30));
        const res = await this.module.unstake(alice, alice, shares(100), [], { from: owner });
        expect(res.receipt.gasUsed).is.lessThan(10 ** 6);
        reportGas('ERC20CompetitiveRewardModule', 'unstake', 'max fundings', res)
      });
    });

    describe('when number of fundings is at max but one schedule expires', function () {
      beforeEach(async function () {
        // setup funding
        await this.token.transfer(owner, tokens(10000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: owner });

        // fund max number of times
        await this.module.methods['fund(uint256,uint256)'](
          tokens(100), days(30), { from: owner }
        );
        this.t0 = await this.module.lastUpdated();
        for (var i = 0; i < 15; i++) {
          await this.module.methods['fund(uint256,uint256)'](
            tokens(100), days(90), { from: owner }
          );
        }

        // expire first funding
        await time.increaseTo(this.t0.add(days(45)));
        this.res0 = await this.module.clean({ from: owner });

        // fund again
        this.res1 = await this.module.methods['fund(uint256,uint256)'](
          tokens(200), days(180), { from: owner }
        );
        this.t1 = await this.module.lastUpdated();
      });

      it('should have 16 active funding schedules', async function () {
        expect(await this.module.fundingCount(this.token.address)).to.be.bignumber.equal(new BN(16));
      });

      it('should emit RewardsExpired on clean', async function () {
        expectEvent(
          this.res0,
          'RewardsExpired',
          { token: this.token.address, amount: tokens(100), timestamp: this.t0 }
        );
      });

      it('should emit RewardsFunded on fund', async function () {
        expectEvent(
          this.res1,
          'RewardsFunded',
          { token: this.token.address, amount: tokens(200), timestamp: this.t1 }
        );
      });

      it('should properly reindex fundings', async function () {
        expect((await this.module.fundings(this.token.address, 0)).amount).to.be.bignumber.equal(tokens(100));
        expect((await this.module.fundings(this.token.address, 0)).duration).to.be.bignumber.equal(days(90));
        expect((await this.module.fundings(this.token.address, 15)).amount).to.be.bignumber.equal(tokens(200)); // new funding
        expect((await this.module.fundings(this.token.address, 15)).duration).to.be.bignumber.equal(days(180));
      });

      it('should have expected amount of funding unlocked', async function () {
        // 45 days passed
        // 100 (expired) + 1/2 * 15 * 100
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(850), TOKEN_DELTA);
      });

      it('should have expected amount of funding locked', async function () {
        // 45 days passed, and 0 days on new funding
        // 1/2 * 15 * 100 + 200
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(950), TOKEN_DELTA);
      });

    });

  });


  describe('unlocking', function () {

    beforeEach(async function () {
      this.module = await ERC20CompetitiveRewardModule.new(
        this.token.address,
        bonus(0.5),
        bonus(2.0),
        days(90),
        factory,
        { from: owner }
      );

      // setup funding
      await this.token.transfer(owner, tokens(10000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: owner });
    });

    describe('with a single 90-day funding schedule', function () {
      beforeEach(async function () {
        // fund 1000 tokens at 90 day unlocking
        await this.module.methods['fund(uint256,uint256)'](
          tokens(1000), days(90), { from: owner }
        );
        this.t0 = await this.module.lastUpdated();
      });

      it('should have zero unlocked initially', async function () {
        expect(await this.module.totalUnlocked()).to.be.bignumber.equal(tokens(0));
      });

      it('should have 50% unlocked at 45 days', async function () {
        await time.increaseTo(this.t0.add(days(45)));
        const res = await this.module.update(constants.ZERO_ADDRESS, { from: owner });

        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);

        const e = res.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.token).to.equal(this.token.address);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(500), SHARE_DELTA);
      });

      it('should have 90% unlocked at 81 days', async function () {
        await time.increaseTo(this.t0.add(days(81)));
        const res = await this.module.update(constants.ZERO_ADDRESS, { from: owner });

        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(900), TOKEN_DELTA);
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(100), TOKEN_DELTA);

        const e = res.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.token).to.equal(this.token.address);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(900), SHARE_DELTA);
      });

      it('should have 100% unlocked at 90 days', async function () {
        await time.increaseTo(this.t0.add(days(90)));
        const res = await this.module.update(constants.ZERO_ADDRESS, { from: owner });

        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(1000), TOKEN_DELTA);
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(0), TOKEN_DELTA);

        const e = res.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.token).to.equal(this.token.address);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(1000), SHARE_DELTA);
      });

      it('should have 100% unlocked beyond 90 days', async function () {
        await time.increaseTo(this.t0.add(days(100)));
        const res = await this.module.update(constants.ZERO_ADDRESS, { from: owner });
        // should be exact at this point
        expect(await this.module.totalUnlocked()).to.be.bignumber.equal(tokens(1000));
        expect(await this.module.totalLocked()).to.be.bignumber.equal(tokens(0));
        expectEvent(res, 'RewardsUnlocked', { shares: shares(1000) });
      });

      it('should unlock in increments over time', async function () {
        // 50%
        await time.increaseTo(this.t0.add(days(45)));
        const res0 = await this.module.update(constants.ZERO_ADDRESS, { from: owner });
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
        const e0 = res0.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e0.args.token).to.equal(this.token.address);
        expect(e0.args.shares).to.be.bignumber.closeTo(shares(500), SHARE_DELTA);

        // 90%
        await time.increaseTo(this.t0.add(days(81)));
        const res1 = await this.module.update(constants.ZERO_ADDRESS, { from: owner });
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(900), TOKEN_DELTA);
        const e1 = res1.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e1.args.token).to.equal(this.token.address);
        expect(e1.args.shares).to.be.bignumber.closeTo(shares(400), SHARE_DELTA);

        // 100%
        await time.increaseTo(this.t0.add(days(90)));
        const res2 = await this.module.update(constants.ZERO_ADDRESS, { from: owner });
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(1000), TOKEN_DELTA);
        const e2 = res2.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e2.args.token).to.equal(this.token.address);
        expect(e2.args.shares).to.be.bignumber.closeTo(shares(100), SHARE_DELTA);

        // 100% (beyond period)
        await time.increaseTo(this.t0.add(days(91)));
        await this.module.update(constants.ZERO_ADDRESS, { from: owner });
        expect(await this.module.totalUnlocked()).to.be.bignumber.equal(tokens(1000));
      });
    });

    describe('with a single 10-year funding schedule', function () {
      beforeEach(async function () {
        // fund 1000 tokens at 10 year unlocking
        await this.module.methods['fund(uint256,uint256)'](
          tokens(1000), days(10 * 365), { from: owner }
        );
        this.t0 = await this.module.lastUpdated();
      });

      it('should have zero unlocked initially', async function () {
        expect(await this.module.totalUnlocked()).to.be.bignumber.equal(tokens(0));
      });

      it('should have 50% unlocked after 5 years', async function () {
        await time.increaseTo(this.t0.add(days(5 * 365)));
        const res = await this.module.update(constants.ZERO_ADDRESS, { from: owner });

        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);

        const e = res.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.token).to.equal(this.token.address);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(500), SHARE_DELTA);
      });

      it('should have 90% unlocked after 9 years', async function () {
        await time.increaseTo(this.t0.add(days(9 * 365)));
        const res = await this.module.update(constants.ZERO_ADDRESS, { from: owner });

        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(900), TOKEN_DELTA);
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(100), TOKEN_DELTA);

        const e = res.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.token).to.equal(this.token.address);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(900), SHARE_DELTA);
      });

      it('should have 100% unlocked after 10 years', async function () {
        await time.increaseTo(this.t0.add(days(10 * 365)));
        const res = await this.module.update(constants.ZERO_ADDRESS, { from: owner });

        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(1000), TOKEN_DELTA);
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(0), TOKEN_DELTA);

        const e = res.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.token).to.equal(this.token.address);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(1000), SHARE_DELTA);
      });

      it('should cleanup small remainder from integer math error', async function () {
        // h/t https://github.com/ampleforth/token-geyser

        // advance to 10 years minus 1 minute
        await time.increaseTo(this.t0.add(days(10 * 365)) - new BN(60));
        const res0 = await this.module.update(constants.ZERO_ADDRESS, { from: owner })
        const e0 = res0.logs.filter(l => l.event === 'RewardsUnlocked')[0];

        // complete 10 year period
        await time.increaseTo(this.t0.add(days(10 * 365)) + new BN(5));
        const res1 = await this.module.update(constants.ZERO_ADDRESS, { from: owner })
        const e1 = res1.logs.filter(l => l.event === 'RewardsUnlocked')[0];

        // ensure all tokens have been unlocked
        expect(await this.module.totalUnlocked()).to.be.bignumber.equal(tokens(1000));
        expect(await this.module.lockedShares(this.token.address)).to.be.bignumber.equal(shares(0));
        expect(e0.args.shares.add(e1.args.shares)).to.be.bignumber.closeTo(shares(1000), SHARE_DELTA);
      });
    });

    describe('with multiple funding schedules', function () {
      beforeEach(async function () {
        // fund 1000 tokens at 90 day unlocking
        await this.module.methods['fund(uint256,uint256)'](
          tokens(1000), days(90),
          { from: owner }
        );
        this.t0 = await this.module.lastUpdated();

        // fund 1000 tokens, over 180 day unlocking period, with 45 day delayed start
        await this.module.methods['fund(uint256,uint256,uint256)'](
          tokens(1000), days(180), this.t0.add(days(45)),
          { from: owner }
        );
      });

      it('should have 0% unlocked initially', async function () {
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(0), TOKEN_DELTA);
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(2000), TOKEN_DELTA);
      });

      it('should have 50% of first funding unlocked at 45 days', async function () {
        await time.increaseTo(this.t0.add(days(45)));
        const res = await this.module.update(constants.ZERO_ADDRESS, { from: owner });

        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(500 + 1000), TOKEN_DELTA);

        const e = res.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.token).to.equal(this.token.address);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(500), SHARE_DELTA);

        expect((await this.module.fundings(this.token.address, 0)).locked).to.be.bignumber.closeTo(shares(500), SHARE_DELTA);
        expect((await this.module.fundings(this.token.address, 1)).locked).to.be.bignumber.closeTo(shares(1000), SHARE_DELTA);
      });

      it('should have 90% of first funding and 20% of second funding unlocked at 81 days', async function () {
        await time.increaseTo(this.t0.add(days(81)));
        const res = await this.module.update(constants.ZERO_ADDRESS, { from: owner });

        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(900 + 200), TOKEN_DELTA);
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(100 + 800), TOKEN_DELTA);

        const e = res.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.token).to.equal(this.token.address);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(1100), SHARE_DELTA);

        expect((await this.module.fundings(this.token.address, 0)).locked).to.be.bignumber.closeTo(shares(100), SHARE_DELTA);
        expect((await this.module.fundings(this.token.address, 1)).locked).to.be.bignumber.closeTo(shares(800), SHARE_DELTA);
      });

      it('should have 100% of first funding and 50% of second funding unlocked at 135 days', async function () {
        await time.increaseTo(this.t0.add(days(135)));
        const res = await this.module.update(constants.ZERO_ADDRESS, { from: owner });

        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(1000 + 500), TOKEN_DELTA);
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(0 + 500), TOKEN_DELTA);

        const e = res.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.token).to.equal(this.token.address);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(1500), SHARE_DELTA);

        expect((await this.module.fundings(this.token.address, 0)).locked).to.be.bignumber.closeTo(shares(0), SHARE_DELTA);
        expect((await this.module.fundings(this.token.address, 1)).locked).to.be.bignumber.closeTo(shares(500), SHARE_DELTA);
      });

      it('should have 100% unlocked after 225 days', async function () {
        await time.increaseTo(this.t0.add(days(500)));
        const res = await this.module.update(constants.ZERO_ADDRESS, { from: owner });

        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(2000), TOKEN_DELTA);
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(0), TOKEN_DELTA);

        const e = res.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.token).to.equal(this.token.address);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(2000), SHARE_DELTA);

        expect((await this.module.fundings(this.token.address, 0)).locked).to.be.bignumber.closeTo(shares(0), SHARE_DELTA);
        expect((await this.module.fundings(this.token.address, 1)).locked).to.be.bignumber.closeTo(shares(0), SHARE_DELTA);
      });
    });

    describe('when funding period is 0 seconds', function () {
      beforeEach(async function () {
        // fund 1000 tokens at 00 day unlocking
        await this.module.methods['fund(uint256,uint256)'](
          tokens(1000), 0,
          { from: owner }
        );
        this.res = await this.module.update(constants.ZERO_ADDRESS, { from: owner });
      });

      it('should emit RewardsUnlocked event', async function () {
        expectEvent(this.res, 'RewardsUnlocked', { token: this.token.address, shares: shares(1000) });
      });

      it('should have 100% of funding unlocked immediately', async function () {
        expect(await this.module.totalUnlocked()).to.be.bignumber.equal(tokens(1000));
      });
    });
  });


  describe('elastic reward token', function () {

    beforeEach(async function () {
      // owner creates module
      this.module = await ERC20CompetitiveRewardModule.new(
        this.elastic.address,
        bonus(0.0),
        bonus(1.0),
        days(30),
        factory,
        { from: owner }
      );

      // owner funds module
      await this.elastic.transfer(owner, tokens(10000), { from: org });
      await this.elastic.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.methods['fund(uint256,uint256)'](tokens(1000), days(180), { from: owner });
      this.t0 = await this.module.lastUpdated();

      // alice stakes 100 tokens
      await this.module.stake(alice, alice, shares(100), [], { from: owner });
    });

    describe('when supply expands', function () {

      beforeEach(async function () {
        // advance 45 days
        await time.increaseTo(this.t0.add(days(45)));
        this.res0 = await this.module.update(constants.ZERO_ADDRESS, { from: owner });

        // expand
        await this.elastic.setCoefficient(toFixedPointBigNumber(1.1, 10, 18));

        // advance another 45 days
        await time.increaseTo(this.t0.add(days(90)));
        this.res1 = await this.module.update(constants.ZERO_ADDRESS, { from: owner });

        // alice unstakes 25 tokens with 2x time multiplier
        // portion: (2.0 * 25) / (100 - 25 + 2.0 * 25) = 0.4
        this.res2 = await this.module.unstake(alice, alice, shares(25), [], { from: owner });
      });

      it('should increase total locked', async function () {
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(1.1 * 500), TOKEN_DELTA);
      });

      it('should increase total unlocked', async function () {
        // 0.4 of unlocked already distributed
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(0.6 * 1.1 * 500), TOKEN_DELTA);
      });

      it('should unlock shares at linear rate before expansion', async function () {
        const e = this.res0.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.shares).to.be.bignumber.closeTo(shares(250), SHARE_DELTA);
      });

      it('should unlock shares at linear rate after expansion', async function () {
        const e = this.res1.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.shares).to.be.bignumber.closeTo(shares(250), SHARE_DELTA);
      });

      it('should emit reward event with increased amount and original shares', async function () {
        const e = this.res2.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(0.4 * 1.1 * 500), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(0.4 * 500), SHARE_DELTA);
      });

      it('should distribute increased rewards', async function () {
        expect(await this.elastic.balanceOf(alice)).to.be.bignumber.closeTo(tokens(0.4 * 1.1 * 500), TOKEN_DELTA);
      });
    });

    describe('when supply decreases', function () {

      beforeEach(async function () {
        // advance 45 days
        await time.increaseTo(this.t0.add(days(45)));
        this.res0 = await this.module.update(constants.ZERO_ADDRESS, { from: owner });

        // shrink
        await this.elastic.setCoefficient(toFixedPointBigNumber(0.75, 10, 18));

        // advance another 45 days
        await time.increaseTo(this.t0.add(days(90)));
        this.res1 = await this.module.update(constants.ZERO_ADDRESS, { from: owner });

        // alice unstakes 25 tokens with 2x time multiplier
        // portion: (2.0 * 25) / (100 - 25 + 2.0 * 25) = 0.4
        this.res2 = await this.module.unstake(alice, alice, shares(25), [], { from: owner });
      });

      it('should decrease total locked', async function () {
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(0.75 * 500), TOKEN_DELTA);
      });

      it('should decrease total unlocked', async function () {
        // 0.4 of unlocked already distributed
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(0.6 * 0.75 * 500), TOKEN_DELTA);
      });

      it('should unlock shares at linear rate before expansion', async function () {
        const e = this.res0.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.shares).to.be.bignumber.closeTo(shares(250), SHARE_DELTA);
      });

      it('should unlock shares at linear rate after expansion', async function () {
        const e = this.res1.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.shares).to.be.bignumber.closeTo(shares(250), SHARE_DELTA);
      });

      it('should emit reward event with decreased amount and original shares', async function () {
        const e = this.res2.logs.filter(l => l.event === 'RewardsDistributed')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(0.4 * 0.75 * 500), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(0.4 * 500), SHARE_DELTA);
      });

      it('should distribute decreased rewards', async function () {
        expect(await this.elastic.balanceOf(alice)).to.be.bignumber.closeTo(tokens(0.4 * 0.75 * 500), TOKEN_DELTA);
      });
    });
  });


  describe('transfer fee reward token', function () {

    beforeEach(async function () {
      // owner creates module
      this.module = await ERC20CompetitiveRewardModule.new(
        this.feeToken.address,
        bonus(0.0),
        bonus(1.0),
        days(30),
        factory,
        { from: owner }
      );

      // starting user balance: 9500
      await this.feeToken.transfer(owner, tokens(10000), { from: org });
      await this.feeToken.approve(this.module.address, tokens(100000), { from: owner });
    });

    describe('when funded once', function () {

      beforeEach(async function () {
        // owner funds module
        this.res = await this.module.methods['fund(uint256,uint256)'](
          tokens(1000), days(90),
          { from: owner }
        );
        this.t0 = await this.module.lastUpdated();
      });

      it('should emit RewardsFunded', async function () {
        expectEvent(
          this.res,
          'RewardsFunded',
          { token: this.feeToken.address, amount: tokens(1000), shares: shares(950), timestamp: this.t0 }
        );
      });

      it('should increase total fundings count', async function () {
        expect(await this.module.fundingCount(this.feeToken.address)).to.be.bignumber.equal(new BN(1));
      });

      it('should increase total locked by amount after fee', async function () {
        expect(await this.module.totalLocked()).to.be.bignumber.equal(tokens(950));
      });

      it('should decrease user balance by full amount', async function () {
        expect(await this.feeToken.balanceOf(owner)).to.be.bignumber.equal(tokens(8500));
      });

      it('should mint locked rewards shares after fee', async function () {
        expect((await this.module.fundings(this.feeToken.address, 0)).shares).to.be.bignumber.closeTo(
          shares(950), SHARE_DELTA
        );
      });

      it('should update total locked rewards shares after fee', async function () {
        expect(await this.module.lockedShares(this.feeToken.address)).to.be.bignumber.closeTo(
          shares(950), SHARE_DELTA
        );
      });

    });

    describe('when half of the unlocking period has elapsed', function () {

      beforeEach(async function () {
        // owner funds module
        this.res = await this.module.methods['fund(uint256,uint256)'](
          tokens(1000), days(90),
          { from: owner }
        );
        this.t0 = await this.module.lastUpdated();

        // time elapsed
        await time.increaseTo(this.t0.add(days(45)));
        this.res = await this.module.update(constants.ZERO_ADDRESS, { from: owner });
      });

      it('should unlock half of rewards without transfer fee', async function () {
        expect(await this.module.totalUnlocked()).to.be.bignumber.closeTo(tokens(475), TOKEN_DELTA);
      });

      it('should decrease total locked to half of post-fee amount', async function () {
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(475), TOKEN_DELTA);
      });

      it('should unlock funding shares after fee', async function () {
        expect((await this.module.fundings(this.feeToken.address, 0)).locked).to.be.bignumber.closeTo(
          shares(475), SHARE_DELTA
        );
      });

      it('should update total locked rewards shares after fee', async function () {
        expect(await this.module.lockedShares(this.feeToken.address)).to.be.bignumber.closeTo(
          shares(475), SHARE_DELTA
        );
      });

      it('should emit RewardUnlocked', async function () {
        const e = this.res.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.token).to.be.equal(this.feeToken.address);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(475), SHARE_DELTA);  // post fee
      });

    });


    describe('when funded multiple times', function () {

      beforeEach(async function () {
        // first funding
        await this.module.methods['fund(uint256,uint256)'](
          tokens(1000), days(90),
          { from: owner }
        );
        this.t0 = await this.module.lastUpdated();

        // fund again 45 days later
        await time.increaseTo(this.t0.add(days(45)));
        this.res = await this.module.methods['fund(uint256,uint256)'](
          tokens(2000), days(90),
          { from: owner }
        );
        this.t1 = await this.module.lastUpdated();
      });

      it('should emit RewardsFunded and RewardsUnlocked', async function () {
        expectEvent(
          this.res,
          'RewardsFunded',
          { token: this.feeToken.address, amount: tokens(2000), shares: shares(1900), timestamp: this.t1 }
        );
        const e = this.res.logs.filter(l => l.event === 'RewardsUnlocked')[0];
        expect(e.args.token).to.be.equal(this.feeToken.address);
        expect(e.args.shares).to.be.bignumber.closeTo(shares(475), SHARE_DELTA); // post fee
      });

      it('should increase total fundings count', async function () {
        expect(await this.module.fundingCount(this.feeToken.address)).to.be.bignumber.equal(new BN(2));
      });

      it('should increase total locked by amount after fee', async function () {
        expect(await this.module.totalLocked()).to.be.bignumber.closeTo(tokens(2375), TOKEN_DELTA);
      });

      it('should decrease user balance by full amount', async function () {
        expect(await this.feeToken.balanceOf(owner)).to.be.bignumber.equal(tokens(6500));
      });

      it('should mint locked rewards shares after fee', async function () {
        expect((await this.module.fundings(this.feeToken.address, 0)).shares).to.be.bignumber.closeTo(
          shares(950), SHARE_DELTA
        );
        expect((await this.module.fundings(this.feeToken.address, 1)).shares).to.be.bignumber.closeTo(
          shares(1900), SHARE_DELTA
        );
      });

      it('should unlock funding shares after fee', async function () {
        expect((await this.module.fundings(this.feeToken.address, 0)).locked).to.be.bignumber.closeTo(
          shares(475), SHARE_DELTA
        );
        expect((await this.module.fundings(this.feeToken.address, 1)).locked).to.be.bignumber.closeTo(
          shares(1900), SHARE_DELTA
        );
      });

      it('should update total locked rewards shares after fee', async function () {
        expect(await this.module.lockedShares(this.feeToken.address)).to.be.bignumber.closeTo(
          shares(2375), SHARE_DELTA
        );
      });

    });

  });

});
