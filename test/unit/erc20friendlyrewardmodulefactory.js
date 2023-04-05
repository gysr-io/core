// test module for ERC20FriendlyRewardModuleFactory

const { artifacts, web3 } = require('hardhat');
const { BN, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const { bonus, days, reportGas, FEE } = require('../util/helper');

const ERC20FriendlyRewardModule = artifacts.require('ERC20FriendlyRewardModule');
const ERC20FriendlyRewardModuleFactory = artifacts.require('ERC20FriendlyRewardModuleFactory');
const TestToken = artifacts.require('TestToken');


describe('ERC20FriendlyRewardModuleFactory', function () {
  let org, owner, alice, config;
  before(async function () {
    [org, owner, alice, config] = await web3.eth.getAccounts();
  });

  beforeEach('setup', async function () {
    this.factory = await ERC20FriendlyRewardModuleFactory.new({ from: org });
    this.token = await TestToken.new({ from: org });
  });

  describe('when constructor parameters are not encoded properly constructed', function () {

    it('should fail', async function () {
      // missing an argument
      const data = web3.eth.abi.encodeParameters(
        ['address', 'uint256'],
        [this.token.address, bonus(0).toString()]
      );

      await expectRevert(
        this.factory.createModule(config, data, { from: owner }),
        'frmf1' // ERC20FriendlyRewardModuleFactory: invalid constructor data
      );
    });
  });

  describe('when a module is created with factory', function () {

    beforeEach(async function () {
      // encode configuration parameters as bytes
      const data = web3.eth.abi.encodeParameters(
        ['address', 'uint256', 'uint256'],
        [this.token.address, bonus(0).toString(), days(90).toString()]
      );

      // create module with factory
      this.res = await this.factory.createModule(config, data, { from: owner });
      this.addr = this.res.logs.filter(l => l.event === 'ModuleCreated')[0].args.module;
      this.module = await ERC20FriendlyRewardModule.at(this.addr);
    });

    it('should emit ModuleCreated event', async function () {
      expectEvent(this.res, 'ModuleCreated', { 'user': owner, 'module': this.addr });
    });

    it('should set reward token properly', async function () {
      expect((await this.module.tokens())[0]).to.equal(this.token.address);
    });

    it('should set minimum time bonus properly', async function () {
      expect(await this.module.vestingStart()).to.be.bignumber.equal(new BN(0));
    });

    it('should set time bonus period properly', async function () {
      expect(await this.module.vestingPeriod()).to.be.bignumber.equal(days(90));
    });

    it('should set owner to message sender', async function () {
      expect(await this.module.owner()).to.equal(owner);
    });

    it('should set have zero reward balances', async function () {
      expect((await this.module.balances())[0]).to.bignumber.equal(new BN(0));
    });

    it('should have zero usage ratio', async function () {
      expect(await this.module.usage()).to.be.bignumber.equal(new BN(0));
    });

    it('should set factory identifier properly', async function () {
      expect(await this.module.factory()).to.equal(this.factory.address);
    });

    it('report gas', async function () {
      reportGas('ERC20FriendlyRewardModuleFactory', 'createModule', '', this.res)
    });

  });

});
