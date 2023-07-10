// unit tests for ERC20BondStakingModule

const { artifacts, web3 } = require('hardhat');
const { BN, time, expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const {
  tokens,
  e18,
  days,
  shares,
  toFixedPointBigNumber,
  fromFixedPointBigNumber,
  fromBonus,
  fromTokens,
  setupTime,
  DECIMALS
} = require('../util/helper');

const ERC20BondStakingModule = artifacts.require('ERC20BondStakingModule');
const Configuration = artifacts.require('Configuration');
const TestToken = artifacts.require('TestToken');
const TestElasticToken = artifacts.require('TestElasticToken')
const TestFeeToken = artifacts.require('TestFeeToken');
const TestIndivisibleToken = artifacts.require('TestIndivisibleToken');
const ERC20BondStakingModuleInfo = artifacts.require('ERC20BondStakingModuleInfo');


// tolerance
const TOKEN_DELTA = toFixedPointBigNumber(0.001, 10, DECIMALS);
const TOKEN_DELTA_BIG = toFixedPointBigNumber(0.01, 10, DECIMALS);
const SHARE_DELTA = toFixedPointBigNumber(0.001 * (10 ** 6), 10, DECIMALS);
const SHARE_DELTA_BIG = toFixedPointBigNumber(0.01 * (10 ** 6), 10, DECIMALS);
const DEBT_DELTA = toFixedPointBigNumber(0.001 * (10 ** 6), 10, DECIMALS);


describe('ERC20BondStakingModule', function () {
  let org, owner, alice, bob, other, factory, treasury;
  before(async function () {
    [org, owner, alice, bob, other, factory, treasury] = await web3.eth.getAccounts();
  });

  beforeEach('setup', async function () {
    this.config = await Configuration.new({ from: org });
    this.token = await TestToken.new({ from: org });
  });

  describe('construction', function () {

    describe('when initialized with valid constructor arguments', function () {
      beforeEach(async function () {
        this.module = await ERC20BondStakingModule.new(
          days(30),
          true,
          this.config.address,
          factory,
          { from: owner }
        );
      });
      it('should create an ERC20BondStakingModule object', async function () {
        expect(this.module).to.be.an('object');
        expect(this.module.constructor.name).to.be.equal('TruffleContract');
      });

      it('should set the owner to the sender address', async function () {
        expect(await this.module.owner()).to.equal(owner);
      });

      it('should set the desired vesting period', async function () {
        expect(await this.module.period()).to.be.bignumber.equal(days(30));
      });

      it('should set burndown flag', async function () {
        expect(await this.module.burndown()).to.equal(true);
      });

      it('should set the initial nonce', async function () {
        expect(await this.module.nonce()).to.be.bignumber.equal(new BN(1));
      })

      it('should return empty list for initial tokens', async function () {
        expect((await this.module.tokens()).length).to.equal(0);
      });

      it('should return the correct factory address', async function () {
        expect(await this.module.factory()).to.equal(factory);
      });

      it('should return empty list for user balances', async function () {
        expect((await this.module.balances(bob)).length).to.equal(0);
      });

      it('should return empty list for total balances', async function () {
        expect((await this.module.totals()).length).to.equal(0);
      });

    })
  });


  describe('open', function () {

    beforeEach(async function () {
      // owner creates bond module
      this.token = await TestToken.new({ from: org });
      this.module = await ERC20BondStakingModule.new(
        days(30),
        true,
        this.config.address,
        factory,
        { from: owner }
      );
    });

    describe('when caller does not control module', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.open(
            this.token.address,
            e18(0.80),
            e18(0.25 / 1000), // (1.05 - 0.80) / 1000e6
            shares(100),
            shares(1000),
            { from: other }),
          'oc2' // OwnerController: caller is not the controller
        );
      });
    });

    describe('when market already exists', function () {
      it('should fail', async function () {
        await this.module.open(
          this.token.address,
          e18(0.80),
          toFixedPointBigNumber(0.25, 10, 9),
          shares(100),
          shares(1000),
          { from: owner }
        );
        await expectRevert(
          this.module.open(
            this.token.address,
            e18(0.80),
            e18(0.25 / 1000), // (1.05 - 0.80) / 1000e6
            shares(100),
            shares(1000),
            { from: owner }),
          'bsm19' // market already exists
        );
      });
    });

    describe('when minimum price is zero', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.open(
            this.token.address,
            new BN(0),
            e18(0.25 / 1000), // (1.05 - 0.80) / 1000e6
            shares(100),
            shares(1000),
            { from: owner }),
          'bsm21' // price is zero
        );
      });
    });

    describe('when max bond size is zero', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.open(
            this.token.address,
            e18(0.80),
            e18(0.25 / 1000),
            shares(0),
            shares(1000),
            { from: owner }),
          'bsm22' // max is zero
        );
      });
    });

    describe('when market capacity is zero', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.open(
            this.token.address,
            e18(0.80),
            e18(0.25 / 1000),
            shares(100),
            shares(0),
            { from: owner }),
          'bsm23' // capacity is zero
        );
      });
    });

    describe('when market is opened', function () {

      beforeEach(async function () {
        // open bond market
        this.res = await this.module.open(
          this.token.address,
          e18(0.80),
          e18(0.25 / 1000), // (1.05 - 0.80) / 1000e6
          shares(100),
          shares(1000),
          { from: owner }
        );
        this.t0 = (await this.module.markets(this.token.address)).updated;
      });

      it('should add new market to tokens list', async function () {
        let tokens = await this.module.tokens();
        expect(tokens.length).to.equal(1);
        expect(tokens[0]).to.equal(this.token.address);
      });

      it('should set bond market price', async function () {
        expect((await this.module.markets(this.token.address)).price).to.be.bignumber.equal(e18(0.80));
      });

      it('should set bond market coefficient', async function () {
        expect((await this.module.markets(this.token.address)).coeff).to.be.bignumber.equal(e18(0.25 / 1000));
      });

      it('should set max bond size', async function () {
        expect((await this.module.markets(this.token.address)).max).to.be.bignumber.equal(shares(100));
      });

      it('should reset new bond market capacity', async function () {
        expect((await this.module.markets(this.token.address)).capacity).to.be.bignumber.equal(shares(1000));
      });

      it('should emit MarketOpened event', async function () {
        expectEvent(
          this.res,
          'MarketOpened',
          {
            token: this.token.address,
            price: e18(0.80),
            coeff: new BN('250000000000000'),
            max: shares(100),
            capacity: shares(1000)
          }
        );
      });

    });

  });


  describe('stake', function () {

    beforeEach('setup', async function () {
      // owner creates bond module
      this.token = await TestToken.new({ from: org });
      this.module = await ERC20BondStakingModule.new(
        days(30),
        true,
        this.config.address,
        factory,
        { from: owner }
      );
      // open bond market
      await this.module.open(
        this.token.address,
        e18(1.25),
        e18(0.75 / 1000), // (2.0 - 1.25) / 1000e6 as e24
        shares(100),
        shares(1000),
        { from: owner }
      );
      // acquire bond tokens and approve spending
      await this.token.transfer(alice, tokens(1000), { from: org });
      await this.token.transfer(bob, tokens(1000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: alice });
      await this.token.approve(this.module.address, tokens(100000), { from: bob });
    });

    describe('when caller does not own module', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.stake(bob, tokens(100), [], { from: other }),
          'oc1' // OwnerController: caller is not the owner
        );
      });
    });

    describe('when amount is zero', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.stake(bob, tokens(0), [], { from: owner }),
          'bsm2'
        );
      });
    });

    describe('when encoded token data is missing', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.stake(bob, tokens(80), [], { from: owner }),
          'bsm3'
        );
      });
    });

    describe('when sender tries to stake more than their balance', function () {
      it('should fail', async function () {
        const data = web3.eth.abi.encodeParameter('address', this.token.address);
        await expectRevert(
          this.module.stake(bob, tokens(1001), data, { from: owner }),
          'ERC20: transfer amount exceeds balance'
        );
      });
    });

    describe('when market does not exist', function () {
      it('should fail', async function () {
        const data = web3.eth.abi.encodeParameter('address', other);
        await expectRevert(
          this.module.stake(bob, tokens(80), data, { from: owner }),
          'bsm4'
        );
      });
    });

    describe('when bond size is too large', function () {
      it('should fail', async function () {
        const data = web3.eth.abi.encodeParameter('address', this.token.address);
        await expectRevert(
          this.module.stake(bob, tokens(150), data, { from: owner }),
          'bsm5'
        );
      });
    });

    describe('when bond purchase exceeds market capacity', function () {
      it('should fail', async function () {
        const data = web3.eth.abi.encodeParameter('address', this.token.address);
        // buy out most of debt capacity
        for (let i = 0; i < 5; i++) {
          await this.module.stake(alice, tokens(95 * (1.25 + i * 190 * 0.00075)), data, { from: owner })
          await this.module.stake(bob, tokens(95 * (1.25 + (95 + i * 95) * 0.00075)), data, { from: owner })
        }
        await expectRevert(
          this.module.stake(bob, tokens(180), data, { from: owner }),
          'bsm6'
        );
      });
    });

    describe('when bond debt is below minimum threshold', function () {
      it('should fail', async function () {
        const data = web3.eth.abi.encodeParameters(['address', 'uint256'], [this.token.address, shares(85)]);
        await expectRevert(
          this.module.stake(bob, tokens(100), data, { from: owner }),
          'bsm7'
        );
      });
    });

    describe('when market has been closed', function () {
      it('should fail', async function () {
        await this.module.close(this.token.address, { from: owner });
        const data = web3.eth.abi.encodeParameter('address', this.token.address);
        await expectRevert(
          this.module.stake(bob, tokens(80), data, { from: owner }),
          'bsm4'
        );
      });
    });


    describe('when multiple users stake in a single bond market', function () {

      beforeEach('alice and bob stake', async function () {
        const data0 = web3.eth.abi.encodeParameter('address', this.token.address);
        this.res0 = await this.module.stake(alice, tokens(125), data0, { from: owner });
        this.t0 = (await this.module.markets(this.token.address)).updated;
        const data1 = web3.eth.abi.encodeParameters(['address', 'uint256'], [this.token.address, shares(79.2)]); // expect 80 w/ 1% tolerance
        this.res1 = await this.module.stake(bob, tokens(106), data1, { from: owner }); // price now @ 1.325
        this.t1 = (await this.module.markets(this.token.address)).updated;
      });

      it('should decrease each user token balance', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(tokens(875));
        expect(await this.token.balanceOf(bob)).to.be.bignumber.equal(tokens(894));
      });

      it('should update total staking balance', async function () {
        expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(231));
      });

      it('should update staking balances for each user', async function () {
        expect((await this.module.balances(alice))[0]).to.be.bignumber.closeTo(tokens(125), tokens(2 * 125).div(days(30)));
        expect((await this.module.balances(bob))[0]).to.be.bignumber.closeTo(tokens(106), tokens(1 * 106).div(days(30)));
      });

      it('should create the first bond position', async function () {
        const b = await this.module.bonds(new BN(1));
        expect(b.market).to.equal(this.token.address);
        expect(b.principal).to.be.bignumber.equal(shares(125));
        expect(b.debt).to.be.bignumber.equal(shares(100));
        expect(b.timestamp).to.be.bignumber.equal(this.t0);
      });

      it('should create the second bond position', async function () {
        const b = await this.module.bonds(new BN(2));
        expect(b.market).to.equal(this.token.address);
        expect(b.principal).to.be.bignumber.equal(shares(106));
        expect(b.debt).to.be.bignumber.closeTo(shares(80), DEBT_DELTA);
        expect(b.timestamp).to.be.bignumber.equal(this.t1);
      });

      it('should set the first bond owner', async function () {
        expect(await this.module.ownerOf(1)).to.be.equal(alice);
      });

      it('should set the second bond owner', async function () {
        expect(await this.module.ownerOf(2)).to.be.equal(bob);
      });

      it('should set the first owner bond mapping', async function () {
        expect(await this.module.ownerBonds(alice, 0)).to.be.bignumber.equal(new BN(1));
      });

      it('should set the second owner bond mapping', async function () {
        expect(await this.module.ownerBonds(bob, 0)).to.be.bignumber.equal(new BN(2));
      });

      it('should set the first bond index mapping', async function () {
        expect(await this.module.bondIndex(1)).to.be.bignumber.equal(new BN(0));
      });

      it('should set the second bond index mapping', async function () {
        expect(await this.module.bondIndex(2)).to.be.bignumber.equal(new BN(0));
      });

      it('should increase bond count for first user', async function () {
        expect(await this.module.balanceOf(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should increase bond count for second user', async function () {
        expect(await this.module.balanceOf(bob)).to.be.bignumber.equal(new BN(1));
      });

      it('should combine to increase total bond market debt', async function () {
        expect((await this.module.markets(this.token.address)).debt).to.be.bignumber.closeTo(shares(180), DEBT_DELTA);
      });

      it('should combine to decrease total bond market capacity', async function () {
        expect((await this.module.markets(this.token.address)).capacity).to.be.bignumber.closeTo(shares(820), DEBT_DELTA);
      });

      it('should combine to increase total bond market token shares', async function () {
        expect((await this.module.markets(this.token.address)).principal).to.be.bignumber.equal(shares(231));
      });

      it('should update bond market last updated timestamp', async function () {
        expect((await this.module.markets(this.token.address)).updated).to.be.bignumber.equal(this.t1);
      });

      it('should update bond market vesting start timestamp', async function () {
        expect((await this.module.markets(this.token.address)).start).to.be.bignumber.equal(this.t1);
      });

      it('should increment nonce', async function () {
        expect(await this.module.nonce()).to.be.bignumber.equal(new BN(3));
      });

      it('should emit first Staked event', async function () {
        expectEvent(
          this.res0,
          'Staked',
          { user: alice, token: this.token.address, amount: tokens(125), shares: shares(100) }
        );
      });

      it('should emit second Staked event', async function () {
        const e = this.res1.logs.filter(l => l.event === 'Staked')[0];
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.equal(tokens(106)); // should be exact
        expect(e.args.shares).to.be.bignumber.closeTo(shares(80), DEBT_DELTA);
      });

      it('should not emit Fee events', async function () {
        expect(this.res0.logs.filter(l => l.event === 'Fee').length).to.be.equal(0);
        expect(this.res1.logs.filter(l => l.event === 'Fee').length).to.be.equal(0);
      });
    });


    describe('when one user stakes multiple times in a single bond market', function () {

      beforeEach(async function () {
        const data0 = web3.eth.abi.encodeParameter('address', this.token.address);
        this.res0 = await this.module.stake(alice, tokens(100), data0, { from: owner }); // price @ 1.25
        this.t0 = (await this.module.markets(this.token.address)).updated;
        const data1 = web3.eth.abi.encodeParameters(['address', 'uint256'], [this.token.address, shares(49.5)]); // expect 50 w/ 1% tolerance
        this.res1 = await this.module.stake(alice, tokens(65.5), data1, { from: owner }); // price now @ 1.31
        this.t1 = (await this.module.markets(this.token.address)).updated;
      });

      it('should decrease user token balance', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(tokens(834.5));
      });

      it('should update total staking balance', async function () {
        expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(165.5));
      });

      it('should update staking balances for each user', async function () {
        expect((await this.module.balances(alice))[0]).to.be.bignumber.closeTo(tokens(165.5), tokens(2 * 165.5).div(days(30)));
      });

      it('should create the first bond position', async function () {
        const b = await this.module.bonds(new BN(1));
        expect(b.market).to.equal(this.token.address);
        expect(b.principal).to.be.bignumber.equal(shares(100));
        expect(b.debt).to.be.bignumber.equal(shares(80));
        expect(b.timestamp).to.be.bignumber.equal(this.t0);
      });

      it('should create the second bond position', async function () {
        const b = await this.module.bonds(new BN(2));
        expect(b.market).to.equal(this.token.address);
        expect(b.principal).to.be.bignumber.equal(shares(65.5));
        expect(b.debt).to.be.bignumber.closeTo(shares(50), DEBT_DELTA);
        expect(b.timestamp).to.be.bignumber.equal(this.t1);
      });

      it('should set the first bond owner to user', async function () {
        expect(await this.module.ownerOf(1)).to.be.equal(alice);
      });

      it('should set the second bond owner to user', async function () {
        expect(await this.module.ownerOf(2)).to.be.equal(alice);
      });

      it('should set the first owner bond mapping', async function () {
        expect(await this.module.ownerBonds(alice, 0)).to.be.bignumber.equal(new BN(1));
      });

      it('should set the second owner bond mapping', async function () {
        expect(await this.module.ownerBonds(alice, 1)).to.be.bignumber.equal(new BN(2));
      });

      it('should set the first bond index mapping', async function () {
        expect(await this.module.bondIndex(1)).to.be.bignumber.equal(new BN(0));
      });

      it('should set the second bond index mapping', async function () {
        expect(await this.module.bondIndex(2)).to.be.bignumber.equal(new BN(1));
      });

      it('should increase bond count for user', async function () {
        expect(await this.module.balanceOf(alice)).to.be.bignumber.equal(new BN(2));
      });

      it('should combine to increase total bond market debt', async function () {
        expect((await this.module.markets(this.token.address)).debt).to.be.bignumber.closeTo(shares(130), DEBT_DELTA);
      });

      it('should combine to decrease total bond market capacity', async function () {
        expect((await this.module.markets(this.token.address)).capacity).to.be.bignumber.closeTo(shares(870), DEBT_DELTA);
      });

      it('should combine to increase total bond market token shares', async function () {
        expect((await this.module.markets(this.token.address)).principal).to.be.bignumber.equal(shares(165.5));
      });

      it('should update bond market last updated timestamp', async function () {
        expect((await this.module.markets(this.token.address)).updated).to.be.bignumber.equal(this.t1);
      });

      it('should update bond market vesting start timestamp', async function () {
        expect((await this.module.markets(this.token.address)).start).to.be.bignumber.equal(this.t1);
      });

      it('should increment nonce', async function () {
        expect(await this.module.nonce()).to.be.bignumber.equal(new BN(3));
      });

      it('should emit first Staked event', async function () {
        expectEvent(
          this.res0,
          'Staked',
          { user: alice, token: this.token.address, amount: tokens(100), shares: shares(80) }
        );
      });

      it('should emit second Staked event', async function () {
        const e = this.res1.logs.filter(l => l.event === 'Staked')[0];
        expect(e.args.user).eq(alice);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.equal(tokens(65.5)); // should be exact
        expect(e.args.shares).to.be.bignumber.closeTo(shares(50), DEBT_DELTA);
      });

    });

    describe('when one user purchases bond with protocol fee enabled', function () {

      beforeEach(async function () {
        // configure fee
        await this.config.setAddressUint96(
          web3.utils.soliditySha3('gysr.core.bond.stake.fee'),
          treasury,
          e18(0.01),
          { from: org }
        );

        // purchase bond
        const data0 = web3.eth.abi.encodeParameter('address', this.token.address);
        this.res0 = await this.module.stake(alice, tokens(100), data0, { from: owner });
        this.t0 = (await this.module.markets(this.token.address)).updated;
      });

      it('should decrease user token balance', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(tokens(900));
      });

      it('should update total staking balance minus fee', async function () {
        expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(99));
      });

      it('should increase user staking balance minus fee', async function () {
        expect((await this.module.balances(alice))[0]).to.be.bignumber.closeTo(tokens(99), tokens(2 * 99).div(days(30)));
      });

      it('should create the first bond position with principal and debt after fee', async function () {
        const b = await this.module.bonds(new BN(1));
        expect(b.market).to.equal(this.token.address);
        expect(b.principal).to.be.bignumber.equal(shares(99));
        expect(b.debt).to.be.bignumber.equal(shares(79.2));
        expect(b.timestamp).to.be.bignumber.equal(this.t0);
      });

      it('should increase total bond market debt after fee', async function () {
        expect((await this.module.markets(this.token.address)).debt).to.be.bignumber.closeTo(shares(79.2), DEBT_DELTA);
      });

      it('should decrease total bond market capacity after fee', async function () {
        expect((await this.module.markets(this.token.address)).capacity).to.be.bignumber.closeTo(shares(920.8), DEBT_DELTA);
      });

      it('should increase total bond market token shares after fee', async function () {
        expect((await this.module.markets(this.token.address)).principal).to.be.bignumber.equal(shares(99));
      });

      it('should increase module token balance by stake amount minus fee', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.equal(tokens(99));
      });

      it('should increase treasury token balance by fee amount', async function () {
        expect(await this.token.balanceOf(treasury)).to.be.bignumber.equal(tokens(1));
      });

      it('should emit first Staked event with shares reduced by fee', async function () {
        expectEvent(
          this.res0,
          'Staked',
          { user: alice, token: this.token.address, amount: tokens(100), shares: shares(79.2) }
        );
      });

      it('should emit Fee event', async function () {
        expectEvent(this.res0, 'Fee', { receiver: treasury, token: this.token.address, amount: tokens(1.0) });
      });

    });


    describe('when one user purchases bonds across multiple markets', function () {

      beforeEach(async function () {
        this.token1 = await TestToken.new({ from: org });

        // open another bond market
        await this.module.open(
          this.token1.address,
          e18(4000),
          e18(1500 / 2000), // (4000 - 1500) / 2000e6
          shares(100),
          shares(3000),
          { from: owner }
        );
        // acquire bond tokens and approve spending
        await this.token1.transfer(alice, tokens(1000000), { from: org });
        await this.token1.approve(this.module.address, tokens(100000000), { from: alice });

        // configure fee
        await this.config.setAddressUint96(
          web3.utils.soliditySha3('gysr.core.bond.stake.fee'),
          treasury,
          e18(0.01),
          { from: org }
        );

        // purchase bonds
        const data0 = web3.eth.abi.encodeParameter('address', this.token.address);
        this.res0 = await this.module.stake(alice, tokens(100), data0, { from: owner });
        this.t0 = (await this.module.markets(this.token.address)).updated;

        const data1 = web3.eth.abi.encodeParameter('address', this.token1.address);
        this.res1 = await this.module.stake(alice, tokens(120000), data1, { from: owner });
        this.t1 = (await this.module.markets(this.token1.address)).updated;
      });

      it('should decrease user token balance of first token', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(tokens(900));
      });

      it('should decrease user token balance of first token', async function () {
        expect(await this.token1.balanceOf(alice)).to.be.bignumber.equal(tokens(880000));
      });

      it('should update total staking balances', async function () {
        const totals = await this.module.totals()
        expect(totals[0]).to.be.bignumber.equal(tokens(99));
        expect(totals[1]).to.be.bignumber.equal(tokens(118800));
      });

      it('should increase user staking balances', async function () {
        const balances = await this.module.balances(alice);
        expect(balances[0]).to.be.bignumber.closeTo(tokens(99), tokens(2 * 99).div(days(30)));
        expect(balances[1]).to.be.bignumber.closeTo(tokens(118800), tokens(2 * 118800).div(days(30)));
      });

      it('should create the first bond position in first market', async function () {
        const b = await this.module.bonds(new BN(1));
        expect(b.market).to.equal(this.token.address);
        expect(b.principal).to.be.bignumber.equal(shares(99));
        expect(b.debt).to.be.bignumber.equal(shares(79.2));
        expect(b.timestamp).to.be.bignumber.equal(this.t0);
      });

      it('should create the second bond position in second market', async function () {
        const b = await this.module.bonds(new BN(2));
        expect(b.market).to.equal(this.token1.address);
        expect(b.principal).to.be.bignumber.equal(shares(118800));
        expect(b.debt).to.be.bignumber.equal(shares(29.7));
        expect(b.timestamp).to.be.bignumber.equal(this.t1);
      });

      it('should set bond owners', async function () {
        expect(await this.module.ownerOf(1)).to.be.equal(alice);
        expect(await this.module.ownerOf(2)).to.be.equal(alice);
      });

      it('should set owner bond mappings', async function () {
        expect(await this.module.ownerBonds(alice, 0)).to.be.bignumber.equal(new BN(1));
        expect(await this.module.ownerBonds(alice, 1)).to.be.bignumber.equal(new BN(2));
      });

      it('should set bond index mappings', async function () {
        expect(await this.module.bondIndex(1)).to.be.bignumber.equal(new BN(0));
        expect(await this.module.bondIndex(2)).to.be.bignumber.equal(new BN(1));
      });

      it('should increase bond count for user', async function () {
        expect(await this.module.balanceOf(alice)).to.be.bignumber.equal(new BN(2));
      });

      it('should increase first bond market debt', async function () {
        expect((await this.module.markets(this.token.address)).debt).to.be.bignumber.closeTo(shares(79.2), DEBT_DELTA);
      });

      it('should increase second bond market debt', async function () {
        expect((await this.module.markets(this.token1.address)).debt).to.be.bignumber.closeTo(shares(29.7), DEBT_DELTA);
      });

      it('should decrease first bond market capacity', async function () {
        expect((await this.module.markets(this.token.address)).capacity).to.be.bignumber.closeTo(shares(920.8), DEBT_DELTA);
      });

      it('should decrease second bond market capacity', async function () {
        expect((await this.module.markets(this.token1.address)).capacity).to.be.bignumber.closeTo(shares(2970.3), DEBT_DELTA);
      });

      it('should increase first bond market token shares', async function () {
        expect((await this.module.markets(this.token.address)).principal).to.be.bignumber.equal(shares(99));
      });

      it('should increase second bond market token shares', async function () {
        expect((await this.module.markets(this.token1.address)).principal).to.be.bignumber.equal(shares(118800));
      });

      it('should update first bond market timestamps only on first stake', async function () {
        expect((await this.module.markets(this.token.address)).updated).to.be.bignumber.equal(this.t0);
        expect((await this.module.markets(this.token.address)).start).to.be.bignumber.equal(this.t0);
      });

      it('should update second bond market timestamps on second stake', async function () {
        expect((await this.module.markets(this.token1.address)).updated).to.be.bignumber.equal(this.t1);
        expect((await this.module.markets(this.token1.address)).start).to.be.bignumber.equal(this.t1);
      });

      it('should increment nonce', async function () {
        expect(await this.module.nonce()).to.be.bignumber.equal(new BN(3));
      });

      it('should increase module token balances by stake amount minus fee', async function () {
        expect(await this.token.balanceOf(this.module.address)).to.be.bignumber.equal(tokens(99));
        expect(await this.token1.balanceOf(this.module.address)).to.be.bignumber.equal(tokens(118800));
      });

      it('should increase treasury token balances by fee amount', async function () {
        expect(await this.token.balanceOf(treasury)).to.be.bignumber.equal(tokens(1));
        expect(await this.token1.balanceOf(treasury)).to.be.bignumber.equal(tokens(1200));
      });

      it('should emit first Staked event for first token market', async function () {
        expectEvent(
          this.res0,
          'Staked',
          { user: alice, token: this.token.address, amount: tokens(100), shares: shares(79.2) }
        );
      });

      it('should emit second Staked event for second token market', async function () {
        expectEvent(
          this.res1,
          'Staked',
          { user: alice, token: this.token1.address, amount: tokens(120000), shares: shares(29.7) }
        );
      });

      it('should emit Fee event for first token market', async function () {
        expectEvent(this.res0, 'Fee', { receiver: treasury, token: this.token.address, amount: tokens(1.0) });
      });

      it('should emit Fee event for second token market', async function () {
        expectEvent(this.res1, 'Fee', { receiver: treasury, token: this.token1.address, amount: tokens(1200) });
      });

    });

  });


  describe('update', function () {

    describe('when burndown is disabled', function () {

      beforeEach('setup', async function () {
        // owner creates bond module
        this.token = await TestToken.new({ from: org });
        this.module = await ERC20BondStakingModule.new(
          days(14),
          false,
          this.config.address,
          factory,
          { from: owner }
        );
        // open bond market
        await this.module.open(
          this.token.address,
          e18(5.0),
          e18(2.5 / 5000), // (7.5 - 5.0) / 5000e6
          shares(500),
          shares(10000),
          { from: owner }
        );
        // acquire bond tokens and approve spending
        await this.token.transfer(alice, tokens(1000), { from: org });
        await this.token.transfer(bob, tokens(1000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: alice });
        await this.token.approve(this.module.address, tokens(100000), { from: bob });

        // purchase bonds one week apart
        const data = web3.eth.abi.encodeParameter('address', this.token.address);
        await this.module.stake(alice, tokens(500), data, { from: owner }); // +100e6 debt
        this.t0 = (await this.module.markets(this.token.address)).updated;
        await setupTime(this.t0, days(7)); // decay -50e6 debt
        await this.module.stake(bob, tokens(201), data, { from: owner }); // price now @ 5.025
        this.t1 = (await this.module.markets(this.token.address)).updated;
      });

      describe('when user does not own bond', function () {
        it('should fail', async function () {
          const data = web3.eth.abi.encodeParameter('uint256', new BN(2));
          await expectRevert(
            this.module.update(alice, data, { from: owner }),
            'bsm18'
          );
        });
      });

      describe('when no time has elapsed', function () {

        beforeEach(async function () {
          const data = web3.eth.abi.encodeParameter('uint256', new BN(1));
          await this.module.update(alice, data, { from: owner });
        });

        it('should have zero staking balance for first user', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(0));
        });

        it('should have zero staking balance for second user', async function () {
          expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(new BN(0));
        });

        it('should have combined total staking balance', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(701));
        });

        it('should fully vest spent tokens immediately', async function () {
          expect((await this.module.markets(this.token.address)).vested).to.be.bignumber.equal(shares(701));
        });

        it('should decay half of debt from first user and add new debt from second user', async function () {
          expect((await this.module.markets(this.token.address)).debt).to.be.bignumber.closeTo(shares(90), SHARE_DELTA);
        });

      });

      describe('when half of vesting period has elapsed', function () {

        beforeEach(async function () {
          await setupTime(this.t0, days(14));
          const data = web3.eth.abi.encodeParameter('uint256', new BN(1));
          await this.module.update(alice, data, { from: owner });
        });

        it('should have zero staking balance for first user', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(0));
        });

        it('should have zero staking balance for second user', async function () {
          expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(new BN(0));
        });

        it('should have combined total staking balance', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(701));
        });

        it('should fully vest spent tokens', async function () {
          expect((await this.module.markets(this.token.address)).vested).to.be.bignumber.equal(shares(701));
        });

        it('should decay half of last debt', async function () {
          expect((await this.module.markets(this.token.address)).debt).to.be.bignumber.closeTo(shares(45), SHARE_DELTA);
        });

        it('should update bond market last updated timestamp', async function () {
          expect((await this.module.markets(this.token.address)).updated).to.be.bignumber.closeTo(this.t0.add(days(14)), new BN(1));
        });

        it('should not affect the bond market vesting start timestamp', async function () {
          expect((await this.module.markets(this.token.address)).start).to.be.bignumber.closeTo(this.t0.add(days(7)), new BN(1));
        });

      });

      describe('when more than a full vesting period has elapsed', function () {

        beforeEach(async function () {
          await setupTime(this.t0, days(30));
          const data = web3.eth.abi.encodeParameter('uint256', new BN(1));
          await this.module.update(alice, data, { from: owner });
        });

        it('should have zero staking balance for first user', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(0));
        });

        it('should have zero staking balance for second user', async function () {
          expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(new BN(0));
        });

        it('should have combined total staking balance', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(701));
        });

        it('should fully vest spent tokens', async function () {
          expect((await this.module.markets(this.token.address)).vested).to.be.bignumber.equal(shares(701));
        });

        it('should fully decay debt', async function () {
          expect((await this.module.markets(this.token.address)).debt).to.be.bignumber.equal(new BN(0));
        });

        it('should update bond market last updated timestamp', async function () {
          expect((await this.module.markets(this.token.address)).updated).to.be.bignumber.closeTo(this.t0.add(days(30)), new BN(1));
        });

        it('should not affect the bond market vesting start timestamp', async function () {
          expect((await this.module.markets(this.token.address)).start).to.be.bignumber.closeTo(this.t0.add(days(7)), new BN(1));
        });

      });

    });

    describe('when burndown is enabled', function () {

      beforeEach('setup', async function () {
        // owner creates bond module
        this.token = await TestToken.new({ from: org });
        this.module = await ERC20BondStakingModule.new(
          days(14),
          true,
          this.config.address,
          factory,
          { from: owner }
        );
        // open bond market
        await this.module.open(
          this.token.address,
          e18(5.0),
          e18(2.5 / 5000), // (7.5 - 5.0) / 5000e6
          shares(500),
          shares(10000),
          { from: owner }
        );
        // acquire bond tokens and approve spending
        await this.token.transfer(alice, tokens(1000), { from: org });
        await this.token.transfer(bob, tokens(1000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: alice });
        await this.token.approve(this.module.address, tokens(100000), { from: bob });

        // purchase bonds one week apart
        const data = web3.eth.abi.encodeParameter('address', this.token.address);
        await this.module.stake(alice, tokens(500), data, { from: owner }); // +100e6 debt
        this.t0 = (await this.module.markets(this.token.address)).updated;
        await setupTime(this.t0, days(7)); // decay -50e6 debt
        await this.module.stake(bob, tokens(201), data, { from: owner }); // price now @ 5.025
        this.t1 = (await this.module.markets(this.token.address)).updated;
      });

      describe('when no time has elapsed', function () {

        beforeEach(async function () {
          const data = web3.eth.abi.encodeParameter('uint256', new BN(2));
          await this.module.update(bob, data, { from: owner });
        });

        it('should burn down half of staking balance for first user', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.closeTo(tokens(250), tokens(3 * 500).div(days(14)));
        });

        it('should hold full staking balance for second user', async function () {
          expect((await this.module.balances(bob))[0]).to.be.bignumber.closeTo(tokens(201), tokens(2 * 201).div(days(14)));
        });

        it('should have combined total staking balance', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(701));
        });

        it('should vest half of tokens from first user', async function () {
          expect((await this.module.markets(this.token.address)).vested).to.be.bignumber.closeTo(shares(250), shares(2 * 500).div(days(14)));
        });

        it('should decay half of debt from first user and add new debt from second user', async function () {
          expect((await this.module.markets(this.token.address)).debt).to.be.bignumber.closeTo(shares(90), DEBT_DELTA);
        });
      });

      describe('when half of vesting period has elapsed', function () {

        beforeEach(async function () {
          await setupTime(this.t0, days(14));
          const data = web3.eth.abi.encodeParameter('uint256', new BN(2));
          await this.module.update(bob, data, { from: owner });
        });

        it('should burn down entire staking balance for first user', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.closeTo(new BN(0), tokens(500).div(days(14)));
        });

        it('should burn down half of staking balance for second user', async function () {
          expect((await this.module.balances(bob))[0]).to.be.bignumber.closeTo(tokens(100.5), tokens(2 * 201).div(days(14)));
        });

        it('should have combined total staking balance', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(701));
        });

        it('should vest half of last unvested amount', async function () {
          expect((await this.module.markets(this.token.address)).vested).to.be.bignumber.closeTo(shares(475.5), SHARE_DELTA);
        });

        it('should decay half of last debt', async function () {
          expect((await this.module.markets(this.token.address)).debt).to.be.bignumber.closeTo(shares(45), DEBT_DELTA);
        });

        it('should update bond market last updated timestamp', async function () {
          expect((await this.module.markets(this.token.address)).updated).to.be.bignumber.closeTo(this.t0.add(days(14)), new BN(1));
        });

        it('should not affect the bond market vesting start timestamp', async function () {
          expect((await this.module.markets(this.token.address)).start).to.be.bignumber.closeTo(this.t0.add(days(7)), new BN(1));
        });

      });

      describe('when more than a full vesting period has elapsed', function () {

        beforeEach(async function () {
          await setupTime(this.t0, days(30));
          const data = web3.eth.abi.encodeParameter('uint256', new BN(2));
          await this.module.update(bob, data, { from: owner });
        });

        it('should burn down entire staking balance for first user', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(0));
        });

        it('should burn down entire staking balance for second user', async function () {
          expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(new BN(0));
        });

        it('should have combined total staking balance', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(701));
        });

        it('should fully vest spent tokens', async function () {
          expect((await this.module.markets(this.token.address)).vested).to.be.bignumber.equal(shares(701));
        });

        it('should fully decay debt', async function () {
          expect((await this.module.markets(this.token.address)).debt).to.be.bignumber.equal(new BN(0));
        });

        it('should update bond market last updated timestamp', async function () {
          expect((await this.module.markets(this.token.address)).updated).to.be.bignumber.closeTo(this.t0.add(days(30)), new BN(1));
        });

        it('should not affect the bond market vesting start timestamp', async function () {
          expect((await this.module.markets(this.token.address)).start).to.be.bignumber.closeTo(this.t0.add(days(7)), new BN(1));
        });

      });

    });

  });


  describe('unstake', function () {

    describe('when burndown is disabled', function () {

      beforeEach('setup', async function () {
        // owner creates bond module
        this.token = await TestToken.new({ from: org });
        this.module = await ERC20BondStakingModule.new(
          days(10),
          false,
          this.config.address,
          factory,
          { from: owner }
        );
        // open bond market
        await this.module.open(
          this.token.address,
          e18(3.0),
          e18(1.5 / 1000), // (4.5 - 3.0) / 1000e6 as e24
          shares(1000),
          shares(10000),
          { from: owner }
        );
        // acquire bond tokens and approve spending
        await this.token.transfer(alice, tokens(1000), { from: org });
        await this.token.transfer(bob, tokens(1000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: alice });
        await this.token.approve(this.module.address, tokens(100000), { from: bob });

        // alice and bob purchase bonds
        const data = web3.eth.abi.encodeParameter('address', this.token.address);
        await this.module.stake(alice, tokens(300), data, { from: owner }); // +100e6 debt
        this.t0 = (await this.module.markets(this.token.address)).updated;
        await setupTime(this.t0, days(2)); // decay -20e6 debt
        await this.module.stake(bob, tokens(156), data, { from: owner }); // price now @ 3.12
        this.t1 = (await this.module.markets(this.token.address)).updated;
      });

      describe('when user passes invalid encoded data', function () {
        it('should fail', async function () {
          await expectRevert(
            this.module.unstake(alice, new BN(0), [], { from: owner }),
            'bsm8'
          );
        });
      });

      describe('when user unstakes a bond they do not own', function () {
        it('should fail', async function () {
          const data = web3.eth.abi.encodeParameter('uint256', new BN(2));
          await expectRevert(
            this.module.unstake(alice, new BN(0), data, { from: owner }),
            'bsm9'
          );
        });
      });

      describe('when user unstakes a nonzero amount to recover remaining principal', function () {
        it('should fail', async function () {
          const data = web3.eth.abi.encodeParameter('uint256', new BN(1));
          await expectRevert(
            this.module.unstake(alice, tokens(100), data, { from: owner }),
            'bsm11'
          );
        });
      });

      describe('when one user unstakes all shares after half of vesting period', function () {

        beforeEach(async function () {
          // advance to 5 days
          await setupTime(this.t0, days(5));

          // unstake bond
          const data = web3.eth.abi.encodeParameter('uint256', new BN(1));
          this.res = await this.module.unstake(alice, new BN(0), data, { from: owner });
        });

        it('should have zero staking balance for user', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(0));
        });

        it('should not affect total staking balance', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(456));
        });

        it('should not increase user token balance', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(tokens(700));
        });

        it('should clear unstaked bond position', async function () {
          const b = await this.module.bonds(new BN(1));
          expect(b.market).to.equal(constants.ZERO_ADDRESS);
          expect(b.principal).to.be.bignumber.equal(new BN(0));
          expect(b.debt).to.be.bignumber.equal(new BN(0));
          expect(b.timestamp).to.be.bignumber.equal(new BN(0));
        });

        it('should clear the bond owner', async function () {
          await expectRevert(this.module.ownerOf(1), 'ERC721: invalid token ID');
        });

        it('should clear the owner bond mapping', async function () {
          expect(await this.module.ownerBonds(alice, 0)).to.be.bignumber.equal(new BN(0));
        });

        it('should clear the bond index mapping', async function () {
          expect(await this.module.bondIndex(1)).to.be.bignumber.equal(new BN(0));
        });

        it('should decrease bond count for user', async function () {
          expect(await this.module.balanceOf(alice)).to.be.bignumber.equal(new BN(0));
        });

        it('should decay bond market debt', async function () {
          // 100 - 0.2 * 100 + 50 - 0.3 * (80 + 50)
          expect((await this.module.markets(this.token.address)).debt).to.be.bignumber.closeTo(shares(91), DEBT_DELTA);
        });

        it('should not affect vested spent tokens', async function () {
          expect((await this.module.markets(this.token.address)).vested).to.be.bignumber.equal(shares(456));
        });

        it('should not affect total bond market capacity', async function () {
          expect((await this.module.markets(this.token.address)).capacity).to.be.bignumber.closeTo(shares(9850), DEBT_DELTA);
        });

        it('should not affect total bond market token shares', async function () {
          expect((await this.module.markets(this.token.address)).principal).to.be.bignumber.equal(shares(456));
        });

        it('should update bond market last updated timestamp', async function () {
          expect((await this.module.markets(this.token.address)).updated).to.be.bignumber.closeTo(this.t0.add(days(5)), new BN(1));
        });

        it('should not affect the bond market vesting start timestamp', async function () {
          expect((await this.module.markets(this.token.address)).start).to.be.bignumber.equal(this.t1);
        });

        it('should emit Unstaked event', async function () {
          expectEvent(
            this.res,
            'Unstaked',
            { user: alice, token: this.token.address, amount: new BN(0), shares: shares(100) }
          );
        });
      });


      describe('when user unstakes one of many bonds', function () {

        beforeEach(async function () {
          // alice buys two more bonds
          const data0 = web3.eth.abi.encodeParameter('address', this.token.address);
          await setupTime(this.t0, days(3));
          await this.module.stake(alice, tokens(200), data0, { from: owner }); // token id: 3
          await setupTime(this.t0, days(4));
          await this.module.stake(alice, tokens(100), data0, { from: owner });

          // advance to 5 days
          await setupTime(this.t0, days(5));

          // unstake bond
          const data1 = web3.eth.abi.encodeParameter('uint256', new BN(3));
          this.res = await this.module.unstake(alice, new BN(0), data1, { from: owner });
        });

        it('should not affect total staking balance', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(756));
        });

        it('should not increase user token balance', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(tokens(400));
        });

        it('should clear unstaked bond position', async function () {
          const b = await this.module.bonds(new BN(3));
          expect(b.market).to.equal(constants.ZERO_ADDRESS);
          expect(b.principal).to.be.bignumber.equal(new BN(0));
          expect(b.debt).to.be.bignumber.equal(new BN(0));
          expect(b.timestamp).to.be.bignumber.equal(new BN(0));
        });

        it('should clear the bond owner', async function () {
          await expectRevert(this.module.ownerOf(3), 'ERC721: invalid token ID');
        });

        it('should reindex the owner bond mapping', async function () {
          expect(await this.module.ownerBonds(alice, 0)).to.be.bignumber.equal(new BN(1));
          expect(await this.module.ownerBonds(alice, 1)).to.be.bignumber.equal(new BN(4));
        });

        it('should clear the bond index mapping', async function () {
          expect(await this.module.bondIndex(3)).to.be.bignumber.equal(new BN(0));
        });

        it('should reindex the remaining bond index mapping', async function () {
          expect(await this.module.bondIndex(1)).to.be.bignumber.equal(new BN(0));
          expect(await this.module.bondIndex(4)).to.be.bignumber.equal(new BN(1));
        });

        it('should decrease bond count for user', async function () {
          expect(await this.module.balanceOf(alice)).to.be.bignumber.equal(new BN(2));
        });

        it('should emit Unstaked event', async function () {
          expectEvent(
            this.res,
            'Unstaked',
            { user: alice, token: this.token.address, amount: new BN(0) }
          );
        });
      });

    });

    describe('when burndown is enabled', function () {

      beforeEach('setup', async function () {
        // owner creates bond module
        this.token = await TestToken.new({ from: org });
        this.module = await ERC20BondStakingModule.new(
          days(10),
          true,
          this.config.address,
          factory,
          { from: owner }
        );
        // open bond market
        await this.module.open(
          this.token.address,
          e18(3.0),
          e18(1.5 / 1000), // (4.5 - 3.0) / 1000e6
          shares(1000),
          shares(10000),
          { from: owner }
        );
        // acquire bond tokens and approve spending
        await this.token.transfer(alice, tokens(1000), { from: org });
        await this.token.transfer(bob, tokens(1000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: alice });
        await this.token.approve(this.module.address, tokens(100000), { from: bob });

        // purchase bonds two days apart
        const data = web3.eth.abi.encodeParameter('address', this.token.address);
        await this.module.stake(alice, tokens(300), data, { from: owner }); // +100e6 debt
        this.t0 = (await this.module.markets(this.token.address)).updated;
        await setupTime(this.t0, days(2)); // decay -20e6 debt
        await this.module.stake(bob, tokens(156), data, { from: owner }); // price now @ 3.12
        this.t1 = (await this.module.markets(this.token.address)).updated;
      });

      describe('when one user unstakes all shares after half of vesting period', function () {

        beforeEach(async function () {
          // advance to 5 days
          await setupTime(this.t0, days(5));

          // unstake bond
          const data = web3.eth.abi.encodeParameter('uint256', new BN(1));
          this.res = await this.module.unstake(alice, new BN(0), data, { from: owner });
        });

        it('should have zero staking balance for user', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(0));
        });

        it('should reduce total staking balance by half of user principal', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.closeTo(tokens(306), TOKEN_DELTA);
        });

        it('should increase user token balance by half of principal', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(tokens(850), TOKEN_DELTA);
        });

        it('should clear unstaked bond position', async function () {
          const b = await this.module.bonds(new BN(1));
          expect(b.market).to.equal(constants.ZERO_ADDRESS);
          expect(b.principal).to.be.bignumber.equal(new BN(0));
          expect(b.debt).to.be.bignumber.equal(new BN(0));
          expect(b.timestamp).to.be.bignumber.equal(new BN(0));
        });

        it('should clear the bond owner', async function () {
          await expectRevert(this.module.ownerOf(1), 'ERC721: invalid token ID');
        });

        it('should clear the owner bond mapping', async function () {
          expect(await this.module.ownerBonds(alice, 0)).to.be.bignumber.equal(new BN(0));
        });

        it('should clear the bond index mapping', async function () {
          expect(await this.module.bondIndex(1)).to.be.bignumber.equal(new BN(0));
        });

        it('should decrease bond count for user', async function () {
          expect(await this.module.balanceOf(alice)).to.be.bignumber.equal(new BN(0));
        });

        it('should decay bond market debt and remove unvested unstaked debt', async function () {
          // 100 - 0.2 * 100 + 50 - 0.3 * (80 + 50) - 0.5 * 100
          expect((await this.module.markets(this.token.address)).debt).to.be.bignumber.closeTo(shares(41), DEBT_DELTA);
        });

        it('should increase vested spent tokens', async function () {
          // 0.2 * 300 + 0.3 * (240 + 156)
          expect((await this.module.markets(this.token.address)).vested).to.be.bignumber.closeTo(shares(178.8), SHARE_DELTA);
        });

        it('should increase total bond market capacity', async function () {
          expect((await this.module.markets(this.token.address)).capacity).to.be.bignumber.closeTo(shares(9850 + 50), DEBT_DELTA);
        });

        it('should decrease total bond market token shares', async function () {
          expect((await this.module.markets(this.token.address)).principal).to.be.bignumber.closeTo(shares(306), SHARE_DELTA);
        });

        it('should update bond market last updated timestamp', async function () {
          expect((await this.module.markets(this.token.address)).updated).to.be.bignumber.closeTo(this.t0.add(days(5)), new BN(1));
        });

        it('should not affect the bond market vesting start timestamp', async function () {
          expect((await this.module.markets(this.token.address)).start).to.be.bignumber.equal(this.t1);
        });

        it('should emit Unstaked event', async function () {
          const e = this.res.logs.filter(l => l.event === 'Unstaked')[0];
          expect(e.args.user).eq(alice);
          expect(e.args.token).eq(this.token.address);
          expect(e.args.amount).to.be.bignumber.closeTo(tokens(150), TOKEN_DELTA);
          expect(e.args.shares).to.be.bignumber.equal(shares(100));
        });
      });

      describe('when one user unstakes half of shares after half of vesting period', function () {

        beforeEach(async function () {
          // advance to 5 days
          await setupTime(this.t0, days(5));

          // unstake bond
          const data = web3.eth.abi.encodeParameter('uint256', new BN(1));
          this.res = await this.module.unstake(alice, tokens(75), data, { from: owner });
        });

        it('should reduce staking balance for user by 3/4', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.closeTo(tokens(75), TOKEN_DELTA);
        });

        it('should reduce total staking balance by 1/4 of user principal', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(381)); // should be exact
        });

        it('should increase user token balance by 1/4 of principal', async function () {
          expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(tokens(775)); // should be exact
        });

        it('should update bond position', async function () {
          const b = await this.module.bonds(new BN(1));
          expect(b.market).to.equal(this.token.address);
          expect(b.principal).to.be.bignumber.closeTo(shares(150), SHARE_DELTA);
          expect(b.debt).to.be.bignumber.closeTo(shares(50), DEBT_DELTA);
          expect(b.timestamp).to.be.bignumber.equal(this.t0);
        });

        it('should keep the bond owner', async function () {
          expect(await this.module.ownerOf(1)).to.be.equal(alice);
        });

        it('should keep the owner bond mapping', async function () {
          expect(await this.module.ownerBonds(alice, 0)).to.be.bignumber.equal(new BN(1));
        });

        it('should keep the bond index mapping', async function () {
          expect(await this.module.bondIndex(1)).to.be.bignumber.equal(new BN(0));
        });

        it('should not affect bond count for user', async function () {
          expect(await this.module.balanceOf(alice)).to.be.bignumber.equal(new BN(1));
        });

        it('should decay bond market debt and remove unvested unstaked debt', async function () {
          // 100 - 0.2 * 100 + 50 - 0.3 * (80 + 50) - 0.25 * 100
          expect((await this.module.markets(this.token.address)).debt).to.be.bignumber.closeTo(shares(66), DEBT_DELTA);
        });

        it('should increase vested spent tokens', async function () {
          // 0.2 * 300 + 0.3 * (240 + 156)
          expect((await this.module.markets(this.token.address)).vested).to.be.bignumber.closeTo(shares(178.8), SHARE_DELTA);
        });

        it('should increase total bond market capacity', async function () {
          expect((await this.module.markets(this.token.address)).capacity).to.be.bignumber.closeTo(shares(9850 + 25), DEBT_DELTA);
        });

        it('should decrease total bond market token shares', async function () {
          expect((await this.module.markets(this.token.address)).principal).to.be.bignumber.equal(shares(381));
        });

        it('should update bond market last updated timestamp', async function () {
          expect((await this.module.markets(this.token.address)).updated).to.be.bignumber.closeTo(this.t0.add(days(5)), new BN(1));
        });

        it('should not affect the bond market vesting start timestamp', async function () {
          expect((await this.module.markets(this.token.address)).start).to.be.bignumber.equal(this.t1);
        });

        it('should emit Unstaked event', async function () {
          const e = this.res.logs.filter(l => l.event === 'Unstaked')[0];
          expect(e.args.user).eq(alice);
          expect(e.args.token).eq(this.token.address);
          expect(e.args.amount).to.be.bignumber.equal(tokens(75)); // should be exact
          expect(e.args.shares).to.be.bignumber.closeTo(shares(50), SHARE_DELTA);
        });
      });

      describe('when one user unstakes all shares in multiple operations', function () {

        beforeEach(async function () {
          // advance to 5 days
          await setupTime(this.t0, days(5));

          // unstake bond
          const data = web3.eth.abi.encodeParameter('uint256', new BN(1));
          await this.module.unstake(alice, tokens(75), data, { from: owner }); // 75 tokens, 50e6 debt remaining

          // advance another 2 days
          await setupTime(this.t0, days(7)); // should have 45 tokens remaining (30% of 150 principal still staked)

          // unstake all
          this.res = await this.module.unstake(alice, new BN(0), data, { from: owner });
        });

        it('should have zero staking balance for user', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(0));
        });

        it('should reduce total staking balance by unvested amount of user principal', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.closeTo(tokens(336), TOKEN_DELTA);
        });

        it('should increase user token balance by remainder of principal', async function () {
          // 700 + 75 + 45
          expect(await this.token.balanceOf(alice)).to.be.bignumber.closeTo(tokens(820), TOKEN_DELTA);
        });

        it('should clear bond position', async function () {
          const b = await this.module.bonds(new BN(1));
          expect(b.market).to.equal(constants.ZERO_ADDRESS);
          expect(b.principal).to.be.bignumber.equal(new BN(0));
          expect(b.debt).to.be.bignumber.equal(new BN(0));
          expect(b.timestamp).to.be.bignumber.equal(new BN(0));
        });

        it('should clear the bond owner', async function () {
          await expectRevert(this.module.ownerOf(1), 'ERC721: invalid token ID');
        });

        it('should clear the owner bond mapping', async function () {
          expect(await this.module.ownerBonds(alice, 0)).to.be.bignumber.equal(new BN(0));
        });

        it('should clear the bond index mapping', async function () {
          expect(await this.module.bondIndex(1)).to.be.bignumber.equal(new BN(0));
        });

        it('should decrease bond count for user', async function () {
          expect(await this.module.balanceOf(alice)).to.be.bignumber.equal(new BN(0));
        });

        it('should decay bond market debt and remove unvested unstaked debt', async function () {
          // 100 - 0.2 * 100 + 50 - 0.3 * (80 + 50) - 0.5 * 50 - (2 / 7) * 66 - 0.3 * 50
          expect((await this.module.markets(this.token.address)).debt).to.be.bignumber.closeTo(shares(32.142857), DEBT_DELTA);
        });

        it('should increase vested spent tokens', async function () {
          // 0.2 * 300 + 0.3 * (240 + 156) + (2 / 7) * (456 - 75 - 178.8)
          expect((await this.module.markets(this.token.address)).vested).to.be.bignumber.closeTo(shares(236.5714), SHARE_DELTA);
        });

        it('should increase total bond market capacity', async function () {
          expect((await this.module.markets(this.token.address)).capacity).to.be.bignumber.closeTo(shares(9850 + 25 + 15), DEBT_DELTA);
        });

        it('should decrease total bond market token shares', async function () {
          expect((await this.module.markets(this.token.address)).principal).to.be.bignumber.closeTo(shares(381 - 45), SHARE_DELTA);
        });

        it('should update bond market last updated timestamp', async function () {
          expect((await this.module.markets(this.token.address)).updated).to.be.bignumber.closeTo(this.t0.add(days(7)), new BN(1));
        });

        it('should not affect the bond market vesting start timestamp', async function () {
          expect((await this.module.markets(this.token.address)).start).to.be.bignumber.equal(this.t1);
        });

        it('should emit Unstaked event', async function () {
          const e = this.res.logs.filter(l => l.event === 'Unstaked')[0];
          expect(e.args.user).eq(alice);
          expect(e.args.token).eq(this.token.address);
          expect(e.args.amount).to.be.bignumber.closeTo(tokens(45), TOKEN_DELTA);
          expect(e.args.shares).to.be.bignumber.closeTo(shares(50), SHARE_DELTA);
        });

      });

      describe('when one user unstakes some shares in multiple operations', function () {
        beforeEach(async function () {
          // advance to 5 days
          await setupTime(this.t0, days(5));

          // unstake bond
          const data = web3.eth.abi.encodeParameter('uint256', new BN(1));
          await this.module.unstake(alice, tokens(75), data, { from: owner }); // 75 tokens, 50e6 debt remaining

          // advance another 2 days
          await setupTime(this.t0, days(7)); // should have 45 tokens remaining (30% of 150 principal still staked)

          // unstake some
          this.res = await this.module.unstake(alice, tokens(27), data, { from: owner }); // 18 tokens, 20e6 debt remaining
        });

        it('should have zero staking balance for user', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.closeTo(tokens(18), TOKEN_DELTA);
        });

        it('should reduce total staking balance by unstaked amount', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(354));
        });

        it('should increase user token balance by remainder of principal', async function () {
          // 700 + 75 + 27
          expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(tokens(802));
        });

        it('should update bond position', async function () {
          const b = await this.module.bonds(new BN(1));
          expect(b.market).to.equal(this.token.address);
          expect(b.principal).to.be.bignumber.closeTo(shares(60), SHARE_DELTA);
          expect(b.debt).to.be.bignumber.closeTo(shares(20), DEBT_DELTA);
          expect(b.timestamp).to.be.bignumber.equal(this.t0);
        });

        it('should keep the bond owner', async function () {
          expect(await this.module.ownerOf(1)).to.be.equal(alice);
        });

        it('should keep the owner bond mapping', async function () {
          expect(await this.module.ownerBonds(alice, 0)).to.be.bignumber.equal(new BN(1));
        });

        it('should keep the bond index mapping', async function () {
          expect(await this.module.bondIndex(1)).to.be.bignumber.equal(new BN(0));
        });

        it('should not affect bond count for user', async function () {
          expect(await this.module.balanceOf(alice)).to.be.bignumber.equal(new BN(1));
        });

        it('should decay bond market debt and remove unvested unstaked debt', async function () {
          // 100 - 0.2 * 100 + 50 - 0.3 * (80 + 50) - 0.25 * 100 - (2 / 7) * 66 - 0.3 * 30
          expect((await this.module.markets(this.token.address)).debt).to.be.bignumber.closeTo(shares(38.142857), DEBT_DELTA);
        });

        it('should increase vested spent tokens', async function () {
          // 0.2 * 300 + 0.3 * (240 + 156) + (2 / 7) * (456 - 75 - 178.8)
          expect((await this.module.markets(this.token.address)).vested).to.be.bignumber.closeTo(shares(236.571428), SHARE_DELTA);
        });

        it('should increase total bond market capacity', async function () {
          expect((await this.module.markets(this.token.address)).capacity).to.be.bignumber.closeTo(shares(9850 + 25 + 9), DEBT_DELTA);
        });

        it('should decrease total bond market token shares', async function () {
          expect((await this.module.markets(this.token.address)).principal).to.be.bignumber.closeTo(shares(381 - 27), SHARE_DELTA);
        });

        it('should update bond market last updated timestamp', async function () {
          expect((await this.module.markets(this.token.address)).updated).to.be.bignumber.closeTo(this.t0.add(days(7)), new BN(1));
        });

        it('should not affect the bond market vesting start timestamp', async function () {
          expect((await this.module.markets(this.token.address)).start).to.be.bignumber.equal(this.t1);
        });

        it('should emit Unstaked event', async function () {
          const e = this.res.logs.filter(l => l.event === 'Unstaked')[0];
          expect(e.args.user).eq(alice);
          expect(e.args.token).eq(this.token.address);
          expect(e.args.amount).to.be.bignumber.equal(tokens(27)); // exact
          expect(e.args.shares).to.be.bignumber.closeTo(shares(30), SHARE_DELTA);
        });

      });

    });

    describe('when multiple complex token markets are open', function () {

      beforeEach('setup', async function () {
        // owner creates bond module
        this.token = await TestToken.new({ from: org });
        this.elastic = await TestElasticToken.new({ from: org });
        this.module = await ERC20BondStakingModule.new(
          days(10),
          true,
          this.config.address,
          factory,
          { from: owner }
        );
        // open bond markets
        await this.module.open(
          this.token.address,
          e18(3.0),
          e18(1.5 / 1000), // (4.5 - 3.0) / 1000e6
          shares(1000),
          shares(10000),
          { from: owner }
        );
        await this.module.open(
          this.elastic.address,
          e18(50.0),
          e18(25 / 500), // (75 - 50) / 500e6
          shares(200),
          shares(10000),
          { from: owner }
        );
        // acquire bond tokens and approve spending
        await this.token.transfer(alice, tokens(1000), { from: org });
        await this.token.transfer(bob, tokens(1000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: alice });
        await this.token.approve(this.module.address, tokens(100000), { from: bob });
        await this.elastic.transfer(alice, tokens(5000), { from: org });
        await this.elastic.transfer(bob, tokens(5000), { from: org });
        await this.elastic.approve(this.module.address, tokens(500000), { from: alice });
        await this.elastic.approve(this.module.address, tokens(500000), { from: bob });

        // purchase bonds in first market
        const data = web3.eth.abi.encodeParameter('address', this.token.address);
        await this.module.stake(alice, tokens(300), data, { from: owner }); // +100e6 debt
        this.t0 = (await this.module.markets(this.token.address)).updated;
        await setupTime(this.t0, days(2)); // decay -20e6 debt
        await this.module.stake(bob, tokens(156), data, { from: owner }); // price now @ 3.12
        this.t1 = (await this.module.markets(this.token.address)).updated;

        // purchase bonds in first market
        await setupTime(this.t0, days(5));
        const data1 = web3.eth.abi.encodeParameter('address', this.elastic.address);
        await this.module.stake(alice, tokens(2500), data1, { from: owner }); // +50e6 debt
        this.t2 = (await this.module.markets(this.elastic.address)).updated;
        await setupTime(this.t0, days(8)); // decay -15e6 debt
        await this.module.stake(bob, tokens(1035), data1, { from: owner }); // price now @ 51.75
        this.t3 = (await this.module.markets(this.elastic.address)).updated;
      });

      describe('when one user unstakes all shares on partially vested bond from first market', function () {

        beforeEach(async function () {
          // advance to 10 days
          await setupTime(this.t0, days(10));

          // unstake bond
          const data = web3.eth.abi.encodeParameter('uint256', new BN(2));
          this.res = await this.module.unstake(bob, new BN(0), data, { from: owner });
        });

        it('should have zero staking balance for user in first market', async function () {
          expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(new BN(0));
        });

        it('should not affect staking balance for user in second market', async function () {
          expect((await this.module.balances(bob))[1]).to.be.bignumber.closeTo(tokens(1035 * 0.8), TOKEN_DELTA_BIG);
        });

        it('should reduce total staking balance for first market', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.closeTo(tokens(456 - 0.2 * 156), TOKEN_DELTA);
        });

        it('should not affect total staking balance for second market', async function () {
          expect((await this.module.totals())[1]).to.be.bignumber.equal(tokens(3535));
        });

        it('should increase user token balance by remaining principal', async function () {
          expect(await this.token.balanceOf(bob)).to.be.bignumber.closeTo(tokens(844 + 0.2 * 156), TOKEN_DELTA);
        });

        it('should clear unstaked bond position', async function () {
          const b = await this.module.bonds(new BN(2));
          expect(b.market).to.equal(constants.ZERO_ADDRESS);
          expect(b.principal).to.be.bignumber.equal(new BN(0));
          expect(b.debt).to.be.bignumber.equal(new BN(0));
          expect(b.timestamp).to.be.bignumber.equal(new BN(0));
        });

        it('should clear the bond owner', async function () {
          await expectRevert(this.module.ownerOf(2), 'ERC721: invalid token ID');
        });

        it('should reindex the owner bond mapping', async function () {
          expect(await this.module.ownerBonds(bob, 0)).to.be.bignumber.equal(new BN(4));
          expect(await this.module.ownerBonds(bob, 1)).to.be.bignumber.equal(new BN(0));
        });

        it('should clear the bond index mapping', async function () {
          expect(await this.module.bondIndex(2)).to.be.bignumber.equal(new BN(0));
        });

        it('should decrease bond count for user', async function () {
          expect(await this.module.balanceOf(bob)).to.be.bignumber.equal(new BN(1));
        });

        it('should decay and decrease bond market debt', async function () {
          // 100 - 0.2 * 100 + 50 - 0.8 * (80 + 50) - 0.2 * 50
          expect((await this.module.markets(this.token.address)).debt).to.be.bignumber.closeTo(shares(16), DEBT_DELTA);
        });

        it('should increase vested spent tokens', async function () {
          // 0.2 * 300 + 0.8 * (240 + 156)
          expect((await this.module.markets(this.token.address)).vested).to.be.bignumber.closeTo(shares(376.8), SHARE_DELTA);
        });

        it('should increase total bond market capacity', async function () {
          expect((await this.module.markets(this.token.address)).capacity).to.be.bignumber.closeTo(shares(9850 + 10), DEBT_DELTA);
        });

        it('should decrease total bond market token shares', async function () {
          expect((await this.module.markets(this.token.address)).principal).to.be.bignumber.closeTo(shares(456 - 0.2 * 156), SHARE_DELTA);
        });

        it('should update bond market last updated timestamp', async function () {
          expect((await this.module.markets(this.token.address)).updated).to.be.bignumber.closeTo(this.t0.add(days(10)), new BN(1));
        });

        it('should not affect the bond market vesting start timestamp', async function () {
          expect((await this.module.markets(this.token.address)).start).to.be.bignumber.equal(this.t1);
        });

        it('should not affect or update other bond market', async function () {
          const m = await this.module.markets(this.elastic.address);
          expect(m.start).to.be.bignumber.equal(this.t3);
          expect(m.updated).to.be.bignumber.equal(this.t3);
          expect(m.debt).to.be.bignumber.closeTo(shares(55), DEBT_DELTA);
          expect(m.principal).to.be.bignumber.equal(shares(3535));
          expect(m.vested).to.be.bignumber.closeTo(shares(750), SHARE_DELTA_BIG);
        });

        it('should emit Unstaked event', async function () {
          const e = this.res.logs.filter(l => l.event === 'Unstaked')[0];
          expect(e.args.user).eq(bob);
          expect(e.args.token).eq(this.token.address);
          expect(e.args.amount).to.be.bignumber.closeTo(tokens(0.2 * 156), TOKEN_DELTA);
          expect(e.args.shares).to.be.bignumber.closeTo(shares(50), DEBT_DELTA);
        });
      });


      describe('when multiple bonds are unstaked from elastic token market', function () {

        beforeEach(async function () {
          // advance to 10 days
          await setupTime(this.t0, days(10));

          // unstake bond
          const data0 = web3.eth.abi.encodeParameter('uint256', new BN(3));
          this.res0 = await this.module.unstake(alice, new BN(0), data0, { from: owner }); // 50% vested

          // token supply expands
          await this.elastic.setCoefficient(e18(1.05));

          // unstake another bond
          setupTime(this.t0, days(15));
          const data1 = web3.eth.abi.encodeParameter('uint256', new BN(4));
          this.res1 = await this.module.unstake(bob, new BN(0), data1, { from: owner }); // 70% vested
        });

        it('should have zero staking balance for users in elastic market', async function () {
          expect((await this.module.balances(alice))[1]).to.be.bignumber.equal(new BN(0));
          expect((await this.module.balances(bob))[1]).to.be.bignumber.equal(new BN(0));
        });

        it('should not affect staking balances for users in first market', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(0)); // fully vested
          expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(new BN(0));
        });

        it('should reduce total staking balance for elastic market by unstakes but expand supply', async function () {
          // 3535 - 0.5 * 2500 - 0.3 * 1035  = 1974.5 -> *1.05 = 2073.225
          expect((await this.module.totals())[1]).to.be.bignumber.closeTo(tokens(2073.225), TOKEN_DELTA_BIG);
        });

        it('should not affect total staking balance for first market', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.closeTo(tokens(456), TOKEN_DELTA);
        });

        it('should increase first user token balance by remaining principal after expansion', async function () {
          expect(await this.elastic.balanceOf(alice)).to.be.bignumber.closeTo(tokens(1.05 * (2500 + 0.5 * 2500)), TOKEN_DELTA_BIG);
        });

        it('should increase second user token balance by remaining principal after expansion', async function () {
          expect(await this.elastic.balanceOf(bob)).to.be.bignumber.closeTo(tokens(1.05 * (3965 + 0.3 * 1035)), TOKEN_DELTA_BIG);
        });

        it('should clear unstaked bond positions', async function () {
          const b0 = await this.module.bonds(new BN(3));
          expect(b0.market).to.equal(constants.ZERO_ADDRESS);
          expect(b0.timestamp).to.be.bignumber.equal(new BN(0));
          const b1 = await this.module.bonds(new BN(4));
          expect(b1.market).to.equal(constants.ZERO_ADDRESS);
          expect(b1.timestamp).to.be.bignumber.equal(new BN(0));
        });

        it('should clear the bond owners', async function () {
          await expectRevert(this.module.ownerOf(3), 'ERC721: invalid token ID');
          await expectRevert(this.module.ownerOf(4), 'ERC721: invalid token ID');
        });

        it('should update the owner bond mappings', async function () {
          expect(await this.module.ownerBonds(alice, 0)).to.be.bignumber.equal(new BN(1));
          expect(await this.module.ownerBonds(alice, 1)).to.be.bignumber.equal(new BN(0));
          expect(await this.module.ownerBonds(bob, 0)).to.be.bignumber.equal(new BN(2));
          expect(await this.module.ownerBonds(bob, 1)).to.be.bignumber.equal(new BN(0));
        });

        it('should clear the bond index mapping', async function () {
          expect(await this.module.bondIndex(3)).to.be.bignumber.equal(new BN(0));
          expect(await this.module.bondIndex(4)).to.be.bignumber.equal(new BN(0));
        });

        it('should decrease bond count for users', async function () {
          expect(await this.module.balanceOf(alice)).to.be.bignumber.equal(new BN(1));
          expect(await this.module.balanceOf(bob)).to.be.bignumber.equal(new BN(1));
        });

        it('should decay and decrease bond market debt', async function () {
          // 50 - 0.3 * 50 + 20 - 0.2 * (35 + 20) - 0.5 * 50 = 19
          // 19 - (5 / 8) * 19 - 0.3 * 20 = 1.125
          expect((await this.module.markets(this.elastic.address)).debt).to.be.bignumber.closeTo(shares(1.125), DEBT_DELTA);
        });

        it('should increase vested spent tokens', async function () {
          // 0.3 * 2500 + 0.2 * (1750 + 1035) = 1307
          // 1307 + (5 / 8) * (2285 - 1307) = 1918.25
          expect((await this.module.markets(this.elastic.address)).vested).to.be.bignumber.closeTo(shares(1918.25), SHARE_DELTA_BIG);
        });

        it('should increase total bond market capacity', async function () {
          expect((await this.module.markets(this.elastic.address)).capacity).to.be.bignumber.closeTo(shares(9930 + 25 + 6), DEBT_DELTA);
        });

        it('should decrease total bond market token shares ignoring expansion', async function () {
          expect((await this.module.markets(this.elastic.address)).principal).to.be.bignumber.closeTo(shares(1974.5), SHARE_DELTA_BIG);
        });

        it('should update bond market last updated timestamp', async function () {
          expect((await this.module.markets(this.elastic.address)).updated).to.be.bignumber.closeTo(this.t0.add(days(15)), new BN(1));
        });

        it('should not affect the bond market vesting start timestamp', async function () {
          expect((await this.module.markets(this.elastic.address)).start).to.be.bignumber.equal(this.t3);
        });

        it('should not affect or update other bond market', async function () {
          const m = await this.module.markets(this.token.address);
          expect(m.start).to.be.bignumber.equal(this.t1);
          expect(m.updated).to.be.bignumber.equal(this.t1);
          expect(m.debt).to.be.bignumber.closeTo(shares(130), DEBT_DELTA);
          expect(m.principal).to.be.bignumber.closeTo(shares(456), SHARE_DELTA);
          expect(m.vested).to.be.bignumber.closeTo(shares(60), SHARE_DELTA);
        });

        it('should emit first Unstaked event with amount before expansion', async function () {
          const e = this.res0.logs.filter(l => l.event === 'Unstaked')[0];
          expect(e.args.user).eq(alice);
          expect(e.args.token).eq(this.elastic.address);
          expect(e.args.amount).to.be.bignumber.closeTo(tokens(1250), TOKEN_DELTA_BIG);
          expect(e.args.shares).to.be.bignumber.equal(shares(50));
        });

        it('should emit second Unstaked event with amount after expansion', async function () {
          const e = this.res1.logs.filter(l => l.event === 'Unstaked')[0];
          expect(e.args.user).eq(bob);
          expect(e.args.token).eq(this.elastic.address);
          expect(e.args.amount).to.be.bignumber.closeTo(tokens(1.05 * 0.3 * 1035), TOKEN_DELTA_BIG);
          expect(e.args.shares).to.be.bignumber.closeTo(shares(20), DEBT_DELTA);
        });
      });

    });

  });

  describe('claim', function () {

    beforeEach(async function () {
      // owner creates bond module
      this.token = await TestToken.new({ from: org });
      this.module = await ERC20BondStakingModule.new(
        days(10),
        true,
        this.config.address,
        factory,
        { from: owner }
      );
      // open bond market
      await this.module.open(
        this.token.address,
        e18(3.0),
        e18(1.5 / 1000), // (4.5 - 3.0) / 1000e6
        shares(1000),
        shares(10000),
        { from: owner }
      );
      // acquire bond tokens and approve spending
      await this.token.transfer(alice, tokens(1000), { from: org });
      await this.token.transfer(bob, tokens(1000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: alice });
      await this.token.approve(this.module.address, tokens(100000), { from: bob });

      // alice and bob purchase bonds
      const data = web3.eth.abi.encodeParameter('address', this.token.address);
      await this.module.stake(alice, tokens(300), data, { from: owner }); // +100e6 debt
      this.t0 = (await this.module.markets(this.token.address)).updated;
      await setupTime(this.t0, days(2)); // decay -20e6 debt
      await this.module.stake(bob, tokens(156), data, { from: owner }); // price now @ 3.12
      this.t1 = (await this.module.markets(this.token.address)).updated;
    });

    describe('when user claims passes invalid data', function () {
      it('should fail', async function () {
        const data = web3.eth.abi.encodeParameter('string', 'hello world');
        await expectRevert(
          this.module.claim(alice, new BN(0), data, { from: owner }),
          'bsm15'
        );
      });
    });

    describe('when user claims on a bond they do not own', function () {
      it('should fail', async function () {
        const data = web3.eth.abi.encodeParameter('uint256', new BN(2));
        await expectRevert(
          this.module.claim(alice, new BN(0), data, { from: owner }),
          'bsm16'
        );
      });
    });


    describe('when one user claims', function () {

      beforeEach(async function () {
        // advance to 5 days
        await setupTime(this.t0, days(5));

        // claim on bond
        const data = web3.eth.abi.encodeParameter('uint256', new BN(1));
        this.res = await this.module.claim(alice, new BN(0), data, { from: owner });
      });

      it('should not affect decayed staking balance for user', async function () {
        expect((await this.module.balances(alice))[0]).to.be.bignumber.closeTo(tokens(150), TOKEN_DELTA);
      });

      it('should not affect total staking balance', async function () {
        expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(456));
      });

      it('should not increase user token balance', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(tokens(700));
      });

      it('should not affect bond position', async function () {
        const b = await this.module.bonds(new BN(1));
        expect(b.market).to.equal(this.token.address);
        expect(b.principal).to.be.bignumber.equal(shares(300));
        expect(b.debt).to.be.bignumber.equal(shares(100));
        expect(b.timestamp).to.be.bignumber.equal(this.t0);
      });

      it('should not affect the bond owner', async function () {
        expect(await this.module.ownerOf(1)).to.be.equal(alice);
      });

      it('should not affect the owner bond mapping', async function () {
        expect(await this.module.ownerBonds(alice, 0)).to.be.bignumber.equal(new BN(1));
      });

      it('should not affect the bond index mapping', async function () {
        expect(await this.module.bondIndex(1)).to.be.bignumber.equal(new BN(0));
      });

      it('should not affect bond count for user', async function () {
        expect(await this.module.balanceOf(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should decay bond market debt in update', async function () {
        // 100 - 0.2 * 100 + 50 - 0.3 * (80 + 50)
        expect((await this.module.markets(this.token.address)).debt).to.be.bignumber.closeTo(shares(91), DEBT_DELTA);
      });

      it('should vest some spent tokens in update', async function () {
        // 0.2 * 300 + 0.3 * (240 + 156)
        expect((await this.module.markets(this.token.address)).vested).to.be.bignumber.closeTo(shares(178.8), SHARE_DELTA);
      });

      it('should not affect total bond market capacity', async function () {
        expect((await this.module.markets(this.token.address)).capacity).to.be.bignumber.closeTo(shares(9850), DEBT_DELTA);
      });

      it('should not affect total bond market token shares', async function () {
        expect((await this.module.markets(this.token.address)).principal).to.be.bignumber.equal(shares(456));
      });

      it('should update bond market last updated timestamp', async function () {
        expect((await this.module.markets(this.token.address)).updated).to.be.bignumber.closeTo(this.t0.add(days(5)), new BN(1));
      });

      it('should not affect the bond market vesting start timestamp', async function () {
        expect((await this.module.markets(this.token.address)).start).to.be.bignumber.equal(this.t1);
      });

      it('should emit Claimed event', async function () {
        expectEvent(
          this.res,
          'Claimed',
          { user: alice, token: this.token.address, amount: new BN(0), shares: shares(100) }
        );
      });
    });

  });


  describe('transfer', function () {

    beforeEach(async function () {
      // owner creates bond module
      this.token = await TestToken.new({ from: org });
      this.module = await ERC20BondStakingModule.new(
        days(10),
        true,
        this.config.address,
        factory,
        { from: owner }
      );
      // open bond market
      await this.module.open(
        this.token.address,
        e18(3.0),
        e18(1.5 / 1000), // (4.5 - 3.0) / 1000e6
        shares(1000),
        shares(10000),
        { from: owner }
      );
      // acquire bond tokens and approve spending
      await this.token.transfer(alice, tokens(1000), { from: org });
      await this.token.transfer(bob, tokens(1000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: alice });
      await this.token.approve(this.module.address, tokens(100000), { from: bob });

      // alice and bob purchase bonds
      const data = web3.eth.abi.encodeParameter('address', this.token.address);
      await this.module.stake(alice, tokens(300), data, { from: owner }); // +100e6 debt
      this.t0 = (await this.module.markets(this.token.address)).updated;
      await setupTime(this.t0, days(2)); // decay -20e6 debt

      await this.module.stake(bob, tokens(156), data, { from: owner }); // price now @ 3.12, +50e6 debt
      this.t1 = (await this.module.markets(this.token.address)).updated;
      await setupTime(this.t0, days(4)); // decay -26e6 debt

      await this.module.stake(alice, tokens(236.7), data, { from: owner }); // price now @ 3.156, +75e6 debt
      this.t2 = (await this.module.markets(this.token.address)).updated;
    });

    describe('when user transfers a bond position that does not exist', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.transferFrom(alice, bob, new BN(5), { from: alice }),
          'ERC721: invalid token ID'
        );
      });
    });

    describe('when user transfers a bond position they do not own', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.transferFrom(alice, bob, new BN(2), { from: alice }),
          'ERC721: caller is not token owner or approved'
        );
      });
    });

    describe('when user safe transfers a bond position they do not own', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.safeTransferFrom(alice, bob, new BN(2), { from: alice }),
          'ERC721: caller is not token owner or approved'
        );
      });
    });

    describe('when user transfers a bond position that they already transferred', function () {
      it('should fail', async function () {
        await this.module.transferFrom(alice, bob, new BN(1), { from: alice });
        await expectRevert(
          this.module.transferFrom(alice, other, new BN(1), { from: alice }),
          'ERC721: caller is not token owner or approved'
        );
      });
    });

    describe('when user claims on a bond that they already transferred', function () {
      it('should fail', async function () {
        await this.module.transferFrom(alice, bob, new BN(1), { from: alice });
        const data = web3.eth.abi.encodeParameter('uint256', new BN(1));
        await expectRevert(
          this.module.claim(alice, new BN(1), data, { from: owner }),
          'bsm16'
        );
      });
    });


    describe('when user transfers tokenized bond position', function () {

      beforeEach(async function () {
        // advance to 5 days
        await setupTime(this.t0, days(5));

        // transfer from alice to bob
        this.res = await this.module.transferFrom(alice, bob, new BN(1), { from: alice });
      });

      it('should decrease bond count for sender', async function () {
        expect(await this.module.balanceOf(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should increase bond count for receiver', async function () {
        expect(await this.module.balanceOf(bob)).to.be.bignumber.equal(new BN(2));
      });

      it('should decrease staking balance for sender', async function () {
        // 0.9 * 236.7
        expect((await this.module.balances(alice))[0]).to.be.bignumber.closeTo(tokens(213.03), TOKEN_DELTA);
      });

      it('should increase staking balance for sender', async function () {
        // 0.5 * 300 + 0.7 * 156
        expect((await this.module.balances(bob))[0]).to.be.bignumber.closeTo(tokens(259.2), TOKEN_DELTA);
      });

      it('should not affect total staking balance', async function () {
        expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(692.7));
      });

      it('should not affect user token balances', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(tokens(463.3));
        expect(await this.token.balanceOf(bob)).to.be.bignumber.equal(tokens(844));
      });

      it('should not affect transferred bond position', async function () {
        const b = await this.module.bonds(new BN(1));
        expect(b.market).to.equal(this.token.address);
        expect(b.principal).to.be.bignumber.equal(shares(300));
        expect(b.debt).to.be.bignumber.equal(shares(100));
        expect(b.timestamp).to.be.bignumber.equal(this.t0);
      });

      it('should change the bond owner', async function () {
        expect(await this.module.ownerOf(1)).to.be.equal(bob);
      });

      it('should reindex the owner bond mapping for sender', async function () {
        expect(await this.module.ownerBonds(alice, 0)).to.be.bignumber.equal(new BN(3));
      });

      it('should extend the owner bond mapping for sender', async function () {
        expect(await this.module.ownerBonds(bob, 0)).to.be.bignumber.equal(new BN(2));
        expect(await this.module.ownerBonds(bob, 1)).to.be.bignumber.equal(new BN(1));
      });

      it('should update the bond index mapping', async function () {
        expect(await this.module.bondIndex(1)).to.be.bignumber.equal(new BN(1));
        expect(await this.module.bondIndex(3)).to.be.bignumber.equal(new BN(0));
      });

      it('should not affect total bond market capacity', async function () {
        expect((await this.module.markets(this.token.address)).capacity).to.be.bignumber.closeTo(shares(9775), SHARE_DELTA);
      });

      it('should not affect total bond market token shares', async function () {
        expect((await this.module.markets(this.token.address)).principal).to.be.bignumber.equal(shares(692.7));
      });

      it('should emit Transfer event', async function () {
        expectEvent(
          this.res,
          'Transfer',
          { from: alice, to: bob, tokenId: new BN(1) }
        );
      });
    });


    describe('when receiver unstakes transferred bond position', function () {

      beforeEach(async function () {
        // transfer from alice to bob
        await this.module.transferFrom(alice, bob, new BN(1), { from: alice });

        // advance to 5 days
        await setupTime(this.t0, days(5));

        // unstake bond
        const data = web3.eth.abi.encodeParameter('uint256', new BN(1));
        this.res = await this.module.unstake(bob, new BN(0), data, { from: owner });
      });

      it('should decrease bond count for receiver', async function () {
        expect(await this.module.balanceOf(alice)).to.be.bignumber.equal(new BN(1));
      });

      it('should not affect staking balance for original holder', async function () {
        // 0.9 * 236.7
        expect((await this.module.balances(alice))[0]).to.be.bignumber.closeTo(tokens(213.03), TOKEN_DELTA);
      });

      it('should decrease staking balance for receiver', async function () {
        // 0.5 * 300 + 0.7 * 156 - 150
        expect((await this.module.balances(bob))[0]).to.be.bignumber.closeTo(tokens(109.2), TOKEN_DELTA);
      });

      it('should decrease total staking balance', async function () {
        // -150
        expect((await this.module.totals())[0]).to.be.bignumber.closeTo(tokens(542.7), TOKEN_DELTA);
      });

      it('should increase receiver token balance', async function () {
        expect(await this.token.balanceOf(bob)).to.be.bignumber.closeTo(tokens(994), TOKEN_DELTA);
      });

      it('should not affect original holder token balance', async function () {
        expect(await this.token.balanceOf(alice)).to.be.bignumber.equal(tokens(463.3));
      });

      it('should clear unstaked bond position', async function () {
        const b = await this.module.bonds(new BN(1));
        expect(b.market).to.equal(constants.ZERO_ADDRESS);
        expect(b.principal).to.be.bignumber.equal(new BN(0));
        expect(b.debt).to.be.bignumber.equal(new BN(0));
        expect(b.timestamp).to.be.bignumber.equal(new BN(0));
      });

      it('should clear the bond owner', async function () {
        await expectRevert(this.module.ownerOf(1), 'ERC721: invalid token ID');
      });

      it('should clear the owner bond mapping', async function () {
        expect(await this.module.ownerBonds(bob, 1)).to.be.bignumber.equal(new BN(0));
      });

      it('should clear the bond index mapping', async function () {
        expect(await this.module.bondIndex(1)).to.be.bignumber.equal(new BN(0));
      });

      it('should decay bond market debt in update and remove unvested unstaked debt', async function () {
        // 100 - 0.2 * 100 + 50 - 0.2 * (80 + 50) + 75 - 0.1 * (104 + 75) - 0.5 * 100
        expect((await this.module.markets(this.token.address)).debt).to.be.bignumber.closeTo(shares(111.1), DEBT_DELTA);
      });

      it('should vest some spent tokens in update', async function () {
        // 0.2 * 300 + 0.2 * (240 + 156) + 0.1 * (316.8 + 236.7)
        expect((await this.module.markets(this.token.address)).vested).to.be.bignumber.closeTo(shares(194.55), SHARE_DELTA);
      });

      it('should emit Unstaked event', async function () {
        const e = this.res.logs.filter(l => l.event === 'Unstaked')[0];
        expect(e.args.user).eq(bob);
        expect(e.args.token).eq(this.token.address);
        expect(e.args.amount).to.be.bignumber.closeTo(tokens(150), TOKEN_DELTA);
        expect(e.args.shares).to.be.bignumber.equal(shares(100));
      });
    });

  });

  describe('metadata', function () {

    beforeEach(async function () {
      // configure metadata
      this.info = await ERC20BondStakingModuleInfo.new({ from: org });
      await this.config.setAddress(
        web3.utils.soliditySha3('gysr.core.bond.metadata'),
        this.info.address,
        { from: org }
      );

      // owner creates bond module
      this.token = await TestToken.new({ from: org });
      this.module = await ERC20BondStakingModule.new(
        days(10),
        true,
        this.config.address,
        factory,
        { from: owner }
      );
      // open bond market
      await this.module.open(
        this.token.address,
        e18(3.0),
        e18(1.5 / 1000), // (4.5 - 3.0) / 1000e6
        shares(1000),
        shares(10000),
        { from: owner }
      );
      // acquire bond tokens and approve spending
      await this.token.transfer(alice, tokens(1000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: alice });

      // alice purchases bond
      const data = web3.eth.abi.encodeParameter('address', this.token.address);
      await this.module.stake(alice, tokens(300), data, { from: owner }); // +100e6 debt
      this.t0 = (await this.module.markets(this.token.address)).updated;
    });

    describe('when getting bond metadata for invalid token id', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.tokenURI(new BN(3)),
          'ERC721: invalid token ID'
        );
      });
    });

    describe('when getting metadata for valid token id', function () {

      beforeEach(async function () {
        // get metadata
        this.res = await this.module.tokenURI(new BN(1));
      });

      it('should return a non zero length string bond count for sender', async function () {
        expect(this.res.length).gt(0);
      });

      it('should be equivalent to direct call to metadata library', async function () {
        const res = await this.info.metadata(this.module.address, new BN(1), [])
        expect(this.res).equal(res);
      });

    });

  });


  describe('adjust', function () {

    beforeEach(async function () {
      // owner creates bond module
      this.token = await TestToken.new({ from: org });
      this.module = await ERC20BondStakingModule.new(
        days(30),
        true,
        this.config.address,
        factory,
        { from: owner }
      );
      // open bond market
      await this.module.open(
        this.token.address,
        e18(3.00),
        e18(1.50 / 1000), // (4.50 - 3.00) / 1000e6
        shares(100),
        shares(1000),
        { from: owner }
      );
      // purchase bond
      await this.token.transfer(alice, tokens(1000), { from: org });
      await this.token.approve(this.module.address, tokens(100000), { from: alice });
      const data = web3.eth.abi.encodeParameter('address', this.token.address);
      await this.module.stake(alice, tokens(250), data, { from: owner });
    });

    describe('when caller does not control module', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.adjust(
            this.token.address,
            e18(5.25),
            e18(0.75 / 1000), // (6.00 - 5.25) / 1000e6
            shares(100),
            shares(2000),
            { from: other }),
          'oc2' // OwnerController: caller is not the controller
        );
      });
    });

    describe('when market does not exist', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.adjust(
            other,
            e18(5.25),
            e18(0.75 / 1000),
            shares(100),
            shares(2000),
            { from: owner }),
          'bsm25' // market does not exist
        );
      });
    });

    describe('when minimum price is zero', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.adjust(
            this.token.address,
            e18(0),
            e18(0.75 / 1000),
            shares(100),
            shares(2000),
            { from: owner }),
          'bsm26' // price is zero
        );
      });
    });

    describe('when max bond size is zero', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.adjust(
            this.token.address,
            e18(5.25),
            e18(0.75 / 1000),
            shares(0),
            shares(2000),
            { from: owner }),
          'bsm27' // max is zero
        );
      });
    });

    describe('when market capacity is zero', function () {
      it('should fail', async function () {
        await expectRevert(
          this.module.adjust(
            this.token.address,
            e18(5.25),
            e18(0.75 / 1000),
            shares(100),
            shares(0),
            { from: owner }),
          'bsm28' // capacity is zero
        );
      });
    });

    describe('when market is adjusted', function () {

      beforeEach(async function () {
        // advance time
        time.increase(days(7));

        // do adjustment
        this.res = await this.module.adjust(
          this.token.address,
          e18(5.25),
          e18(0.75 / 1000), // (6.0 - 5.25) / 1000e6
          shares(80),
          shares(2000),
          { from: owner }
        );
        this.t0 = (await this.module.markets(this.token.address)).updated;
      });

      describe('when no time has elapsed', function () {

        it('should create new adjustment entry', async function () {
          let adj = await this.module.adjustments(this.token.address);
          expect(adj.price).to.be.bignumber.equal(e18(5.25));
          expect(adj.coeff).to.be.bignumber.equal(new BN('750000000000000'));
          expect(adj.timestamp).to.be.bignumber.equal(this.t0);
        });

        it('should set new max bond size', async function () {
          expect((await this.module.markets(this.token.address)).max).to.be.bignumber.equal(shares(80));
        });

        it('should reset new bond market capacity', async function () {
          expect((await this.module.markets(this.token.address)).capacity).to.be.bignumber.equal(shares(2000));
        });

        it('should not change bond market price yet', async function () {
          expect((await this.module.markets(this.token.address)).price).to.be.bignumber.equal(e18(3.00));
        });

        it('should not change bond market coefficient yet', async function () {
          expect((await this.module.markets(this.token.address)).coeff).to.be.bignumber.equal(e18(1.5 / 1000));
        });

        it('should emit MarketAdjusted event', async function () {
          expectEvent(
            this.res,
            'MarketAdjusted',
            {
              token: this.token.address,
              price: e18(5.25),
              coeff: new BN('750000000000000'),
              max: shares(80),
              capacity: shares(2000)
            }
          );
        });

      });

      describe('when 1/3 of adjustment period has elapsed', function () {

        beforeEach(async function () {
          setupTime(this.t0, days(10));
          const data = web3.eth.abi.encodeParameter('uint256', new BN(1));
          await this.module.update(alice, data, { from: owner });
        });

        it('should create new adjustment entry', async function () {
          let adj = await this.module.adjustments(this.token.address);
          expect(adj.price).to.be.bignumber.equal(e18(5.25));
          expect(adj.coeff).to.be.bignumber.equal(new BN('750000000000000'));
          expect(adj.timestamp).to.be.bignumber.equal(this.t0);
        });

        it('should set new max bond size', async function () {
          expect((await this.module.markets(this.token.address)).max).to.be.bignumber.equal(shares(80));
        });

        it('should reset new bond market capacity', async function () {
          expect((await this.module.markets(this.token.address)).capacity).to.be.bignumber.equal(shares(2000));
        });

        it('should interpolate 1/3 of the change to bond market price', async function () {
          expect((await this.module.markets(this.token.address)).price).to.be.bignumber.closeTo(
            e18(3.75),
            e18(2.25).div(days(30))
          );
        });

        it('should interpolate 1/3 of the change to bond market coefficient', async function () {
          expect((await this.module.markets(this.token.address)).coeff).to.be.bignumber.closeTo(
            e18(1.25 / 1000),
            e18(0.75 / 1000).div(days(30))
          );
        });

      });

      describe('when entire adjustment period has elapsed', function () {

        beforeEach(async function () {
          setupTime(this.t0, days(31));
          const data = web3.eth.abi.encodeParameter('uint256', new BN(1));
          await this.module.update(alice, data, { from: owner });
        });

        it('should delete new adjustment entry', async function () {
          let adj = await this.module.adjustments(this.token.address);
          expect(adj.price).to.be.bignumber.equal(new BN(0));
          expect(adj.coeff).to.be.bignumber.equal(new BN(0));
          expect(adj.timestamp).to.be.bignumber.equal(new BN(0));
        });

        it('should set new max bond size', async function () {
          expect((await this.module.markets(this.token.address)).max).to.be.bignumber.equal(shares(80));
        });

        it('should reset new bond market capacity', async function () {
          expect((await this.module.markets(this.token.address)).capacity).to.be.bignumber.equal(shares(2000));
        });

        it('should reach target bond market price', async function () {
          expect((await this.module.markets(this.token.address)).price).to.be.bignumber.equal(e18(5.25));
        });

        it('should reach target bond market coefficient', async function () {
          expect((await this.module.markets(this.token.address)).coeff).to.be.bignumber.equal(e18(0.75 / 1000));
        });

      });

      describe('when half of adjustment period has elapsed in multiple steps', function () {

        beforeEach(async function () {
          setupTime(this.t0, days(11));
          const data = web3.eth.abi.encodeParameter('uint256', new BN(1));
          await this.module.update(alice, data, { from: owner });

          setupTime(this.t0, days(15));
          await this.module.update(alice, data, { from: owner });
        });

        it('should create new adjustment entry', async function () {
          let adj = await this.module.adjustments(this.token.address);
          expect(adj.price).to.be.bignumber.equal(e18(5.25));
          expect(adj.coeff).to.be.bignumber.equal(new BN('750000000000000'));
          expect(adj.timestamp).to.be.bignumber.equal(this.t0);
        });

        it('should set new max bond size', async function () {
          expect((await this.module.markets(this.token.address)).max).to.be.bignumber.equal(shares(80));
        });

        it('should reset new bond market capacity', async function () {
          expect((await this.module.markets(this.token.address)).capacity).to.be.bignumber.equal(shares(2000));
        });

        it('should interpolate 1/2 of the change to bond market price', async function () {
          expect((await this.module.markets(this.token.address)).price).to.be.bignumber.closeTo(
            e18(4.125),
            e18(2.25).div(days(30))
          );
        });

        it('should interpolate 1/2 of the change to bond market coefficient', async function () {
          expect((await this.module.markets(this.token.address)).coeff).to.be.bignumber.closeTo(
            e18(1.125 / 1000),
            e18(0.75 / 1000).div(days(30))
          );
        });

      });

    });

  });


  describe('withdraw', function () {

    describe('when burndown is disabled', function () {

      beforeEach('setup', async function () {
        // owner creates bond module
        this.token = await TestToken.new({ from: org });
        this.module = await ERC20BondStakingModule.new(
          days(10),
          false,
          this.config.address,
          factory,
          { from: owner }
        );
        // open bond market
        await this.module.open(
          this.token.address,
          e18(3.0),
          e18(1.5 / 1000), // (4.5 - 3.0) / 1000e6
          shares(1000),
          shares(10000),
          { from: owner }
        );
        // acquire bond tokens and approve spending
        await this.token.transfer(alice, tokens(1000), { from: org });
        await this.token.transfer(bob, tokens(1000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: alice });
        await this.token.approve(this.module.address, tokens(100000), { from: bob });

        // alice and bob purchase bonds
        const data = web3.eth.abi.encodeParameter('address', this.token.address);
        await this.module.stake(alice, tokens(300), data, { from: owner }); // +100e6 debt
        this.t0 = (await this.module.markets(this.token.address)).updated;
        await setupTime(this.t0, days(2)); // decay -20e6 debt
        await this.module.stake(bob, tokens(156), data, { from: owner }); // price now @ 3.12
        this.t1 = (await this.module.markets(this.token.address)).updated;
      });

      describe('when caller does not control module', function () {
        it('should fail', async function () {
          await expectRevert(
            this.module.withdraw(this.token.address, tokens(100), { from: other }),
            'oc2' // OwnerController: caller is not the controller
          );
        });
      });

      describe('when market does not exist', function () {
        it('should fail', async function () {
          await expectRevert(
            this.module.withdraw(other, tokens(100), { from: owner }),
            'bsm29' // market does not exist
          );
        });
      });

      describe('when amount is zero', function () {
        it('should fail', async function () {
          await expectRevert(
            this.module.withdraw(this.token.address, tokens(0), { from: owner }),
            'bsm30' // amount is zero
          );
        });
      });

      describe('when amount exceeds balance', function () {
        it('should fail', async function () {
          await expectRevert(
            this.module.withdraw(this.token.address, tokens(460), { from: owner }),
            'bsm31' // amount exceeds balance
          );
        });
      });

      describe('when controller withdraws some of available market balance', function () {

        beforeEach(async function () {
          // advance to 5 days
          await setupTime(this.t0, days(5));

          // withdraw
          this.res = await this.module.withdraw(this.token.address, tokens(200), { from: owner });
        });

        it('should have zero staking balance for users', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(0));
          expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(new BN(0));
        });

        it('should decrease total staking balance', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(256));
        });

        it('should decrease total token shares', async function () {
          expect((await this.module.markets(this.token.address)).principal).to.be.bignumber.equal(shares(256));
        });

        it('should decrease vested token shares', async function () {
          expect((await this.module.markets(this.token.address)).vested).to.be.bignumber.equal(shares(256));
        });

        it('should increase controller token balance', async function () {
          expect(await this.token.balanceOf(owner)).to.be.bignumber.equal(tokens(200));
        });

        it('should emit MarketBalanceWithdrawn event', async function () {
          expectEvent(
            this.res,
            'MarketBalanceWithdrawn',
            { token: this.token.address, amount: tokens(200) }
          );
        });
      });

      describe('when controller withdraws all market balance', function () {

        beforeEach(async function () {
          // advance to 5 days
          await setupTime(this.t0, days(5));

          // withdraw
          this.res = await this.module.withdraw(this.token.address, tokens(456), { from: owner });
        });

        it('should have zero staking balance for users', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(0));
          expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(new BN(0));
        });

        it('should zero total staking balance', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(0));
        });

        it('should zero total token shares', async function () {
          expect((await this.module.markets(this.token.address)).principal).to.be.bignumber.equal(shares(0));
        });

        it('should zero vested token shares', async function () {
          expect((await this.module.markets(this.token.address)).vested).to.be.bignumber.equal(shares(0));
        });

        it('should increase controller token balance', async function () {
          expect(await this.token.balanceOf(owner)).to.be.bignumber.equal(tokens(456));
        });

        it('should emit MarketBalanceWithdrawn event', async function () {
          expectEvent(
            this.res,
            'MarketBalanceWithdrawn',
            { token: this.token.address, amount: tokens(456) }
          );
        });
      });

    });

    describe('when burndown is enabled', function () {

      beforeEach('setup', async function () {
        // owner creates bond module
        this.token = await TestToken.new({ from: org });
        this.module = await ERC20BondStakingModule.new(
          days(10),
          true,
          this.config.address,
          factory,
          { from: owner }
        );
        // open bond market
        await this.module.open(
          this.token.address,
          e18(3.0),
          e18(1.5 / 1000), // (4.5 - 3.0) / 1000e6
          shares(1000),
          shares(10000),
          { from: owner }
        );
        // acquire bond tokens and approve spending
        await this.token.transfer(alice, tokens(1000), { from: org });
        await this.token.transfer(bob, tokens(1000), { from: org });
        await this.token.approve(this.module.address, tokens(100000), { from: alice });
        await this.token.approve(this.module.address, tokens(100000), { from: bob });

        // purchase bonds one week apart
        const data = web3.eth.abi.encodeParameter('address', this.token.address);
        await this.module.stake(alice, tokens(300), data, { from: owner }); // +100e6 debt
        this.t0 = (await this.module.markets(this.token.address)).updated;
        await setupTime(this.t0, days(2)); // decay -20e6 debt
        await this.module.stake(bob, tokens(156), data, { from: owner }); // price now @ 3.12
        this.t1 = (await this.module.markets(this.token.address)).updated;
      });

      describe('when amount exceeds vested balance', function () {
        it('should fail', async function () {
          await setupTime(this.t0, days(5));
          await expectRevert(
            this.module.withdraw(this.token.address, tokens(180), { from: owner }),
            'bsm31' // amount exceeds balance
          );
        });
      });

      describe('when controller withdraws all after half of vesting period', function () {

        beforeEach(async function () {
          // advance to 5 days
          await setupTime(this.t0, days(5));

          // withdraw
          // 0.2 * 300 + 0.3 * (240 + 156) = 178.8
          this.res = await this.module.withdraw(this.token.address, tokens(178), { from: owner });
        });

        it('should have burned down staking balance for users', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.closeTo(tokens(150), TOKEN_DELTA);
          expect((await this.module.balances(bob))[0]).to.be.bignumber.closeTo(tokens(109.2), TOKEN_DELTA);
        });

        it('should decrease total staking balance by amount withdraw', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(278));
        });

        it('should decrease total token shares by amount withdraw', async function () {
          expect((await this.module.markets(this.token.address)).principal).to.be.bignumber.equal(shares(278));
        });

        it('should zero vested token shares', async function () {
          expect((await this.module.markets(this.token.address)).vested).to.be.bignumber.closeTo(shares(0.8), SHARE_DELTA);
        });

        it('should increase controller token balance', async function () {
          expect(await this.token.balanceOf(owner)).to.be.bignumber.equal(tokens(178));
        });

        it('should emit MarketBalanceWithdrawn event', async function () {
          expectEvent(
            this.res,
            'MarketBalanceWithdrawn',
            { token: this.token.address, amount: tokens(178) }
          );
        });

      });

      describe('when controller withdraws after vesting period has elapsed', function () {

        beforeEach(async function () {
          // advance to 14 days
          await setupTime(this.t0, days(14));

          // withdraw
          this.res = await this.module.withdraw(this.token.address, tokens(456), { from: owner });
        });

        it('should have zero staking balance for users', async function () {
          expect((await this.module.balances(alice))[0]).to.be.bignumber.equal(new BN(0));
          expect((await this.module.balances(bob))[0]).to.be.bignumber.equal(new BN(0));
        });

        it('should zero total staking balance', async function () {
          expect((await this.module.totals())[0]).to.be.bignumber.equal(tokens(0));
        });

        it('should zero total token shares', async function () {
          expect((await this.module.markets(this.token.address)).principal).to.be.bignumber.equal(shares(0));
        });

        it('should zero vested token shares', async function () {
          expect((await this.module.markets(this.token.address)).vested).to.be.bignumber.equal(shares(0));
        });

        it('should increase controller token balance', async function () {
          expect(await this.token.balanceOf(owner)).to.be.bignumber.equal(tokens(456));
        });

        it('should emit MarketBalanceWithdrawn event', async function () {
          expectEvent(
            this.res,
            'MarketBalanceWithdrawn',
            { token: this.token.address, amount: tokens(456) }
          );
        });

      });

    });

  });

});
