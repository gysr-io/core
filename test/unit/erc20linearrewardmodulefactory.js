// test module for ERC20LinearRewardModuleFactory

const { artifacts, web3 } = require('hardhat');
const { BN, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const { e18, days } = require('../util/helper');

const ERC20LinearRewardModule = artifacts.require('ERC20LinearRewardModule');
const ERC20LinearRewardModuleFactory = artifacts.require('ERC20LinearRewardModuleFactory');
const TestToken = artifacts.require('TestToken');


describe('ERC20LinearRewardModuleFactory', function () {
  let org, owner, alice, config;
  before(async function () {
    [org, owner, alice, config] = await web3.eth.getAccounts();
  });

  beforeEach('setup', async function () {
    this.factory = await ERC20LinearRewardModuleFactory.new({ from: org });
    this.token = await TestToken.new({ from: org });
  });

  describe('when constructor parameters are not encoded properly', function () {

    it('should fail', async function () {
      // missing an argument
      const data = web3.eth.abi.encodeParameters(
        ['address', 'uint256'],
        [this.token.address, e18(0).toString()]
      );

      await expectRevert(
        this.factory.createModule(config, data, { from: owner }),
        'lrmf1' // ERC20LinearRewardModuleFactory: invalid constructor data
      );
    });
  });

  describe('when a module is created with factory', function () {

    beforeEach(async function () {
      // encode configuration parameters as bytes
      const data = web3.eth.abi.encodeParameters(
        ['address', 'uint256', 'uint256'],
        [this.token.address, days(30).toString(), e18(1).toString()]
      );

      // create module with factory
      this.res = await this.factory.createModule(config, data, { from: owner });
      this.addr = this.res.logs.filter(l => l.event === 'ModuleCreated')[0].args.module;
      this.module = await ERC20LinearRewardModule.at(this.addr);
    });

    it('should emit ModuleCreated event', async function () {
      expectEvent(this.res, 'ModuleCreated', { 'user': owner, 'module': this.addr });
    });

    it('should set reward token properly', async function () {
      expect((await this.module.tokens())[0]).to.equal(this.token.address);
    });

    it('should set time period properly', async function () {
      expect(await this.module.period()).to.be.bignumber.equal(days(30));
    });

    it('should set earning rate properly', async function () {
      expect(await this.module.rate()).to.be.bignumber.equal(e18(1));
    });

    it('should set owner to message sender', async function () {
      expect(await this.module.owner()).to.equal(owner);
    });

    it('should set have zero reward balances', async function () {
      expect((await this.module.balances())[0]).to.bignumber.equal(new BN(0));
    });

    it('should set factory identifier properly', async function () {
      expect(await this.module.factory()).to.equal(this.factory.address);
    });

  });

});
