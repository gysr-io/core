// unit tests for ERC20StakingModule

const { accounts, contract, web3 } = require('@openzeppelin/test-environment');
const { BN, time, expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const {
  tokens,
  bonus,
  days,
  shares,
  toFixedPointBigNumber,
  fromFixedPointBigNumber,
  fromBonus,
  fromTokens,
  DECIMALS
} = require('../util/helper');

const ERC20StakingModule = contract.fromArtifact('ERC20StakingModule');
const TestToken = contract.fromArtifact('TestToken');
const TestElasticToken = contract.fromArtifact('TestElasticToken')
const TestFeeToken = contract.fromArtifact('TestFeeToken');
const TestIndivisibleToken = contract.fromArtifact('TestIndivisibleToken');


// tolerance
const TOKEN_DELTA = toFixedPointBigNumber(0.000001, 10, DECIMALS);
const SHARE_DELTA = toFixedPointBigNumber(0.000001 * (10 ** 6), 10, DECIMALS);


describe('ERC20StakingModule', function () {
  const [org, owner, controller, bob, alice, factory] = accounts;

  beforeEach('setup', async function () {
    this.token = await TestToken.new({ from: org });
  });

  describe('construction', function () {

    describe('when initialized with valid constructor arguments', function () {
      beforeEach(async function () {
        this.module = await ERC20StakingModule.new(
          this.token.address,
          factory,
          { from: owner }
        );
      });
      it('should create an ERC20StakingModule object', async function () {
        expect(this.module).to.be.an('object');
        expect(this.module.constructor.name).to.be.equal('TruffleContract');
      });

      it('should set the owner to the sender address', async function () {
        expect(await this.module.owner()).to.equal(owner);
      });

      it('should return the correct token address', async function () {
        expect((await this.module.tokens())[0]).to.equal(this.token.address);
      });

      it('should return the correct factory address', async function () {
        expect(await this.module.factory()).to.equal(factory);
      });

      it('should have zero user balances', async function () {
        expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(new BN(0));
      });

      it('should have zero total balances', async function () {
        expect((await this.module.totals())[0]).to.be.bignumber.equal(new BN(0));
      });

      it('should have zero total staking shares', async function () {
        expect(await this.module.totalShares()).to.be.bignumber.equal(new BN(0));
      });
    })
  });

  describe('staking with standard token', function () {
    const [owner, org, treasury, alice, bob, other] = accounts;

    beforeEach('setup', async function () {
      // owner creates staking module with standard token
      this.token = await TestToken.new({ from: org });
      this.module = await ERC20StakingModule.new(
        this.token.address,
        factory,
        { from: owner }
      );

      // acquire staking tokens and approval
      await this.token.transfer(alice, tokens(1000), { from: org });
      await this.token.transfer(bob, tokens(1000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: alice });
      await this.token.approve(this.module.address, tokens(100000), { from: bob });
    });

    describe('stake', function () {

      describe('when caller does not own module', function () {
        it('should fail', async function () {
          await expectRevert(
            this.module.stake(bob, tokens(100), [], { from: other }),
            'oc1' // OwnerController: caller is not the owner
          );
        });
      });

      describe('when sender tries to stake more than their balance', function () {
        it('should fail', async function () {
          await expectRevert(
            this.module.stake(bob, tokens(1001), [], { from: owner }),
            'ERC20: transfer amount exceeds balance.'
          );
        });
      });


      describe('when multiple users stake', function () {

        beforeEach('alice and bob stake', async function () {
          this.res0 = await this.module.stake(alice, tokens(100), [], { from: owner });
          this.res1 = await this.module.stake(bob, tokens(200), [], { from: owner });
        });

        it('should decrease each user token balance', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(tokens(900));
          expect(await this.token.balanceOf(bob)).to.be.bignumber.equal(tokens(800));
        });

        it('should update total staking balance', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(300));
        });

        it('should update staking balances for each user', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(tokens(100));
          expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(tokens(200));
        });

        it('should update the total staking shares for each user', async function () {
          expect(await this.module.shares(alice)).to.be.bignumber.equal(shares(100));
          expect(await this.module.shares(bob)).to.be.bignumber.equal(shares(200));
        });

        it('should combine to increase the total staking shares', async function () {
          expect(await this.module.totalShares()).to.be.bignumber.equal(shares(300));
        });

        it('should emit each Staked event', async function () {
          expectEvent(
            this.res0,
            'Staked',
            { user: alice, token: this.token.address, amount: tokens(100), shares: shares(100) }
          );
          expectEvent(
            this.res1,
            'Staked',
            { user: bob, token: this.token.address, amount: tokens(200), shares: shares(200) }
          );
        });

      });

    });


    describe('unstake', function () {

      beforeEach('alice and bob stake', async function () {
        // alice and bob stake
        await this.module.stake(alice, tokens(100), [], { from: owner });
        await this.module.stake(bob, tokens(200), [], { from: owner });

        // advance time
        await time.increase(days(30));
      });

      describe('when caller does not own module', function () {
        it('should fail', async function () {
          await expectRevert(
            this.module.unstake(alice, tokens(100), [], { from: other }),
            'oc1' // OwnerController: caller is not the owner
          );
        });
      });

      describe('when user tries to unstake more than their balance', function () {
        it('should fail', async function () {
          await expectRevert(
            this.module.unstake(alice, tokens(101), [], { from: owner }),
            'sm6' // ERC20StakingModule: unstake amount exceeds balance
          );
        });
      });

      describe('when one user unstakes all shares', function () {

        beforeEach(async function () {
          // unstake
          this.res = await this.module.unstake(alice, tokens(100), [], { from: owner });
        });

        it('should return staking token to user balance', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(tokens(1000));
        });

        it('should update staking balance for user to zero', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(0));
        });

        it('should update total staking balance', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(200));
        });

        it('should not affect staking balances for other users', async function () {
          expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(tokens(200));
        });

        it('should update the total staking shares for user to zero', async function () {
          expect(await this.module.shares(alice)).to.be.bignumber.equal(new BN(0));
        });

        it('should update the total staking shares', async function () {
          expect(await this.module.totalShares()).to.be.bignumber.equal(shares(200));
        });

        it('should emit Unstaked event', async function () {
          expectEvent(
            this.res,
            'Unstaked',
            { user: alice, token: this.token.address, amount: tokens(100), shares: shares(100) }
          );
        });

      });

      describe('when one user unstakes some shares', function () {

        beforeEach(async function () {
          // unstake
          this.res = await this.module.unstake(alice, tokens(75), [], { from: owner });
        });

        it('should return some staking token to user balance', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(tokens(975));
        });

        it('should update staking balance for user', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(tokens(25));
        });

        it('should update total staking balance', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(225));
        });

        it('should not affect staking balances for other users', async function () {
          expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(tokens(200));
        });

        it('should update the total staking shares for user', async function () {
          expect(await this.module.shares(alice)).to.be.bignumber.equal(shares(25));
        });

        it('should update the total staking shares', async function () {
          expect(await this.module.totalShares()).to.be.bignumber.equal(shares(225));
        });

        it('should emit Unstaked event', async function () {
          expectEvent(
            this.res,
            'Unstaked',
            { user: alice, token: this.token.address, amount: tokens(75), shares: shares(75) }
          );
        });

      });
    });

    describe('claim', function () {

      beforeEach('alice and bob stake', async function () {
        // alice and bob stake
        await this.module.stake(alice, tokens(100), [], { from: owner });
        await this.module.stake(bob, tokens(200), [], { from: owner });

        // advance time
        await time.increase(days(30));
      });

      describe('when caller does not own module', function () {
        it('should fail', async function () {
          await expectRevert(
            this.module.claim(alice, tokens(100), [], { from: other }),
            'oc1' // OwnerController: caller is not the owner
          );
        });
      });

      describe('when user tries to claim more than their balance', function () {
        it('should fail', async function () {
          await expectRevert(
            this.module.claim(alice, tokens(101), [], { from: owner }),
            'sm6' // ERC20StakingModule: unstake amount exceeds balance
          );
        });
      });

      describe('when one user claims with all shares', function () {

        beforeEach(async function () {
          // claim
          this.res = await this.module.claim(alice, tokens(100), [], { from: owner });
        });

        it('should not return staking token to user balance', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(tokens(900));
        });

        it('should not affect staking balance for user', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(tokens(100));
        });

        it('should not affect total staking balance', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(300));
        });

        it('should not affect staking balances for other users', async function () {
          expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(tokens(200));
        });

        it('should not affect the total staking shares for user', async function () {
          expect(await this.module.shares(alice)).to.be.bignumber.equal(shares(100));
        });

        it('should not affect the total staking shares', async function () {
          expect(await this.module.totalShares()).to.be.bignumber.equal(shares(300));
        });

        it('should emit Claimed event with all shares', async function () {
          expectEvent(
            this.res,
            'Claimed',
            { user: alice, token: this.token.address, amount: tokens(100), shares: shares(100) }
          );
        });

      });

      describe('when one user claims with some shares', function () {

        beforeEach(async function () {
          // claim
          this.res = await this.module.claim(alice, tokens(75), [], { from: owner });
        });

        it('should not return staking token to user balance', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(tokens(900));
        });

        it('should not affect staking balance for user', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(tokens(100));
        });

        it('should not affect total staking balance', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(300));
        });

        it('should not affect staking balances for other users', async function () {
          expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(tokens(200));
        });

        it('should not affect the total staking shares for user', async function () {
          expect(await this.module.shares(alice)).to.be.bignumber.equal(shares(100));
        });

        it('should not affect the total staking shares', async function () {
          expect(await this.module.totalShares()).to.be.bignumber.equal(shares(300));
        });

        it('should emit Claimed event with some shares', async function () {
          expectEvent(
            this.res,
            'Claimed',
            { user: alice, token: this.token.address, amount: tokens(75), shares: shares(75) }
          );
        });

      });
    });

  });


  describe('staking with indivisible token', function () {

    beforeEach('setup', async function () {
      // owner creates staking module with indivisible token
      this.token = await TestIndivisibleToken.new({ from: org });
      this.module = await ERC20StakingModule.new(
        this.token.address,
        factory,
        { from: owner }
      );

      // acquire staking tokens and approval
      await this.token.transfer(alice, new BN(10), { from: org });
      await this.token.transfer(bob, new BN(10), { from: org });
      await this.token.approve(this.module.address, new BN(1000), { from: alice });
      await this.token.approve(this.module.address, new BN(1000), { from: bob });
    });

    describe('stake', function () {

      describe('when multiple users stake', function () {

        beforeEach('alice and bob stake', async function () {
          this.res0 = await this.module.stake(alice, new BN(1), [], { from: owner });
          this.res1 = await this.module.stake(bob, new BN(5), [], { from: owner });
        });

        it('should decrease each user token balance', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(new BN(9));
          expect(await this.token.balanceOf(bob)).to.be.bignumber.equal(new BN(5));
        });

        it('should update total staking balance', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(new BN(6));
        });

        it('should update staking balances for each user', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(1));
          expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(new BN(5));
        });

        it('should update the total staking shares for each user', async function () {
          expect(await this.module.shares(alice)).to.be.bignumber.equal(new BN(1).mul(new BN(10 ** 6)));
          expect(await this.module.shares(bob)).to.be.bignumber.equal(new BN(5).mul(new BN(10 ** 6)));
        });

        it('should combine to increase the total staking shares', async function () {
          expect(await this.module.totalShares()).to.be.bignumber.equal(new BN(6).mul(new BN(10 ** 6)));
        });

        it('should emit each Staked event', async function () {
          expectEvent(
            this.res0,
            'Staked',
            { user: alice, token: this.token.address, amount: new BN(1), shares: new BN(10 ** 6) }
          );
          expectEvent(
            this.res1,
            'Staked',
            { user: bob, token: this.token.address, amount: new BN(5), shares: new BN(5).mul(new BN(10 ** 6)) }
          );
        });

      });

    });


    describe('unstake', function () {

      beforeEach('alice and bob stake', async function () {
        // alice and bob stake
        await this.module.stake(alice, new BN(3), [], { from: owner });
        await this.module.stake(bob, new BN(5), [], { from: owner });

        // advance time
        await time.increase(days(30));
      });

      describe('when one user unstakes all shares', function () {

        beforeEach(async function () {
          // unstake
          this.res = await this.module.unstake(alice, new BN(3), [], { from: owner });
        });

        it('should return staking token to user balance', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(new BN(10));
        });

        it('should update staking balance for user to zero', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(0));
        });

        it('should update total staking balance', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(new BN(5));
        });

        it('should not affect staking balances for other users', async function () {
          expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(new BN(5));
        });

        it('should update the total staking shares for user to zero', async function () {
          expect(await this.module.shares(alice)).to.be.bignumber.equal(new BN(0));
        });

        it('should update the total staking shares', async function () {
          expect(await this.module.totalShares()).to.be.bignumber.equal(new BN(5).mul(new BN(10 ** 6)));
        });

        it('should emit Unstaked event', async function () {
          expectEvent(
            this.res,
            'Unstaked',
            { user: alice, token: this.token.address, amount: new BN(3), shares: new BN(3).mul(new BN(10 ** 6)) }
          );
        });

      });

      describe('when one user unstakes some shares', function () {

        beforeEach(async function () {
          // unstake
          this.res = await this.module.unstake(alice, new BN(1), [], { from: owner });
        });

        it('should return some staking token to user balance', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(new BN(8));
        });

        it('should update staking balance for user', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(2));
        });

        it('should update total staking balance', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(new BN(7));
        });

        it('should not affect staking balances for other users', async function () {
          expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(new BN(5));
        });

        it('should update the total staking shares for user', async function () {
          expect(await this.module.shares(alice)).to.be.bignumber.equal(new BN(2).mul(new BN(10 ** 6)));
        });

        it('should update the total staking shares', async function () {
          expect(await this.module.totalShares()).to.be.bignumber.equal(new BN(7).mul(new BN(10 ** 6)));
        });

        it('should emit Unstaked event', async function () {
          expectEvent(
            this.res,
            'Unstaked',
            { user: alice, token: this.token.address, amount: new BN(1), shares: new BN(10 ** 6) }
          );
        });

      });

    });

    describe('claim', function () {

      beforeEach('alice and bob stake', async function () {
        // alice and bob stake
        await this.module.stake(alice, new BN(3), [], { from: owner });
        await this.module.stake(bob, new BN(5), [], { from: owner });

        // advance time
        await time.increase(days(30));
      });

      describe('when one user claims with all shares', function () {

        beforeEach(async function () {
          // claim
          this.res = await this.module.claim(alice, new BN(3), [], { from: owner });
        });

        it('should not return staking token to user balance', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(new BN(7));
        });

        it('should not affect staking balance for user', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(3));
        });

        it('should not affect the total staking shares for user', async function () {
          expect(await this.module.shares(alice)).to.be.bignumber.equal(new BN(3).mul(new BN(10 ** 6)));
        });

        it('should emit Claimed event with all shares', async function () {
          expectEvent(
            this.res,
            'Claimed',
            { user: alice, token: this.token.address, amount: new BN(3), shares: new BN(3).mul(new BN(10 ** 6)) }
          );
        });

      });

      describe('when one user claims with some shares', function () {

        beforeEach(async function () {
          // claim
          this.res = await this.module.claim(alice, new BN(1), [], { from: owner });
        });


        it('should not return staking token to user balance', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(new BN(7));
        });

        it('should not affect staking balance for user', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(3));
        });

        it('should not affect the total staking shares for user', async function () {
          expect(await this.module.shares(alice)).to.be.bignumber.equal(new BN(3).mul(new BN(10 ** 6)));
        });

        it('should emit Claimed event with all shares', async function () {
          expectEvent(
            this.res,
            'Claimed',
            { user: alice, token: this.token.address, amount: new BN(1), shares: new BN(10 ** 6) }
          );
        });

      });
    });
  });


  describe('staking with elastic token', function () {

    beforeEach('setup', async function () {
      // owner creates staking module with elastic token
      this.token = await TestElasticToken.new({ from: org });
      this.module = await ERC20StakingModule.new(
        this.token.address,
        factory,
        { from: owner }
      );

      // acquire staking tokens and approval
      await this.token.transfer(alice, tokens(1000), { from: org });
      await this.token.transfer(bob, tokens(1000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: alice });
      await this.token.approve(this.module.address, tokens(100000), { from: bob });
    });

    describe('stake', function () {

      describe('when supply expands', function () {

        beforeEach(async function () {
          // alice stakes
          this.res0 = await this.module.stake(alice, tokens(100), [], { from: owner });

          // expand elastic supply
          await this.token.setCoefficient(toFixedPointBigNumber(1.1, 10, 18));

          // bob stakes
          this.res1 = await this.module.stake(bob, tokens(100), [], { from: owner });
        });

        it('should decrease then expand elastic token balance of first user', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(tokens(990), TOKEN_DELTA);
        });

        it('should expand then decrease elastic token balance of second user', async function () {
          expect(await this.token.balanceOf(bob)).to.be.bignumber.closeTo(tokens(1000), TOKEN_DELTA);
        });

        it('should increase total staked', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.closeTo(tokens(210), TOKEN_DELTA);
        });

        it('should increase staking balance for users who staked before expansion', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.closeTo(tokens(110), TOKEN_DELTA);
        });

        it('should not change staking balance for users who staked after expansion', async function () {
          expect((await this.module.balances(bob))[0]).to.be.bignumber.closeTo(tokens(100), TOKEN_DELTA);
        });

        it('should not change previously minted shares', async function () {
          expect(await this.module.shares(alice)).to.be.bignumber.closeTo(shares(100), SHARE_DELTA);
        });

        it('should mint new shares at lower rate', async function () {
          expect(await this.module.shares(bob)).to.be.bignumber.closeTo(shares(100 / 1.1), SHARE_DELTA);
        });

        it('should combine to increase the total staking shares', async function () {
          expect(await this.module.totalShares()).to.be.bignumber.closeTo(shares(100 + 100 / 1.1), SHARE_DELTA);
        });

        it('should emit Staked event before expansion with normal shares', async function () {
          const e0 = this.res0.logs.filter(l => l.event === 'Staked')[0];
          expect(e0.args.user).eq(alice);
          expect(e0.args.token).eq(this.token.address);
          expect(e0.args.amount).to.be.bignumber.closeTo(tokens(100), TOKEN_DELTA);
          expect(e0.args.shares).to.be.bignumber.closeTo(shares(100), SHARE_DELTA);
        });

        it('should emit Staked event after expansion with reduced shares', async function () {
          const e1 = this.res1.logs.filter(l => l.event === 'Staked')[0];
          expect(e1.args.user).eq(bob);
          expect(e1.args.token).eq(this.token.address);
          expect(e1.args.amount).to.be.bignumber.closeTo(tokens(100), TOKEN_DELTA);
          expect(e1.args.shares).to.be.bignumber.closeTo(shares(100 / 1.1), SHARE_DELTA);
        });

      });

      describe('when supply decreases', function () {

        beforeEach(async function () {
          // alice stakes
          this.res0 = await this.module.stake(alice, tokens(100), [], { from: owner });

          // shrink elastic supply
          await this.token.setCoefficient(toFixedPointBigNumber(0.75, 10, 18));

          // bob stakes
          this.res1 = await this.module.stake(bob, tokens(100), [], { from: owner });
        });

        it('should decrease then shrink elastic token balance of first user', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(tokens(675), TOKEN_DELTA);
        });

        it('should shrink then decrease elastic token balance of second user', async function () {
          expect(await this.token.balanceOf(bob)).to.be.bignumber.closeTo(tokens(650), TOKEN_DELTA);
        });

        it('should shrink total staked', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.closeTo(tokens(175), TOKEN_DELTA);
        });

        it('should decrease staking balance for users who staked before shrinking', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.closeTo(tokens(75), TOKEN_DELTA);
        });

        it('should not change staking balance for users who staked after shrinking', async function () {
          expect((await this.module.balances(bob))[0]).to.be.bignumber.closeTo(tokens(100), TOKEN_DELTA);
        });

        it('should not change previously minted shares', async function () {
          expect(await this.module.shares(alice)).to.be.bignumber.closeTo(shares(100), SHARE_DELTA);
        });

        it('should mint new shares at higher rate', async function () {
          expect(await this.module.shares(bob)).to.be.bignumber.closeTo(shares(100 / 0.75), SHARE_DELTA);
        });

        it('should combine to increase the total staking shares', async function () {
          expect(await this.module.totalShares()).to.be.bignumber.closeTo(shares(100 + 100 / 0.75), SHARE_DELTA);
        });

        it('should emit Staked event before shrinking with normal shares', async function () {
          const e0 = this.res0.logs.filter(l => l.event === 'Staked')[0];
          expect(e0.args.user).eq(alice);
          expect(e0.args.token).eq(this.token.address);
          expect(e0.args.amount).to.be.bignumber.closeTo(tokens(100), TOKEN_DELTA);
          expect(e0.args.shares).to.be.bignumber.closeTo(shares(100), SHARE_DELTA);
        });

        it('should emit Staked event after shrinking with higher shares', async function () {
          const e1 = this.res1.logs.filter(l => l.event === 'Staked')[0];
          expect(e1.args.user).eq(bob);
          expect(e1.args.token).eq(this.token.address);
          expect(e1.args.amount).to.be.bignumber.closeTo(tokens(100), TOKEN_DELTA);
          expect(e1.args.shares).to.be.bignumber.closeTo(shares(100 / 0.75), SHARE_DELTA);
        });

      });

    });


    describe('unstake', function () {

      describe('when supply expands', function () {

        beforeEach(async function () {
          // alice stakes
          await this.module.stake(alice, tokens(100), [], { from: owner });

          // expand elastic supply
          await this.token.setCoefficient(toFixedPointBigNumber(1.1, 10, 18));

          // bob stakes
          await this.module.stake(bob, tokens(100), [], { from: owner });

          // advance time
          await time.increase(days(30));

          // alice unstakes all
          const amount = (await this.module.balances(alice))[0];
          this.res = await this.module.unstake(alice, amount, [], { from: owner });
        });

        it('should return staking token to user balance', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(tokens(1100), TOKEN_DELTA);
        });

        it('should update staking balance for user to zero', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(0));
        });

        it('should update total staking balance', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.closeTo(tokens(100), TOKEN_DELTA);
        });

        it('should not affect staking balances for other users', async function () {
          expect((await this.module.balances(bob))[0]).to.be.bignumber.closeTo(tokens(100), TOKEN_DELTA);
        });

        it('should update the total staking shares for user to zero', async function () {
          expect(await this.module.shares(alice)).to.be.bignumber.equal(new BN(0));
        });

        it('should update the total staking shares', async function () {
          expect(await this.module.totalShares()).to.be.bignumber.closeTo(shares(100 / 1.1), SHARE_DELTA);
        });

        it('should emit Unstaked event with increased amount and original shares', async function () {
          const e0 = this.res.logs.filter(l => l.event === 'Unstaked')[0];
          expect(e0.args.user).eq(alice);
          expect(e0.args.token).eq(this.token.address);
          expect(e0.args.amount).to.be.bignumber.closeTo(tokens(110), TOKEN_DELTA);
          expect(e0.args.shares).to.be.bignumber.equal(shares(100));
        });

      });

      describe('when supply decreases', function () {

        beforeEach(async function () {
          // alice stakes
          await this.module.stake(alice, tokens(100), [], { from: owner });

          // shrink elastic supply
          await this.token.setCoefficient(toFixedPointBigNumber(0.75, 10, 18));

          // bob stakes
          await this.module.stake(bob, tokens(100), [], { from: owner });

          // advance time
          await time.increase(days(30));

          // alice unstakes all
          const amount = (await this.module.balances(alice))[0];
          this.res = await this.module.unstake(alice, amount, [], { from: owner });
        });

        it('should return staking token to user balance', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(tokens(750), TOKEN_DELTA);
        });

        it('should update staking balance for user to zero', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(0));
        });

        it('should update total staking balance', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.closeTo(tokens(100), TOKEN_DELTA);
        });

        it('should not affect staking balances for other users', async function () {
          expect((await this.module.balances(bob))[0]).to.be.bignumber.closeTo(tokens(100), TOKEN_DELTA);
        });

        it('should update the total staking shares for user to zero', async function () {
          expect(await this.module.shares(alice)).to.be.bignumber.equal(new BN(0));
        });

        it('should update the total staking shares', async function () {
          expect(await this.module.totalShares()).to.be.bignumber.closeTo(shares(100 / 0.75), SHARE_DELTA);
        });

        it('should emit Unstaked event with reduced amount and original shares', async function () {
          const e0 = this.res.logs.filter(l => l.event === 'Unstaked')[0];
          expect(e0.args.user).eq(alice);
          expect(e0.args.token).eq(this.token.address);
          expect(e0.args.amount).to.be.bignumber.closeTo(tokens(75), TOKEN_DELTA);
          expect(e0.args.shares).to.be.bignumber.equal(shares(100));

        });

      });
    });

    describe('claim', function () {

      describe('when supply expands', function () {

        beforeEach(async function () {
          // alice stakes
          await this.module.stake(alice, tokens(100), [], { from: owner });

          // expand elastic supply
          await this.token.setCoefficient(toFixedPointBigNumber(1.1, 10, 18));

          // bob stakes
          await this.module.stake(bob, tokens(100), [], { from: owner });

          // advance time
          await time.increase(days(30));

          // alice claims all
          const amount0 = (await this.module.balances(alice))[0];
          this.res0 = await this.module.claim(alice, amount0, [], { from: owner });

          // bob claims all
          const amount1 = (await this.module.balances(bob))[0];
          this.res1 = await this.module.claim(bob, amount1, [], { from: owner });
        });

        it('should not effect elastic token balance of users who staked before expansion', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(tokens(990), TOKEN_DELTA);
        });

        it('should not effect elastic token balance of users who staked after expansion', async function () {
          expect(await this.token.balanceOf(bob)).to.be.bignumber.closeTo(tokens(1000), TOKEN_DELTA);
        });

        it('should not effect staking balance for users who staked before expansion', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.closeTo(tokens(110), TOKEN_DELTA);
        });

        it('should not effect staking balance for users who staked after expansion', async function () {
          expect((await this.module.balances(bob))[0]).to.be.bignumber.closeTo(tokens(100), TOKEN_DELTA);
        });

        it('should emit Claimed event for first user with initial share rate', async function () {
          const e = this.res0.logs.filter(l => l.event === 'Claimed')[0];
          expect(e.args.user).eq(alice);
          expect(e.args.token).eq(this.token.address);
          expect(e.args.amount).to.be.bignumber.closeTo(tokens(110), TOKEN_DELTA);
          expect(e.args.shares).to.be.bignumber.closeTo(shares(100), SHARE_DELTA);
        });

        it('should emit Claimed event for second user with reduced share rate', async function () {
          const e = this.res1.logs.filter(l => l.event === 'Claimed')[0];
          expect(e.args.user).eq(bob);
          expect(e.args.token).eq(this.token.address);
          expect(e.args.amount).to.be.bignumber.closeTo(tokens(100), TOKEN_DELTA);
          expect(e.args.shares).to.be.bignumber.closeTo(shares(100 / 1.1), SHARE_DELTA);
        });

      });

      describe('when supply decreases', function () {

        beforeEach(async function () {
          // alice stakes
          await this.module.stake(alice, tokens(100), [], { from: owner });

          // shrink elastic supply
          await this.token.setCoefficient(toFixedPointBigNumber(0.75, 10, 18));

          // bob stakes
          await this.module.stake(bob, tokens(100), [], { from: owner });

          // advance time
          await time.increase(days(30));

          // alice claims all
          const amount0 = (await this.module.balances(alice))[0];
          this.res0 = await this.module.claim(alice, amount0, [], { from: owner });

          // bob claims all
          const amount1 = (await this.module.balances(bob))[0];
          this.res1 = await this.module.claim(bob, amount1, [], { from: owner });
        });

        it('should not effect elastic token balance of users who staked before shrinking', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(tokens(675), TOKEN_DELTA);
        });

        it('should not effect elastic token balance of users who staked after shrinking', async function () {
          expect(await this.token.balanceOf(bob)).to.be.bignumber.closeTo(tokens(650), TOKEN_DELTA);
        });

        it('should not effect staking balance for users who staked before shrinking', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.closeTo(tokens(75), TOKEN_DELTA);
        });

        it('should not effect staking balance for users who staked after shrinking', async function () {
          expect((await this.module.balances(bob))[0]).to.be.bignumber.closeTo(tokens(100), TOKEN_DELTA);
        });

        it('should emit Claimed event for first user with initial share rate', async function () {
          const e = this.res0.logs.filter(l => l.event === 'Claimed')[0];
          expect(e.args.user).eq(alice);
          expect(e.args.token).eq(this.token.address);
          expect(e.args.amount).to.be.bignumber.closeTo(tokens(75), TOKEN_DELTA);
          expect(e.args.shares).to.be.bignumber.closeTo(shares(100), SHARE_DELTA);
        });

        it('should emit Claimed event for second user with increased share rate', async function () {
          const e = this.res1.logs.filter(l => l.event === 'Claimed')[0];
          expect(e.args.user).eq(bob);
          expect(e.args.token).eq(this.token.address);
          expect(e.args.amount).to.be.bignumber.closeTo(tokens(100), TOKEN_DELTA);
          expect(e.args.shares).to.be.bignumber.closeTo(shares(100 / 0.75), SHARE_DELTA);
        });

      });
    });
  });


  describe('staking with transfer fee token', function () {

    beforeEach('setup', async function () {
      // owner creates staking module with elastic token
      this.token = await TestFeeToken.new({ from: org });
      this.module = await ERC20StakingModule.new(
        this.token.address,
        factory,
        { from: owner }
      );

      // acquire staking tokens and approval (starting balance: 950)
      await this.token.transfer(alice, tokens(1000), { from: org });
      await this.token.transfer(bob, tokens(1000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: alice });
      await this.token.approve(this.module.address, tokens(100000), { from: bob });
    });

    describe('stake', function () {

      describe('when one user stakes', function () {

        beforeEach('alice stakes', async function () {
          this.res = await this.module.stake(alice, tokens(100), [], { from: owner });
        });

        it('should decrease user staking token balance by full amount', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(tokens(850));
        });

        it('should update the total staked tokens for user after fee', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(tokens(95));
        });

        it('should increase total staked by amount remaining after fee', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(95));
        });

        it('should update the total staked shares after fee', async function () {
          expect(await this.module.shares(alice)).to.be.bignumber.equal(shares(95));
        });

        it('should increase the total staking shares after fee', async function () {
          expect(await this.module.totalShares()).to.be.bignumber.equal(shares(95));
        });

        it('should emit Staked event', async function () {
          expectEvent(
            this.res,
            'Staked',
            { user: alice, token: this.token.address, amount: tokens(100), shares: shares(95) }  // amount pre-fee
          );
        });

      });
    });

    describe('when multiple users stake', function () {

      beforeEach('alice and bob stake', async function () {
        this.res0 = await this.module.stake(alice, tokens(300), [], { from: owner });
        this.res1 = await this.module.stake(bob, tokens(100), [], { from: owner });
      });

      it('should decrease each user staking token balance by full amount', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(tokens(650));
        expect(await this.token.balanceOf(bob)).to.be.bignumber.equal(tokens(850));
      });

      it('should update staking balances for each user after fee', async function () {
        expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(tokens(285));
        expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(tokens(95));
      });

      it('should combine to increase total staking balance after fee', async function () {
        expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(380));
      });

      it('should update the total staking shares for each user after fee', async function () {
        expect(await this.module.shares(alice)).to.be.bignumber.equal(shares(285));
        expect(await this.module.shares(bob)).to.be.bignumber.equal(shares(95));
      });

      it('should combine to increase the total staking shares after fee', async function () {
        expect(await this.module.totalShares()).to.be.bignumber.equal(shares(380));
      });

      it('should emit each Staked event', async function () {
        expectEvent(
          this.res0,
          'Staked',
          { user: alice, token: this.token.address, amount: tokens(300), shares: shares(285) }  // amount pre-fee
        );
        expectEvent(
          this.res1,
          'Staked',
          { user: bob, token: this.token.address, amount: tokens(100), shares: shares(95) }  // amount pre-fee
        );
      });

    });


    describe('unstake', function () {

      beforeEach(async function () {
        // alice and bob stake
        await this.module.stake(alice, tokens(100), [], { from: owner });
        await this.module.stake(bob, tokens(400), [], { from: owner });

        // advance time
        await time.increase(days(30));
      });

      describe('when user tries to unstake their pre-fee stake amount', function () {
        it('should fail', async function () {
          await expectRevert(
            this.module.claim(alice, tokens(100), [], { from: owner }),
            'sm6' // ERC20StakingModule: unstake amount exceeds balance
          );
        });
      });

      describe('when one user unstakes all shares', function () {

        beforeEach(async function () {
          // alice unstakes all
          this.res = await this.module.unstake(alice, tokens(95), [], { from: owner });
        });

        it('should return staking token to user balance after 2x fee', async function () {
          // 850 + 90.25
          expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
            tokens(940.250), TOKEN_DELTA
          );
        });

        it('should update staking balance for user to zero', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(0));
        });

        it('should update total staking balance', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.closeTo(tokens(380), TOKEN_DELTA);
        });

        it('should not affect staking balances for other users', async function () {
          expect((await this.module.balances(bob))[0]).to.be.bignumber.closeTo(tokens(380), TOKEN_DELTA);
        });

        it('should update the total staking shares for user to zero', async function () {
          expect(await this.module.shares(alice)).to.be.bignumber.equal(new BN(0));
        });

        it('should update the total staking shares', async function () {
          expect(await this.module.totalShares()).to.be.bignumber.equal(shares(380));
        });

        it('should emit Unstaked event', async function () {
          expectEvent(
            this.res,
            'Unstaked',
            { user: alice, token: this.token.address, amount: tokens(95), shares: shares(95) }  // amount pre-fee
          );
        });

      });

      describe('when multiple users unstake all shares', function () {

        beforeEach(async function () {
          // alice and bob unstake all
          this.res0 = await this.module.unstake(alice, tokens(95), [], { from: owner });
          this.res1 = await this.module.unstake(bob, tokens(380), [], { from: owner });
        });

        it('should return staking token to both user balances after 2x fee', async function () {
          // 850 + 90.25
          expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(
            tokens(940.250), TOKEN_DELTA
          );
          // 550 + 361
          expect(await this.token.balanceOf(bob)).to.be.bignumber.equal(tokens(911));
        });

        it('should update staking balances for each user to zero', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(0));
          expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(new BN(0));
        });

        it('should update total staking balance to zero', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(new BN(0));
        });

        it('should update the total staking shares for each user to zero', async function () {
          expect(await this.module.shares(alice)).to.be.bignumber.equal(new BN(0));
          expect(await this.module.shares(bob)).to.be.bignumber.equal(new BN(0));
        });

        it('should update the total staking shares to zero', async function () {
          expect(await this.module.totalShares()).to.be.bignumber.equal(new BN(0));
        });

        it('should emit Unstaked event for each user', async function () {
          expectEvent(
            this.res0,
            'Unstaked',
            { user: alice, token: this.token.address, amount: tokens(95), shares: shares(95) }  // amount pre-fee
          );
          expectEvent(
            this.res1,
            'Unstaked',
            { user: bob, token: this.token.address, amount: tokens(380), shares: shares(380) }  // amount pre-fee
          );
        });

      });


      describe('when one user unstakes some shares', function () {

        beforeEach(async function () {
          // alice unstakes some
          this.res = await this.module.unstake(alice, tokens(50), [], { from: owner });
        });

        it('should return some staking token to user balance after fee', async function () {
          // 850 + 47.5
          expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(tokens(897.5));
        });

        it('should update staking balance for user', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(tokens(45));
        });

        it('should update total staking balance', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(425));
        });

        it('should not affect staking balances for other users', async function () {
          expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(tokens(380));
        });

        it('should update the total staking shares for user', async function () {
          expect(await this.module.shares(alice)).to.be.bignumber.equal(shares(45));
        });

        it('should update the total staking shares', async function () {
          expect(await this.module.totalShares()).to.be.bignumber.equal(shares(425));
        });

        it('should emit Unstaked event', async function () {
          expectEvent(
            this.res,
            'Unstaked',
            { user: alice, token: this.token.address, amount: tokens(50), shares: shares(50) }  // amount pre-fee
          );
        });

      });
    });

    describe('claim', function () {

      beforeEach('alice and bob stake', async function () {
        // alice and bob stake
        await this.module.stake(alice, tokens(100), [], { from: owner });
        await this.module.stake(bob, tokens(200), [], { from: owner });

        // advance time
        await time.increase(days(30));
      });

      describe('when user tries to claim their pre-fee stake amount', function () {
        it('should fail', async function () {
          await expectRevert(
            this.module.claim(alice, tokens(100), [], { from: owner }),
            'sm6' // ERC20StakingModule: unstake amount exceeds balance
          );
        });
      });

      describe('when one user claims with all shares', function () {

        beforeEach(async function () {
          // claim
          this.res = await this.module.claim(alice, tokens(95), [], { from: owner });
        });

        it('should not return staking token to user balance', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(tokens(850));
        });

        it('should maintain staking balance for user and avoid additional fee', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(tokens(95));
        });

        it('should maintain total staking balance and avoid additional fee', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(285));
        });

        it('should not affect staking balances for other users', async function () {
          expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(tokens(190));
        });

        it('should not affect the total staking shares for user', async function () {
          expect(await this.module.shares(alice)).to.be.bignumber.equal(shares(95));
        });

        it('should not affect the total staking shares', async function () {
          expect(await this.module.totalShares()).to.be.bignumber.equal(shares(285));
        });

        it('should emit Claimed event with all shares', async function () {
          expectEvent(
            this.res,
            'Claimed',
            { user: alice, token: this.token.address, amount: tokens(95), shares: shares(95) }
          );
        });

      });

      describe('when multiple users claim', function () {

        beforeEach(async function () {
          // claim
          this.res0 = await this.module.claim(alice, tokens(50), [], { from: owner });
          this.res1 = await this.module.claim(bob, tokens(190), [], { from: owner });
        });

        it('should not return staking token to user balances', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(tokens(850));
          expect(await this.token.balanceOf(bob)).to.be.bignumber.equal(tokens(750));
        });

        it('should maintain staking balances for users and avoid additional fees', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(tokens(95));
          expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(tokens(190));
        });

        it('should maintain total staking balance and avoid additional fees', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(285));
        });

        it('should not affect the total staking shares for each user', async function () {
          expect(await this.module.shares(alice)).to.be.bignumber.equal(shares(95));
          expect(await this.module.shares(bob)).to.be.bignumber.equal(shares(190));
        });

        it('should not affect the total staking shares', async function () {
          expect(await this.module.totalShares()).to.be.bignumber.equal(shares(285));
        });

        it('should emit Claimed event with some shares for first user', async function () {
          expectEvent(
            this.res0,
            'Claimed',
            { user: alice, token: this.token.address, amount: tokens(50), shares: shares(50) }
          );
        });

        it('should emit Claimed event with all shares for second user', async function () {
          expectEvent(
            this.res1,
            'Claimed',
            { user: bob, token: this.token.address, amount: tokens(190), shares: shares(190) }
          );
        });

      });
    });

  });
});
