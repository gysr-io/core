// unit tests for ERC20CompetitiveRewardInfo library

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
const GeyserToken = contract.fromArtifact('GeyserToken');
const TestToken = contract.fromArtifact('TestToken');
const ERC20CompetitiveRewardModuleInfo = contract.fromArtifact('ERC20CompetitiveRewardModuleInfo');


// need decent tolerance to account for potential timing error
const TOKEN_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);
const SHARE_DELTA = toFixedPointBigNumber(0.0001 * (10 ** 6), 10, DECIMALS);
const BONUS_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);


describe('ERC20CompetitiveRewardModuleInfo', function () {
  const [org, owner, controller, bob, alice, factory] = accounts;

  beforeEach('setup', async function () {
    this.gysr = await GeyserToken.new({ from: org });
    this.token = await TestToken.new({ from: org });
    this.info = await ERC20CompetitiveRewardModuleInfo.new({ from: org });
  });


  describe('when pool is first initialized', function () {

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
          this.info.rewards(this.module.address, alice, 0, 0),
          'crmi1'  // shares must be greater than zero
        );
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

    describe('when getting user share seconds', function () {

      it('should revert', async function () {
        await expectRevert(
          this.info.userShareSeconds(this.module.address, alice, 0),
          'crmi1'  // shares must be greater than zero
        );
      });

    });

    describe('when getting total share seconds', function () {
      beforeEach(async function () {
        this.res = await this.info.totalShareSeconds(this.module.address);
      });

      it('should return zero', async function () {
        expect(this.res).to.be.bignumber.equal(new BN(0));
      });
    });

  });


  describe('when multiple users have staked', function () {

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

      // expect 3.0x time multiplier on first stake, 2.0x time multiplier on second stake
      // gysr bonus: 1.0 tokens, at initial 0.0 usage, unstaking 200/300 total
      this.mult = 1.0 + Math.log10(1.0 + (3.0 / 200.0) * 1.0 / (0.01 + 0.0));
      const raw = 100 * 90 + 100 * 30;
      const inflated = this.mult * (100 * 90 * 3.0 + 100 * 30 * 2.0);
      this.portion = inflated / (18000 - raw + inflated);
      this.usage = (raw / 18000) * (this.mult - 1.0) / this.mult;

      // advance last 30 days
      await time.increaseTo(this.t0.add(days(100)));
    });

    describe('when user previews rewards with too many shares', function () {

      it('should revert', async function () {
        await expectRevert(
          this.info.rewards(this.module.address, alice, shares(201), 0),
          'crmi2'  // shares greater than user position
        );
      });

    });

    describe('when user previews rewards with GYSR bonus', function () {

      beforeEach(async function () {
        // preview rewards
        this.res = await this.info.rewards(this.module.address, alice, shares(200), tokens(1));
      });

      it('should return expected reward amount', async function () {
        expect(this.res[0]).to.be.bignumber.closeTo(
          tokens(this.portion * 500), TOKEN_DELTA
        );
      });

      it('should return an estimated 2.5x time multiplier', async function () {
        expect(this.res[1]).to.be.bignumber.closeTo(bonus((90 * 3.0 + 30 * 2.0) / 120.0), BONUS_DELTA);
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

    describe('when getting user share seconds', function () {

      beforeEach(async function () {
        // get user share seconds
        this.res = await this.info.userShareSeconds(this.module.address, alice, shares(200));
      });

      it('should return expected raw share seconds', async function () {
        expect(this.res[0]).to.be.bignumber.closeTo(
          shares(100).mul(new BN(120 * 86400)),
          shares(200) // one share second
        );
      });

      it('should return expected time bonus share seconds', async function () {
        expect(this.res[1]).to.be.bignumber.closeTo(
          shares(100).mul(new BN((90 * 3.0 + 30 * 2.0) * 86400)),
          shares(200 * 2.5) // one share second
        );
      });

    });

    describe('when getting total share seconds', function () {

      beforeEach(async function () {
        // get total share seconds
        this.res = await this.info.totalShareSeconds(this.module.address);
      });

      it('should return total share seconds for all users', async function () {
        expect(this.res).to.be.bignumber.closeTo(
          shares(100).mul(new BN((90 + 60 + 30) * 86400)),
          shares(300) // one share second
        );
      });
    });

  });

});
