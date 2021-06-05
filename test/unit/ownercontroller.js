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

      it('should initialize owner to sender', async function () {
        expect(await this.contract.owner()).to.equal(owner);
      });

      it('should initialize controller to sender', async function () {
        expect(await this.contract.controller()).to.equal(owner);
      });

    });
  });

  describe('ownership', function () {

    beforeEach(async function () {
      await this.contract.transferControl(controller, { from: owner });
    });

    describe('when owner transfers ownership', function () {
      beforeEach(async function () {
        this.res = await this.contract.transferOwnership(alice, { from: owner });
      });

      it('should update owner to new address', async function () {
        expect(await this.contract.owner()).to.equal(alice);
      });

      it('should not change controller', async function () {
        expect(await this.contract.controller()).to.equal(controller);
      });

      it('should emit OwnershipTransferred event', async function () {
        expectEvent(
          this.res,
          'OwnershipTransferred',
          { previousOwner: owner, newOwner: alice }
        );
      });

    });

    describe('when controller tries to transfer ownership', function () {
      it('should fail', async function () {
        await expectRevert(
          this.contract.transferOwnership(alice, { from: controller }),
          'oc1' // OwnerController: caller is not the owner
        );
      });
    });

    describe('when other account tries to transfer ownership', function () {
      it('should fail', async function () {
        await expectRevert(
          this.contract.transferOwnership(bob, { from: bob }),
          'oc1' // OwnerController: caller is not the owner
        );
      });
    });

    describe('when owner tries to transfer ownership to zero address', function () {
      it('should fail', async function () {
        await expectRevert(
          this.contract.transferOwnership(constants.ZERO_ADDRESS, { from: owner }),
          'oc3' // OwnerController: new owner is zero address
        );
      });
    });

  });

  describe('control', function () {

    beforeEach(async function () {
      await this.contract.transferControl(controller, { from: owner });
    });

    describe('when owner transfers control', function () {
      beforeEach(async function () {
        this.res = await this.contract.transferControl(alice, { from: owner });
      });

      it('should update controller to new address', async function () {
        expect(await this.contract.controller()).to.equal(alice);
      });

      it('should not change owner', async function () {
        expect(await this.contract.owner()).to.equal(owner);
      });

      it('should emit ControlTransferred event', async function () {
        expectEvent(
          this.res,
          'ControlTransferred',
          { previousController: controller, newController: alice }
        );
      });

    });

    describe('when controller tries to transfer control', function () {
      it('should fail', async function () {
        await expectRevert(
          this.contract.transferControl(alice, { from: controller }),
          'oc1' // OwnerController: caller is not the owner
        );
      });
    });

    describe('when other account tries to transfer ownership', function () {
      it('should fail', async function () {
        await expectRevert(
          this.contract.transferControl(bob, { from: bob }),
          'oc1' // OwnerController: caller is not the owner
        );
      });
    });

    describe('when owner tries to transfer ownership to zero address', function () {
      it('should fail', async function () {
        await expectRevert(
          this.contract.transferControl(constants.ZERO_ADDRESS, { from: owner }),
          'oc4' // OwnerController: new controller is zero address
        );
      });
    });

  });

});
