// Notificações Web Push para a dona (Android, computador e iPhone com o painel na Tela de Início).
// Chaves VAPID: do .env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) ou criadas na primeira execução e guardadas
// no armazenamento (data/vapid.json no computador, Upstash Redis no Render).
const webpush = require('web-push');
const store = require('./store');

const MAX_SUBS = 20;
let ready = null;
let publicKey = '';

function init() {
  if (!ready) {
    ready = (async () => {
      let keys;
      if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
      } else {
        keys = await store.getJSON('vapid', null);
        if (!keys) {
          keys = webpush.generateVAPIDKeys();
          await store.setJSON('vapid', keys);
          console.log('Chaves de notificação (VAPID) criadas e guardadas (' + store.mode + ').');
        }
      }
      // a Apple recusa o envio sem um "subject" válido (mailto: ou https:)
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', keys.publicKey, keys.privateKey);
      publicKey = keys.publicKey;
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

const readSubs = () => store.getJSON('push-subscriptions', []);
const writeSubs = (list) => store.setJSON('push-subscriptions', list);

function isValidSub(s) {
  return s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1000 &&
    s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string';
}

async function getPublicKey() {
  await init();
  return publicKey;
}

function subscribe(sub, device) {
  if (!isValidSub(sub)) return Promise.reject(Object.assign(new Error('Inscrição inválida.'), { status: 400 }));
  return store.withLock(async () => {
    const list = (await readSubs()).filter((s) => s.endpoint !== sub.endpoint);
    list.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, device: String(device || '').slice(0, 80), createdAt: new Date().toISOString() });
    await writeSubs(list.slice(-MAX_SUBS));
    return list.length;
  });
}

function unsubscribe(endpoint) {
  return store.withLock(async () => {
    const list = (await readSubs()).filter((s) => s.endpoint !== endpoint);
    await writeSubs(list);
    return list.length;
  });
}

async function status(endpoint) {
  const list = await readSubs();
  return { subscribed: list.some((s) => s.endpoint === endpoint), devices: list.length };
}

const count = async () => (await readSubs()).length;

// Envia para todos os aparelhos inscritos; remove os que não existem mais (404/410)
async function sendToAll(payload) {
  await init();
  const list = await readSubs();
  if (!list.length) return { sent: 0, failed: 0 };
  const body = JSON.stringify(payload);
  const dead = new Set();
  let sent = 0;
  let failed = 0;
  await Promise.all(list.map(async (s) => {
    try {
      await webpush.sendNotification(s, body, { TTL: 24 * 60 * 60, urgency: 'high' });
      sent++;
    } catch (e) {
      failed++;
      if (e.statusCode === 404 || e.statusCode === 410) dead.add(s.endpoint);
      else console.error('Falha ao enviar notificação:', e.statusCode || '', e.body || e.message);
    }
  }));
  if (dead.size) {
    await store.withLock(async () => writeSubs((await readSubs()).filter((s) => !dead.has(s.endpoint))));
  }
  return { sent, failed };
}

module.exports = { init, getPublicKey, subscribe, unsubscribe, status, count, sendToAll };
