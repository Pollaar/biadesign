// Gera a imagem de pré-visualização do link (WhatsApp, Instagram, etc.): public/img/og.jpg (1200x630)
// Rode: node scripts/og.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const PUBLIC = path.join(__dirname, '..', 'public');
const W = 1200;
const H = 630;
// fotos do catálogo usadas na imagem: [arquivo, ponto de corte (object-position)]
const TILES = [
  ['img/volume-brasileiro-marrom-4.jpg', 0.5, 0.9],
  ['img/volume-egipcio-6.jpg', 0.5, 0.57],
  ['img/fox-eyes-1.jpg', 0.5, 0.73],
];
const TW = 180;
const TH = 470;
const GAP = 16;
const X0 = W - 36 - (TW * 3 + GAP * 2);

const round = (w, h, r) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" fill="#fff"/></svg>`);

(async () => {
  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff6f9"/><stop offset="1" stop-color="#f9d3e2"/></linearGradient>
      <linearGradient id="p" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ea7fa6"/><stop offset=".6" stop-color="#c83f72"/><stop offset="1" stop-color="#a52f5c"/></linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <circle cx="120" cy="560" r="260" fill="#fbdde8" opacity=".55"/>
    <text x="64" y="235" font-family="Bodoni MT, Didot, Georgia, serif" font-size="92" letter-spacing="6" fill="#1d1d1f">BEATRIZ</text>
    <text x="64" y="345" font-family="Bodoni MT, Didot, Georgia, serif" font-size="92" letter-spacing="6" fill="url(#p)">LIMA</text>
    <rect x="68" y="382" width="86" height="4" rx="2" fill="#e0588a"/>
    <text x="66" y="440" font-family="Bodoni MT, Didot, Georgia, serif" font-size="38" font-weight="700" letter-spacing="7" fill="#c83f72">LASH DESIGNER</text>
    <text x="66" y="496" font-family="Segoe UI, Arial, sans-serif" font-size="28" fill="#6e6e73">Cílios e design de sobrancelhas</text>
    <text x="66" y="546" font-family="Segoe UI, Arial, sans-serif" font-size="28" font-weight="700" fill="#c83f72">Agende seu horário online</text>
  </svg>`);

  const layers = [];
  for (let i = 0; i < TILES.length; i++) {
    const [file, fx, fy] = TILES[i];
    const input = path.join(PUBLIC, file);
    const { width, height } = await sharp(input).metadata();
    // recorte TW:TH centrado no ponto de foco
    let cw = width;
    let ch = Math.round((width * TH) / TW);
    if (ch > height) { ch = height; cw = Math.round((height * TW) / TH); }
    const left = Math.round((width - cw) * fx);
    const top = Math.round((height - ch) * fy);
    const photo = await sharp(input).extract({ left, top, width: cw, height: ch }).resize(TW, TH)
      .composite([{ input: round(TW, TH, 26), blend: 'dest-in' }]).png().toBuffer();
    layers.push({ input: photo, left: X0 + i * (TW + GAP), top: 80 + (i === 1 ? 36 : 0) });
  }

  const out = path.join(PUBLIC, 'img', 'og.jpg');
  await sharp(bg).composite(layers).jpeg({ quality: 84 }).toFile(out);
  console.log('og.jpg', Math.round(fs.statSync(out).size / 1024) + 'KB');
})().catch((e) => { console.error(e); process.exit(1); });
