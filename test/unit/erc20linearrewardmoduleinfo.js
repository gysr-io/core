// unit tests for ERC20LinearRewardModuleInfo library

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
  DECIMALS
} = require('../util/helper');

const ERC20LinearRewardModule = artifacts.require('ERC20LinearRewardModule');
const TestToken = artifacts.require('TestToken');
const Configuration = artifacts.require('Configuration');
const ERC20LinearRewardModuleInfo = artifacts.require('ERC20LinearRewardModuleInfo');


// need decent tolerance to account for potential timing error
const TOKEN_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);
const SHARE_DELTA = toFixedPointBigNumber(0.0001 * (10 ** 6), 10, DECIMALS);
const BONUS_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);


describe('ERC20LinearRewardModuleInfo', function () {
  let org, owner, alice, bob, other, factory;
  before(async function () {
    [org, owner, alice, bob, other, factory] = await web3.eth.getAccounts();
  });

  beforeEach('setup', async function () {
    this.token = await TestToken.new({ from: org });
    this.config = await Configuration.new({ from: org });
    this.info = await ERC20LinearRewardModuleInfo.new({ from: org });
  });


  describe('when pool is first initialized', function () {

    beforeEach(async function () {
      this.module = await ERC20LinearRewardModule.new(
        this.token.address,
        days(14),
        e18(1),
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
        expect(this.res).to.be.bignumber.equal(new BN(0));
      });
    });

    describe('when getting total runway', function () {
      beforeEach(async function () {
        this.res = await this.info.runway(this.module.address);
      });

      it('should return zero', async function () {
        expect(this.res).to.be.bignumber.equal(new BN(0));
      });
    });

    describe('when validating a new stake', function () {

      beforeEach(async function () {
        this.res = await this.info.validate(this.module.address, shares(0.0001));
      });

      it('should return false', async function () {
        expect(this.res[0]).to.equal(false);
      });

      it('should return zero seconds', async function () {
        expect(this.res[1]).to.be.bignumber.equal(new BN(0));
      });

    });

  });


  describe('when multiple users have staked', function () {

    beforeEach('setup', async function () {

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
      await this.module.fund(tokens(5000), { from: owner });

      // create stake for alice @ 0.0002 tokens/sec
      await this.module.stake(bytes32(alice), alice, shares(0.0002), [], { from: owner });
      // create stake for bob @ 0.0003 tokens/sec
      await this.module.stake(bytes32(bob), bob, shares(0.0003), [], { from: owner });
      this.t0 = await this.module.lastUpdated();

      // advance 7 days
      await time.increaseTo(this.t0.add(days(7)));

      // increase stake for alice by 0.0002 tokens/sec
      await this.module.stake(bytes32(alice), alice, shares(0.0002), [], { from: owner });

      // advance 7 days
      await time.increaseTo(this.t0.add(days(14)));
    });


    describe('when user previews rewards from multiple stakes', function () {

      beforeEach(async function () {
        // preview rewards
        this.res = await this.info.preview(this.module.address, bytes32(alice));
      });

      it('should return expected reward amount', async function () {
        const r = 0.0002 * days(7) + 0.0004 * days(7);
        expect(this.res).to.be.bignumber.closeTo(tokens(r), shares(0.0004));
      });

    });

    describe('when user previews rewards', function () {

      beforeEach(async function () {
        // preview rewards
        this.res = await this.info.preview(this.module.address, bytes32(bob));
      });

      it('should return expected reward amount', async function () {
        const r = 0.0003 * days(14);
        expect(this.res).to.be.bignumber.closeTo(tokens(r), shares(0.0003));
      });

    });

    describe('when getting estimated runway', function () {

      beforeEach(async function () {
        // estimate runway
        this.res = await this.info.runway(this.module.address);
      });

      it('should return half of funding amount', async function () {
        const t = (5000 - 0.0005 * days(7) - 0.0007 * days(7)) / 0.0007;
        expect(this.res).to.be.bignumber.closeTo(new BN(t), new BN(1));
      });

    });

    describe('when validating a new stake within budget', function () {

      beforeEach(async function () {
        this.res = await this.info.validate(this.module.address, shares(0.0001));
      });

      it('should return false', async function () {
        expect(this.res[0]).to.equal(true);
      });

      it('should return runway greater than period', async function () {
        const t = (5000 - 0.0005 * days(7) - 0.0007 * days(7)) / 0.0008;
        expect(this.res[1]).to.be.bignumber.closeTo(new BN(t), new BN(1));
      });

    });

    describe('when validating a new stake that exceeds budget', function () {

      beforeEach(async function () {
        this.res = await this.info.validate(this.module.address, shares(0.003));
      });

      it('should return false', async function () {
        expect(this.res[0]).to.equal(false);
      });

      it('should return runway less than period', async function () {
        const t = (5000 - 0.0005 * days(7) - 0.0007 * days(7)) / 0.0037;
        expect(this.res[1]).to.be.bignumber.closeTo(new BN(t), new BN(1));
      });

    });

  });


  describe('when rewards have been depleted', function () {

    beforeEach('setup', async function () {

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

      // create stake for alice @ 0.0005 tokens/sec
      await this.module.stake(bytes32(alice), alice, shares(0.0005), [], { from: owner });
      // create stake for bob @ 0.0003 tokens/sec
      await this.module.stake(bytes32(bob), bob, shares(0.0003), [], { from: owner });
      this.t0 = await this.module.lastUpdated();

      // advance 15 days to deplete rewards
      await time.increaseTo(this.t0.add(days(15)));
    });


    describe('when user previews rewards', function () {

      beforeEach(async function () {
        // preview rewards
        this.res = await this.info.preview(this.module.address, bytes32(alice));
      });

      it('should return expected reward amount', async function () {
        const r = 5 / 8 * 1000;
        expect(this.res).to.be.bignumber.closeTo(tokens(r), shares(0.0005));
      });

    });

    describe('when other user previews rewards', function () {

      beforeEach(async function () {
        // preview rewards
        this.res = await this.info.preview(this.module.address, bytes32(bob));
      });

      it('should return expected reward amount', async function () {
        const r = 3 / 8 * 1000;
        expect(this.res).to.be.bignumber.closeTo(tokens(r), shares(0.0003));
      });

    });

    describe('when getting estimated runway', function () {

      beforeEach(async function () {
        // estimate runway
        this.res = await this.info.runway(this.module.address);
      });

      it('should return zero seconds', async function () {
        expect(this.res).to.be.bignumber.equal(new BN(0));
      });

    });

    describe('when validating a new stake', function () {

      beforeEach(async function () {
        this.res = await this.info.validate(this.module.address, shares(0.0001));
      });

      it('should return false', async function () {
        expect(this.res[0]).to.equal(false);
      });

      it('should return zero seconds', async function () {
        expect(this.res[1]).to.be.bignumber.equal(new BN(0));
      });

    });

  });

});
