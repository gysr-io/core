// unit tests for Configuration contract

const { artifacts, web3 } = require('hardhat');
const { BN, time, expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');
const { e18, toFixedPointBigNumber } = require('../util/helper');

const Configuration = artifacts.require('Configuration');


describe('Configuration', function () {
  let owner, controller, other, alice, bob;
  before(async function () {
    [owner, controller, other, alice, bob] = await web3.eth.getAccounts();
  });

  beforeEach('setup', async function () {
    this.config = await Configuration.new({ from: owner });
  });

  describe('construction', function () {

    describe('when created', function () {

      it('should initialize owner to sender', async function () {
        expect(await this.config.owner()).to.equal(owner);
      });

      it('should initialize controller to sender', async function () {
        expect(await this.config.controller()).to.equal(owner);
      });

    });
  });

  describe('uint256', function () {

    beforeEach(async function () {
      await this.config.transferControl(controller, { from: owner });
    });

    describe('when non controller tries to set value', function () {
      it('should fail', async function () {
        await expectRevert(
          this.config.setUint256(web3.utils.soliditySha3('config.test.number'), new BN(42), { from: alice }),
          'oc2' // OwnerController: caller is not the controller
        );
      });
    });

    describe('when uint256 parameter is set', function () {
      beforeEach(async function () {
        this.res = await this.config.setUint256(
          web3.utils.soliditySha3('config.test.number'),
          new BN(42),
          { from: controller }
        );
      });

      it('should update parameter to new uint256 value', async function () {
        expect(await this.config.getUint256(web3.utils.soliditySha3('config.test.number'))).to.be.bignumber.equal(new BN(42));
      });

      it('should emit ParameterUpdated event', async function () {
        expectEvent(
          this.res,
          'ParameterUpdated',
          { key: web3.utils.soliditySha3('config.test.number'), value: new BN(42) }
        );
      });

    });

  });


  describe('address', function () {

    beforeEach(async function () {
      await this.config.transferControl(controller, { from: owner });
    });

    describe('when non controller tries to set value', function () {
      it('should fail', async function () {
        await expectRevert(
          this.config.setAddress(web3.utils.soliditySha3('config.test.address'), other, { from: alice }),
          'oc2' // OwnerController: caller is not the controller
        );
      });
    });

    describe('when address parameter is set', function () {
      beforeEach(async function () {
        this.res = await this.config.setAddress(
          web3.utils.soliditySha3('config.test.address'),
          other,
          { from: controller }
        );
      });

      it('should update parameter to new address value', async function () {
        expect(await this.config.getAddress(web3.utils.soliditySha3('config.test.address'))).to.equal(other);
      });

      it('should emit ParameterUpdated event', async function () {
        expectEvent(
          this.res,
          'ParameterUpdated',
          { key: web3.utils.soliditySha3('config.test.address'), value: other }
        );
      });

    });

  });


  describe('address uint96', function () {

    beforeEach(async function () {
      await this.config.transferControl(controller, { from: owner });
    });

    describe('when non controller tries to set value', function () {
      it('should fail', async function () {
        await expectRevert(
          this.config.setAddressUint96(web3.utils.soliditySha3('config.test.pair'), other, new BN(42), { from: alice }),
          'oc2' // OwnerController: caller is not the controller
        );
      });
    });

    describe('when address uint96 parameter is set', function () {
      beforeEach(async function () {
        this.res = await this.config.setAddressUint96(
          web3.utils.soliditySha3('config.test.pair'),
          other,
          e18(0.12345),
          { from: controller }
        );
      });

      it('should pack address under config parameter', async function () {
        const res = await this.config.getAddressUint96(web3.utils.soliditySha3('config.test.pair'));
        expect(res[0]).to.equal(other);
      });

      it('should pack uint96 under config parameter', async function () {
        const res = await this.config.getAddressUint96(web3.utils.soliditySha3('config.test.pair'));
        expect(res[1]).to.be.bignumber.equal(e18(0.12345));
      });

      it('should emit ParameterUpdated event', async function () {
        expectEvent(
          this.res,
          'ParameterUpdated',
          { key: web3.utils.soliditySha3('config.test.pair'), value0: other, value1: e18(0.12345) }
        );
      });

    });

  });


  describe('override', function () {

    beforeEach(async function () {
      await this.config.transferControl(controller, { from: owner });
      await this.config.setUint256(
        web3.utils.soliditySha3('config.test.number'),
        new BN(42),
        { from: controller }
      );
      await this.config.setAddress(
        web3.utils.soliditySha3('config.test.address'),
        bob,
        { from: controller }
      );
      await this.config.setAddressUint96(
        web3.utils.soliditySha3('config.test.pair'),
        bob,
        e18(0.12345),
        { from: controller }
      );
    });

    describe('when non controller tries to set uint256 override', function () {
      it('should fail', async function () {
        await expectRevert(
          this.config.overrideUint256(alice, web3.utils.soliditySha3('config.test.number'), new BN(123), { from: alice }),
          'oc2' // OwnerController: caller is not the controller
        );
      });
    });

    describe('when non controller tries to set address override', function () {
      it('should fail', async function () {
        await expectRevert(
          this.config.overrideAddress(alice, web3.utils.soliditySha3('config.test.address'), bob, { from: alice }),
          'oc2' // OwnerController: caller is not the controller
        );
      });
    });

    describe('when non controller tries to set address uint96 override', function () {
      it('should fail', async function () {
        await expectRevert(
          this.config.overrideAddressUint96(alice, web3.utils.soliditySha3('config.test.pair'), bob, new BN(123), { from: alice }),
          'oc2' // OwnerController: caller is not the controller
        );
      });
    });

    describe('when uint256 parameter is overriden', function () {
      beforeEach(async function () {
        this.res = await this.config.overrideUint256(
          alice,
          web3.utils.soliditySha3('config.test.number'),
          new BN(123),
          { from: controller }
        );
      });

      it('should return override number value for special caller', async function () {
        expect(await this.config.getUint256(web3.utils.soliditySha3('config.test.number'), { from: alice }))
          .to.be.bignumber.equal(new BN(123));
      });

      it('should return normal value for other callers', async function () {
        expect(await this.config.getUint256(web3.utils.soliditySha3('config.test.number')))
          .to.be.bignumber.equal(new BN(42));
      });

      it('should emit ParameterOverridden event', async function () {
        expectEvent(
          this.res,
          'ParameterOverridden',
          { caller: alice, key: web3.utils.soliditySha3('config.test.number'), value: new BN(123) }
        );
      });

    });

    describe('when address parameter is overriden', function () {
      beforeEach(async function () {
        this.res = await this.config.overrideAddress(
          alice,
          web3.utils.soliditySha3('config.test.address'),
          other,
          { from: controller }
        );
      });

      it('should return override address value for special caller', async function () {
        expect(await this.config.getAddress(web3.utils.soliditySha3('config.test.address'), { from: alice })).to.equal(other);
      });

      it('should return normal value for other callers', async function () {
        expect(await this.config.getAddress(web3.utils.soliditySha3('config.test.address'))).to.equal(bob);
      });

      it('should emit ParameterOverridden event', async function () {
        expectEvent(
          this.res,
          'ParameterOverridden',
          { caller: alice, key: web3.utils.soliditySha3('config.test.address'), value: other }
        );
      });

    });


    describe('when address uint96 parameter is overriden', function () {
      beforeEach(async function () {
        this.res = await this.config.overrideAddressUint96(
          alice,
          web3.utils.soliditySha3('config.test.pair'),
          other,
          e18(0.011111),
          { from: controller }
        );
      });

      it('should return override packed address for special caller', async function () {
        const res = await this.config.getAddressUint96(web3.utils.soliditySha3('config.test.pair'), { from: alice });
        expect(res[0]).to.equal(other);
      });

      it('should return override packed uint96 for special caller', async function () {
        const res = await this.config.getAddressUint96(web3.utils.soliditySha3('config.test.pair'), { from: alice });
        expect(res[1]).to.be.bignumber.equal(e18(0.011111));
      });

      it('should return normal packed address for other callers', async function () {
        const res = await this.config.getAddressUint96(web3.utils.soliditySha3('config.test.pair'));
        expect(res[0]).to.equal(bob);
      });

      it('should return normal packed uint96 for other callers', async function () {
        const res = await this.config.getAddressUint96(web3.utils.soliditySha3('config.test.pair'));
        expect(res[1]).to.be.bignumber.equal(e18(0.12345));
      });

      it('should emit ParameterOverridden event', async function () {
        expectEvent(
          this.res,
          'ParameterOverridden',
          { caller: alice, key: web3.utils.soliditySha3('config.test.pair'), value0: other, value1: e18(0.011111) }
        );
      });

    });

  });

});
