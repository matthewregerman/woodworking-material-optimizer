import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength, formatLength, toU, formatU, formatArea } from '../src/engine/units.js';

test('parses plain and comma decimals in millimetres', () => {
  assert.equal(parseLength('596.5', 'mm'), 596.5);
  assert.equal(parseLength(' 596,5 ', 'mm'), 596.5);
  assert.equal(parseLength('2440', 'mm'), 2440);
  assert.equal(parseLength('.5', 'mm'), 0.5);
});

test('parses fractions and mixed numbers in inches', () => {
  // compared in engine units (whole micrometres), which is what the packer sees
  assert.equal(toU(parseLength('3/4', 'in')), 19050);
  assert.equal(toU(parseLength('23 1/2', 'in')), 596900);
  assert.equal(toU(parseLength('23-1/2', 'in')), 596900);
  assert.equal(toU(parseLength('48', 'in')), 1219200);
  assert.equal(toU(parseLength('1/8', 'in')), 3175);
});

test('a unit suffix overrides the job unit', () => {
  assert.equal(toU(parseLength('3/4"', 'mm')), 19050);
  assert.equal(parseLength('1 in', 'mm'), 25.4);
  assert.equal(parseLength('19mm', 'in'), 19);
  assert.equal(parseLength('2.5 cm', 'mm'), 25);
});

test('empty is null and rubbish is NaN', () => {
  assert.equal(parseLength('', 'mm'), null);
  assert.equal(parseLength('   ', 'mm'), null);
  for (const bad of ['abc', '12x', '1/0', '--3', '1.2.3', '-5', 'mm']) {
    assert.ok(Number.isNaN(parseLength(bad, 'mm')), bad);
  }
});

test('formats millimetres without trailing zeros', () => {
  assert.equal(formatLength(658.8, 'mm'), '658.8');
  assert.equal(formatLength(2440, 'mm'), '2440');
  assert.equal(formatLength(1.25, 'mm'), '1.25');
});

test('formats inches as fractions when exact, decimals otherwise', () => {
  assert.equal(formatLength(23.5 * 25.4, 'in'), '23 1/2');
  assert.equal(formatLength(19.05, 'in'), '3/4');
  assert.equal(formatLength(48 * 25.4, 'in'), '48');
  assert.equal(formatLength(25.4 / 64, 'in'), '1/64');
  assert.equal(formatLength(19, 'in'), '0.748');
});

test('what is typed comes back the same after a round trip', () => {
  for (const s of ['23 1/2', '3/4', '47 15/16', '1/8', '96']) {
    assert.equal(formatLength(parseLength(s, 'in'), 'in'), s);
  }
  for (const s of ['1220', '658.8', '1.2', '0.5']) {
    assert.equal(formatLength(parseLength(s, 'mm'), 'mm'), s);
  }
});

test('engine units are exact micrometres', () => {
  assert.equal(toU(1.2), 1200);
  assert.equal(toU(0.1 + 0.2), 300);
  assert.equal(toU(3.175), 3175);
  assert.equal(formatU(658800, 'mm'), '658.8');
  assert.equal(formatArea(2440e3 * 1220e3, 'mm'), '2.98 m²');
});
