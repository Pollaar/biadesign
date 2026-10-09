require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const push = require('./push');
// api.whatsapp.com direto: o redirecionamento do wa.me estraga emojis (vira "�") no WhatsApp Web
const buildWaLink = (phone, text) => `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`;

// ---------- Configuração ----------
const TZ = 'America/Sao_Paulo';
const PORT = Number(process.env.PORT || 3000);
const MAX_WEEKS_AHEAD = Number(process.env.MAX_WEEKS_AHEAD || 26); // até onde a dona pode liberar semanas
const ADMIN_KEY = process.env.ADMIN_KEY || '123';
const MAX_SLOTS_PER_DAY = 20;
const MAX_CAPACITY = 20;
const MAX_PENDING_PER_SLOT = 5; // pedidos aguardando confirmação no mesmo horário
const MAX_REMOVED_BACKUP = 1000; // cópia de segurança do que for apagado em "Limpar todos"
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) return d;
  if (d.length === 10 || d.length === 11) return '55' + d;
  return d;
}
const OWNER_PHONE = normalizePhone(process.env.OWNER_PHONE || '21972090405');

// Catálogo (serviços, valores, fotos e textos do site): a dona edita catalog.json
// (relido quando o arquivo muda, sem precisar reiniciar o servidor)
const CATALOG_FILE = path.join(__dirname, 'catalog.json');
let catalogCache = { mtime: 0, data: null };
function catalog() {
  const fsSync = require('fs');
  const mtime = fsSync.statSync(CATALOG_FILE).mtimeMs;
  if (mtime !== catalogCache.mtime) {
    try {
      catalogCache = { mtime, data: JSON.parse(fsSync.readFileSync(CATALOG_FILE, 'utf8')) };
    } catch (e) {
      if (!catalogCache.data) throw e;
      console.error('catalog.json inválido, mantendo a versão anterior:', e.message);
    }
  }
  return catalogCache.data;
}
catalog();
const OPTION_LABEL = { aplicacao: 'Aplicação', manutencao: 'Manutenção' };
// forma de pagamento (Pix, cartão por aproximação ou dinheiro)
const PAYMENT_LABEL = { pix: 'Pix', cartao: 'Cartão (aproximação)', dinheiro: 'Dinheiro' };
const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Monta a descrição e o valor do pedido a partir do catálogo (ou lança erro 400)
function resolveOrder(serviceId, option, extraIds) {
  const service = catalog().services.find((s) => s.id === serviceId);
  if (!service) throw httpError(400, 'Escolha o serviço.');
  if (!(option in OPTION_LABEL) || typeof service.prices[option] !== 'number') throw httpError(400, 'Escolha aplicação ou manutenção.');
  const ids = Array.isArray(extraIds) ? [...new Set(extraIds.map(String))] : [];
  const extras = ids.map((id) => catalog().extras.find((e) => e.id === id));
  if (extras.some((e) => !e)) throw httpError(400, 'Adicional inválido.');
  const total = service.prices[option] + extras.reduce((a, e) => a + e.price, 0);
  const model = `${service.name} · ${OPTION_LABEL[option]}` + (extras.length ? ` + ${extras.map((e) => e.name).join(' + ')}` : '');
  return { service, option, extras, total, model };
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// ---------- Datas (strings YYYY-MM-DD / HH:MM, fuso de São Paulo) ----------
const isDateStr = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z'));
function nowInTz() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
}
const todayStr = () => nowInTz().date;
function addDays(s, n) {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekday = (s) => new Date(s + 'T00:00:00Z').getUTCDay(); // 0=dom
function mondayOf(s) {
  const wd = weekday(s);
  return addDays(s, wd === 0 ? -6 : 1 - wd);
}
const fmtShort = (s) => `${s.slice(8)}/${s.slice(5, 7)}`;
function formatBR(s) {
  const d = new Date(s + 'T12:00:00Z');
  const dia = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' }).format(d);
  const [y, m, dd] = s.split('-');
  return `${dia}, ${dd}/${m}/${y}`;
}
function formatPhoneBR(p) {
  const d = p.startsWith('55') ? p.slice(2) : p;
  return d.length === 11
    ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
    : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
}
function isSlotPast(date, time) {
  const now = nowInTz();
  return date < now.date || (date === now.date && time <= now.time);
}

// ---------- Armazenamento (JSON) com trava para evitar overbooking ----------
// db = {
//   weeks: { "<segunda>": { released: bool, days: { "<data>": [ { time, capacity } ] } } },
//   bookings: [ { id, name, phone, date, time, model, status, createdAt, decidedAt? } ]
// }
// status: 'pending' (cliente pediu, ainda não ocupa vaga) | 'confirmed' (dona confirmou, ocupa vaga) | 'rejected'
//         | 'cancelled' (dona cancelou um confirmado; a vaga volta para a agenda)
// Agendamentos antigos sem status são tratados como confirmados.
// Fica em data/bookings.json (computador) ou no Upstash Redis (Render) — ver store.js
const withLock = store.withLock;
async function readDb() {
  const db = (await store.getJSON('bookings', null)) || {};
  db.bookings = db.bookings || [];
  db.weeks = db.weeks || {};
  return db;
}
// Cópias de segurança: a cada gravação guarda um instantâneo (no máx. 1 por hora, últimos 48) além do dado principal.
// Se a agenda aparecer vazia na subida do servidor, o último instantâneo é restaurado sozinho.
const SNAPSHOT_EVERY_MS = 60 * 60 * 1000;
const MAX_SNAPSHOTS = 48;
let lastSnapshotAt = 0;
async function writeDb(db) {
  await store.setJSON('bookings', db);
  const now = Date.now();
  if (now - lastSnapshotAt < SNAPSHOT_EVERY_MS) return;
  lastSnapshotAt = now;
  try {
    const snaps = await store.getJSON('bookings-snapshots', []);
    snaps.push({ at: new Date(now).toISOString(), data: db });
    await store.setJSON('bookings-snapshots', snaps.slice(-MAX_SNAPSHOTS));
  } catch (e) {
    console.error('Falha ao gravar o instantâneo de segurança:', e.message);
  }
}
async function restoreIfEmpty() {
  const db = await store.getJSON('bookings', null);
  const empty = !db || (!(db.bookings || []).length && !Object.keys(db.weeks || {}).length);
  if (!empty) return;
  const snaps = await store.getJSON('bookings-snapshots', []);
  const last = [...snaps].reverse().find((s) => s.data && ((s.data.bookings || []).length || Object.keys(s.data.weeks || {}).length));
  if (!last) return;
  await store.setJSON('bookings', last.data);
  console.warn('Agenda estava vazia: restaurada a partir do instantâneo de ' + last.at);
}
const statusOf = (b) => b.status || 'confirmed';
const isConfirmed = (b) => statusOf(b) === 'confirmed';
const isActive = (b) => statusOf(b) === 'pending' || statusOf(b) === 'confirmed';
// só agendamentos confirmados tiram vaga da agenda
const countBooked = (db, date, time) => db.bookings.filter((b) => b.date === date && b.time === time && isConfirmed(b)).length;
const countPending = (db, date, time) => db.bookings.filter((b) => b.date === date && b.time === time && statusOf(b) === 'pending').length;
const findSlot = (db, date, time) => {
  const week = db.weeks[mondayOf(date)];
  return ((week && week.days && week.days[date]) || []).find((s) => s.time === time) || null;
};
// pedido pendente que ainda cabe (horário existe, não passou e não lotou)
function canConfirm(db, b) {
  const slot = findSlot(db, b.date, b.time);
  return statusOf(b) === 'pending' && !!slot && !isSlotPast(b.date, b.time) && countBooked(db, b.date, b.time) < slot.capacity;
}

// ---------- Visão pública de um dia ----------
function buildDayView(db, date, slots) {
  const sl = slots.map((s) => {
    const remaining = Math.max(0, s.capacity - countBooked(db, date, s.time));
    const status = isSlotPast(date, s.time) ? 'past' : remaining === 0 ? 'full' : 'available';
    return { time: s.time, remaining, status };
  });
  const remaining = sl.filter((s) => s.status === 'available').reduce((a, s) => a + s.remaining, 0);
  const status = remaining > 0 ? 'available' : sl.every((s) => s.status === 'past') ? 'past' : 'full';
  return { date, weekday: weekday(date), status, remaining, slots: sl };
}
function releasedWeeks(db) {
  const first = mondayOf(todayStr());
  return Object.keys(db.weeks).filter((w) => db.weeks[w].released && w >= first).sort();
}
function weekHasAvailability(db, monday) {
  const days = db.weeks[monday].days || {};
  return Object.entries(days).some(([date, slots]) => buildDayView(db, date, slots).status === 'available');
}

// ---------- App ----------
const app = express();
app.set('trust proxy', 1);
const smallJson = express.json({ limit: '20kb' });
app.use((req, res, next) => (req.path === '/api/admin/restore' ? next() : smallJson(req, res, next)));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// Catálogo e dados do estúdio para o site
app.get('/api/config', (req, res) => res.json({
  business: { ...catalog().business, instagram: String(catalog().business.instagram || '').replace(/^@/, '') },
  services: catalog().services,
  extras: catalog().extras,
}));

// Semanas liberadas: dias, horários e vagas (para a cliente)
app.get('/api/availability', async (req, res) => {
  try {
    const db = await readDb();
    const list = releasedWeeks(db);
    if (!list.length) return res.json({ empty: true });

    let start;
    if (isDateStr(req.query.week)) {
      const ref = mondayOf(req.query.week);
      start = list.includes(ref) ? ref : list.find((w) => w >= ref) || list[list.length - 1];
    } else {
      start = list.find((w) => weekHasAvailability(db, w)) || list[0];
    }
    const idx = list.indexOf(start);
    const cfg = db.weeks[start].days || {};
    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, i);
      if (!cfg[date] || !cfg[date].length) continue;
      days.push(buildDayView(db, date, cfg[date]));
    }
    res.json({
      weekStart: start,
      weekEnd: addDays(start, 6),
      days,
      hasPrev: idx > 0,
      hasNext: idx < list.length - 1,
      prevWeek: list[idx - 1] || null,
      nextWeek: list[idx + 1] || null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao carregar a disponibilidade.' });
  }
});

// Criar agendamento (dia + horário)
app.post('/api/bookings', async (req, res) => {
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
  const phone = normalizePhone(req.body.phone);
  const date = String(req.body.date || '');
  const time = String(req.body.time || '');
  let order;
  try {
    order = resolveOrder(String(req.body.serviceId || ''), String(req.body.option || ''), req.body.extras);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const { model, total } = order;
  const payment = String(req.body.payment || '');
  if (!(payment in PAYMENT_LABEL)) return res.status(400).json({ error: 'Escolha a forma de pagamento (Pix, cartão ou dinheiro).' });

  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Informe seu nome.' });
  if (phone.length < 12 || phone.length > 13) return res.status(400).json({ error: 'Informe um WhatsApp válido com DDD.' });
  if (!isDateStr(date)) return res.status(400).json({ error: 'Data inválida.' });
  if (!TIME_RE.test(time)) return res.status(400).json({ error: 'Horário inválido.' });

  let booking;
  try {
    booking = await withLock(async () => {
      const db = await readDb();
      const week = db.weeks[mondayOf(date)];
      const slots = week && week.released ? (week.days || {})[date] : null;
      const slot = slots && slots.find((s) => s.time === time);
      if (!slot) throw httpError(409, 'Esse horário não está disponível. Escolha outro.');
      if (isSlotPast(date, time)) throw httpError(400, 'Esse horário já passou.');
      if (countBooked(db, date, time) >= slot.capacity) throw httpError(409, 'Esse horário acabou de lotar. Escolha outro.');
      if (db.bookings.some((b) => b.date === date && b.phone === phone && isActive(b))) {
        throw httpError(409, 'Você já tem um agendamento (ou pedido) nesse dia.');
      }
      if (countPending(db, date, time) >= MAX_PENDING_PER_SLOT) {
        throw httpError(409, 'Esse horário já tem muitos pedidos aguardando confirmação. Escolha outro.');
      }
      const b = {
        id: crypto.randomUUID(), name, phone, date, time, model, total, payment,
        serviceId: order.service.id, option: order.option, extras: order.extras.map((e) => e.id),
        status: 'pending', createdAt: new Date().toISOString(),
      };
      db.bookings.push(b);
      await writeDb(db);
      return b;
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    return res.status(500).json({ error: 'Erro ao salvar o agendamento.' });
  }

  // Mensagem pronta que a cliente envia à dona pelo WhatsApp (link wa.me)
  const message =
    `Olá, ${catalog().business.name.split(' ')[0]}! Acabei de solicitar um horário pelo site. 💖\n\n` +
    `Nome: ${name}\n` +
    `Dia: ${formatBR(date)}\n` +
    `Horário: ${time}\n` +
    `Serviço: ${order.service.name} (${OPTION_LABEL[order.option]})\n` +
    (order.extras.length ? `Adicionais: ${order.extras.map((e) => e.name).join(', ')}\n` : '') +
    `Valor: ${brl(total)}\n` +
    `Pagamento: ${PAYMENT_LABEL[payment]}\n\n` +
    `Pode confirmar, por favor?`;

  res.status(201).json({
    ok: true,
    booking: {
      id: booking.id, name: booking.name, date: booking.date, time: booking.time,
      model: booking.model, total: booking.total, payment: booking.payment, status: booking.status, dateLabel: formatBR(booking.date),
    },
    message,
    whatsappLink: buildWaLink(OWNER_PHONE, message),
  });

  // avisa a dona no celular/computador (não atrasa a resposta para a cliente)
  notifyNewBooking(booking).catch((e) => console.error('Notificação:', e.message));
});

async function notifyNewBooking(b) {
  if (!(await push.count())) return;
  const db = await readDb();
  const pending = db.bookings.filter((x) => statusOf(x) === 'pending' && !isSlotPast(x.date, x.time)).length;
  const wd = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' }).format(new Date(b.date + 'T12:00:00Z')).replace('.', '');
  await push.sendToAll({
    title: 'Novo pedido 💖',
    body: `${b.name} · ${wd} ${fmtShort(b.date)} às ${b.time}\n${b.model}${typeof b.total === 'number' ? ' · ' + brl(b.total) : ''}${PAYMENT_LABEL[b.payment] ? ' · ' + PAYMENT_LABEL[b.payment] : ''}`,
    url: '/admin#pedidos',
    tag: 'pedido-' + b.id,
    badge: pending,
  });
}

// ---------- Área da dona (protegida por chave) ----------
const adminFails = new Map();
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return res.status(503).json({ error: 'Painel desativado: defina ADMIN_KEY no arquivo .env.' });
  const now = Date.now();
  const f = adminFails.get(req.ip) || { n: 0, until: 0 };
  if (f.until > now) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  if (!safeEqual(req.get('x-admin-key') || '', ADMIN_KEY)) {
    f.n += 1;
    if (f.n >= 10) { f.until = now + 10 * 60 * 1000; f.n = 0; }
    adminFails.set(req.ip, f);
    return res.status(401).json({ error: 'Chave incorreta.' });
  }
  adminFails.delete(req.ip);
  next();
}

function weekBounds() {
  const minWeek = mondayOf(todayStr());
  return { minWeek, maxWeek: addDays(minWeek, MAX_WEEKS_AHEAD * 7) };
}

// Configuração de uma semana (+ agendamentos dela)
app.get('/api/admin/weeks/:week', requireAdmin, async (req, res) => {
  try {
    const { minWeek, maxWeek } = weekBounds();
    let monday = req.params.week === 'current' || !isDateStr(req.params.week) ? minWeek : mondayOf(req.params.week);
    if (monday < minWeek) monday = minWeek;
    if (monday > maxWeek) monday = maxWeek;

    const db = await readDb();
    const week = db.weeks[monday];
    const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    res.json({
      weekStart: monday,
      minWeek,
      maxWeek,
      released: !!(week && week.released),
      days: dates.map((date) => ({
        date,
        weekday: weekday(date),
        slots: ((week && week.days && week.days[date]) || []).map((s) => ({
          time: s.time,
          capacity: s.capacity,
          booked: countBooked(db, date, s.time),
          pending: countPending(db, date, s.time),
        })),
      })),
      bookings: db.bookings
        .filter((b) => dates.includes(b.date))
        .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))
        .map((b) => ({
          id: b.id, name: b.name, phone: b.phone, date: b.date, time: b.time || '', model: b.model || '',
          total: typeof b.total === 'number' ? b.total : null, payment: b.payment || '',
          status: statusOf(b), canConfirm: canConfirm(db, b),
        })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao carregar a semana.' });
  }
});

function normalizeWeekConfig(body, monday) {
  const released = !!body && body.released === true;
  const rawDays = (body && body.days) || {};
  const days = {};
  for (const [date, slots] of Object.entries(rawDays)) {
    if (!isDateStr(date) || mondayOf(date) !== monday) throw httpError(400, `Dia fora da semana: ${date}`);
    if (!Array.isArray(slots) || slots.length === 0) continue;
    if (slots.length > MAX_SLOTS_PER_DAY) throw httpError(400, `Máximo de ${MAX_SLOTS_PER_DAY} horários por dia.`);
    const seen = new Set();
    const clean = [];
    for (const s of slots) {
      const time = String((s && s.time) || '');
      const capacity = Number(s && s.capacity);
      if (!TIME_RE.test(time)) throw httpError(400, `Horário inválido em ${fmtShort(date)}.`);
      if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) {
        throw httpError(400, `As vagas devem ser de 1 a ${MAX_CAPACITY} (${fmtShort(date)} às ${time}).`);
      }
      if (seen.has(time)) throw httpError(400, `Horário repetido em ${fmtShort(date)}: ${time}.`);
      seen.add(time);
      clean.push({ time, capacity });
    }
    days[date] = clean.sort((a, b) => a.time.localeCompare(b.time));
  }
  if (released && Object.keys(days).length === 0) {
    throw httpError(400, 'Adicione pelo menos um dia com horário para liberar a semana.');
  }
  return { released, days };
}

// Salvar / liberar / retirar uma semana
app.put('/api/admin/weeks/:week', requireAdmin, async (req, res) => {
  try {
    if (!isDateStr(req.params.week)) return res.status(400).json({ error: 'Semana inválida.' });
    const monday = mondayOf(req.params.week);
    const { minWeek, maxWeek } = weekBounds();
    if (monday < minWeek) return res.status(400).json({ error: 'Não é possível alterar semanas que já passaram.' });
    if (monday > maxWeek) return res.status(400).json({ error: 'Essa semana está longe demais no futuro.' });

    const cfg = normalizeWeekConfig(req.body, monday);
    await withLock(async () => {
      const db = await readDb();

      // não deixa apagar horário (ou cortar vagas) que já tem gente agendada
      const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
      const counts = {};
      db.bookings.filter((b) => b.time && dates.includes(b.date) && isConfirmed(b)).forEach((b) => {
        const k = `${b.date} ${b.time}`;
        counts[k] = (counts[k] || 0) + 1;
      });
      for (const [k, n] of Object.entries(counts)) {
        const [date, time] = k.split(' ');
        const slot = (cfg.days[date] || []).find((s) => s.time === time);
        if (!slot) throw httpError(409, `Já existe agendamento em ${fmtShort(date)} às ${time}; esse horário não pode ser removido.`);
        if (slot.capacity < n) throw httpError(409, `Em ${fmtShort(date)} às ${time} já há ${n} agendado(s); as vagas não podem ser menos que isso.`);
      }

      db.weeks[monday] = cfg;
      await writeDb(db);
    });
    res.json({ ok: true });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Erro ao salvar a semana.' });
  }
});

// Apagar todos os agendamentos de uma semana (dupla verificação: body { confirm: "LIMPAR", expected: <qtd vista no painel> })
app.delete('/api/admin/weeks/:week/bookings', requireAdmin, async (req, res) => {
  try {
    if (!isDateStr(req.params.week)) return res.status(400).json({ error: 'Semana inválida.' });
    const monday = mondayOf(req.params.week);
    if (monday < weekBounds().minWeek) return res.status(400).json({ error: 'Não é possível alterar semanas que já passaram.' });
    if (String((req.body && req.body.confirm) || '').trim().toUpperCase() !== 'LIMPAR') {
      return res.status(400).json({ error: 'Digite LIMPAR para confirmar.' });
    }
    const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const removed = await withLock(async () => {
      const db = await readDb();
      const gone = db.bookings.filter((b) => dates.includes(b.date));
      // se chegou pedido novo depois que a dona abriu a tela, não apaga sem ela ver
      if (Number(req.body.expected) !== gone.length) {
        throw httpError(409, 'A lista mudou (chegou ou saiu algum agendamento). Confira de novo antes de limpar.');
      }
      if (!gone.length) return [];
      const backup = await store.getJSON('removed-bookings', []);
      const removedAt = new Date().toISOString();
      backup.push(...gone.map((b) => ({ ...b, removedAt })));
      await store.setJSON('removed-bookings', backup.slice(-MAX_REMOVED_BACKUP));
      db.bookings = db.bookings.filter((b) => !dates.includes(b.date));
      await writeDb(db);
      return gone;
    });
    res.json({ ok: true, removed: removed.length });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Erro ao limpar os agendamentos.' });
  }
});

// Lista completa de agendamentos (?status=pending|confirmed|rejected|cancelled para filtrar)
app.get('/api/admin/bookings', requireAdmin, async (req, res) => {
  const db = await readDb();
  const list = db.bookings
    .map((b) => ({ ...b, status: statusOf(b), canConfirm: canConfirm(db, b) }))
    .filter((b) => !req.query.status || b.status === req.query.status);
  res.json(list.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''))));
});

