import { buildWallLink, postbackHash, formatAmount, WALL_BASE } from './lib/moonetix.js';
import { handlePostback } from './lib/postback.js';
import { createDemoStore, emptyState } from './demo-store.js';

const flag = typeof document === 'undefined' ? null : document.querySelector('meta[name="moonetix-demo"]');

export const DEMO_CONFIG = {
  appId: 'demoapp0000000000000001',
  linkSalt: 'demo_link_salt_not_secret',
  postbackKey: 'demo_postback_key_not_secret',
  currencyName: 'Coins',
};

export const OFFERS = [
  { id: 'puzzle', title: 'Reach level 5 in a puzzle game', about: 'Install a puzzle game and clear the first five levels.', reward: '150' },
  { id: 'survey', title: 'Answer a short survey', about: 'About five minutes of questions on hobbies and free time.', reward: '40' },
  { id: 'strategy', title: 'Finish the tutorial in a strategy game', about: 'Build your first town and complete the guided tutorial.', reward: '90' },
  { id: 'videos', title: 'Watch three short videos', about: 'Three clips of about 30 seconds each.', reward: '7.5' },
];

const STATE_KEY = 'moonetix_demo_state';
const LOG_KEY = 'moonetix_demo_log';
const TOKEN_KEY = 'moonetix_demo_player_token';

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

function json(status, data) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

function ageConfirmed(body) {
  const v = body.age_confirmed;
  return v === true || v === 'true' || v === '1';
}

export function createDemoServer(store, config = DEMO_CONFIG) {
  return async function route(url, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    const auth = new Headers(init.headers || {}).get('Authorization') || '';
    const m = /^Bearer (\S+)$/.exec(auth);
    const token = m ? m[1] : '';

    if (method === 'POST' && url.pathname === '/api/players') {
      let body = {};
      try {
        body = init.body ? JSON.parse(init.body) : {};
      } catch {
        return json(400, { error: 'invalid body' });
      }
      if (!ageConfirmed(body)) return json(400, { error: 'age_confirmation_required' });
      const player = store.createPlayer();
      return json(201, { token: player.token, player_id: player.id });
    }

    if (url.pathname === '/api/balance' || url.pathname === '/api/offerwall-link') {
      if (method !== 'GET') return json(405, { error: 'method_not_allowed' });
      const player = store.findPlayerByToken(token);
      if (!player) return json(401, { error: 'sign_in_required' });
      if (url.pathname === '/api/balance') {
        return json(200, { player_id: player.id, balance: formatAmount(player.balance_micro), currency: config.currencyName });
      }
      const link = buildWallLink({ appId: config.appId, linkSalt: config.linkSalt, userId: String(player.id), subs: { sub1: 'html5' } });
      return json(200, { url: link });
    }

    return json(404, { error: 'not_found' });
  };
}

export function signedPostback({ tx, user, reward, status, offer }, postbackKey = DEMO_CONFIG.postbackKey) {
  const params = new URLSearchParams({ user, tx, status, reward, offer });
  params.set('hash', postbackHash(postbackKey, tx, user, reward, status));
  return params;
}

