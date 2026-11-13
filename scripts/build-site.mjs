// Builds the GitHub Pages demo into _site/.
//
//   node scripts/build-site.mjs
//   PHASER_FILE=/path/to/phaser.min.js node scripts/build-site.mjs
//
// The Pages demo runs without the Node server. It is the real public/game.js
// plus a demo script (site/demo.js) that answers the game's /api calls in the
// browser and runs each postback through the real src/postback.js.
//
// - Phaser: public/index.html pins a jsDelivr URL with a sha384 integrity
//   value. The build downloads that exact URL (or reads PHASER_FILE), checks
//   the hash against the value in index.html, and serves the file from
//   _site/vendor/, so visitors make no third-party requests.
// - public/game.js is copied with comments removed. src/moonetix.js and
//   src/postback.js become browser ES modules: same code, comments removed,
//   node:crypto and Buffer provided by site/lib/node-crypto.js.
// - The demo switch is a meta tag this script writes into _site/index.html.
//   The real server serves public/ only and never sees it.
// - The server snippet shown under "Use it in your project" is run with Node
//   against the real src/ and its output is written into the page, so the
//   snippet and the output it claims cannot drift apart.
//
// Node 22 built-ins only (fetch, crypto). Nothing in public/ or src/ changes.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(ROOT, '_site');
const require = createRequire(import.meta.url);

function fail(message) {
  console.error(`build-site: ${message}`);
  process.exit(1);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

// Removes // and /* */ comments. Knows about strings, template literals and
// regex literals, which covers public/game.js and src/.
function stripComments(src) {
  let out = '';
  let i = 0;
  let lastSig = '';
  let word = '';
  const ident = /[A-Za-z0-9_$]/;
  const regexAfter = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
  const regexAfterWord = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'throw']);
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) throw new Error('unterminated block comment');
      i = end + 2;
      out += ' ';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') j++;
        else if (c === '`' && src[j] === '$' && src[j + 1] === '{') {
          const close = src.indexOf('}', j);
          if (src.slice(j, close).includes('`')) throw new Error('nested template literal not supported');
        } else if (c !== '`' && src[j] === '\n') throw new Error('unterminated string');
        j++;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
      lastSig = c;
      word = '';
      continue;
    }
    if (c === '/' && (regexAfter.has(lastSig) || regexAfterWord.has(word))) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length) {
        const ch = src[j];
        if (ch === '\\') { j += 2; continue; }
        if (ch === '\n') throw new Error('unterminated regex');
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) break;
        j++;
      }
      j++;
      while (j < src.length && /[a-z]/.test(src[j])) j++;
      out += src.slice(i, j);
      i = j;
      lastSig = '/';
      word = '';
      continue;
    }
    if (ident.test(c)) word = (ident.test(out[out.length - 1] || '') ? word : '') + c;
    else if (!/\s/.test(c)) word = '';
    if (!/\s/.test(c)) lastSig = c;
    out += c;
    i++;
  }
  return out
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l !== '')
    .join('\n') + '\n';
}

// Wraps a CommonJS file from src/ as an ES module with the same exports.
const SHIMS = { 'node:crypto': './node-crypto.js' };
function toBrowserModule(name) {
  const file = path.join(ROOT, 'src', `${name}.js`);
  const source = stripComments(fs.readFileSync(file, 'utf8'));
  const deps = [...new Set([...source.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]))];
  const targets = deps.map((dep) => {
    if (SHIMS[dep]) return SHIMS[dep];
    if (dep.startsWith('./')) return `${dep}.js`;
    throw new Error(`src/${name}.js requires ${dep}, which has no browser shim`);
  });
  const usesBuffer = /\bBuffer\b/.test(source);
  const names = Object.keys(require(file));
  const lines = targets.map((t, k) => `import __dep${k} from '${t}';`);
  if (usesBuffer) lines.push(`import { Buffer as __Buffer } from '${SHIMS['node:crypto']}';`);
  const table = deps.length ? `{ ${deps.map((dep, k) => `'${dep}': __dep${k}`).join(', ')} }` : '{}';
  lines.push(
    'const module = { exports: {} };',
    `(function (module, exports, require${usesBuffer ? ', Buffer' : ''}) {`,
    source.trimEnd(),
    `})(module, module.exports, (id) => (${table})[id]${usesBuffer ? ', __Buffer' : ''});`,
    'export default module.exports;',
    `export const { ${names.join(', ')} } = module.exports;`,
    '',
  );
  return lines.join('\n');
}