// Dona confirma ou recusa um pedido. Só ao confirmar o horário sai da agenda.
function clientMessage(b, status) {
  const first = b.name.split(' ')[0];
  if (status === 'confirmed') {
    // pedido do sinal + dados do Pix (valor e dados ficam em catalog.json › business.deposit)
    const d = catalog().business.deposit || {};
    const amount = `R$${Number(d.amount || 20).toFixed(2).replace('.', ',')}`;
    return `Para confirmar o seu horário eu peço um sinal de ${amount} o valor será abatido no dia do procedimento 🥰\n\n` +
      `Pix 👇🏽\n` +
      `${d.pixName || ''}\n` +
      `Banco ${d.bank || ''}\n` +
      `${d.pixKeyType || 'Chave'}\n` +
      `*${d.pixKey || ''}*\n\n` +
      `Leia com atenção\n\n` +
      `✨O horário será confirmado somente após o sinal.\n` +
      `✨Em caso de desistência o valor não será devolvido.\n` +
      `✨Em caso de imprevistos avisar com 24h de antecedência.`;
  }
  if (status === 'cancelled') {
    return `Olá, ${first}! Precisei cancelar seu agendamento de ${formatBR(b.date)} às ${b.time}. ` +
      `Desculpe pelo transtorno! Se quiser, escolha outro horário pelo site. 💖`;
  }
  return `Olá, ${first}! Infelizmente não consigo te atender em ${formatBR(b.date)} às ${b.time}. ` +
    `Se quiser, escolha outro horário pelo site. 💖`;
}

