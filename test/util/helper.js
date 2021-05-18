const { BN, time } = require('@openzeppelin/test-helpers');
const { fromWei, toWei } = require('web3-utils')
const { appendFileSync, existsSync, unlinkSync } = require('fs');


// same const used for GYSR, test token, and bonus value returns
const DECIMALS = 18;
// max 20% GYSR spending fee
const FEE = 0.2;

const UNITMAP = {
  3: 'kwei',
  6: 'mwei',
  9: 'gwei',
  12: 'micro',
  15: 'milli',
  18: 'ether',
  21: 'kether'
};

const GAS_REPORT = './gas_report.txt';
var gas_report_initialized = false;

function tokens(x) {
  return toFixedPointBigNumber(x, 10, DECIMALS);
}

function fromTokens(x) {
  return fromFixedPointBigNumber(x, 10, DECIMALS);
}

function bonus(x) {
  return toFixedPointBigNumber(x, 10, DECIMALS);
}

function fromBonus(x) {
  return fromFixedPointBigNumber(x, 10, DECIMALS);
}

function days(x) {
  return new BN(60 * 60 * 24 * x);
}

function shares(x) {
  return new BN(10 ** 6).mul(toFixedPointBigNumber(x, 10, DECIMALS));
}

async function now() {
  return time.latest()
}

function toFixedPointBigNumber(x, base, decimal) {
  // use web3 utils if possible
  if (base == 10 && decimal in UNITMAP) {
    return new BN(toWei(x.toString(), UNITMAP[decimal]));
  }

  var x_ = x;
  var bn = new BN(0);
  for (var i = 0; i < decimal; i++) {
    // shift next decimal chunk to integer
    var v = x_;
    for (j = 0; j < i; j++) {
      v *= base;
    }
    v = Math.floor(v);

    // add to big number
    bn = bn.add((new BN(v)).mul((new BN(base)).pow(new BN(decimal - i))));

    // shift back to decimal and remove
    for (j = 0; j < i; j++) {
      v /= base;
    }
    x_ -= v;
  }
  return bn;
}

function fromFixedPointBigNumber(x, base, decimal) {
  // use web3 utils if possible
  if (base == 10 && decimal in UNITMAP) {
    return parseFloat(fromWei(x, UNITMAP[decimal]));
  }

  var x_ = new BN(x);
  var value = 0.0;
  for (var i = 0; i < decimal; i++) {
    // get next chunk from big number
    var c = (new BN(base)).pow(new BN(decimal - i))
    var v = x_.div(c);
    x_ = x_.sub(v.mul(c));

    // shift bn chunk to decimal and add
    v_ = v.toNumber();
    for (j = 0; j < i; j++) {
      v_ /= base;
    }
    value += v_;
  }
  return value;
}

function reportGas(contract, method, description, tx) {
  if (!gas_report_initialized) {
    // reset
    if (existsSync(GAS_REPORT)) {
      unlinkSync(GAS_REPORT);
    }
    appendFileSync(GAS_REPORT, 'contract, method, description, gas\n');
    gas_report_initialized = true;
  }
  // write entry
  const amount = tx.receipt.gasUsed;
  appendFileSync(GAS_REPORT, `${contract}, ${method}, ${description}, ${amount}\n`);
}

module.exports = {
  tokens,
  fromTokens,
  bonus,
  fromBonus,
  days,
  shares,
  now,
  toFixedPointBigNumber,
  fromFixedPointBigNumber,
  reportGas,
  DECIMALS,
  FEE
};
