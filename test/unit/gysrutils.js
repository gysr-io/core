// test module for MathUtils

const { accounts, contract } = require('@openzeppelin/test-environment');
const { BN, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');
const {
  tokens,
  bonus,
  fromBonus,
  reportGas
} = require('../util/helper');

const TestGysrUtils = contract.fromArtifact('TestGysrUtils');

// tolerance
const BONUS_DELTA = 0.000001;

// formula for GYSR bonus
//
// x: gysr spent
// s: stake amount
// S: total staked amount
// u: usage ratio
//
// bonus(x,s,S,u) = 1 + log10(1 + (x * 0.01 * S / s) / (0.01 + u))
//
// note: the gysr scaling term is not used if stake amount < 1% of total
// bonus(x,u) = 1 + log10(1 + x / (0.01 + u))
//


describe('GysrUtils', function () {

  beforeEach(async function () {
    this.lib = await TestGysrUtils.new();
  });

  describe('when GYSR amount is zero', function () {
    it('should return 1.0 bonus multiplier', async function () {
      const mult = await this.lib.testGysrBonus(new BN(0), tokens(10), tokens(1000), new BN(0));
      expect(mult).to.be.bignumber.equal(bonus(1.0));
    });
  });

  describe('when staked amount is zero', function () {
    it('should return 0.0 bonus multiplier', async function () {
      const mult = await this.lib.testGysrBonus(tokens(1), new BN(0), tokens(1000), new BN(0));
      expect(mult).to.be.bignumber.equal(new BN(0));
    });
  });

  describe('when total staked amount is zero', function () {
    it('should return 0.0 bonus multiplier', async function () {
      const mult = await this.lib.testGysrBonus(tokens(1), tokens(10), new BN(0), new BN(0));
      expect(mult).to.be.bignumber.equal(new BN(0));
    });
  });


  describe('when usage is at 0.0 and stake is 1%', function () {

    it('should return 2.04 bonus multiplier for 0.1 GYSR tokens', async function () {
      const gysr = 0.1;
      const amount = 10.0;
      const total = 1000.0;
      const usage = 0.0;

      const mult = fromBonus(
        await this.lib.testGysrBonus(tokens(gysr), tokens(amount), tokens(total), bonus(usage))
      );

      const multExpected = 1.0 + Math.log10(1.0 + gysr / 0.01);
      expect(mult).to.be.approximately(multExpected, BONUS_DELTA);
    });

    it('should return 3.0 bonus multiplier for 1.0 GYSR tokens', async function () {
      const gysr = 1.0;
      const amount = 10.0;
      const total = 1000.0;
      const usage = 0.0;

      const mult = fromBonus(
        await this.lib.testGysrBonus(tokens(gysr), tokens(amount), tokens(total), bonus(usage))
      );

      const multExpected = 1.0 + Math.log10(1.0 + gysr / 0.01);
      expect(mult).to.be.approximately(multExpected, BONUS_DELTA);
    });

    it('should return 4.0 bonus multiplier for 10.0 GYSR tokens', async function () {
      const gysr = 10.0;
      const amount = 10.0;
      const total = 1000.0;
      const usage = 0.0;

      const mult = fromBonus(
        await this.lib.testGysrBonus(tokens(gysr), tokens(amount), tokens(total), bonus(usage))
      );

      const multExpected = 1.0 + Math.log10(1.0 + gysr / 0.01);
      expect(mult).to.be.approximately(multExpected, BONUS_DELTA);
    });

    it('should return 9.0 bonus multiplier for 1.0M GYSR tokens', async function () {
      const gysr = 1000000.0;
      const amount = 10.0;
      const total = 1000.0;
      const usage = 0.0;

      const mult = fromBonus(
        await this.lib.testGysrBonus(tokens(gysr), tokens(amount), tokens(total), bonus(usage))
      );

      const multExpected = 1.0 + Math.log10(1.0 + gysr / 0.01);
      expect(mult).to.be.approximately(multExpected, BONUS_DELTA);
    });

  });

  describe('when usage is at 0.0 and stake is 10%', function () {

    it('should return 1.3 bonus multiplier for 0.1 GYSR tokens', async function () {
      const gysr = 0.1;
      const amount = 100.0;
      const total = 1000.0;
      const usage = 0.0;

      const mult = fromBonus(
        await this.lib.testGysrBonus(tokens(gysr), tokens(amount), tokens(total), bonus(usage))
      );

      const multExpected = 1.0 + Math.log10(1.0 + 0.1 * gysr / 0.01);
      expect(mult).to.be.approximately(multExpected, BONUS_DELTA);
    });

    it('should return 2.04 bonus multiplier for 1.0 GYSR tokens', async function () {
      const gysr = 1.0;
      const amount = 100.0;
      const total = 1000.0;
      const usage = 0.0;

      const mult = fromBonus(
        await this.lib.testGysrBonus(tokens(gysr), tokens(amount), tokens(total), bonus(usage))
      );

      const multExpected = 1.0 + Math.log10(1.0 + 0.1 * gysr / 0.01);
      expect(mult).to.be.approximately(multExpected, BONUS_DELTA);
    });

    it('should return 3.0 bonus multiplier for 10.0 GYSR tokens', async function () {
      const gysr = 10.0;
      const amount = 100.0;
      const total = 1000.0;
      const usage = 0.0;

      const mult = fromBonus(
        await this.lib.testGysrBonus(tokens(gysr), tokens(amount), tokens(total), bonus(usage))
      );

      const multExpected = 1.0 + Math.log10(1.0 + 0.1 * gysr / 0.01);
      expect(mult).to.be.approximately(multExpected, BONUS_DELTA);
    });

    it('should return 8.0 bonus multiplier for 1.0M GYSR tokens', async function () {
      const gysr = 1000000.0;
      const amount = 100.0;
      const total = 1000.0;
      const usage = 0.0;

      const mult = fromBonus(
        await this.lib.testGysrBonus(tokens(gysr), tokens(amount), tokens(total), bonus(usage))
      );

      const multExpected = 1.0 + Math.log10(1.0 + 0.1 * gysr / 0.01);
      expect(mult).to.be.approximately(multExpected, BONUS_DELTA);
    });

  });

  describe('when usage is at 0.0 and stake is less than 1%', function () {

    it('should return unscaled bonus multiplier', async function () {
      const gysr = 1.0;
      const amount = 5.0;
      const total = 1000.0;
      const usage = 0.0;

      const mult = fromBonus(
        await this.lib.testGysrBonus(tokens(gysr), tokens(amount), tokens(total), bonus(usage))
      );

      const multExpected = 1.0 + Math.log10(1.0 + gysr / 0.01);
      expect(mult).to.be.approximately(multExpected, BONUS_DELTA);
    });

  });

  describe('when usage is at 0.5 and stake is 1%', function () {

    it('should return 1.07 bonus multiplier for 0.1 GYSR tokens', async function () {
      const gysr = 0.1;
      const amount = 10.0;
      const total = 1000.0;
      const usage = 0.5;

      const mult = fromBonus(
        await this.lib.testGysrBonus(tokens(gysr), tokens(amount), tokens(total), bonus(usage))
      );

      const multExpected = 1.0 + Math.log10(1.0 + gysr / (0.01 + usage));
      expect(mult).to.be.approximately(multExpected, BONUS_DELTA);
    });

    it('should return 1.47 bonus multiplier for 1.0 GYSR tokens', async function () {
      const gysr = 1.0;
      const amount = 10.0;
      const total = 1000.0;
      const usage = 0.5;

      const mult = fromBonus(
        await this.lib.testGysrBonus(tokens(gysr), tokens(amount), tokens(total), bonus(usage))
      );

      const multExpected = 1.0 + Math.log10(1.0 + gysr / (0.01 + usage));
      expect(mult).to.be.approximately(multExpected, BONUS_DELTA);
    });

    it('should return 2.31 bonus multiplier for 10.0 GYSR tokens', async function () {
      const gysr = 10.0;
      const amount = 10.0;
      const total = 1000.0;
      const usage = 0.5;

      const mult = fromBonus(
        await this.lib.testGysrBonus(tokens(gysr), tokens(amount), tokens(total), bonus(usage))
      );

      const multExpected = 1.0 + Math.log10(1.0 + gysr / (0.01 + usage));
      expect(mult).to.be.approximately(multExpected, BONUS_DELTA);
    });

    it('should return 7.29 bonus multiplier for 1.0M GYSR tokens', async function () {
      const gysr = 1000000.0;
      const amount = 10.0;
      const total = 1000.0;
      const usage = 0.5;

      const mult = fromBonus(
        await this.lib.testGysrBonus(tokens(gysr), tokens(amount), tokens(total), bonus(usage))
      );

      const multExpected = 1.0 + Math.log10(1.0 + gysr / (0.01 + usage));
      expect(mult).to.be.approximately(multExpected, BONUS_DELTA);
    });

  });


  describe('when usage is at 0.5 and stake is 10%', function () {

    it('should return 1.008 bonus multiplier for 0.1 GYSR tokens', async function () {
      const gysr = 0.1;
      const amount = 100.0;
      const total = 1000.0;
      const usage = 0.5;

      const mult = fromBonus(
        await this.lib.testGysrBonus(tokens(gysr), tokens(amount), tokens(total), bonus(usage))
      );

      const multExpected = 1.0 + Math.log10(1.0 + 0.1 * gysr / (0.01 + usage));
      expect(mult).to.be.approximately(multExpected, BONUS_DELTA);
    });

    it('should return 1.07 bonus multiplier for 1.0 GYSR tokens', async function () {
      const gysr = 1.0;
      const amount = 100.0;
      const total = 1000.0;
      const usage = 0.5;

      const mult = fromBonus(
        await this.lib.testGysrBonus(tokens(gysr), tokens(amount), tokens(total), bonus(usage))
      );

      const multExpected = 1.0 + Math.log10(1.0 + 0.1 * gysr / (0.01 + usage));
      expect(mult).to.be.approximately(multExpected, BONUS_DELTA);
    });

    it('should return 1.47 bonus multiplier for 10.0 GYSR tokens', async function () {
      const gysr = 10.0;
      const amount = 100.0;
      const total = 1000.0;
      const usage = 0.5;

      const mult = fromBonus(
        await this.lib.testGysrBonus(tokens(gysr), tokens(amount), tokens(total), bonus(usage))
      );

      const multExpected = 1.0 + Math.log10(1.0 + 0.1 * gysr / (0.01 + usage));
      expect(mult).to.be.approximately(multExpected, BONUS_DELTA);
    });

    it('should return 6.29 bonus multiplier for 1.0M GYSR tokens', async function () {
      const gysr = 1000000.0;
      const amount = 100.0;
      const total = 1000.0;
      const usage = 0.5;

      const mult = fromBonus(
        await this.lib.testGysrBonus(tokens(gysr), tokens(amount), tokens(total), bonus(usage))
      );

      const multExpected = 1.0 + Math.log10(1.0 + 0.1 * gysr / (0.01 + usage));
      expect(mult).to.be.approximately(multExpected, BONUS_DELTA);
    });

    it('report gas should return 6.29 bonus multiplier for 1.0M GYSR tokens', async function () {
      const gysr = 1000000.0;
      const amount = 100.0;
      const total = 1000.0;
      const usage = 0.5;

      const res = await this.lib.testEventGysrBonus(tokens(gysr), tokens(amount), tokens(total), bonus(usage));

      reportGas('GysrUtils', 'gysrBonus', '0.5 usage and 10% stake', res);
    });

  });

  describe('when usage is at 0.5 and stake is under 1%', function () {

    it('should return unscaled bonus multiplier', async function () {
      const gysr = 1.0;
      const amount = 5.0;
      const total = 1000.0;
      const usage = 0.5;

      const mult = fromBonus(
        await this.lib.testGysrBonus(tokens(gysr), tokens(amount), tokens(total), bonus(usage))
      );

      const multExpected = 1.0 + Math.log10(1.0 + gysr / (0.01 + usage));
      expect(mult).to.be.approximately(multExpected, BONUS_DELTA);
    });

  });
});
