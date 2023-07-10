// unit tests for ERC20BondStakingModuleInfo library

const { artifacts, web3 } = require('hardhat');
const { BN, time, expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const {
  tokens,
  bonus,
  days,
  shares,
  bytes32,
  e6,
  e18,
  setupTime
} = require('../util/helper');

const ERC20BondStakingModuleInfo = artifacts.require('ERC20BondStakingModuleInfo');
const ERC20BondStakingModule = artifacts.require('ERC20BondStakingModule');
const ERC20FixedRewardModule = artifacts.require('ERC20FixedRewardModule');
const Pool = artifacts.require('Pool');
const Configuration = artifacts.require('Configuration');
const TestToken = artifacts.require('TestToken');
const TestLiquidityToken = artifacts.require('TestLiquidityToken');
const TestElasticToken = artifacts.require('TestElasticToken')


describe('ERC20BondStakingModuleInfo', function () {
  let org, owner, alice, bob, other, factory;
  before(async function () {
    [org, owner, alice, bob, other, factory] = await web3.eth.getAccounts();
  });

  beforeEach('setup', async function () {
    this.config = await Configuration.new({ from: org });
    this.token = await TestToken.new({ from: org });
    this.lp = await TestLiquidityToken.new({ from: org });
    this.elastic = await TestElasticToken.new({ from: org });
    this.info = await ERC20BondStakingModuleInfo.new({ from: org });
  });


  describe('when pool is first initialized', function () {

    beforeEach(async function () {
      this.module = await ERC20BondStakingModule.new(
        days(30),
        false,
        this.config.address,
        factory,
        { from: owner }
      );
    });

    describe('when getting tokens', function () {

      beforeEach(async function () {
        this.res = await this.info.tokens(this.module.address);
      });

      it('should return empty list of token addresses', async function () {
        expect(this.res.addresses_.length).eq(0);
      });

      it('should return empty list of token names', async function () {
        expect(this.res.names_.length).to.equal(0);
      });

      it('should return empty list of token symbols', async function () {
        expect(this.res.symbols_.length).to.equal(0);
      });

      it('should return empty list of token decimals', async function () {
        expect(this.res.decimals_.length).to.equal(0);
      });

    });

    describe('when user gets positions', function () {

      beforeEach(async function () {
        this.res = await this.info.positions(this.module.address, alice, []);
      });

      it('should return empty list of accounts', async function () {
        expect(this.res.accounts_.length).eq(0);
      });

      it('should return empty list of shares', async function () {
        expect(this.res.shares_.length).eq(0);
      });
    });

  });

  describe('when markets have been created', function () {

    beforeEach(async function () {
      // create module
      this.module = await ERC20BondStakingModule.new(
        days(30),
        true,
        this.config.address,
        factory,
        { from: owner }
      );

      // open markets
      await this.module.open(
        this.elastic.address,
        e18(0.80),
        e18(0.25 / 1000), // (1.05 - 0.80) / 1000e6
        shares(100),
        shares(1000),
        { from: owner }
      );
      await this.module.open(
        this.lp.address,
        e18(0.10),
        e18(0.05 / 1000), // (0.15 - 0.10) / 1000e6
        shares(100),
        shares(1000),
        { from: owner }
      );
    });

    describe('when getting tokens', function () {

      beforeEach(async function () {
        this.res = await this.info.tokens(this.module.address);
      });

      it('should return lists with length two', async function () {
        expect(this.res.addresses_.length).eq(2);
        expect(this.res.names_.length).to.equal(2);
        expect(this.res.symbols_.length).to.equal(2);
        expect(this.res.decimals_.length).to.equal(2);
      });

      it('should return staking token addresses', async function () {
        expect(this.res.addresses_[0]).to.equal(this.elastic.address);
        expect(this.res.addresses_[1]).to.equal(this.lp.address);
      });

      it('should return staking token names', async function () {
        expect(this.res.names_[0]).to.equal("TestElasticToken");
        expect(this.res.names_[1]).to.equal("TestLiquidityToken");
      });

      it('should return staking token symbols', async function () {
        expect(this.res.symbols_[0]).to.equal("ELASTIC");
        expect(this.res.symbols_[1]).to.equal("LP-TKN");
      });

      it('should return staking token decimals', async function () {
        expect(this.res.decimals_[0]).to.be.bignumber.equal(new BN(18));
        expect(this.res.decimals_[1]).to.be.bignumber.equal(new BN(18));
      });

    });

    describe('when user gets positions', function () {

      beforeEach(async function () {
        this.res = await this.info.positions(this.module.address, alice, []);
      });

      it('should return empty list of accounts', async function () {
        expect(this.res.accounts_.length).eq(0);
      });

      it('should return empty list of shares', async function () {
        expect(this.res.shares_.length).eq(0);
      });
    });

    describe('when getting bond metadata for non existent token id', function () {
      it('should fail', async function () {
        await expectRevert.unspecified(
          this.info.metadata(this.module.address, new BN(3), []),
          // 'bsmi1'
        );
      });
    });

    describe('when getting current prices', function () {

      it('should return floor price for first token', async function () {
        const res = await this.info.price(this.module.address, this.elastic.address);
        expect(res).to.be.bignumber.equal(e18(0.80));
      });

      it('should return floor price for second token', async function () {
        const res = await this.info.price(this.module.address, this.lp.address);
        expect(res).to.be.bignumber.equal(e18(0.10));
      });

    });

    describe('when getting quote', function () {

      beforeEach(async function () {
        this.res = await this.info.quote(this.module.address, this.lp.address, tokens(5));
      });

      it('should expected number of debt shares', async function () {
        expect(this.res[0]).to.be.bignumber.equal(shares(50));
      });

      it('should return okay', async function () {
        expect(this.res[1]).to.be.true;
      });
    });

    describe('when getting quote on invalid amount', function () {

      beforeEach(async function () {
        this.res = await this.info.quote(this.module.address, this.lp.address, tokens(20));
      });

      it('should return expected number of debt shares', async function () {
        expect(this.res[0]).to.be.bignumber.equal(shares(200));
      });

      it('should return validity false', async function () {
        expect(this.res[1]).to.be.false;
      });
    });

    describe('when getting quote with fee', function () {

      beforeEach(async function () {
        await this.config.setAddressUint96(
          web3.utils.soliditySha3('gysr.core.bond.stake.fee'),
          other,
          e18(0.02),
          { from: org }
        );
        this.res = await this.info.methods['quote(address,address,uint256,address)'](
          this.module.address, this.lp.address, tokens(5), this.config.address);
      });

      it('should return expected number of debt shares', async function () {
        expect(this.res[0]).to.be.bignumber.equal(shares(49));
      });

      it('should return okay', async function () {
        expect(this.res[1]).to.be.true;
      });
    });

    describe('when getting unstakeable for non existent bond id', function () {
      it('should fail', async function () {
        await expectRevert.unspecified(
          this.info.unstakeable(this.module.address, new BN(3), new BN(0)),
          // 'bsmi5'
        );
      });
    });

  });


  describe('when user has purchased bonds', function () {

    beforeEach(async function () {
      // create pool
      this.module = await ERC20BondStakingModule.new(
        days(30),
        true,
        this.config.address,
        factory,
        { from: owner }
      );
      this.rewardmodule = await ERC20FixedRewardModule.new(
        this.token.address,
        days(30),
        e18(1),
        this.config.address,
        factory,
        { from: owner }
      );
      this.pool = await Pool.new(
        this.module.address,
        this.rewardmodule.address,
        other,
        this.config.address,
        { from: owner }
      );
      await this.module.transferOwnership(this.pool.address, { from: owner });
      await this.rewardmodule.transferOwnership(this.pool.address, { from: owner });

      // fund pool
      await this.token.transfer(owner, tokens(1000), { from: org });
      await this.token.approve(this.rewardmodule.address, tokens(1000), { from: owner });
      this.res = await this.rewardmodule.fund(tokens(1000), { from: owner });

      // open markets
      await this.module.open(
        this.elastic.address,
        e18(0.80),
        e18(0.25 / 1000), // (1.05 - 0.80) / 1000e6
        shares(100),
        shares(1000),
        { from: owner }
      );
      await this.module.open(
        this.lp.address,
        e18(0.10),
        e18(0.05 / 1000), // (0.15 - 0.10) / 1000e6
        shares(100),
        shares(1000),
        { from: owner }
      );

      // acquire staking tokens and approval
      await this.elastic.transfer(alice, tokens(1000), { from: org });
      await this.lp.transfer(alice, tokens(1000), { from: org });
      await this.elastic.approve(this.module.address, tokens(100000), { from: alice });
      await this.lp.approve(this.module.address, tokens(100000), { from: alice });

      // purchase bonds
      const data0 = web3.eth.abi.encodeParameter('address', this.elastic.address);
      await this.pool.stake(tokens(80), data0, [], { from: alice }); // expect 100
      this.t0 = (await this.module.markets(this.elastic.address)).updated;
      const data1 = web3.eth.abi.encodeParameters(['address', 'uint256'], [this.lp.address, shares(49.5)]); // expect 50 w/ 1% tolerance
      await this.pool.stake(tokens(5), data1, [], { from: alice });
      this.t1 = (await this.module.markets(this.lp.address)).updated;
    });

    describe('when getting tokens', function () {

      beforeEach(async function () {
        this.res = await this.info.tokens(this.module.address);
      });

      it('should return lists with length two', async function () {
        expect(this.res.addresses_.length).eq(2);
        expect(this.res.names_.length).to.equal(2);
        expect(this.res.symbols_.length).to.equal(2);
        expect(this.res.decimals_.length).to.equal(2);
      });

      it('should return staking token addresses', async function () {
        expect(this.res.addresses_[0]).to.equal(this.elastic.address);
        expect(this.res.addresses_[1]).to.equal(this.lp.address);
      });

      it('should return staking token names', async function () {
        expect(this.res.names_[0]).to.equal("TestElasticToken");
        expect(this.res.names_[1]).to.equal("TestLiquidityToken");
      });

      it('should return staking token symbols', async function () {
        expect(this.res.symbols_[0]).to.equal("ELASTIC");
        expect(this.res.symbols_[1]).to.equal("LP-TKN");
      });

      it('should return staking token decimals', async function () {
        expect(this.res.decimals_[0]).to.be.bignumber.equal(new BN(18));
        expect(this.res.decimals_[1]).to.be.bignumber.equal(new BN(18));
      });

    });

    describe('when user gets positions', function () {

      beforeEach(async function () {
        this.res = await this.info.positions(this.module.address, alice, []);
      });

      it('should return list of two accounts', async function () {
        expect(this.res.accounts_.length).eq(2);
      });

      it('should return list of two shares', async function () {
        expect(this.res.accounts_.length).eq(2);
      });

      it('should return bond ids as accounts', async function () {
        expect(this.res.accounts_[0]).to.be.equal(bytes32(1));
        expect(this.res.accounts_[1]).to.be.equal(bytes32(2));
      });

      it('should return bond debt as shares', async function () {
        expect(this.res.shares_[0]).to.be.bignumber.equal(shares(100));
        expect(this.res.shares_[1]).to.be.bignumber.equal(shares(50));
      });
    });

    describe('when getting metadata for bond position', function () {

      beforeEach(async function () {
        const res = await this.info.metadata(this.module.address, 1, []);

        let data = res.split(';base64,')[1];
        this.metadata = JSON.parse(Buffer.from(data, 'base64').toString());

        let svgdata = this.metadata['image'].split(';base64,')[1];
        this.svg = Buffer.from(svgdata, 'base64').toString();
      });

      it('should return derived name', async function () {
        expect(this.metadata['name']).to.equal('TKN Bond Position: 1');
      });

      it('should return derived description', async function () {
        expect(this.metadata['description']).to.equal('Bond position that was purchased with TestElasticToken and pays out in TestToken. Powered by GYSR Protocol.');
      });

      it('should generate base64 encoded svg for image', async function () {
        expect(this.metadata['image']).to.contain('data:image/svg+xml;base64');
      });

      it('should include name in svg', async function () {
        expect(this.svg).to.contain('<text font-size="100%" y="10%" x="5%">TKN Bond Position</text>');
      });

      it('should include bond ID in svg', async function () {
        expect(this.svg).to.contain('<text font-size="80%" y="18%" x="5%">Bond ID: 1</text>');
      });

      it('should include principal token in svg', async function () {
        expect(this.svg).to.contain('<text font-size="60%" y="25%" x="5%">Principal token: TestElasticToken</text>');
      });

      it('should include reward token in svg', async function () {
        expect(this.svg).to.contain('<text font-size="60%" y="40%" x="5%">Reward token: TestToken</text>');
      });

      it('should return two total attributes', async function () {
        expect(Object.keys(this.metadata['attributes']).length).to.equal(5);
      });

      it('should set principal token address attribute', async function () {
        expect(this.metadata['attributes']['principal_address']).to.equal(this.elastic.address.toLowerCase());
      });

      it('should set reward token address attribute', async function () {
        expect(this.metadata['attributes']['reward_address']).to.equal(this.token.address.toLowerCase());
      });

      it('should set timestamp attribute', async function () {
        expect(this.metadata['attributes']['timestamp']).to.equal(this.t0.toNumber());
      });
    });

    describe('when getting current prices', function () {

      it('should return increased price for first token', async function () {
        // 0.8 + 0.25 * 100 / 1000
        const res = await this.info.price(this.module.address, this.elastic.address);
        expect(res).to.be.bignumber.closeTo(e18(0.825), e18(0.0001));
      });

      it('should return increased price for second token', async function () {
        // 0.1 + 0.05 * 50 / 1000
        const res = await this.info.price(this.module.address, this.lp.address);
        expect(res).to.be.bignumber.closeTo(e18(0.1025), e18(0.0001));
      });

    });

    describe('when getting prices after time has elapsed', function () {

      it('should return decayed price increase for first token', async function () {
        // 0.8 + 0.25 * 100 / 1000 * 0.8
        await setupTime(this.t0, days(6));
        const res = await this.info.price(this.module.address, this.elastic.address);
        expect(res).to.be.bignumber.closeTo(e18(0.820), e18(0.0001));
      });

      it('should return decayed price increase for second token', async function () {
        // 0.1 + 0.05 * 50 / 1000 * 0.5
        await setupTime(this.t0, days(15));
        const res = await this.info.price(this.module.address, this.lp.address);
        expect(res).to.be.bignumber.closeTo(e18(0.10125), e18(0.0001));
      });

    });

    describe('when getting prices after full period has elapsed', function () {

      it('should return floor price for first token', async function () {
        await setupTime(this.t0, days(31));
        const res = await this.info.price(this.module.address, this.elastic.address);
        expect(res).to.be.bignumber.equal(e18(0.8));
      });

      it('should return floor price for second token', async function () {
        await setupTime(this.t0, days(31));
        const res = await this.info.price(this.module.address, this.lp.address);
        expect(res).to.be.bignumber.equal(e18(0.1));
      });

    });

    describe('when getting quote', function () {

      beforeEach(async function () {
        this.res = await this.info.quote(this.module.address, this.lp.address, tokens(5));
      });

      it('should expected number of debt shares', async function () {
        expect(this.res[0]).to.be.bignumber.closeTo(shares(5 / 0.1025), shares(0.001));
      });

      it('should return okay', async function () {
        expect(this.res[1]).to.be.true;
      });
    });

    describe('when getting quote on invalid amount', function () {

      beforeEach(async function () {
        this.res = await this.info.quote(this.module.address, this.lp.address, tokens(20));
      });

      it('should expected number of debt shares', async function () {
        expect(this.res[0]).to.be.bignumber.closeTo(shares(20 / 0.1025), shares(0.001));
      });

      it('should return validity false', async function () {
        expect(this.res[1]).to.be.false;
      });
    });

    describe('when getting quote with fee', function () {

      beforeEach(async function () {
        await this.config.setAddressUint96(
          web3.utils.soliditySha3('gysr.core.bond.stake.fee'),
          other,
          e18(0.02),
          { from: org }
        );
        this.res = await this.info.methods['quote(address,address,uint256,address)'](
          this.module.address, this.lp.address, tokens(5), this.config.address);
      });

      it('should return expected number of debt shares', async function () {
        expect(this.res[0]).to.be.bignumber.closeTo(shares(4.9 / 0.1025), shares(0.001));
      });

      it('should return okay', async function () {
        expect(this.res[1]).to.be.true;
      });
    });

    describe('when getting unstakeable on new bond', function () {

      beforeEach(async function () {
        this.res = await this.info.unstakeable(this.module.address, new BN(1), new BN(0));
      });

      it('should return full principal amount', async function () {
        expect(this.res[0]).to.be.bignumber.closeTo(tokens(80), tokens(0.001));
      });

      it('should return full debt amount', async function () {
        expect(this.res[1]).to.be.bignumber.equal(shares(100));
      });

      it('should return okay for valid unstake', async function () {
        expect(this.res[2]).to.be.true;
      });

    });


    describe('when getting unstakeable on partially vested bond', function () {

      beforeEach(async function () {
        await setupTime(this.t0, days(15));
        this.res = await this.info.unstakeable(this.module.address, new BN(1), new BN(0));
      });

      it('should return half the principal amount', async function () {
        expect(this.res[0]).to.be.bignumber.closeTo(tokens(40), tokens(0.001));
      });

      it('should return full debt amount', async function () {
        expect(this.res[1]).to.be.bignumber.equal(shares(100));
      });

      it('should return okay for valid unstake', async function () {
        expect(this.res[2]).to.be.true;
      });

    });

    describe('when checking a valid unstakeable amount on a partially vested bond', function () {

      beforeEach(async function () {
        await setupTime(this.t0, days(15));
        this.res = await this.info.unstakeable(this.module.address, new BN(1), tokens(30));
      });

      it('should return the requested amount', async function () {
        expect(this.res[0]).to.be.bignumber.equal(tokens(30));
      });

      it('should return prorated debt amount', async function () {
        expect(this.res[1]).to.be.bignumber.closeTo(shares(75), shares(0.001));
      });

      it('should return okay for valid unstake', async function () {
        expect(this.res[2]).to.be.true;
      });

    });

    describe('when checking an invalid unstakeable amount on a partially vested bond', function () {

      beforeEach(async function () {
        await setupTime(this.t0, days(15));
        this.res = await this.info.unstakeable(this.module.address, new BN(1), tokens(45));
      });

      it('should return the max returnable amount', async function () {
        expect(this.res[0]).to.be.bignumber.closeTo(tokens(40), tokens(0.001));
      });

      it('should return full debt amount', async function () {
        expect(this.res[1]).to.be.bignumber.equal(shares(100));
      });

      it('should return false for invalid unstake', async function () {
        expect(this.res[2]).to.be.false;
      });
    });

    describe('when checking unstakeable amount on a fully vested bond', function () {

      beforeEach(async function () {
        await setupTime(this.t0, days(31));
        this.res = await this.info.unstakeable(this.module.address, new BN(1), new BN(0));
      });

      it('should return zero returnable', async function () {
        expect(this.res[0]).to.be.bignumber.equal(new BN(0));
      });

      it('should return full debt amount', async function () {
        expect(this.res[1]).to.be.bignumber.equal(shares(100));
      });

      it('should return okay for valid unstake', async function () {
        expect(this.res[2]).to.be.true;
      });

    });

    describe('when checking nonzero unstakeable amount on a fully vested bond', function () {

      beforeEach(async function () {
        await setupTime(this.t0, days(31));
        this.res = await this.info.unstakeable(this.module.address, new BN(1), tokens(5));
      });

      it('should return zero returnable', async function () {
        expect(this.res[0]).to.be.bignumber.equal(new BN(0));
      });

      it('should return full debt amount', async function () {
        expect(this.res[1]).to.be.bignumber.equal(shares(100));
      });

      it('should return false for invalid unstake', async function () {
        expect(this.res[2]).to.be.false;
      });

    });

    describe('when getting withdrawable amounts initially', function () {

      it('should return zero vested for first token', async function () {
        const res = await this.info.withdrawable(this.module.address, this.elastic.address);
        expect(res).to.be.bignumber.closeTo(new BN(0), tokens(0.001));
      });

      it('should return zero vested for second token', async function () {
        const res = await this.info.withdrawable(this.module.address, this.lp.address);
        expect(res).to.be.bignumber.closeTo(new BN(0), tokens(0.0001));
      });

    });

    describe('when getting withdrawable amounts have some time has elapsed', function () {

      it('should return zero vested for first token', async function () {
        await setupTime(this.t0, days(24));
        const res = await this.info.withdrawable(this.module.address, this.elastic.address);
        expect(res).to.be.bignumber.closeTo(tokens(64), tokens(0.001));
      });

      it('should return zero vested for second token', async function () {
        await setupTime(this.t0, days(24));
        const res = await this.info.withdrawable(this.module.address, this.lp.address);
        expect(res).to.be.bignumber.closeTo(tokens(4), tokens(0.0001));
      });

    });

    describe('when getting withdrawable amounts after full period has elapsed', function () {

      it('should return full principal balance as vested for first token', async function () {
        await setupTime(this.t0, days(31));
        const res = await this.info.withdrawable(this.module.address, this.elastic.address);
        expect(res).to.be.bignumber.equal(tokens(80));
      });

      it('should return full principal balance as vested for second token', async function () {
        await setupTime(this.t0, days(31));
        const res = await this.info.withdrawable(this.module.address, this.lp.address);
        expect(res).to.be.bignumber.equal(tokens(5));
      });

    });


  });

});
