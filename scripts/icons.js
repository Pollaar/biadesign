// Gera os ícones do painel (Tela de Início do iPhone/Android e notificações). Uso: node scripts/icons.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(OUT, { recursive: true });

// fundo rosa em degradê com o "B" branco (como no logotipo)
const icon = (size, pad) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#ef8fb3"/><stop offset=".55" stop-color="#e0588a"/><stop offset="1" stop-color="#b8386a"/>
  </linearGradient></defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <text x="256" y="${256 + 118 * pad}" text-anchor="middle" font-family="Bodoni MT, Didot, Georgia, 'Times New Roman', serif"
        font-weight="700" font-size="${340 * pad}" fill="#ffffff">B</text>
</svg>`;
// ícone pequeno monocromático (barra de status do Android)
const badge = `
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <text x="48" y="80" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="88" fill="#ffffff">B</text>
</svg>`;

(async () => {
  const jobs = [
    ['icon-192.png', 192, 1], ['icon-512.png', 512, 1],
    ['icon-maskable-512.png', 512, 0.78], // área segura menor para ícones recortados em círculo
    ['apple-touch-icon.png', 180, 1],
  ];
  for (const [name, size, pad] of jobs) {
    await sharp(Buffer.from(icon(size, pad))).resize(size, size).png().toFile(path.join(OUT, name));
    console.log('icons/' + name);
  }
  await sharp(Buffer.from(badge)).png().toFile(path.join(OUT, 'badge-96.png'));
  console.log('icons/badge-96.png');
})().catch((e) => { console.error(e); process.exit(1); });