const ACTIONS = { confirm: 'confirmed', reject: 'rejected', cancel: 'cancelled' };
app.post('/api/admin/bookings/:id/:action(confirm|reject|cancel)', requireAdmin, async (req, res) => {
  const status = ACTIONS[req.params.action];
  try {
    const booking = await withLock(async () => {
      const db = await readDb();
      const b = db.bookings.find((x) => x.id === req.params.id);
      if (!b) throw httpError(404, 'Agendamento não encontrado.');
      if (status === 'cancelled') {
        if (statusOf(b) !== 'confirmed') throw httpError(409, 'Só é possível cancelar agendamentos confirmados.');
      } else if (statusOf(b) !== 'pending') {
        throw httpError(409, 'Esse pedido já foi respondido.');
      }
      if (status === 'confirmed') {
        const slot = findSlot(db, b.date, b.time);
        if (!slot) throw httpError(409, 'Esse horário não existe mais na agenda. Recuse o pedido.');
        if (isSlotPast(b.date, b.time)) throw httpError(409, 'Esse horário já passou.');
        if (countBooked(db, b.date, b.time) >= slot.capacity) {
          throw httpError(409, 'Esse horário já está lotado com agendamentos confirmados. Recuse o pedido.');
        }
      }
      b.status = status;
      b.decidedAt = new Date().toISOString();
      await writeDb(db);
      return b;
    });
    res.json({
      ok: true,
      booking: { ...booking },
      whatsappLink: buildWaLink(booking.phone, clientMessage(booking, status)),
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Erro ao atualizar o agendamento.' });
  }
});

// ---------- Notificações (Web Push) ----------
// rotas async: erros viram resposta JSON em vez de derrubar a requisição
const route = (fn, msg) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: msg });
  }
};
const endpointOf = (req) => String((req.body && req.body.endpoint) || '');

