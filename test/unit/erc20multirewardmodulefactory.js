// test module for ERC20MultiRewardModuleFactory

const { artifacts, web3 } = require('hardhat');
const { BN, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const { e18, days } = require('../util/helper');

const ERC20MultiRewardModule = artifacts.require('ERC20MultiRewardModule');
const ERC20MultiRewardModuleFactory = artifacts.require('ERC20MultiRewardModuleFactory');


describe('ERC20MultiRewardModuleFactory', function () {
  let org, owner, alice, config;
  before(async function () {
    [org, owner, alice, config] = await web3.eth.getAccounts();
  });

  beforeEach('setup', async function () {
    this.factory = await ERC20MultiRewardModuleFactory.new({ from: org });
  });

  describe('when constructor parameters are not encoded properly', function () {
    it('should fail', async function () {
      // missing an argument
      const data = web3.eth.abi.encodeParameters(['uint256'], [e18(0.25)]);
      await expectRevert(
        this.factory.createModule(config, data, { from: owner }),
        'mrmf1' // ERC20MultiRewardModuleFactory: invalid constructor data
      );
    });
  });

  describe('when vesting start is greater than one', function () {
    it('should fail', async function () {
      // missing an argument
      const data = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [e18(1.01), days(30)]);
      await expectRevert(
        this.factory.createModule(config, data, { from: owner }),
        'mrm1'
      );
    });
  });


  describe('when a module is created with factory', function () {

    beforeEach(async function () {
      // encode configuration parameters as bytes
      const data = web3.eth.abi.encodeParameters(['uint256', 'uint256'], [e18(0.25), days(30)]);

      // create module with factory
      this.res = await this.factory.createModule(config, data, { from: owner });
      this.addr = this.res.logs.filter(l => l.event === 'ModuleCreated')[0].args.module;
      this.module = await ERC20MultiRewardModule.at(this.addr);
    });

    it('should set vesting start properly', async function () {
      expect(await this.module.vestingStart()).to.be.bignumber.equal(e18(0.25));
    });

    it('should set vesting period properly', async function () {
      expect(await this.module.vestingPeriod()).to.be.bignumber.equal(days(30));
    });

    it('should have no reward tokens', async function () {
      expect((await this.module.tokens()).length).to.equal(0);
    });

    it('should have no reward balances', async function () {
      expect((await this.module.balances()).length).to.equal(0);
    });

    it('should set owner to message sender', async function () {
      expect(await this.module.owner()).to.equal(owner);
    });

    it('should set factory identifier properly', async function () {
      expect(await this.module.factory()).to.equal(this.factory.address);
    });

    it('should emit ModuleCreated event', async function () {
      expectEvent(this.res, 'ModuleCreated', { 'user': owner, 'module': this.addr });
    });

  });

});
