// unit tests for ERC20MultiRewardModuleInfo library

const { artifacts, web3 } = require('hardhat');
const { BN, time, expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const {
  tokens,
  bonus,
  days,
  shares,
  bytes32,
  toFixedPointBigNumber,
  setupTime,
  DECIMALS,
} = require('../util/helper');

const ERC20MultiRewardModule = artifacts.require('ERC20MultiRewardModule');
const Configuration = artifacts.require('Configuration');
const TestToken = artifacts.require('TestToken');
const ERC20MultiRewardModuleInfo = artifacts.require('ERC20MultiRewardModuleInfo');


// need decent tolerance to account for potential timing error
const TOKEN_DELTA = toFixedPointBigNumber(0.001, 10, DECIMALS);
const SHARE_DELTA = toFixedPointBigNumber(0.0001 * (10 ** 6), 10, DECIMALS);
const BONUS_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);


describe('ERC20MultiRewardModuleInfo', function () {
  let org, owner, alice, bob, other, factory;
  before(async function () {
    [org, owner, alice, bob, other, factory] = await web3.eth.getAccounts();
  });

  beforeEach('setup', async function () {
    this.config = await Configuration.new({ from: org });
    this.token = await TestToken.new({ from: org });
    this.credit = await TestToken.new({ from: org });
    this.info = await ERC20MultiRewardModuleInfo.new({ from: org });
  });


  describe('when pool is first initialized', function () {

    beforeEach(async function () {
      this.module = await ERC20MultiRewardModule.new(
        bonus(0.2),
        days(60),
        this.config.address,
        factory,
        { from: owner }
      );
    });

    describe('when getting tokens', function () {

      beforeEach(async function () {
        this.res = await this.info.tokens(this.module.address);
      });

      it('should return empty list of token addresses', async function () {
        expect(this.res.addresses_.length).eq(0);
      });

      it('should return empty list of token names', async function () {
        expect(this.res.names_.length).to.equal(0);
      });

      it('should return empty list of token symbols', async function () {
        expect(this.res.symbols_.length).to.equal(0);
      });

      it('should return empty list of token decimals', async function () {
        expect(this.res.decimals_.length).to.equal(0);
      });

    });

    describe('when user gets pending rewards', function () {
      it('should revert', async function () {
        // TODO
        await expectRevert.unspecified(
          this.info.rewards(this.module.address, bytes32(alice), 0, []),
          // 'mrmi1'  // shares must be greater than zero
        );
      });
    });

    describe('when user previews reward', function () {
      it('should revert', async function () {
        // TODO
        await expectRevert.unspecified(
          this.info.preview(this.module.address, bytes32(alice), 0, []),
          // 'mrmi1'  // shares must be greater than zero
        );
      });
    });

    describe('when getting total unlockable', function () {
      beforeEach(async function () {
        this.res = await this.info.unlockable(this.module.address, this.token.address);
      });

      it('should return zero', async function () {
        expect(this.res).to.be.bignumber.equal(new BN(0));
      });
    });

    describe('when getting total unlocked', function () {
      beforeEach(async function () {
        this.res = await this.info.unlocked(this.module.address, this.token.address);
      });

      it('should return zero', async function () {
        expect(this.res).to.be.bignumber.equal(new BN(0));
      });
    });

    describe('when getting rewards per staked share', function () {
      beforeEach(async function () {
        this.res = await this.info.rewardsPerStakedShare(this.module.address, this.token.address);
      });

      it('should return zero', async function () {
        expect(this.res).to.be.bignumber.equal(new BN(0));
      });
    });

  });


  describe('when multiple users have staked', function () {

    beforeEach('setup', async function () {

      // owner creates module
      this.module = await ERC20MultiRewardModule.new(
        bonus(0.0),
        days(90),
        this.config.address,
        factory,
        { from: owner }
      );

      // owner funds module
      await this.token.transfer(owner, tokens(10000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.methods['fund(address,uint256,uint256)'](
        this.token.address, tokens(1000), days(200),
        { from: owner }
      );
      this.t0 = (await this.module.fundings(this.token.address, 0)).updated;

      await this.credit.transfer(owner, tokens(10000), { from: org });
      await this.credit.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.fund(this.credit.address, tokens(2000), days(100), this.t0.add(days(50)), { from: owner });

      // alice stakes 100 tokens on day 5
      await setupTime(this.t0, days(5));
      const data0 = web3.eth.abi.encodeParameters(['address', 'address'], [this.token.address, this.credit.address]);
      await this.module.stake(bytes32(alice), alice, shares(100), data0, { from: owner });

      // bob stakes 150 tokens on day 10
      await setupTime(this.t0, days(10));
      const data1 = web3.eth.abi.encodeParameters(['address', 'address'], [this.token.address, this.credit.address]);
      await this.module.stake(bytes32(bob), bob, shares(150), data1, { from: owner });

      // alice stakes another 150 tokens on day 20 for just one reward
      await setupTime(this.t0, days(20));
      const data2 = web3.eth.abi.encodeParameters(['address'], [this.token.address]);
      await this.module.stake(bytes32(alice), alice, shares(150), data2, { from: owner });


      // token: 10 days @ 5 / 100 = 0.50, 10 days @ 5 / 250 = 0.2, 50 days @ 5 / 400 = 0.625
      // elastic: 20 days @ 20 / 250 = 1.6
      await setupTime(this.t0, days(70));

      // first stake @ 65/90 vesting, second stake @ 50/90 vesting
      this.r0 = (65 / 90) * (50 + 50 * (100 / 250) + 250 * (100 / 400)) + (50 / 90) * 250 * (150 / 400);

      // first stake @ 65/90 vesting, second stake not registered
      this.r1 = (65 / 90) * 400 * (100 / 250);
    });

    describe('when getting tokens', function () {

      beforeEach(async function () {
        this.res = await this.info.tokens(this.module.address);
      });

      it('should return lists with two elements', async function () {
        expect(this.res.addresses_.length).eq(2);
        expect(this.res.names_.length).to.equal(2);
        expect(this.res.symbols_.length).to.equal(2);
        expect(this.res.decimals_.length).to.equal(2);
      });

      it('should return reward token addresses', async function () {
        expect(this.res.addresses_[0]).to.equal(this.token.address);
        expect(this.res.addresses_[1]).to.equal(this.credit.address);
      });

      it('should return reward token names', async function () {
        expect(this.res.names_[0]).to.equal("TestToken");
        expect(this.res.names_[1]).to.equal("TestToken");
      });

      it('should return reward token symbols', async function () {
        expect(this.res.symbols_[0]).to.equal("TKN");
        expect(this.res.symbols_[1]).to.equal("TKN");
      });

      it('should return staking token decimals', async function () {
        expect(this.res.decimals_[0]).to.be.bignumber.equal(new BN(18));
        expect(this.res.decimals_[1]).to.be.bignumber.equal(new BN(18));
      });

    });


    describe('when user previews rewards with too many shares', function () {

      it('should revert', async function () {
        // TODO
        await expectRevert.unspecified(
          this.info.preview(this.module.address, bytes32(alice), shares(251), [this.token.address, this.credit.address]),
          // 'mrmi2'  // shares greater than user position
        );
      });

    });


    describe('when user gets all pending rewards', function () {

      beforeEach(async function () {
        // preview rewards
        this.res = await this.info.rewards(this.module.address, bytes32(alice), shares(250), []);
      });

      it('should return reward list with two elements', async function () {
        expect(this.res.length).equal(2);
      });

      it('should return expected reward amounts', async function () {
        expect(this.res[0]).to.be.bignumber.closeTo(tokens(this.r0), TOKEN_DELTA);
        expect(this.res[1]).to.be.bignumber.closeTo(tokens(this.r1), TOKEN_DELTA);
      });

    });

    describe('when user previews rewards for all shares and all tokens', function () {

      beforeEach(async function () {
        // preview rewards
        this.res = await this.info.preview(
          this.module.address,
          bytes32(alice),
          shares(250),
          [this.token.address, this.credit.address]
        );
      });

      it('should return reward and vesting lists with two elements', async function () {
        expect(this.res.rewards_.length).equal(2);
        expect(this.res.vesting_.length).equal(2);
      });

      it('should return expected reward amounts', async function () {
        expect(this.res.rewards_[0]).to.be.bignumber.closeTo(tokens(this.r0), TOKEN_DELTA);
        expect(this.res.rewards_[1]).to.be.bignumber.closeTo(tokens(this.r1), TOKEN_DELTA);
      });

      it('should return expected vesting coefficients', async function () {
        expect(this.res.vesting_[0]).to.be.bignumber.closeTo(bonus(0.65316), BONUS_DELTA);
        expect(this.res.vesting_[1]).to.be.bignumber.closeTo(bonus(65 / 90), BONUS_DELTA);
      });

    });

    describe('when user previews rewards for all shares and some tokens', function () {

      beforeEach(async function () {
        // preview rewards
        this.res = await this.info.preview(
          this.module.address,
          bytes32(alice),
          shares(250),
          [this.credit.address]
        );
      });

      it('should return reward and vesting lists with two elements', async function () {
        expect(this.res.rewards_.length).equal(1);
        expect(this.res.vesting_.length).equal(1);
      });

      it('should return expected reward amounts', async function () {
        expect(this.res.rewards_[0]).to.be.bignumber.closeTo(tokens(this.r1), TOKEN_DELTA);
      });

      it('should return expected vesting coefficients', async function () {
        expect(this.res.vesting_[0]).to.be.bignumber.closeTo(bonus(65 / 90), BONUS_DELTA);
      });

    });

    describe('when user previews rewards for some shares and all tokens', function () {

      beforeEach(async function () {
        // preview rewards
        this.res = await this.info.preview(
          this.module.address,
          bytes32(alice),
          shares(80),
          [this.token.address, this.credit.address]
        );
      });

      it('should return reward and vesting lists with two elements', async function () {
        expect(this.res.rewards_.length).equal(2);
        expect(this.res.vesting_.length).equal(2);
      });

      it('should return expected reward amounts', async function () {
        const r = (50 / 90) * 250 * (80 / 400)
        expect(this.res.rewards_[0]).to.be.bignumber.closeTo(tokens(r), TOKEN_DELTA);
        expect(this.res.rewards_[1]).to.be.bignumber.equal(new BN(0));
      });

      it('should return expected vesting coefficients', async function () {
        expect(this.res.vesting_[0]).to.be.bignumber.closeTo(bonus(50 / 90), BONUS_DELTA);
        expect(this.res.vesting_[1]).to.be.bignumber.equal(new BN(0));
      });

    });

    describe('when user previews rewards by index for all stakes and all tokens', function () {

      beforeEach(async function () {
        // preview rewards
        this.res = await this.info.methods['preview(address,bytes32,uint256,uint256,address[])'](
          this.module.address,
          bytes32(alice),
          new BN(0),
          new BN(2),
          [this.token.address, this.credit.address]
        );
      });

      it('should return reward and vesting lists with two elements', async function () {
        expect(this.res.rewards_.length).equal(2);
        expect(this.res.vesting_.length).equal(2);
      });

      it('should return expected reward amounts', async function () {
        expect(this.res.rewards_[0]).to.be.bignumber.closeTo(tokens(this.r0), TOKEN_DELTA);
        expect(this.res.rewards_[1]).to.be.bignumber.closeTo(tokens(this.r1), TOKEN_DELTA);
      });

      it('should return expected vesting coefficients', async function () {
        expect(this.res.vesting_[0]).to.be.bignumber.closeTo(bonus(0.65316), BONUS_DELTA);
        expect(this.res.vesting_[1]).to.be.bignumber.closeTo(bonus(65 / 90), BONUS_DELTA);
      });

    });

    describe('when user previews rewards by index for all stakes and some tokens', function () {

      beforeEach(async function () {
        // preview rewards
        this.res = await this.info.methods['preview(address,bytes32,uint256,uint256,address[])'](
          this.module.address,
          bytes32(alice),
          new BN(0),
          new BN(2),
          [this.token.address]
        );
      });

      it('should return reward and vesting lists with two elements', async function () {
        expect(this.res.rewards_.length).equal(1);
        expect(this.res.vesting_.length).equal(1);
      });

      it('should return expected reward amounts', async function () {
        expect(this.res.rewards_[0]).to.be.bignumber.closeTo(tokens(this.r0), TOKEN_DELTA);
      });

      it('should return expected vesting coefficients', async function () {
        expect(this.res.vesting_[0]).to.be.bignumber.closeTo(bonus(0.65316), BONUS_DELTA);
      });

    });

    describe('when user previews rewards by index for some stakes and all tokens', function () {

      beforeEach(async function () {
        // preview rewards
        this.res = await this.info.methods['preview(address,bytes32,uint256,uint256,address[])'](
          this.module.address,
          bytes32(alice),
          new BN(0),
          new BN(1),
          [this.token.address, this.credit.address]
        );
      });

      it('should return reward and vesting lists with two elements', async function () {
        expect(this.res.rewards_.length).equal(2);
        expect(this.res.vesting_.length).equal(2);
      });

      it('should return expected reward amounts', async function () {
        const r0 = (65 / 90) * (50 + 50 * (100 / 250) + 250 * (100 / 400));
        expect(this.res.rewards_[0]).to.be.bignumber.closeTo(tokens(r0), TOKEN_DELTA);
        expect(this.res.rewards_[1]).to.be.bignumber.closeTo(tokens(this.r1), TOKEN_DELTA);
      });

      it('should return expected vesting coefficients', async function () {
        expect(this.res.vesting_[0]).to.be.bignumber.closeTo(bonus(65 / 90), BONUS_DELTA);
        expect(this.res.vesting_[1]).to.be.bignumber.closeTo(bonus(65 / 90), BONUS_DELTA);
      });

    });

    describe('when checking registered rewards all stakes and all tokens', function () {

      beforeEach(async function () {
        // preview rewards
        this.res = await this.info.registered(
          this.module.address,
          bytes32(alice),
          new BN(0),
          new BN(2),
          [this.token.address, this.credit.address]
        );
      });

      it('should return two dimensional array of stakes and reward token accumulators', async function () {
        expect(this.res.length).equal(2);
        expect(this.res[0].length).equal(2);
        expect(this.res[1].length).equal(2);
      });

      it('should return zero for unregistered stakes', async function () {
        expect(this.res[1][1]).to.be.bignumber.equal(new BN(0));
      });

      it('should return accumulator tallies for registered stakes', async function () {
        expect(this.res[0][0]).to.be.bignumber.equal(new BN(1));
        expect(this.res[0][1]).to.be.bignumber.equal(new BN(1));
        expect(this.res[1][0]).to.be.bignumber.closeTo(bonus(0.7), BONUS_DELTA);
      });

    });

    describe('when checking registered rewards all stakes and some tokens', function () {

      beforeEach(async function () {
        // preview rewards
        this.res = await this.info.registered(
          this.module.address,
          bytes32(alice),
          new BN(0),
          new BN(2),
          [this.credit.address]
        );
      });

      it('should return two dimensional array of stakes and reward token accumulators', async function () {
        expect(this.res.length).equal(2);
        expect(this.res[0].length).equal(1);
        expect(this.res[1].length).equal(1);
      });

      it('should return zero for unregistered stakes', async function () {
        expect(this.res[1][0]).to.be.bignumber.equal(new BN(0));
      });

      it('should return accumulator tallies for registered stakes', async function () {
        expect(this.res[0][0]).to.be.bignumber.equal(new BN(1));
      });

    });

    describe('when getting total unlocked', function () {

      beforeEach(async function () {
        // estimate unlocked
        this.res = await this.info.unlocked(this.module.address, this.token.address);
      });

      it('should return half of funding amount', async function () {
        expect(this.res).to.be.bignumber.closeTo(tokens(70 / 200 * 1000), TOKEN_DELTA);
      });

    });

    describe('when getting rewards per staked share', function () {
      beforeEach(async function () {
        this.res = await this.info.rewardsPerStakedShare(this.module.address, this.token.address);
      });

      it('should return expected accumulator preview', async function () {
        expect(this.res).to.be.bignumber.closeTo(bonus(1.325), TOKEN_DELTA);
      });

    });

  });

});
