// unit tests for ERC20FixedRewardModuleInfo library

const { artifacts, web3 } = require('hardhat');
const { BN, time, expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const {
  tokens,
  bonus,
  days,
  shares,
  toFixedPointBigNumber,
  e18,
  bytes32,
  setupTime,
  DECIMALS
} = require('../util/helper');

const ERC20FixedRewardModule = artifacts.require('ERC20FixedRewardModule');
const TestToken = artifacts.require('TestToken');
const Configuration = artifacts.require('Configuration');
const ERC20FixedRewardModuleInfo = artifacts.require('ERC20FixedRewardModuleInfo');


// need decent tolerance to account for potential timing error
const TOKEN_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);
const SHARE_DELTA = toFixedPointBigNumber(0.0001 * (10 ** 6), 10, DECIMALS);
const BONUS_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);


describe('ERC20FixedRewardModuleInfo', function () {
  let org, owner, alice, bob, other, factory;
  before(async function () {
    [org, owner, alice, bob, other, factory] = await web3.eth.getAccounts();
  });

  beforeEach('setup', async function () {
    this.token = await TestToken.new({ from: org });
    this.config = await Configuration.new({ from: org });
    this.info = await ERC20FixedRewardModuleInfo.new({ from: org });
  });


  describe('when pool is first initialized', function () {

    beforeEach(async function () {
      this.module = await ERC20FixedRewardModule.new(
        this.token.address,
        days(10),
        e18(3), // 3.0 reward shares per staking share
        this.config.address,
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

    describe('when getting multi token info', function () {
      beforeEach(async function () {
        this.res = await this.info.tokens(this.module.address);
      });

      it('should return reward token address as first argument at zero index', async function () {
        expect(this.res[0][0]).to.equal(this.token.address);
      });

      it('should return reward token name as second argument at zero index', async function () {
        expect(this.res[1][0]).to.equal("TestToken");
      });

      it('should return reward token symbol as third argument at zero index', async function () {
        expect(this.res[2][0]).to.equal("TKN");
      });

      it('should return reward token decimals as fourth argument at zero index', async function () {
        expect(this.res[3][0]).to.be.bignumber.equal(new BN(18));
      });

    });

    describe('when user previews reward', function () {
      beforeEach(async function () {
        this.res = await this.info.preview(this.module.address, bytes32(alice));
      });

      it('should return zero', async function () {
        expect(this.res[0]).to.be.bignumber.equal(new BN(0));
      });

      it('should return zero vesting', async function () {
        expect(this.res[1]).to.be.bignumber.equal(new BN(0));
      });
    });

    describe('when getting remaining budget', function () {
      beforeEach(async function () {
        this.res = await this.info.budget(this.module.address);
      });

      it('should return zero', async function () {
        expect(this.res).to.be.bignumber.equal(new BN(0));
      });
    });

    describe('when validating a new stake', function () {

      beforeEach(async function () {
        this.res = await this.info.validate(this.module.address, shares(100));
      });

      it('should return false', async function () {
        expect(this.res[0]).to.equal(false);
      });

      it('should return reward amount', async function () {
        expect(this.res[1]).to.be.bignumber.equal(shares(300));
      });

      it('should return zero remaining capacity', async function () {
        expect(this.res[2]).to.be.bignumber.equal(new BN(0));
      });

    });

  });


  describe('when multiple users have staked', function () {

    beforeEach('setup', async function () {
      // owner creates module
      this.module = await ERC20FixedRewardModule.new(
        this.token.address,
        days(10),
        e18(3), // 3.0 reward shares per staking share
        this.config.address,
        factory,
        { from: owner }
      );

      // owner funds module
      await this.token.transfer(owner, tokens(10000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: owner });
      await this.module.fund(tokens(1000), { from: owner });
      await time.increase(days(1));

      // create stake for alice with 240 token reward
      await this.module.stake(bytes32(alice), alice, shares(80), [], { from: owner });
      this.t0 = (await this.module.positions(bytes32(alice))).timestamp;

      // create stake for bob with 150 token reward
      await setupTime(this.t0, days(2));
      await this.module.stake(bytes32(bob), bob, shares(50), [], { from: owner });
      this.t1 = (await this.module.positions(bytes32(bob))).timestamp;

      // create new stake for alice with 60 token reward, rollover 48 unvested from original position
      await setupTime(this.t0, days(8));
      await this.module.stake(bytes32(alice), alice, shares(20), [], { from: owner });
      this.t2 = (await this.module.positions(bytes32(alice))).timestamp;

      // advance 7 days
      await time.increaseTo(this.t0.add(days(14)));
    });

    describe('when user get pending rewards from simple stake fully vested', function () {

      beforeEach(async function () {
        // pending rewards
        this.res = await this.info.rewards(this.module.address, bytes32(bob), shares(50), []);
      });

      it('should return expected reward amount', async function () {
        expect(this.res[0]).to.be.bignumber.equal(tokens(150));
      });

    });


    describe('when user get pending rewards from multiple stakes partially vested', function () {

      beforeEach(async function () {
        // pending rewards
        this.res = await this.info.rewards(this.module.address, bytes32(alice), shares(100), []);
      });

      it('should return expected reward amount', async function () {
        const r = 0.8 * 240 + 0.6 * 108;
        expect(this.res[0]).to.be.bignumber.closeTo(tokens(r), TOKEN_DELTA);
      });

    });

    describe('when user previews rewards from simple stake fully vested', function () {

      beforeEach(async function () {
        // preview rewards
        this.res = await this.info.preview(this.module.address, bytes32(bob));
      });

      it('should return expected reward amount', async function () {
        expect(this.res[0]).to.be.bignumber.equal(tokens(150));
      });

      it('should return time vesting coefficient of 1.0', async function () {
        expect(this.res[1]).to.be.bignumber.equal(e18(1));
      });

    });

    describe('when user previews rewards from multiple stakes partially vested stake fully vested', function () {

      beforeEach(async function () {
        // preview rewards
        this.res = await this.info.preview(this.module.address, bytes32(alice));
      });

      it('should return expected reward amount', async function () {
        const r = 0.8 * 240 + 0.6 * 108;
        expect(this.res[0]).to.be.bignumber.equal(tokens(r));
      });

      it('should return expected time vesting coefficient', async function () {
        expect(this.res[1]).to.be.bignumber.equal(e18(0.6)); // current position
      });

    });

    describe('when getting estimated budget', function () {

      beforeEach(async function () {
        this.res = await this.info.budget(this.module.address);
      });

      it('should return rewards minus debt as shares', async function () {
        expect(this.res).to.be.bignumber.equal(shares(550));
      });

    });

    describe('when validating a new stake within budget', function () {

      beforeEach(async function () {
        this.res = await this.info.validate(this.module.address, shares(180));
      });

      it('should return true', async function () {
        expect(this.res[0]).to.equal(true);
      });

      it('should return allocated debt shares', async function () {
        expect(this.res[1]).to.be.bignumber.equal(shares(540));
      });

      it('should return remaining total budget', async function () {
        expect(this.res[2]).to.be.bignumber.equal(shares(10));
      });
    });

    describe('when validating a new stake that exceeds budget', function () {

      beforeEach(async function () {
        this.res = await this.info.validate(this.module.address, shares(200));
      });

      it('should return false', async function () {
        expect(this.res[0]).to.equal(false);
      });

      it('should return allocated debt shares', async function () {
        expect(this.res[1]).to.be.bignumber.equal(shares(600));
      });

      it('should return remaining total budget', async function () {
        expect(this.res[2]).to.be.bignumber.equal(new BN(0));
      });

    });

    describe('when getting withdrawable tokens', function () {

      beforeEach(async function () {
        this.res = await this.info.withdrawable(this.module.address);
      });

      it('should return rewards minus debt as tokens', async function () {
        expect(this.res).to.be.bignumber.equal(tokens(550));
      });

    });

  });

});
