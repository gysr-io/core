// unit tests for ERC20StakingModuleInfo library

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

const ERC20StakingModule = contract.fromArtifact('ERC20StakingModule');
const GeyserToken = contract.fromArtifact('GeyserToken');
const TestToken = contract.fromArtifact('TestToken');
const ERC20StakingModuleInfo = contract.fromArtifact('ERC20StakingModuleInfo');


// need decent tolerance to account for potential timing error
const TOKEN_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);
const SHARE_DELTA = toFixedPointBigNumber(0.0001 * (10 ** 6), 10, DECIMALS);
const BONUS_DELTA = toFixedPointBigNumber(0.0001, 10, DECIMALS);


describe('ERC20StakingModuleInfo', function () {
  const [org, owner, controller, bob, alice, factory] = accounts;

  beforeEach('setup', async function () {
    this.gysr = await GeyserToken.new({ from: org });
    this.token = await TestToken.new({ from: org });
    this.info = await ERC20StakingModuleInfo.new({ from: org });
  });


  describe('when pool is first initialized', function () {

    beforeEach(async function () {
      this.module = await ERC20StakingModule.new(
        this.token.address,
        factory,
        { from: owner }
      );
    });

    describe('when getting token info', function () {

      beforeEach(async function () {
        this.res = await this.info.token(this.module.address);
      });

      it('should return staking token address as first argument', async function () {
        expect(this.res[0]).to.equal(this.token.address);
      });

      it('should return staking token name as second argument', async function () {
        expect(this.res[1]).to.equal("TestToken");
      });

      it('should return staking token symbol as third argument', async function () {
        expect(this.res[2]).to.equal("TKN");
      });

      it('should return staking token decimals as fourth argument', async function () {
        expect(this.res[3]).to.be.bignumber.equal(new BN(18));
      });

    });

    describe('when user gets all shares', function () {

      beforeEach(async function () {
        this.res = await this.info.shares(this.module.address, alice, 0);
      });

      it('should return zero', async function () {
        expect(this.res).to.be.bignumber.equal(new BN(0));
      });

    });


    describe('when getting shares per token', function () {

      beforeEach(async function () {
        this.res = await this.info.sharesPerToken(this.module.address);
      });

      it('should return 1e6', async function () {
        expect(this.res).to.be.bignumber.equal(shares(1));
      });

    });

  });


  describe('when multiple users have staked', function () {

    beforeEach('setup', async function () {

      // owner creates module
      this.module = await ERC20StakingModule.new(
        this.token.address,
        factory,
        { from: owner }
      );

      // acquire staking tokens and approval
      await this.token.transfer(alice, tokens(1000), { from: org });
      await this.token.transfer(bob, tokens(1000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: alice });
      await this.token.approve(this.module.address, tokens(100000), { from: bob });

      // alice stakes 200 tokens
      await this.module.stake(alice, tokens(200), [], { from: owner });

      // bob stakes 100 tokens
      await this.module.stake(bob, tokens(100), [], { from: owner });

      // advance time
      await time.increase(days(30));
    });

    describe('when user gets all shares', function () {

      beforeEach(async function () {
        this.res = await this.info.shares(this.module.address, alice, 0);
      });

      it('should return full share balance', async function () {
        expect(this.res).to.be.bignumber.equal(shares(200));
      });

    });

    describe('when user gets share value on some tokens', function () {

      beforeEach(async function () {
        this.res = await this.info.shares(this.module.address, alice, tokens(75));
      });

      it('should return expected number of shares', async function () {
        expect(this.res).to.be.bignumber.equal(shares(75));
      });

    });

    describe('when getting shares per token', function () {

      beforeEach(async function () {
        this.res = await this.info.sharesPerToken(this.module.address);
      });

      it('should return 1e6', async function () {
        expect(this.res).to.be.bignumber.equal(shares(1));
      });

    });

  });

});
