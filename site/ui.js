const $ = (id) => document.getElementById(id);
const KEYS = {
  left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  earn: { key: 'e', code: 'KeyE', keyCode: 69 },
};
const NOT_FOR_GAME = new Set([16, 32, 38, 40]);
const GAME_KEYS = new Set([37, 39, 69]);
const timers = new WeakMap();
let sayTimer = 0;

function say(text) {
  const live = $('live');
  live.textContent = '';
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => {
    live.textContent = text;
  }, 60);
}

function sendKey(type, k) {
  window.dispatchEvent(new KeyboardEvent(type, { key: k.key, code: k.code, keyCode: k.keyCode, which: k.keyCode }));
}

function initHint() {
  const hint = $('play-hint');
  const hide = () => hint.classList.add('off');
  $('stage').addEventListener('pointerdown', hide);
  $('stage').addEventListener('pointermove', hide);
  return hide;
}

function initKeys(hideHint) {
  const guard = (e) => {
    if (e.type === 'keydown' && GAME_KEYS.has(e.keyCode)) hideHint();
    if (NOT_FOR_GAME.has(e.keyCode)) e.stopPropagation();
  };
  document.addEventListener('keydown', guard);
  document.addEventListener('keyup', guard);
}

function initPad(hideHint) {
  for (const [id, k] of [['pad-left', KEYS.left], ['pad-right', KEYS.right]]) {
    const btn = $(id);
    let held = false;
    const press = () => {
      if (held) return;
      held = true;
      hideHint();
      btn.classList.add('held');
      sendKey('keydown', k);
    };
    const release = () => {
      if (!held) return;
      held = false;
      btn.classList.remove('held');
      sendKey('keyup', k);
    };
    const capture = (e) => {
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        return;
      }
    };
    btn.addEventListener('pointerdown', (e) => {
      capture(e);
      press();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) btn.addEventListener(type, release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (!e.repeat) press();
    });
    btn.addEventListener('keyup', (e) => {
      if (e.key === 'Enter' || e.key === ' ') release();
    });
  }
  $('pad-earn').addEventListener('click', () => {
    hideHint();
    sendKey('keydown', KEYS.earn);
    sendKey('keyup', KEYS.earn);
  });
}

function initTabs() {
  const tabs = [...document.querySelectorAll('[role=tab]')];
  const select = (tab, focus) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    }
    if (focus) tab.focus();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab, false));
    tab.addEventListener('keydown', (e) => {
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      select(tabs[(to + tabs.length) % tabs.length], true);
    });
    tab.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') e.stopPropagation();
    });
  });
}

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    return false;
  }
}

function flash(btn, ok) {
  const label = btn.querySelector('.copy-label');
  if (!btn.dataset.label) btn.dataset.label = label.textContent;
  label.textContent = ok ? 'Copied' : 'Copy failed';
  btn.classList.toggle('done', ok);
  btn.classList.toggle('fail', !ok);
  btn.querySelector('use').setAttribute('href', ok ? '#i-check' : '#i-bad');
  clearTimeout(timers.get(btn));
  timers.set(
    btn,
    setTimeout(() => {
      label.textContent = btn.dataset.label;
      btn.classList.remove('done', 'fail');
      btn.querySelector('use').setAttribute('href', '#i-copy');
    }, 2000),
  );
}

function initCopy() {
  for (const btn of document.querySelectorAll('.copy[data-copy]')) {
    btn.addEventListener('click', async () => {
      const code = $(btn.dataset.copy);
      const ok = await writeClipboard(code.textContent);
      flash(btn, ok);
      if (ok) {
        say('Copied to the clipboard');
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(code);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      say('Copying is blocked in this browser. The code is selected, copy it with your keyboard.');
    });
  }
}

export function initUi() {
  const hideHint = initHint();
  initKeys(hideHint);
  initPad(hideHint);
  initTabs();
  initCopy();
}
