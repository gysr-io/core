// unit tests for AssignmentStakingModuleInfo library

const { artifacts, web3 } = require('hardhat');
const { BN, time } = require('@openzeppelin/test-helpers');
const { ZERO_ADDRESS } = require('@openzeppelin/test-helpers/src/constants');
const { expect } = require('chai');

const { days, toFixedPointBigNumber, DECIMALS } = require('../util/helper');

const AssignmentStakingModule = artifacts.require('AssignmentStakingModule');
const AssignmentStakingModuleInfo = artifacts.require('AssignmentStakingModuleInfo');

describe('AssignmentStakingModuleInfo', function () {
  let org, owner, alice, bob, other, factory;
  before(async function () {
    [org, owner, alice, bob, other, factory] = await web3.eth.getAccounts();
  });

  beforeEach('setup', async function () {
    this.info = await AssignmentStakingModuleInfo.new({ from: org });
  });

  describe('when pool is first initialized', function () {
    beforeEach(async function () {
      this.module = await AssignmentStakingModule.new(factory, { from: owner });
    });

    describe('when getting token info', function () {
      beforeEach(async function () {
        this.res = await this.info.tokens(this.module.address);
      });

      it('should return staking token address as first argument', async function () {
        expect(this.res.addresses_[0]).to.equal(ZERO_ADDRESS);
      });

      it('should return empty name as second argument', async function () {
        expect(this.res.names_[0]).to.equal('');
      });

      it('should return empty symbol as third argument', async function () {
        expect(this.res.symbols_[0]).to.equal('');
      });

      it('should return 0 decimals as fourth argument', async function () {
        expect(this.res.decimals_[0]).to.be.bignumber.equal(new BN(0));
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
        expect(this.res).to.be.bignumber.equal(
          toFixedPointBigNumber(1, 10, 24)
        );
      });
    });
  });

  describe('when multiple users have staked', function () {
    beforeEach('setup', async function () {
      // owner creates staking module
      this.module = await AssignmentStakingModule.new(factory, { from: owner });

      // alice gets 100 shares / day
      const data0 = web3.eth.abi.encodeParameters(['address'], [alice]);
      this.res0 = await this.module.stake(owner, 100, data0, { from: owner });

      // bob gets 200 shares / day
      const data1 = web3.eth.abi.encodeParameters(['address'], [bob]);
      this.res1 = await this.module.stake(owner, 200, data1, { from: owner });

      // advance time
      await time.increase(days(30));
    });

    describe('when user gets all shares', function () {
      beforeEach(async function () {
        this.res = await this.info.shares(this.module.address, alice, 0);
      });

      it('should return full share balance', async function () {
        expect(this.res).to.be.bignumber.equal(new BN(100));
      });
    });

    describe('when user gets share value on some tokens', function () {
      beforeEach(async function () {
        this.res = await this.info.shares(
          this.module.address,
          alice,
          new BN(50)
        );
      });

      it('should return expected number of shares', async function () {
        expect(this.res).to.be.bignumber.equal(
          toFixedPointBigNumber(50, 10, 6)
        );
      });
    });

    describe('when getting shares per token', function () {
      beforeEach(async function () {
        this.res = await this.info.sharesPerToken(this.module.address);
      });

      it('should return 1e6', async function () {
        expect(this.res).to.be.bignumber.equal(
          toFixedPointBigNumber(1, 10, 24)
        );
      });
    });
  });
});
