// test module for AssignmentStakingModuleFactory

const { artifacts, web3 } = require('hardhat');
const { BN, expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const { reportGas } = require('../util/helper');

const AssignmentStakingModule = artifacts.require('AssignmentStakingModule');
const AssignmentStakingModuleFactory = artifacts.require('AssignmentStakingModuleFactory');

describe('AssignmentStakingModuleFactory', function () {
  let org, owner, alice, config;
  before(async function () {
    [org, owner, alice, config] = await web3.eth.getAccounts();
  });

  beforeEach('setup', async function () {
    this.factory = await AssignmentStakingModuleFactory.new({ from: org });
  });

  describe('when a module is created with factory', function () {

    beforeEach(async function () {
      // create module with factory
      this.res = await this.factory.createModule(config, [], { from: owner });
      this.addr = this.res.logs.filter(l => l.event === 'ModuleCreated')[0].args.module;
      this.module = await AssignmentStakingModule.at(this.addr);
    });

    it('should emit ModuleCreated event', async function () {
      expectEvent(this.res, 'ModuleCreated', { 'user': owner, 'module': this.addr });
    });

    it('should set staking token properly', async function () {
      expect((await this.module.tokens())[0]).to.equal(constants.ZERO_ADDRESS);
    });

    it('should set owner to message sender', async function () {
      expect(await this.module.owner()).to.equal(owner);
    });

    it('should set have zero user balance', async function () {
      expect((await this.module.balances(alice))[0]).to.bignumber.equal(new BN(0));
    });

    it('should set have zero total balance', async function () {
      expect((await this.module.totals())[0]).to.bignumber.equal(new BN(0));
    });

    it('should set factory identifier properly', async function () {
      expect(await this.module.factory()).to.equal(this.factory.address);
    });

    it('gas cost', async function () {
      reportGas('AssignmentStakingModuleFactory', 'createModule', '', this.res);
    });

  });

});