app.get('/api/admin/push/key', requireAdmin, route(async (req, res) => {
  res.json({ publicKey: await push.getPublicKey(), devices: await push.count() });
}, 'Erro ao carregar as notificações.'));
app.post('/api/admin/push/status', requireAdmin, route(async (req, res) => {
  res.json(await push.status(endpointOf(req)));
}, 'Erro ao carregar as notificações.'));
app.post('/api/admin/push/subscribe', requireAdmin, route(async (req, res) => {
  const devices = await push.subscribe(req.body && req.body.subscription, req.body && req.body.device);
  res.json({ ok: true, devices });
}, 'Erro ao ativar as notificações.'));
app.post('/api/admin/push/unsubscribe', requireAdmin, route(async (req, res) => {
  res.json({ ok: true, devices: await push.unsubscribe(endpointOf(req)) });
}, 'Erro ao desativar as notificações.'));
app.post('/api/admin/push/test', requireAdmin, route(async (req, res) => {
  const r = await push.sendToAll({ title: 'Notificações ativas ✨', body: 'Você vai receber um aviso aqui a cada novo pedido.', url: '/admin', tag: 'teste' });
  res.json({ ok: true, ...r });
}, 'Erro ao enviar o teste.'));

// Backup para guardar fora do servidor: baixa tudo em um arquivo JSON (e restaura a partir dele)
app.get('/api/admin/backup', requireAdmin, route(async (req, res) => {
  const data = { exportedAt: new Date().toISOString(), bookings: await store.getJSON('bookings', {}), removedBookings: await store.getJSON('removed-bookings', []) };
  res.set('Content-Disposition', `attachment; filename="backup-agenda-${data.exportedAt.slice(0, 10)}.json"`).json(data);
}, 'Erro ao gerar o backup.'));
app.post('/api/admin/restore', requireAdmin, express.json({ limit: '5mb' }), route(async (req, res) => {
  const b = req.body && req.body.bookings;
  if (!b || !Array.isArray(b.bookings) || typeof b.weeks !== 'object') return res.status(400).json({ error: 'Arquivo de backup inválido.' });
  await withLock(async () => {
    await store.setJSON('bookings-snapshots', [...(await store.getJSON('bookings-snapshots', [])), { at: new Date().toISOString(), data: await store.getJSON('bookings', {}) }].slice(-MAX_SNAPSHOTS));
    await store.setJSON('bookings', b);
    if (Array.isArray(req.body.removedBookings)) await store.setJSON('removed-bookings', req.body.removedBookings);
  });
  res.json({ ok: true, bookings: b.bookings.length });
}, 'Erro ao restaurar o backup.'));

// Para o cron-job.org manter o servidor acordado no Render grátis (não toca no banco)
app.get('/healthz', (req, res) => res.type('text').send('ok'));

(async () => {
  try {
    await store.ping();
  } catch (e) {
    console.error('Não foi possível conectar ao armazenamento (' + store.mode + '). Confira UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN:', e.message);
    process.exit(1);
  }
  try {
    await restoreIfEmpty();
  } catch (e) {
    console.error('Não foi possível checar o instantâneo de segurança:', e.message);
  }
  try {
    await push.init();
  } catch (e) {
    console.error('Erro na configuração das notificações:', e.message);
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`Agendamento rodando em http://localhost:${PORT} (dados: ${store.mode === 'redis' ? 'Upstash Redis' : 'pasta data/'})`);
    console.log(`Painel da dona em http://localhost:${PORT}/admin`);
    if (!ADMIN_KEY || ADMIN_KEY === '123' || ADMIN_KEY === 'troque-esta-chave') {
      console.warn('ATENÇÃO: defina uma ADMIN_KEY própria (no .env ou nas variáveis do Render). A chave atual é fraca ou está vazia.');
    }
  });
})();
