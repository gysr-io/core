// test module for ERC20StakingModuleFactory

const { accounts, contract, web3 } = require('@openzeppelin/test-environment');
const { BN, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const { reportGas } = require('../util/helper');

const ERC20StakingModule = contract.fromArtifact('ERC20StakingModule');
const ERC20StakingModuleFactory = contract.fromArtifact('ERC20StakingModuleFactory');
const TestToken = contract.fromArtifact('TestToken');


describe('ERC20StakingModuleFactory', function () {
  const [owner, org, alice] = accounts;

  beforeEach('setup', async function () {
    this.factory = await ERC20StakingModuleFactory.new({ from: org });
    this.token = await TestToken.new({ from: org });
  });

  describe('when constructor parameters are not encoded properly constructed', function () {

    it('should fail', async function () {
      const data = "0x0de0b6b3a7640000"; // not a full 32 bytes
      await expectRevert(
        this.factory.createModule(data, { from: owner }),
        'smf1' // ERC20StakingModuleFactory: invalid data
      );
    });
  });

  describe('when a module is created with factory', function () {

    beforeEach(async function () {
      // encode staking token as bytes
      const data = web3.eth.abi.encodeParameter('address', this.token.address);

      // create module with factory
      this.res = await this.factory.createModule(data, { from: owner });
      this.addr = this.res.logs.filter(l => l.event === 'ModuleCreated')[0].args.module;
      this.module = await ERC20StakingModule.at(this.addr);
    });

    it('should emit ModuleCreated event', async function () {
      expectEvent(this.res, 'ModuleCreated', { 'user': owner, 'module': this.addr });
    });

    it('should set staking token properly', async function () {
      expect((await this.module.tokens())[0]).to.equal(this.token.address);
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
      reportGas('ERC20StakingModuleFactory', 'createModule', '', this.res);
    });

  });

});
