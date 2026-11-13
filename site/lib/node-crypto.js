const encoder = new TextEncoder();

function primes(count) {
  const out = [];
  for (let n = 2; out.length < count; n++) {
    if (out.every((p) => n % p !== 0)) out.push(n);
  }
  return out;
}

const fraction = (x) => Math.floor((x - Math.floor(x)) * 4294967296) >>> 0;
const P = primes(64);
const K = Uint32Array.from(P, (p) => fraction(Math.cbrt(p)));
const H0 = Uint32Array.from(P.slice(0, 8), (p) => fraction(Math.sqrt(p)));
const ror = (x, n) => (x >>> n) | (x << (32 - n));

function toBytes(data) {
  if (typeof data === 'string') return encoder.encode(data);
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function sha256(input) {
  const bytes = toBytes(input);
  const len = bytes.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[len] = 0x80;
  const view = new DataView(m.buffer);
  view.setUint32(total - 8, Math.floor((len * 8) / 4294967296));
  view.setUint32(total - 4, (len * 8) >>> 0);
  const h = H0.slice();
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = ror(w[i - 15], 7) ^ ror(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = ror(w[i - 2], 17) ^ ror(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      k = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += k;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i]);
  return out;
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function digestAs(bytes, encoding) {
  if (encoding !== 'hex') throw new Error('only hex digests are supported');
  return Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('');
}

function checkAlgorithm(name) {
  if (name !== 'sha256') throw new Error('only sha256 is supported');
}

function createHash(name) {
  checkAlgorithm(name);
  let data = new Uint8Array(0);
  return {
    update(part) {
      data = concat(data, toBytes(part));
      return this;
    },
    digest(encoding) {
      return digestAs(sha256(data), encoding);
    },
  };
}

function createHmac(name, key) {
  checkAlgorithm(name);
  let k = toBytes(key);
  if (k.length > 64) k = sha256(k);
  const block = new Uint8Array(64);
  block.set(k);
  const inner = block.map((x) => x ^ 0x36);
  const outer = block.map((x) => x ^ 0x5c);
  let data = new Uint8Array(0);
  return {
    update(part) {
      data = concat(data, toBytes(part));
      return this;
    },
    digest(encoding) {
      return digestAs(sha256(concat(outer, sha256(concat(inner, data)))), encoding);
    },
  };
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length');
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export const Buffer = { from: (value) => toBytes(String(value)) };

export default { createHash, createHmac, timingSafeEqual };
