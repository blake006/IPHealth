'use strict';

/** 版本号推进规则单测：次版本 0~10 顺次，满 10 进位 */

const assert = require('assert');
const { nextVersion } = require('./bump-version');

const cases = [
  ['1.1.0', '1.1.1'],
  ['1.1.1', '1.1.2'],
  ['1.1.9', '1.1.10'],
  ['1.1.10', '1.2.0'],
  ['1.2.0', '1.2.1'],
  ['1.2.10', '1.3.0'],
  ['1.0.12', '1.1.0'],
];

let pass = 0;
for (const [from, want] of cases) {
  try {
    assert.strictEqual(nextVersion(from), want);
    pass += 1;
    console.log(`✔ ${from} → ${want}`);
  } catch (e) {
    console.log(`✘ ${from} → ${nextVersion(from)}（期望 ${want}）`);
  }
}

let threw = false;
try {
  nextVersion('1.1');
} catch (e) {
  threw = true;
}
console.log(`${threw ? '✔' : '✘'} 非法版本号会报错`);

const total = cases.length + 1;
const ok = pass + (threw ? 1 : 0);
console.log(`\n通过 ${ok} / ${total}`);
process.exit(ok === total ? 0 : 1);