async function phaserBytes(url) {
  if (process.env.PHASER_FILE) {
    const file = path.resolve(process.env.PHASER_FILE);
    console.log(`Phaser from PHASER_FILE ${file}`);
    return fs.readFileSync(file);
  }
  console.log(`Phaser from ${url}`);
  const res = await fetch(url, { redirect: 'error' });
  if (!res.ok) fail(`could not download Phaser: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const publicHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

const phaserTag = [...publicHtml.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]).find((t) => /\bsrc="[^"]*phaser[^"]*"/.test(t));
if (!phaserTag) fail('no Phaser script tag in public/index.html');
const phaserUrl = /\bsrc="([^"]+)"/.exec(phaserTag)[1];
const integrity = (/\bintegrity="([^"]+)"/.exec(phaserTag) || [])[1];
if (!/^https:\/\//.test(phaserUrl)) fail(`unexpected Phaser URL ${phaserUrl}`);
if (!integrity || !/^sha384-[A-Za-z0-9+/]+=*$/.test(integrity)) fail('the Phaser script tag has no sha384 integrity value');

const phaser = await phaserBytes(phaserUrl);
const actual = 'sha384-' + crypto.createHash('sha384').update(phaser).digest('base64');
if (actual !== integrity) fail(`Phaser integrity mismatch: expected ${integrity}, got ${actual}`);

const ageGate = (/<div id="age-gate"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/.exec(publicHtml) || [])[0];
if (!ageGate) fail('no age gate block in public/index.html');

fs.rmSync(OUT, { recursive: true, force: true });
copyDir(SITE, OUT);
fs.mkdirSync(path.join(OUT, 'vendor'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'vendor', 'phaser.min.js'), phaser);

const game = stripComments(fs.readFileSync(path.join(ROOT, 'public', 'game.js'), 'utf8'));
try {
  new vm.Script(game, { filename: 'game.js' });
} catch (err) {
  fail(`game.js does not parse after removing comments: ${err.message}`);
}
fs.writeFileSync(path.join(OUT, 'game.js'), game);

for (const name of ['moonetix', 'postback']) {
  fs.writeFileSync(path.join(OUT, 'lib', `${name}.js`), toBrowserModule(name));
}

let html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');

const phaserVersion = (/phaser@(\d+\.\d+\.\d+)\//.exec(phaserUrl) || [])[1];
if (!phaserVersion) fail(`no Phaser version in ${phaserUrl}`);

// Runs the snippet from the page the way a reader would: from the repo folder.
const unescapeHtml = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const escapeHtml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const snippet = (/<code id="code-server">([\s\S]*?)<\/code>/.exec(html) || [])[1];
if (!snippet) fail('no server snippet (code-server) in site/index.html');
let snippetOutput;
try {
  snippetOutput = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-'], {
    cwd: ROOT,
    input: unescapeHtml(snippet),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30000,
  }).trimEnd();
} catch (err) {
  fail(`the server snippet on the page does not run: ${String(err.stderr || err.message).trim().split('\n').pop()}`);
}
const snippetLines = snippetOutput.split('\n');
if (snippetLines.length !== 3 || !snippetLines[0].startsWith('https://wall.moonetix.com/') || !snippetLines[1].includes("'credited'") || !snippetLines[2].includes("'duplicate'")) {
  fail(`unexpected output from the server snippet on the page:\n${snippetOutput}`);
}

html = html
  .replace('@@DEMO_FLAG@@', '<meta name="moonetix-demo" content="on">')
  .replace('@@PHASER@@', `<script src="vendor/phaser.min.js" integrity="${integrity}" defer></script>`)
  .replace('@@PHASER_VERSION@@', phaserVersion)
  .replace('@@SERVER_OUTPUT@@', () => escapeHtml(snippetOutput))
  .replace('@@AGE_GATE@@', ageGate.replace(/\n  /g, '\n'));
if (html.includes('@@')) fail('an @@ placeholder is left in index.html');
fs.writeFileSync(path.join(OUT, 'index.html'), html);

// The browser modules must answer exactly like the Node ones.
const typeFile = path.join(OUT, 'package.json');
fs.writeFileSync(typeFile, '{"type":"module"}\n');
const web = await import(pathToFileURL(path.join(OUT, 'lib', 'moonetix.js')).href);
const webPostback = await import(pathToFileURL(path.join(OUT, 'lib', 'postback.js')).href);
const { createDemoStore } = await import(pathToFileURL(path.join(OUT, 'demo-store.js')).href);
fs.rmSync(typeFile);

const node = require(path.join(ROOT, 'src', 'moonetix.js'));
const nodePostback = require(path.join(ROOT, 'src', 'postback.js'));
const vectors = require(path.join(ROOT, 'test', 'fixtures', 'moonetix-vectors.json'));
for (const [user, expected] of Object.entries(vectors.walls)) {
  const link = web.buildWallLink({ appId: vectors.app_id, linkSalt: vectors.link_salt, userId: user });
  if (link !== expected) fail(`browser buildWallLink differs for user ${user}`);
}
const storeA = createDemoStore();
const storeB = createDemoStore();
for (let k = 0; k < 2; k++) {
  storeA.createPlayer();
  storeB.createPlayer();
}
let checked = 0;
for (const [name, url] of Object.entries(vectors.postbacks)) {
  const params = new URL(url).searchParams;
  const a = webPostback.handlePostback(params, { postbackKey: vectors.postback_key, store: storeA });
  const b = nodePostback.handlePostback(params, { postbackKey: vectors.postback_key, store: storeB });
  if (JSON.stringify(a) !== JSON.stringify(b)) fail(`browser handlePostback differs on ${name}`);
  const [tx, user, reward, status] = ['tx', 'user', 'reward', 'status'].map((p) => params.get(p) ?? '');
  if (web.postbackHash(vectors.postback_key, tx, user, reward, status) !== node.postbackHash(vectors.postback_key, tx, user, reward, status)) {
    fail(`browser postbackHash differs on ${name}`);
  }
  checked++;
}
for (const v of ['0', '7.5', '1.23456', '150', '999999999.999999', '-1', 'x']) {
  if (web.parseAmount(v) !== node.parseAmount(v)) fail(`browser parseAmount differs on ${v}`);
}

const kb = (f) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1);
console.log(`_site built: Phaser ${phaserVersion} ${kb('vendor/phaser.min.js')} KB (integrity ok), ${checked} postback vectors and ${Object.keys(vectors.walls).length} signed links match src/, server snippet ran`);
