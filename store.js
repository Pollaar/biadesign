// Armazenamento dos dados (agendamentos, aparelhos das notificações, chaves).
// - Com UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN definidos: usa o Upstash Redis (para hospedagens
//   sem disco permanente, como o Render grátis).
// - Sem essas variáveis: usa arquivos JSON na pasta data/ (para rodar no computador).
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const PREFIX = process.env.REDIS_PREFIX || 'agenda:';
const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

let redis = null;
if (url && token) {
  const { Redis } = require('@upstash/redis');
  redis = new Redis({ url, token });
}
const mode = redis ? 'redis' : 'file';
// No Render o disco é apagado a cada restart: sem Redis os dados sumiriam em silêncio. Melhor não subir.
if (!redis && (process.env.RENDER || process.env.REQUIRE_REDIS)) {
  console.error('ERRO: sem UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN neste ambiente os dados seriam perdidos a cada restart. Defina as variáveis no Render.');
  process.exit(1);
}

// ---------- leitura e escrita ----------
async function getJSON(name, fallback) {
  if (redis) {
    const v = await redis.get(PREFIX + name); // o cliente já converte de JSON
    return v == null ? fallback : v;
  }
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIR, name + '.json'), 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return fallback;
  }
}

async function setJSON(name, value) {
  if (redis) {
    await redis.set(PREFIX + name, value);
    return;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, name + '.json');
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
}

// ---------- trava (evita dois agendamentos no mesmo horário) ----------
// Fila local + trava no Redis (SET NX com validade), para funcionar mesmo com mais de uma instância.
let queue = Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RELEASE = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

async function redisLock(fn) {
  const key = PREFIX + 'lock';
  const id = crypto.randomUUID();
  const deadline = Date.now() + 8000;
  for (let wait = 50; ; wait = Math.min(wait * 1.5, 400)) {
    if ((await redis.set(key, id, { nx: true, px: 10000 })) === 'OK') break;
    if (Date.now() > deadline) throw Object.assign(new Error('Sistema ocupado. Tente de novo em alguns segundos.'), { status: 503 });
    await sleep(wait + Math.random() * 50);
  }
  try {
    return await fn();
  } finally {
    await redis.eval(RELEASE, [key], [id]).catch(() => {});
  }
}

function withLock(fn) {
  const run = queue.then(() => (redis ? redisLock(fn) : fn()), () => (redis ? redisLock(fn) : fn()));
  queue = run.catch(() => {});
  return run;
}

async function ping() {
  if (redis) await redis.ping();
  return mode;
}

module.exports = { mode, getJSON, setJSON, withLock, ping };
