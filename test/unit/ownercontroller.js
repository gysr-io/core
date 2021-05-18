// unit tests for OwnerController contract

const { accounts, contract } = require('@openzeppelin/test-environment');
const { BN, time, expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const OwnerController = contract.fromArtifact('OwnerController');


describe('OwnerController', function () {
  const [owner, controller, bob, alice] = accounts;

  beforeEach('setup', async function () {
    this.contract = await OwnerController.new({ from: owner });
  });

  describe('construction', function () {

    describe('when created', function () {
      beforeEach(async function () {

      });

      it('should initialize owner to sender', async function () {
        expect(await this.contract.owner()).to.equal(owner);
      });

      it('should initialize controller to sender', async function () {
        expect(await this.contract.controller()).to.equal(owner);
      });

    });
  });

});
