// test module for ERC20BondStakingModuleFactory

const { artifacts, web3 } = require('hardhat');
const { BN, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const ERC20BondStakingModule = artifacts.require('ERC20BondStakingModule');
const ERC20BondStakingModuleFactory = artifacts.require('ERC20BondStakingModuleFactory');


describe('ERC20BondStakingModuleFactory', function () {
  let org, owner, alice, config;
  before(async function () {
    [org, owner, alice, config] = await web3.eth.getAccounts();
  });

  beforeEach('setup', async function () {
    this.factory = await ERC20BondStakingModuleFactory.new({ from: org });
  });

  describe('when constructor parameters are not encoded properly', function () {

    it('should fail', async function () {
      const data = "0x0de0b6b3a7640000"; // not a full 64 bytes
      await expectRevert(
        this.factory.createModule(config, data, { from: owner }),
        'bsmf1' // ERC20BondStakingModuleFactory: invalid data
      );
    });
  });

  describe('when a module is created with factory', function () {

    beforeEach(async function () {
      // encode bond period and burndown flag as bytes
      const data = web3.eth.abi.encodeParameters(
        ['uint256', 'bool'],
        ['86400', true]
      );

      // create module with factory
      this.res = await this.factory.createModule(config, data, { from: owner });
      this.addr = this.res.logs.filter(l => l.event === 'ModuleCreated')[0].args.module;
      this.module = await ERC20BondStakingModule.at(this.addr);
    });

    it('should set period', async function () {
      expect(await this.module.period()).to.bignumber.equal(new BN(86400));
    });

    it('should set burndown', async function () {
      expect(await this.module.burndown()).to.be.true;
    });

    it('should set factory identifier', async function () {
      expect(await this.module.factory()).to.equal(this.factory.address);
    });

    it('should set the initial nonce', async function () {
      expect(await this.module.nonce()).to.be.bignumber.equal(new BN(1));
    })

    it('should have empty list for total balances', async function () {
      expect((await this.module.totals()).length).to.equal(0);
    });

    it('should set owner to message sender', async function () {
      expect(await this.module.owner()).to.equal(owner);
    });

    it('should emit ModuleCreated event', async function () {
      expectEvent(this.res, 'ModuleCreated', { 'user': owner, 'module': this.addr });
    });

  });
});
