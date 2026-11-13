import nodeCrypto from './lib/node-crypto.js';

const TOKEN_RE = /^pl_[A-Za-z0-9_-]{43}$/;

function hashToken(token) {
  return nodeCrypto.createHash('sha256').update(token).digest('hex');
}

function randomToken() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes));
  return 'pl_' + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function emptyState() {
  return { nextId: 1, players: [], transactions: {} };
}

export function createDemoStore(state = emptyState(), onChange = () => {}) {
  const byId = (id) => state.players.find((p) => p.id === id) || null;
  return {
    state,

    createPlayer() {
      const token = randomToken();
      const id = state.nextId++;
      state.players.push({ id, token_hash: hashToken(token), balance_micro: 0 });
      onChange();
      return { id, token };
    },

    findPlayerByToken(token) {
      if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
      const hash = hashToken(token);
      return state.players.find((p) => p.token_hash === hash) || null;
    },

    getPlayer(id) {
      return byId(id);
    },

    applyPostback({ transactionId, playerId, rewardMicro, status, offerName }) {
      const txs = state.transactions;
      let result;
      if (status === 1) {
        if (Object.hasOwn(txs, transactionId)) result = 'duplicate';
        else if (!byId(playerId)) result = 'unknown_user';
        else {
          txs[transactionId] = { player_id: playerId, reward_micro: rewardMicro, status: 1, offer_name: offerName || null };
          byId(playerId).balance_micro += rewardMicro;
          result = 'credited';
        }
      } else {
        const tx = Object.hasOwn(txs, transactionId) ? txs[transactionId] : null;
        if (!tx) result = 'not_credited';
        else if (tx.status === 2) result = 'duplicate';
        else if (tx.player_id !== playerId) result = 'user_mismatch';
        else {
          tx.status = 2;
          byId(tx.player_id).balance_micro -= tx.reward_micro;
          result = 'reversed';
        }
      }
      onChange();
      return result;
    },
  };
}
