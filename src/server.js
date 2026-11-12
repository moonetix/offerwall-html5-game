'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('./config');
const { openStore } = require('./store');
const { buildWallLink, formatAmount } = require('./moonetix');
const { handlePostback } = require('./postback');
const { send, sendText, readBody, bearerToken, ageConfirmed, defaultLog } = require('./http');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/game.js': ['game.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
// Phaser comes from jsDelivr at a pinned version with Subresource Integrity.
// embed.js and the offerwall frame come from wall.moonetix.com.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net https://wall.moonetix.com",
  "frame-src https://wall.moonetix.com",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ');

function createApp({ config, store, log = defaultLog }) {
  return http.createServer(async (req, res) => {
    try {
      await route(req, res, { config, store, log });
    } catch (err) {
      if (err && err.statusCode) return send(res, err.statusCode, { error: err.message });
      log('unhandled error', { error: err && err.message });
      send(res, 500, { error: 'server_error' });
    }
  });
}

async function route(req, res, { config, store, log }) {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/moonetix/postback') {
    const { code, body } = handlePostback(url.searchParams, { postbackKey: config.postbackKey, store, log });
    return sendText(res, code, body);
  }

  // Demo sign-in. The player confirms they are 16 or older, and gets a random token.
  if (req.method === 'POST' && url.pathname === '/api/players') {
    const body = await readBody(req);
    if (!ageConfirmed(body)) return send(res, 400, { error: 'age_confirmation_required' });
    const player = store.createPlayer();
    log('player created', { id: player.id });
    return send(res, 201, { token: player.token, player_id: player.id });
  }

  if (url.pathname === '/api/balance' || url.pathname === '/api/offerwall-link') {
    if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
    // The player comes only from the sign-in token, never from a user ID the client sends.
    const player = store.findPlayerByToken(bearerToken(req));
    if (!player) return send(res, 401, { error: 'sign_in_required' });

    if (url.pathname === '/api/balance') {
      return send(res, 200, {
        player_id: player.id,
        balance: formatAmount(player.balance_micro),
        currency: config.currencyName,
      });
    }
    const link = buildWallLink({
      appId: config.appId,
      linkSalt: config.linkSalt,
      userId: String(player.id),
      subs: { sub1: 'html5' },
    });
    return send(res, 200, { url: link });
  }

  if (req.method === 'GET' && STATIC[url.pathname]) {
    const [file, type] = STATIC[url.pathname];
    const content = fs.readFileSync(path.join(PUBLIC_DIR, file));
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': 'no-cache',
    });
    return res.end(content);
  }

  if (req.method === 'GET' && url.pathname === '/health') return sendText(res, 200, 'ok');

  send(res, 404, { error: 'not_found' });
}

if (require.main === module) {
  const config = loadConfig();
  const store = openStore(config.databasePath);
  createApp({ config, store }).listen(config.port, () => {
    console.log(`Listening on http://localhost:${config.port}`);
  });
}

module.exports = { createApp };
