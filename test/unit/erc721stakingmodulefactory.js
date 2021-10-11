// test module for ERC721StakingModuleFactory

const { accounts, contract, web3 } = require('@openzeppelin/test-environment');
const { BN, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const { reportGas } = require('../util/helper');

const ERC721StakingModule = contract.fromArtifact('ERC721StakingModule');
const ERC721StakingModuleFactory = contract.fromArtifact('ERC721StakingModuleFactory');
const TestERC721 = contract.fromArtifact('TestERC721');

describe('ERC721StakingModuleFactory', function () {
  const [owner, org, alice] = accounts;

  beforeEach('setup', async function () {
    this.factory = await ERC721StakingModuleFactory.new({ from: org });
    this.token = await TestERC721.new({ from: org });
  });

  describe('when constructor parameters are not encoded properly constructed', function () {

    it('should fail', async function () {
      const data = "0x0de0b6b3a7640000"; // not a full 32 bytes
      await expectRevert(
        this.factory.createModule(data, { from: owner }),
        'smnf1' // ERC721StakingModuleFactory: invalid data
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
      this.module = await ERC721StakingModule.at(this.addr);
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
      reportGas('ERC721StakingModuleFactory', 'createModule', '', this.res);
    });

  });

});
