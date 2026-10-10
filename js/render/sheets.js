// 位图资产的加载器。画布在图没到之前画矢量版本，到了之后换成图——
// 所以首帧不会因为一张 PNG 还在路上而空白，file:// 下取不到图也只是退回矢量。

const FILES = {
  halo: '../../assets/textures/lamp-halo.png',
  haloBad: '../../assets/textures/lamp-halo-bad.png',
  spark: '../../assets/textures/spark.png',
  field: '../../assets/textures/night-field.png',
};

const images = {};
const patterns = new Map();

export const Sheets = {
  ready: () => Object.keys(images).length,
  get(name) {
    const img = images[name];
    return img && img.complete && img.naturalWidth ? img : null;
  },
  // 图案按 ctx 缓存：createPattern 每次重建会在每帧里分配一张同尺寸的位图。
  pattern(ctx, name) {
    const img = this.get(name);
    if (!img) return null;
    const key = `${name}@${ctx.canvas.width}x${ctx.canvas.height}`;
    if (!patterns.has(key)) patterns.set(key, ctx.createPattern(img, 'repeat'));
    return patterns.get(key);
  },
  load() {
    for (const [name, rel] of Object.entries(FILES)) {
      if (images[name]) continue;
      const img = new Image();
      img.decoding = 'async';
      img.src = new URL(rel, import.meta.url).href;
      images[name] = img;
    }
    return this;
  },
};

Sheets.load();
