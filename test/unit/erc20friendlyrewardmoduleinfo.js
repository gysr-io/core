// unit tests for ERC20FriendlyRewardInfo library

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

const ERC20FriendlyRewardModule = contract.fromArtifact('ERC20FriendlyRewardModule');
const GeyserToken = contract.fromArtifact('GeyserToken');
const TestToken = contract.fromArtifact('TestToken');
const ERC20FriendlyRewardModuleInfo = contract.fromArtifact('ERC20FriendlyRewardModuleInfo');


// need decent tolerance to account for potential timing error
const TOKEN_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);
const SHARE_DELTA = toFixedPointBigNumber(0.0001 * (10 ** 6), 10, DECIMALS);
const BONUS_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);


describe('ERC20FriendlyRewardModuleInfo', function () {
  const [org, owner, controller, bob, alice, factory] = accounts;

  beforeEach('setup', async function () {
    this.gysr = await GeyserToken.new({ from: org });
    this.token = await TestToken.new({ from: org });
    this.info = await ERC20FriendlyRewardModuleInfo.new({ from: org });
  });


  describe('when pool is first initialized', function () {

    beforeEach(async function () {
      this.module = await ERC20FriendlyRewardModule.new(
        this.token.address,
        bonus(0.0),
        days(60),
        factory,
        { from: owner }
      );
    });

    describe('when getting token info', function () {
      beforeEach(async function () {
        this.res = await this.info.token(this.module.address);
      });

      it('should return reward token address as first argument', async function () {
        expect(this.res[0]).to.equal(this.token.address);
      });

      it('should return reward token name as second argument', async function () {
        expect(this.res[1]).to.equal("TestToken");
      });

      it('should return reward token symbol as third argument', async function () {
        expect(this.res[2]).to.equal("TKN");
      });

      it('should return reward token decimals as fourth argument', async function () {
        expect(this.res[3]).to.be.bignumber.equal(new BN(18));
      });

    });

    describe('when user previews reward', function () {

      it('should revert', async function () {
        await expectRevert(
          this.info.rewards(this.module.address, alice, 0),
          'frmi1'  // shares must be greater than zero
        );
      });

    });

    describe('when getting total unlockable', function () {
      beforeEach(async function () {
        this.res = await this.info.unlockable(this.module.address);
      });

      it('should return zero', async function () {
        expect(this.res).to.be.bignumber.equal(new BN(0));
      });
    });

    describe('when getting total unlocked', function () {
      beforeEach(async function () {
        this.res = await this.info.unlocked(this.module.address);
      });

      it('should return zero', async function () {
        expect(this.res).to.be.bignumber.equal(new BN(0));
      });
    });

    describe('when getting rewards per staked share', function () {
      beforeEach(async function () {
        this.res = await this.info.rewardsPerStakedShare(this.module.address);
      });

      it('should return zero', async function () {
        expect(this.res).to.be.bignumber.equal(new BN(0));
      });
    });

    describe('when previewing GYSR multiplier', function () {

      beforeEach(async function () {
        this.res = await this.info.gysrBonus(this.module.address, shares(100), tokens(10));
      });

      it('should reflect zero usage and complete share of pool', async function () {
        const mult = 1.0 + Math.log10(1.0 + (0.01) * 10.0 / (0.01 + 0.0));
        expect(this.res).to.be.bignumber.closeTo(bonus(mult), BONUS_DELTA);
      });

    });

  });


  describe('when multiple users have staked', function () {

    beforeEach('setup', async function () {

      // owner creates module
      this.module = await ERC20FriendlyRewardModule.new(
        this.token.address,
        bonus(0.0),
        days(60),
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

      // bob stakes 100 tokens w/ 10 GYSR at 40 days
      await time.increaseTo(this.t0.add(days(40)));
      const data = web3.eth.abi.encodeParameter('uint256', tokens(10).toString());
      await this.module.stake(bob, bob, shares(100), data, { from: owner });

      // alice stakes another 100 tokens at 70 days
      await time.increaseTo(this.t0.add(days(70)));
      await this.module.stake(alice, alice, shares(100), [], { from: owner });

      // 0-40 days
      // 200 rewards unlocked
      // alice: 100 staked
      this.aliceRewardTotal = 200;

      // 40-70 days
      // 150 reards unlocked
      // alice 100 staked
      // bob 100 staked w/ 10 GYSR
      this.mult = 1.0 + Math.log10(1.0 + (0.01 * 200.0 / 100.0) * 10.0 / (0.01 + 0.0));
      this.aliceRewardTotal += 150 * 100 / (100 + this.mult * 100);
      this.bobRewardTotal = 150 * this.mult * 100 / (100 + this.mult * 100);

      // 70-100 days
      // 150 rewards unlocked
      // alice 200 staked (100 @ 100% vest, 100 @ 50% vest)
      // bob 100 staked w/ 10 GYSR
      this.alicePenalty = 150 * 0.5 * 100 / (200 + this.mult * 100);
      this.aliceRewardTotal += 150 * (100 + 0.5 * 100) / (200 + this.mult * 100);
      this.bobRewardTotal += 150 * this.mult * 100 / (200 + this.mult * 100);

      // advance last 30 days
      await time.increaseTo(this.t0.add(days(100)));
    });

    describe('when user previews rewards with too many shares', function () {

      it('should revert', async function () {
        await expectRevert(
          this.info.rewards(this.module.address, alice, shares(201)),
          'frmi2'  // shares greater than user position
        );
      });

    });

    describe('when user previews rewards from multiple stakes', function () {

      beforeEach(async function () {
        // preview rewards
        this.res = await this.info.rewards(this.module.address, alice, shares(200));
      });

      it('should return expected reward amount', async function () {
        expect(this.res[0]).to.be.bignumber.closeTo(tokens(this.aliceRewardTotal), TOKEN_DELTA);
      });

      it('should return an estimated vesting coefficient', async function () {
        expect(this.res[1]).to.be.bignumber.closeTo(
          bonus(this.aliceRewardTotal / (this.aliceRewardTotal + this.alicePenalty)),
          BONUS_DELTA
        );
      });

      it('should return an estimated 1.0 GYSR multiplier', async function () {
        expect(this.res[2]).to.be.bignumber.closeTo(bonus(1.0), BONUS_DELTA);
      });

    });

    describe('when user previews rewards from stake with GYSR bonus', function () {

      beforeEach(async function () {
        // preview rewards
        this.res = await this.info.rewards(this.module.address, bob, shares(100));
      });

      it('should return expected reward amount', async function () {
        expect(this.res[0]).to.be.bignumber.closeTo(tokens(this.bobRewardTotal), TOKEN_DELTA);
      });

      it('should return an estimated 1.0 vesting coefficient', async function () {
        expect(this.res[1]).to.be.bignumber.closeTo(bonus(1.0), BONUS_DELTA);
      });

      it('should return an estimated 2.5x GYSR multiplier', async function () {
        expect(this.res[2]).to.be.bignumber.closeTo(bonus(this.mult), BONUS_DELTA);
      });

    });

    describe('when getting total unlocked', function () {

      beforeEach(async function () {
        // estimate unlocked
        this.res = await this.info.unlocked(this.module.address);
      });

      it('should return half of funding amount', async function () {
        expect(this.res).to.be.bignumber.closeTo(tokens(500), TOKEN_DELTA);
      });

    });

    describe('when getting rewards per staked share', function () {
      beforeEach(async function () {
        this.res = await this.info.rewardsPerStakedShare(this.module.address);
      });

      it('should return expected estimate', async function () {
        expect(this.res).to.be.bignumber.closeTo(
          tokens(200 / 100 + 150 / (100 + this.mult * 100) + 150 / (200 + this.mult * 100)),
          TOKEN_DELTA
        );
      });

    });

    describe('when previewing GYSR multiplier', function () {

      beforeEach(async function () {
        this.res = await this.info.gysrBonus(this.module.address, shares(100), tokens(10));
      });

      it('should reflect some usage and partial share of pool', async function () {
        const usage = (this.mult * 100 - 100) / (this.mult * 100 + 200);
        const mult = 1.0 + Math.log10(1.0 + (0.01 * 400 / 100) * 10.0 / (0.01 + usage));
        expect(this.res).to.be.bignumber.closeTo(bonus(mult), BONUS_DELTA);
      });

    });

  });
});
