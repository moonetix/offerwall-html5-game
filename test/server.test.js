'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { config, vectors, startServer } = require('./helpers');

test('HTML5 game server end to end', async (t) => {
  const app = await startServer();
  t.after(() => app.close());
  const pb = vectors.postbacks;
  let ana;
  let ben;

  await t.test('a player is created only after the 16+ confirmation', async () => {
    let res = await app.post('/api/players', {});
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'age_confirmation_required' });
    res = await app.post('/api/players', { age_confirmed: true });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.player_id, 1);
    assert.match(body.token, /^pl_[A-Za-z0-9_-]{43}$/);
    ana = body.token;
    // A form body works too.
    res = await app.post('/api/players', 'age_confirmed=true', null, { 'Content-Type': 'application/x-www-form-urlencoded' });
    assert.equal(res.status, 201);
    ben = (await res.json()).token;
  });

  await t.test('only a hash of the token is stored', () => {
    const row = app.store.getPlayer(1);
    assert.notEqual(row.token_hash, ana);
    assert.equal(row.token_hash.length, 64);
  });

  await t.test('balance and link need a valid sign-in token', async () => {
    for (const path of ['/api/balance', '/api/offerwall-link']) {
      for (const token of [null, 'pl_wrong', 'pl_' + 'A'.repeat(43)]) {
        const res = await app.get(path, token);
        assert.equal(res.status, 401);
      }
    }
  });

  await t.test('link is signed for the signed-in player, a client user ID is ignored', async () => {
    const res = await app.get('/api/offerwall-link?user_id=2&user=2', ana);
    assert.equal(res.status, 200);
    const { url } = await res.json();
    assert.equal(url, vectors.walls['1'] + '&sub1=html5');
    assert.ok(!url.includes(config.linkSalt));
    const second = await (await app.get('/api/offerwall-link', ben)).json();
    assert.equal(second.url, vectors.walls['2'] + '&sub1=html5');
  });

  await t.test('new players start at zero', async () => {
    const res = await app.get('/api/balance', ana);
    assert.deepEqual(await res.json(), { player_id: 1, balance: '0', currency: 'Coins' });
  });

  await t.test('real postbacks: credit once, decimals stay exact', async () => {
    let res = await app.postback(pb.credit_150);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'credited');
    assert.equal(await app.balance(ana), '150');
    res = await app.postback(pb.credit_150);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'duplicate');
    assert.equal(await app.balance(ana), '150');
    assert.equal(await (await app.postback(pb.credit_decimal)).text(), 'credited');
    assert.equal(await (await app.postback(pb.credit_five_decimals)).text(), 'credited');
    assert.equal(await app.balance(ana), '151.98456');
  });

  await t.test('the same credit sent 10 times at once is paid once', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => app.postback(pb.credit_before_reversed).then((r) => r.text())));
    assert.equal(results.filter((r) => r === 'credited').length, 1);
    assert.equal(results.filter((r) => r === 'duplicate').length, 9);
    assert.equal(await app.balance(ben), '25');
  });

  await t.test('reversal takes back exactly the credit, once', async () => {
    let res = await app.postback(pb.reverse_150);
    assert.equal(await res.text(), 'reversed');
    assert.equal(await app.balance(ana), '1.98456');
    res = await app.postback(pb.reverse_150);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'duplicate');
    assert.equal(await app.balance(ana), '1.98456');
  });

  await t.test('a credit after its reversal is not paid again', async () => {
    const res = await app.postback(pb.credit_150);
    assert.equal(await res.text(), 'duplicate');
    assert.equal(await app.balance(ana), '1.98456');
  });

  await t.test('reversal for another player than the credit changes nothing', async () => {
    const res = await app.postback(pb.reverse_other_user);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'user_mismatch');
    assert.equal(await app.balance(ana), '1.98456');
    assert.equal(await app.balance(ben), '25');
  });

  await t.test('reversal of a test_ transaction that was never credited changes nothing', async () => {
    const res = await app.postback(pb.reverse_uncredited_test);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'not_credited');
    assert.equal(await app.balance(ana), '1.98456');
  });

  await t.test('unknown players get 200 and no credit', async () => {
    let res = await app.postback(pb.credit_unknown_user);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'unknown_user');
    res = await app.postback(pb.credit_test_user);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ignored: unknown user');
  });

  await t.test('tampered, wrongly signed and unsigned postbacks are refused', async () => {
    const tampered = new URL(pb.credit_user2);
    tampered.searchParams.set('reward', '4000');
    let res = await app.postback(tampered.toString());
    assert.equal(res.status, 403);
    const otherUser = new URL(pb.credit_user2);
    otherUser.searchParams.set('user', '1');
    assert.equal((await app.postback(otherUser.toString())).status, 403);
    assert.equal((await app.postback(pb.wrong_key)).status, 403);
    const unsigned = new URL(pb.credit_user2);
    unsigned.searchParams.delete('hash');
    assert.equal((await app.postback(unsigned.toString())).status, 400);
    assert.equal(await app.balance(ben), '25');
    // The untouched postback still works afterwards.
    assert.equal(await (await app.postback(pb.credit_user2)).text(), 'credited');
    assert.equal(await app.balance(ben), '65');
  });

  await t.test('a storage failure answers 500 so Moonetix retries', async () => {
    const original = app.store.applyPostback;
    app.store.applyPostback = () => { throw new Error('disk full'); };
    try {
      const res = await app.postback(pb.credit_unknown_user);
      assert.equal(res.status, 500);
    } finally {
      app.store.applyPostback = original;
    }
  });

  await t.test('serves the game with a pinned Phaser, embed.js and a strict CSP', async () => {
    const res = await fetch(app.base + '/');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /cdn\.jsdelivr\.net\/npm\/phaser@3\.90\.0\/dist\/phaser\.min\.js" integrity="sha384-[A-Za-z0-9+\/=]{64}"/);
    assert.match(html, /<script src="https:\/\/wall\.moonetix\.com\/embed\.js" async><\/script>/);
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net https:\/\/wall\.moonetix\.com/);
    assert.match(csp, /frame-src https:\/\/wall\.moonetix\.com/);
    assert.match(csp, /connect-src 'self'/);
    for (const path of ['/game.js', '/style.css']) {
      const r = await fetch(app.base + path);
      assert.equal(r.status, 200);
      const body = await r.text();
      assert.ok(!body.includes(config.linkSalt) && !body.includes(config.postbackKey));
    }
    assert.equal((await fetch(app.base + '/../src/config.js')).status, 404);
  });

  await t.test('balance and link only answer GET', async () => {
    const res = await app.post('/api/offerwall-link', {}, ana);
    assert.equal(res.status, 405);
  });
});
