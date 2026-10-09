// Gera miniaturas leves (WebP 3:4) das fotos do catálogo, usadas na faixa "Trabalhos reais" e na escolha do serviço.
// Rode depois de adicionar ou trocar fotos: npm run thumbs
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const OUT_W = 480;
const OUT_H = 640; // 3:4

const thumbPath = (src) => src.replace(/^img\//, 'img/thumbs/').replace(/\.(jpe?g|png|webp)$/i, '.webp');

(async () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog.json'), 'utf8'));
  const photos = catalog.services.flatMap((s) => s.photos.map((p) => (typeof p === 'string' ? { src: p } : p)));
  fs.mkdirSync(path.join(PUBLIC, 'img', 'thumbs'), { recursive: true });

  for (const p of photos) {
    const input = path.join(PUBLIC, p.src);
    const output = path.join(PUBLIC, thumbPath(p.src));
    // foto inteira e centralizada (sem corte), sobre um fundo desfocado da própria foto
    const bg = await sharp(input).resize(OUT_W, OUT_H, { fit: 'cover' }).blur(24).modulate({ brightness: 1.05 }).toBuffer();
    const fg = await sharp(input).resize(OUT_W, OUT_H, { fit: 'inside' }).toBuffer();
    const info = await sharp(bg)
      .composite([{ input: fg, gravity: 'center' }])
      .webp({ quality: 72 })
      .toFile(output);
    console.log(thumbPath(p.src), Math.round(info.size / 1024) + 'KB');
  }
})().catch((e) => { console.error(e); process.exit(1); });