function install() {
  const store = createDemoStore(load(STATE_KEY, emptyState()), () => save(STATE_KEY, store.state));
  const route = createDemoServer(store);
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin === location.origin && url.pathname.startsWith('/api/')) return route(url, init);
    return realFetch(input, init);
  };

  const realOpen = window.open.bind(window);
  window.open = (url, ...rest) => {
    if (typeof url === 'string' && url.startsWith(WALL_BASE)) {
      openWall(url);
      return null;
    }
    return realOpen(url, ...rest);
  };
  window.Moonetix = { open: (link) => openWall(link) };

  const $ = (id) => document.getElementById(id);
  const wall = $('wall');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, reduceMotion ? 0 : ms));
  let log = load(LOG_KEY, []);
  let lastFocus = null;
  let player = '';
  let current = null;
  let busy = false;

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
    node.append(...children);
    return node;
  }

  function coins(micro) {
    return formatAmount(micro) + ' ' + DEMO_CONFIG.currencyName;
  }

  function renderLog() {
    $('log').replaceChildren(
      ...log
        .slice(-8)
        .reverse()
        .map((e) =>
          el(
            'li',
            {},
            el('span', { class: 'mono' }, e.tx),
            el('span', { class: 'res ' + (e.code === 200 ? (e.body === 'credited' ? 'ok' : 'same') : 'no') }, e.code + ' ' + e.body),
            el('span', { class: 'sub' }, 'status ' + e.status + ', reward ' + e.reward + ' for player ' + e.user),
          ),
        ),
    );
    $('log-empty').hidden = log.length > 0;
  }

  function post(params) {
    const res = handlePostback(params, { postbackKey: DEMO_CONFIG.postbackKey, store });
    log.push({ tx: params.get('tx'), user: params.get('user'), status: params.get('status'), reward: params.get('reward'), code: res.code, body: res.body });
    log = log.slice(-50);
    save(LOG_KEY, log);
    renderLog();
    window.dispatchEvent(new Event('focus'));
    return res;
  }

  function showOffers() {
    $('flow').hidden = true;
    $('offers').hidden = false;
    $('offers').replaceChildren(
      ...OFFERS.map((o) => {
        const button = el('button', { type: 'button', class: 'btn primary' }, 'Complete offer');
        button.addEventListener('click', () => complete(o));
        return el(
          'li',
          { class: 'offer' },
          el('div', {}, el('h3', {}, o.title), el('p', { class: 'small muted' }, o.about)),
          el('div', { class: 'offer-act' }, el('span', { class: 'reward' }, '+' + o.reward + ' ' + DEMO_CONFIG.currencyName), button),
        );
      }),
    );
  }

  function step(title, ...detail) {
    const li = el('li', { class: 'step' }, el('strong', {}, title), ...detail.map((d) => (typeof d === 'string' ? el('p', { class: 'small' }, d) : d)));
    $('steps').append(li);
    return li;
  }

  async function complete(offer) {
    if (busy) return;
    busy = true;
    const tx = 'demo_' + Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, '0')).join('');
    const params = signedPostback({ tx, user: player, reward: offer.reward, status: '1', offer: offer.title });
    current = params;
    $('offers').hidden = true;
    $('flow').hidden = false;
    $('flow-title').textContent = offer.title;
    $('steps').replaceChildren();
    $('extra').replaceChildren();
    $('flow-actions').hidden = true;
    const before = store.getPlayer(Number(player));

    step('1. Offer completed', 'The advertiser confirms the offer to Moonetix, which records transaction ' + tx + '.');
    await wait(700);
    step(
      '2. Signed postback sent',
      'Moonetix calls your postback URL. The hash is an HMAC-SHA256 of tx:user:reward:status with your postback secret key.',
      el('pre', {}, el('code', {}, 'GET /moonetix/postback?' + params.toString())),
    );
    await wait(900);
    const balanceBefore = before ? before.balance_micro : 0;
    const res = post(params);
    step('3. Server verifies the hash', 'The hash matches, so handlePostback() goes on. It answered ' + res.code + ' ' + res.body + '.');
    await wait(700);
    const after = store.getPlayer(Number(player));
    if (res.body === 'credited') {
      step(
        '4. Coins credited once',
        '+' + coins(after.balance_micro - balanceBefore) + ' for player ' + player + '. Balance: ' + coins(after.balance_micro) + '.',
        'The transaction ID is stored, so a retry of this postback changes nothing.',
      );
    } else {
      step('4. Nothing credited', 'The server answered ' + res.body + '.');
    }
    $('flow-actions').hidden = false;
    $('back').focus();
    busy = false;
  }

  function extra(text, ok) {
    $('extra').append(el('li', { class: ok ? 'same' : 'no' }, text));
  }

  $('again').addEventListener('click', () => {
    if (!current) return;
    const res = post(current);
    extra('Same postback again: ' + res.code + ' ' + res.body + '. The balance did not change.', true);
  });

  $('forged').addEventListener('click', () => {
    if (!current) return;
    const forged = new URLSearchParams(current);
    forged.set('reward', '5000');
    const res = post(forged);
    extra('Reward changed to 5000 without the key: ' + res.code + ' ' + res.body + '. Nothing was stored.', false);
  });

  $('back').addEventListener('click', () => {
    showOffers();
    const first = $('offers').querySelector('button');
    if (first) first.focus();
  });

  function focusables() {
    return [...wall.querySelectorAll('button, a[href]')].filter((n) => !n.closest('[hidden]'));
  }

  function openWall(link) {
    if (!wall.hidden) return;
    const url = new URL(link);
    player = url.searchParams.get('user_id') || '';
    $('wall-user').textContent = player;
    $('wall-link').textContent = link;
    showOffers();
    lastFocus = document.activeElement;
    wall.hidden = false;
    document.body.classList.add('locked');
    $('wall-close').focus();
  }

  function closeWall() {
    if (busy) return;
    wall.hidden = true;
    document.body.classList.remove('locked');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  $('wall-close').addEventListener('click', closeWall);
  wall.addEventListener('click', (e) => {
    if (e.target === wall) closeWall();
  });
  wall.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') closeWall();
    if (e.key === 'Tab') {
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  $('reset').addEventListener('click', () => {
    try {
      for (const k of [STATE_KEY, LOG_KEY, TOKEN_KEY]) localStorage.removeItem(k);
    } catch {
      return;
    }
    location.reload();
  });

  renderLog();
}

if (flag && flag.content === 'on') install();
