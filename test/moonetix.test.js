'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWallLink, postbackHash, safeEqual, parseAmount, formatAmount } = require('../src/moonetix');
const { vectors } = require('./helpers');

test('signed link matches the link Moonetix builds for the same keys', () => {
  for (const [userId, expected] of Object.entries(vectors.walls)) {
    assert.equal(buildWallLink({ appId: vectors.app_id, linkSalt: vectors.link_salt, userId }), expected);
  }
});

test('sub IDs are appended, bad ones are dropped', () => {
  const url = buildWallLink({
    appId: vectors.app_id,
    linkSalt: vectors.link_salt,
    userId: '1',
    subs: { sub1: 'html5', sub2: 'has space', sub9: 'x' },
  });
  assert.equal(url, vectors.walls['1'] + '&sub1=html5');
});

test('user IDs outside the allowed characters are refused', () => {
  for (const userId of ['', 'a b', 'x'.repeat(101), '1/2']) {
    assert.throws(() => buildWallLink({ appId: vectors.app_id, linkSalt: vectors.link_salt, userId }));
  }
});

test('postback hash matches the Moonetix postback code', () => {
  const u = new URL(vectors.postbacks.credit_150);
  const p = u.searchParams;
  const expected = postbackHash(vectors.postback_key, p.get('tx'), p.get('user'), p.get('reward'), p.get('status'));
  assert.equal(expected, p.get('hash'));
  assert.ok(safeEqual(p.get('hash'), expected));
  assert.ok(!safeEqual(p.get('hash').slice(0, -1), expected));
});

test('amounts are exact integers in millionths', () => {
  assert.equal(parseAmount('150'), 150000000);
  assert.equal(parseAmount('0.75'), 750000);
  assert.equal(parseAmount('1.23456'), 1234560);
  for (const bad of ['', '-1', '1e3', '1.1234567', 'abc', '1.', '.5']) assert.equal(parseAmount(bad), null);
  assert.equal(formatAmount(151984560), '151.98456');
  assert.equal(formatAmount(-750000), '-0.75');
  assert.equal(formatAmount(0), '0');
});
