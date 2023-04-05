// unit tests for ERC20StakingModuleInfo library

const { artifacts, web3 } = require('hardhat');
const { BN, time, expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const {
  tokens,
  bonus,
  days,
  shares,
  bytes32,
  DECIMALS
} = require('../util/helper');

const ERC20StakingModule = artifacts.require('ERC20StakingModule');
const GeyserToken = artifacts.require('GeyserToken');
const TestToken = artifacts.require('TestToken');
const ERC20StakingModuleInfo = artifacts.require('ERC20StakingModuleInfo');


describe('ERC20StakingModuleInfo', function () {
  let org, owner, alice, bob, other, factory;
  before(async function () {
    [org, owner, alice, bob, other, factory] = await web3.eth.getAccounts();
  });

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

    describe('when getting tokens', function () {

      beforeEach(async function () {
        this.res = await this.info.tokens(this.module.address);
      });

      it('should return staking token address as first element in addresses list', async function () {
        expect(this.res.addresses_[0]).to.equal(this.token.address);
      });

      it('should return staking token name as first element in names list', async function () {
        expect(this.res.names_[0]).to.equal("TestToken");
      });

      it('should return staking token symbol as first element in symbols list', async function () {
        expect(this.res.symbols_[0]).to.equal("TKN");
      });

      it('should return staking token decimals as first element in decimals list', async function () {
        expect(this.res.decimals_[0]).to.be.bignumber.equal(new BN(18));
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

    describe('when user gets positions', function () {

      beforeEach(async function () {
        this.res = await this.info.positions(this.module.address, alice, []);
      });

      it('should return empty list of accounts', async function () {
        expect(this.res.accounts_.length).eq(0);
      });

      it('should return empty list of shares', async function () {
        expect(this.res.accounts_.length).eq(0);
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

    describe('when user gets positions', function () {

      beforeEach(async function () {
        this.res = await this.info.positions(this.module.address, alice, []);
      });

      it('should return single element list of accounts', async function () {
        expect(this.res.accounts_.length).eq(1);
      });

      it('should return single element list of shares', async function () {
        expect(this.res.accounts_.length).eq(1);
      });

      it('should return address as account', async function () {
        expect(this.res.accounts_[0]).to.be.equal(bytes32(alice));
      });

      it('should return full share balance', async function () {
        expect(this.res.shares_[0]).to.be.bignumber.equal(shares(200));
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
