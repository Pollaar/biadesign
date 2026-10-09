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
    const { width, height } = await sharp(input).metadata();
    // recorte 3:4 pelo "focus" do catálogo (ex. "70% 50%"), igual ao object-position do site
    const [fx, fy] = String(p.focus || '50% 50%').split(/\s+/).map((v) => parseFloat(v) / 100);
    let cw = width;
    let ch = Math.round((width * OUT_H) / OUT_W);
    if (ch > height) { ch = height; cw = Math.round((height * OUT_W) / OUT_H); }
    const left = Math.round((width - cw) * (isNaN(fx) ? 0.5 : fx));
    const top = Math.round((height - ch) * (isNaN(fy) ? 0.5 : fy));
    const info = await sharp(input)
      .extract({ left, top, width: cw, height: ch })
      .resize(OUT_W, OUT_H)
      .webp({ quality: 72 })
      .toFile(output);
    console.log(thumbPath(p.src), Math.round(info.size / 1024) + 'KB');
  }
})().catch((e) => { console.error(e); process.exit(1); });
