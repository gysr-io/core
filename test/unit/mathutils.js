// test module for MathUtils

const { accounts, contract } = require('@openzeppelin/test-environment');
const { BN, expectEvent, expectRevert } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const { toFixedPointBigNumber, fromFixedPointBigNumber } = require('../util/helper');

const MathUtils = contract.fromArtifact('MathUtils');


describe('testing helpers (yes, meta tests...)', function () {

  it('should encode integer to fixed point big number', function () {
    const bn = toFixedPointBigNumber(42, 10, 18);
    expect(bn).to.be.bignumber.equal(new BN(42).mul((new BN(10)).pow(new BN(18))));
  });

  it('should encode decimal to fixed point big number', function () {
    const bn = toFixedPointBigNumber(1.23456, 10, 18);
    expect(bn).to.be.bignumber.equal(new BN('1234560000000000000'));
  });

  it('should encode irregular unit decimal to fixed point big number', function () {
    const bn = toFixedPointBigNumber(5.4321, 10, 9);
    expect(bn).to.be.bignumber.equal(new BN('5432100000'));
  });

  it('should decode fixed point big number to integer', function () {
    const bn = new BN(42).mul((new BN(10)).pow(new BN(18)));
    const x = fromFixedPointBigNumber(bn, 10, 18);
    expect(x).to.be.equal(42);
  });

  it('should decode fixed point big number to decimal', function () {
    const bn = new BN('1234560000000000000');
    const x = fromFixedPointBigNumber(bn, 10, 18);
    expect(x).to.be.equal(1.23456);
  });

  it('should decode irregular unit fixed point big number to decimal', function () {
    const bn = new BN('5432100000');
    const x = fromFixedPointBigNumber(bn, 10, 9);
    expect(x).to.be.equal(5.4321);
  });
});

describe('math utils library', function () {

  it('should compute log2 properly', async function () {
    const math = await MathUtils.new();
    const coeff = (new BN(2)).pow(new BN(64));
    var x = new BN(500);
    x = x.mul(coeff);
    const ybn = await math.testlogbase2(x);
    const y = fromFixedPointBigNumber(ybn, 2, 64);
    expect(y).to.be.approximately(Math.log2(500), 0.000001)
  });

  it('should compute log10 properly', async function () {
    const math = await MathUtils.new();
    const coeff = (new BN(2)).pow(new BN(64));
    for (var i = 0; i < 8; i++) {
      var x = new BN(10 ** i);
      x = x.mul(coeff);
      var y = await math.testlogbase10(x);
      y = y.div(coeff);
      expect(y.toNumber()).to.be.equal(i);
    }
  });
});

