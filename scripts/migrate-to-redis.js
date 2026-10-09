// Copia a agenda da pasta data/ (computador) para o Upstash Redis.
// Uso: defina UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN no .env e rode: npm run migrate
// Não sobrescreve o que já existe no Redis, a não ser com: npm run migrate -- --force
require('dotenv').config();
const fs = require('fs');
const path = require('path');

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.error('Defina UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN no .env (copie do painel do Upstash).');
  process.exit(1);
}
const store = require('../store');
const force = process.argv.includes('--force');
// Os aparelhos das notificações não são copiados: no endereço novo (https) cada aparelho ativa de novo.
const NAMES = ['bookings', 'removed-bookings'];

(async () => {
  await store.ping();
  for (const name of NAMES) {
    const file = path.join(__dirname, '..', 'data', name + '.json');
    if (!fs.existsSync(file)) { console.log(`- ${name}: não existe em data/, pulando`); continue; }
    const current = await store.getJSON(name, null);
    if (current && !force) { console.log(`- ${name}: já existe no Redis, pulando (use --force para sobrescrever)`); continue; }
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    await store.setJSON(name, value);
    const n = Array.isArray(value) ? value.length : (value.bookings || []).length;
    console.log(`✓ ${name}: copiado (${n} agendamento(s))`);
  }
  console.log('Pronto.');
})().catch((e) => { console.error(e.message); process.exit(1); });
