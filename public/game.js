'use strict';

// Coins live on the server. The game only reads the balance; it never adds coins itself.
(() => {
  const TOKEN_KEY = 'moonetix_demo_player_token';
  const WALL_PREFIX = 'https://wall.moonetix.com/';
  const POLL_MS = 15000;

  const state = { token: readToken(), link: '', balance: null, currency: 'Coins', playerId: null };
  let hud = null;

  function readToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  }

  function saveToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Private mode: the sign-in lasts for this page only.
    }
  }

  function signOut() {
    state.token = '';
    state.link = '';
    state.balance = null;
    saveToken('');
    if (hud) hud.showBalance(false);
  }

  async function api(path, options = {}) {
    const headers = {};
    if (options.body) headers['Content-Type'] = 'application/json';
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(path, { ...options, headers });
    if (res.status === 401) {
      signOut();
      throw new Error('sign_in_required');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // Demo sign-in. Your real game uses its own accounts; the server picks the player from the session.
  async function createPlayer() {
    const data = await api('/api/players', { method: 'POST', body: JSON.stringify({ age_confirmed: true }) });
    state.token = data.token;
    saveToken(data.token);
  }

  async function refreshBalance() {
    if (!state.token || document.hidden) return;
    try {
      const data = await api('/api/balance');
      const before = state.balance;
      state.balance = data.balance;
      state.currency = data.currency;
      state.playerId = data.player_id;
      if (hud) hud.showBalance(before !== null && Number(data.balance) > Number(before));
    } catch {
      // Try again on the next poll.
    }
  }

  async function loadLink() {
    if (!state.token || state.link) return;
    try {
      const { url } = await api('/api/offerwall-link');
      if (typeof url === 'string' && url.startsWith(WALL_PREFIX)) state.link = url;
    } catch {
      // The button tries again.
    }
  }

  // The pop-up from embed.js loads only on https pages of the website registered for the app.
  // On http (local development) the link opens in a new tab instead, which works everywhere.
  function inPagePopup() {
    return location.protocol === 'https:' && window.Moonetix && typeof window.Moonetix.open === 'function';
  }

  async function openOfferwall() {
    if (!state.token) {
      showAgeGate();
      return;
    }
    if (state.link) {
      if (inPagePopup()) window.Moonetix.open(state.link);
      else window.open(state.link, '_blank', 'noopener');
      return;
    }
    await loadLink();
    if (state.link && inPagePopup()) {
      window.Moonetix.open(state.link);
    } else if (hud) {
      hud.say(state.link ? 'Offers are ready. Tap Earn coins again.' : 'Offers are not available right now.');
    }
  }

  const gate = document.getElementById('age-gate');

  function showAgeGate() {
    gate.hidden = false;
    document.getElementById('age-yes').focus();
  }

  document.getElementById('age-yes').addEventListener('click', async () => {
    gate.hidden = true;
    try {
      await createPlayer();
      await Promise.all([refreshBalance(), loadLink()]);
      if (hud) hud.say('Tap Earn coins to see offers.');
    } catch {
      if (hud) hud.say('Could not reach the game server.');
    }
  });

  document.getElementById('age-no').addEventListener('click', () => {
    gate.hidden = true;
    if (hud) hud.say('Offers are for players 16 or older. You can still play.');
  });

  // Rewards arrive on the server by postback, often minutes later. Poll while the page is visible.
  setInterval(refreshBalance, POLL_MS);
  document.addEventListener('visibilitychange', refreshBalance);
  window.addEventListener('focus', refreshBalance);

  class StarCatcher extends Phaser.Scene {
    constructor() {
      super('play');
    }

    create() {
      const { width, height } = this.scale;
      makeTextures(this);
      this.score = 0;
      this.speed = 0.22;
      this.stars = [];

      this.basket = this.add.image(width / 2, height - 48, 'basket');
      this.time.addEvent({ delay: 650, loop: true, callback: () => this.dropStar() });
      this.cursors = this.input.keyboard.createCursorKeys();
      this.input.on('pointermove', (p) => {
        this.basket.x = Phaser.Math.Clamp(p.x, 48, width - 48);
      });

      const font = { fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' };
      this.coinsText = this.add.text(16, 16, '', { ...font, fontSize: '22px', color: '#ffffff', fontStyle: 'bold' }).setDepth(10);
      this.scoreText = this.add.text(16, 48, 'Stars: 0', { ...font, fontSize: '16px', color: '#c9d6f2' }).setDepth(10);
      this.messageText = this.add.text(width / 2, height - 100, '', { ...font, fontSize: '15px', color: '#ffffff', align: 'center', wordWrap: { width: width - 48 } })
        .setOrigin(0.5, 1).setDepth(10);

      const earn = this.add.text(width - 16, 16, 'Earn coins', {
        ...font, fontSize: '18px', color: '#ffffff', fontStyle: 'bold', backgroundColor: '#004abb', padding: { x: 14, y: 10 },
      }).setOrigin(1, 0).setDepth(10).setInteractive({ useHandCursor: true });
      // pointerup and keydown run inside the user's action, so a fallback tab is not blocked.
      earn.on('pointerup', openOfferwall);
      this.input.keyboard.on('keydown-E', openOfferwall);

      hud = {
        showBalance: (bump) => {
          this.coinsText.setText(state.balance === null ? `${state.currency}: -` : `${state.currency}: ${state.balance}`);
          if (bump) this.tweens.add({ targets: this.coinsText, scale: 1.25, duration: 160, yoyo: true });
        },
        say: (text) => {
          this.messageText.setText(text);
          this.time.delayedCall(5000, () => {
            if (this.messageText.text === text) this.messageText.setText('');
          });
        },
      };
      hud.showBalance(false);
      refreshBalance();
      loadLink();
    }

    dropStar() {
      const x = Phaser.Math.Between(24, this.scale.width - 24);
      this.stars.push(this.add.image(x, 96, 'star'));
    }

    update(time, delta) {
      if (this.cursors.left.isDown) this.basket.x -= 0.5 * delta;
      if (this.cursors.right.isDown) this.basket.x += 0.5 * delta;
      this.basket.x = Phaser.Math.Clamp(this.basket.x, 48, this.scale.width - 48);

      const catchZone = this.basket.getBounds();
      this.stars = this.stars.filter((star) => {
        star.y += this.speed * delta;
        star.angle += 0.1 * delta;
        if (Phaser.Geom.Intersects.RectangleToRectangle(star.getBounds(), catchZone)) {
          this.score += 1;
          this.scoreText.setText(`Stars: ${this.score}`);
          star.destroy();
          return false;
        }
        if (star.y > this.scale.height + 32) {
          star.destroy();
          return false;
        }
        return true;
      });
    }
  }

  function makeTextures(scene) {
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    const points = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 15 : 7;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      points.push(new Phaser.Geom.Point(16 + r * Math.cos(a), 16 + r * Math.sin(a)));
    }
    g.fillStyle(0xffd34d, 1);
    g.fillPoints(points, true);
    g.generateTexture('star', 32, 32);
    g.clear();
    g.fillStyle(0x7fb0ff, 1);
    g.fillRoundedRect(0, 0, 96, 20, 8);
    g.generateTexture('basket', 96, 20);
    g.destroy();
  }

  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: 480,
    height: 720,
    backgroundColor: '#0b1530',
    banner: false,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: StarCatcher,
  });
})();
