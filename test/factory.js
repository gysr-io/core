// test module for GeyserFactory

const { accounts, contract } = require('@openzeppelin/test-environment');
const { BN, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const { tokens, bonus, days, toFixedPointBigNumber, fromFixedPointBigNumber } = require('./util/helper');

const GeyserFactory = contract.fromArtifact('GeyserFactory');
const Geyser = contract.fromArtifact('Geyser');


describe('factory', function () {
  const [owner, org, gysr, other, staking, reward] = accounts;

  beforeEach('setup', async function () {
    this.factory = await GeyserFactory.new(gysr, { from: org });
  });

  describe('when a Geyser is created with factory', function () {

    beforeEach('setup', async function () {
      this.ret = await this.factory.create(
        staking,
        reward,
        bonus(0.0),
        bonus(1.0),
        days(365),
        { from: owner }
      );
      this.geyserAddress = this.ret.logs.filter(l => l.event === 'GeyserCreated')[0].args.geyser;
      this.geyser = await Geyser.at(this.geyserAddress);
    });

    it('should emit GeyserCreated event', async function () {
      expectEvent(this.ret, 'GeyserCreated', { 'user': owner, 'geyser': this.geyserAddress });
    });

    it('should be owned by creator', async function () {
      expect(await this.geyser.owner()).to.equal(owner);
    });

    it('should set staking and reward tokens properly', async function () {
      expect(await this.geyser.token()).to.equal(staking);
      expect(await this.geyser.stakingToken()).to.equal(staking);
      expect(await this.geyser.rewardToken()).to.equal(reward);
    });

    it('should set time bonus params properly', async function () {
      expect(await this.geyser.bonusMin()).to.be.bignumber.equal(new BN(0));
      expect(await this.geyser.bonusMax()).to.be.bignumber.equal(bonus(1.0));
      expect(await this.geyser.bonusPeriod()).to.be.bignumber.equal(new BN(60 * 60 * 24 * 365));
    });

    it('should be present in factory Geyser set', async function () {
      expect(await this.factory.map(this.geyserAddress)).to.be.true;
    });

    it('should be present in factory Geyser list', async function () {
      expect(await this.factory.list(0)).to.be.equal(this.geyserAddress);
    });

    it('should increase Geyser count', async function () {
      expect(await this.factory.count()).to.be.bignumber.equal(new BN(1));
    });

  });

  describe('when many Geysers are created with factory', function () {

    beforeEach('setup', async function () {
      this.geysers = []
      for (var i = 0; i < 16; i++) {
        const ret = await this.factory.create(
          staking,
          reward,
          bonus(0.0),
          bonus(1.0),
          days(365),
          { from: owner }
        );
        const addr = ret.logs.filter(l => l.event === 'GeyserCreated')[0].args.geyser;
        this.geysers.push(addr);
      }
    });

    it('should contain all Geysers in map', async function () {
      for (const g of this.geysers) {
        expect(await this.factory.map(g)).to.be.true;
      }
    });

    it('should contain all Geysers in list', async function () {
      for (var i = 0; i < 16; i++) {
        expect(await this.factory.list(new BN(i))).to.be.equal(this.geysers[i]);
      }
    });

    it('should increase Geyser count', async function () {
      expect(await this.factory.count()).to.be.bignumber.equal(new BN(16));
    });

    it('should be able to iterate over all Geysers', async function () {
      const count = (await this.factory.count()).toNumber();
      for (var i = 0; i < count; i++) {
        const g = await this.factory.list(new BN(i));
        expect(g).to.be.equal(this.geysers[i]);
      }
    });

  });

});
