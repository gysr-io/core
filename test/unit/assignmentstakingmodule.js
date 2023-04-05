// unit tests for AssignmentStakingModule

const { artifacts, web3 } = require('hardhat');
const {
  BN,
  time,
  expectEvent,
  expectRevert,
  constants,
} = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const { rate, e6, bytes32 } = require('../util/helper');

const AssignmentStakingModule = artifacts.require('AssignmentStakingModule');

describe('AssignmentStakingModule', function () {
  let org, owner, controller, bob, alice, factory, other;
  before(async function () {
    [org, owner, controller, bob, alice, factory, other] = await web3.eth.getAccounts();
  });

  describe('construction', function () {
    describe('when initialized with valid constructor arguments', function () {
      beforeEach(async function () {
        this.module = await AssignmentStakingModule.new(factory, {
          from: owner,
        });
      });

      it('should create an AssignmentStakingModule object', async function () {
        expect(this.module).to.be.an('object');
        expect(this.module.constructor.name).to.be.equal('TruffleContract');
      });

      it('should set the owner to the sender address', async function () {
        expect(await this.module.owner()).to.equal(owner);
      });

      it('should return the correct token address', async function () {
        expect((await this.module.tokens())[0]).to.equal(
          constants.ZERO_ADDRESS
        );
      });

      it('should return the correct factory address', async function () {
        expect(await this.module.factory()).to.equal(factory);
      });

      it('should have zero user balances', async function () {
        expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(rate(0));
      });

      it('should have zero total balances', async function () {
        expect((await this.module.totals())[0]).to.be.bignumber.equal(rate(0));
      });
    });
  });

  describe('stake', function () {
    beforeEach('setup', async function () {
      // owner creates staking module
      this.module = await AssignmentStakingModule.new(factory, { from: owner });
    });

    describe('when caller does not own module', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.stake(owner, 1, [], { from: other }),
          'oc1' // OwnerController: caller is not the owner
        );
      });
    });

    describe('when caller user is not controller', function () {
      it('should fail', async function () {
        const data0 = web3.eth.abi.encodeParameter('address', alice);
        await expectRevert(
          this.module.stake(other, 1, data0, { from: owner }),
          'asm2'
        );
      });
    });

    describe('when invalid data is passed for address', function () {
      it('should fail', async function () {
        const data = web3.eth.abi.encodeParameters(
          ['uint256', 'uint256'],
          [11, 12]
        );
        await expectRevert(
          this.module.stake(owner, 100, data, { from: owner }),
          'asm3' // bad data
        );
      });
    });

    describe('when multiple users stake', function () {
      beforeEach('admin stakes alice and bob', async function () {
        const data0 = web3.eth.abi.encodeParameter('address', alice);
        this.res0 = await this.module.stake(owner, 100, data0, { from: owner });
        const data1 = web3.eth.abi.encodeParameter('address', bob);
        this.res1 = await this.module.stake(owner, 50, data1, { from: owner });
      });

      it('should update total staking balance', async function () {
        expect((await this.module.totals())[0]).to.be.bignumber.equal(
          new BN(150)
        );
      });

      it('should update staking balances for each user', async function () {
        expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(
          new BN(100)
        );
        expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(
          new BN(50)
        );
      });

      it('should emit each Staked event', async function () {
        expectEvent(this.res0, 'Staked', {
          account: bytes32(alice),
          user: owner,
          token: constants.ZERO_ADDRESS,
          amount: new BN(100),
          shares: e6(100),
        });
        expectEvent(this.res1, 'Staked', {
          account: bytes32(bob),
          user: owner,
          token: constants.ZERO_ADDRESS,
          amount: new BN(50),
          shares: e6(50),
        });
      });

    });

    describe('when user stakes multiple times', function () {
      beforeEach('admin stakes alice and then increases rate', async function () {
        const data0 = web3.eth.abi.encodeParameter('address', alice);
        this.res0 = await this.module.stake(owner, 100, data0, { from: owner });
        this.res1 = await this.module.stake(owner, 25, data0, { from: owner });
      });

      it('should update total staking balance', async function () {
        expect((await this.module.totals())[0]).to.be.bignumber.equal(new BN(125));
      });

      it('should update combined staking balance for user', async function () {
        expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(125));
      });

      it('should emit each Staked event', async function () {
        expectEvent(this.res0, 'Staked', {
          account: bytes32(alice),
          user: owner,
          token: constants.ZERO_ADDRESS,
          amount: new BN(100),
          shares: e6(100),
        });
        expectEvent(this.res1, 'Staked', {
          account: bytes32(alice),
          user: owner,
          token: constants.ZERO_ADDRESS,
          amount: new BN(25),
          shares: e6(25),
        });
      });
    });

  });


  describe('unstake', function () {
    beforeEach('setup', async function () {
      // owner creates staking module with Assignment token
      this.module = await AssignmentStakingModule.new(factory, { from: owner });

      const data0 = web3.eth.abi.encodeParameter('address', alice);
      this.res0 = await this.module.stake(owner, 100, data0, { from: owner });
      const data1 = web3.eth.abi.encodeParameter('address', bob);
      this.res1 = await this.module.stake(owner, 50, data1, { from: owner });
    });

    describe('when caller does not own module', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.unstake(owner, 1, [], { from: other }),
          'oc1' // OwnerController: caller is not the owner
        );
      });
    });

    describe('when caller user is not controller', function () {
      it('should fail', async function () {
        const data0 = web3.eth.abi.encodeParameter('address', alice);
        await expectRevert(
          this.module.unstake(other, 1, data0, { from: owner }),
          'asm5'
        );
      });
    });

    describe('when invalid data is passed for address', function () {
      it('should fail', async function () {
        const data = web3.eth.abi.encodeParameters(
          ['uint256', 'uint256'],
          [11, 12]
        );
        await expectRevert(
          this.module.unstake(owner, 100, data, { from: owner }),
          'asm6' // bad data
        );
      });
    });

    describe('when admin tries to unstake more than user balance', function () {
      it('should fail', async function () {
        const data0 = web3.eth.abi.encodeParameter('address', bob);
        await expectRevert(
          this.module.unstake(owner, 60, data0, { from: owner }),
          'asm7' // exceeds balance
        );
      });
    });

    describe("when admin unstakes all of a user's shares", function () {
      beforeEach(async function () {
        // unstake
        const data0 = web3.eth.abi.encodeParameter('address', alice);
        this.res = await this.module.unstake(owner, 100, data0, {
          from: owner,
        });
      });

      it('should update staking balance for user to zero', async function () {
        expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(0));
      });

      it('should update total staking balance', async function () {
        expect((await this.module.totals())[0]).to.be.bignumber.equal(new BN(50));
      });

      it('should not affect staking balances for other users', async function () {
        expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(new BN(50));
      });

      it('should emit Unstaked event', async function () {
        expectEvent(this.res, 'Unstaked', {
          account: bytes32(alice),
          user: owner,
          token: constants.ZERO_ADDRESS,
          amount: new BN(100),
          shares: e6(100),
        });
      });

    });

    describe("when admin unstakes some of a user's shares", function () {
      beforeEach(async function () {
        // unstake some
        const data0 = web3.eth.abi.encodeParameter('address', alice);
        this.res = await this.module.unstake(owner, 25, data0, { from: owner });
      });

      it('should update staking balance for user', async function () {
        expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(75));
      });

      it('should update total staking balance', async function () {
        expect((await this.module.totals())[0]).to.be.bignumber.equal(new BN(125));
      });

      it('should not affect staking balances for other users', async function () {
        expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(new BN(50));
      });

      it('should emit Unstaked event', async function () {
        expectEvent(this.res, 'Unstaked', {
          account: bytes32(alice),
          user: owner,
          token: constants.ZERO_ADDRESS,
          amount: new BN(25),
          shares: e6(25),
        });
      });
    });
  });

  describe('claim', function () {
    beforeEach('alice and bob stake', async function () {
      // owner creates staking module with Assignment token
      this.module = await AssignmentStakingModule.new(factory, { from: owner });

      const data0 = web3.eth.abi.encodeParameter('address', alice);
      this.res0 = await this.module.stake(owner, 100, data0, { from: owner });
      const data1 = web3.eth.abi.encodeParameter('address', bob);
      this.res1 = await this.module.stake(owner, 50, data1, { from: owner });
    });

    describe('when caller does not own module', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.claim(alice, new BN(1), [], { from: other }),
          'oc1' // OwnerController: caller is not the owner
        );
      });
    });

    describe('when user tries to claim more than their balance', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.claim(alice, 200, [], { from: owner }),
          'asm9' // exceeds balance
        );
      });
    });

    describe('when one user claims with all shares', function () {
      beforeEach(async function () {
        // claim
        this.res = await this.module.claim(alice, 100, [], { from: owner });
      });

      it('should not affect staking balance for user', async function () {
        expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(100));
      });

      it('should not affect total staking balance', async function () {
        expect((await this.module.totals())[0]).to.be.bignumber.equal(new BN(150));
      });

      it('should not affect staking balances for other users', async function () {
        expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(new BN(50));
      });

      it('should emit Claimed event with all shares', async function () {
        expectEvent(this.res, 'Claimed', {
          account: bytes32(alice),
          user: alice,
          token: constants.ZERO_ADDRESS,
          amount: new BN(100),
          shares: e6(100),
        });
      });
    });

    describe('when one user claims with some shares', function () {
      beforeEach(async function () {
        // claim
        this.res = await this.module.claim(alice, 25, [], { from: owner });
      });

      it('should not affect staking balance for user', async function () {
        expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(100));
      });

      it('should not affect total staking balance', async function () {
        expect((await this.module.totals())[0]).to.be.bignumber.equal(new BN(150));
      });

      it('should not affect staking balances for other users', async function () {
        expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(new BN(50));
      });

      it('should emit Claimed event with some shares', async function () {
        expectEvent(this.res, 'Claimed', {
          account: bytes32(alice),
          user: alice,
          token: constants.ZERO_ADDRESS,
          amount: new BN(25),
          shares: e6(25),
        });
      });
    });
  });
});
