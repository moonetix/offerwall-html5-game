'use strict';

const { createApp } = require('../src/server');
const { openStore } = require('../src/store');
const vectors = require('./fixtures/moonetix-vectors.json');

const config = {
  port: 0,
  databasePath: ':memory:',
  currencyName: 'Coins',
  appId: vectors.app_id,
  linkSalt: vectors.link_salt,
  postbackKey: vectors.postback_key,
};

async function startServer(overrides = {}) {
  const store = openStore(':memory:');
  const server = createApp({ config: { ...config, ...overrides }, store, log: () => {} });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = (token) => (token ? { Authorization: `Bearer ${token}` } : {});
  return {
    base,
    store,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      store.close();
    },
    get(path, token, headers = {}) {
      return fetch(base + path, { headers: { ...auth(token), ...headers } });
    },
    post(path, body, token, headers = {}) {
      return fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth(token), ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
    },
    async createPlayer() {
      const res = await this.post('/api/players', { age_confirmed: true });
      return (await res.json()).token;
    },
    async balance(token) {
      return (await (await this.get('/api/balance', token)).json()).balance;
    },
    // Sends a postback URL produced by the Moonetix postback code to this server.
    postback(url) {
      const u = new URL(url);
      return fetch(base + u.pathname + u.search);
    },
  };
}

module.exports = { config, vectors, startServer };
