// Draws a shareable lyric card (cover art, the current line big, a few lines around it)
// onto a canvas and returns it as a PNG blob.
const W = 1080;
const H = 1350;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    window.setTimeout(() => resolve(null), 6000);
    img.src = src;
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export interface LyricCardInput {
  title: string;
  artist: string;
  coverUrl?: string;
  before: string[]; // lines shown dimmed above
  line: string; // the highlighted line
  after: string[]; // lines shown dimmed below
}

export async function renderLyricCard(input: LyricCardInput): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const cover = input.coverUrl ? await loadImage(input.coverUrl) : null;

  // Background: blurred, darkened cover or a plain gradient.
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#2b1b4a');
  grad.addColorStop(1, '#0c0c14');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  if (cover) {
    try {
      ctx.save();
      ctx.filter = 'blur(60px)';
      ctx.globalAlpha = 0.55;
      ctx.drawImage(cover, -120, -120, W + 240, H + 240);
      ctx.restore();
    } catch {
      // filter unsupported: keep the gradient
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, W, H);

  const pad = 90;
  const textWidth = W - pad * 2;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Lyric block, vertically centred in the upper part.
  const font = (size: number, weight = 800) =>
    (ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`);
  const blocks: { lines: string[]; size: number; alpha: number; weight: number }[] = [];
  const push = (text: string, size: number, alpha: number, weight: number) => {
    font(size, weight);
    blocks.push({ lines: wrap(ctx, text, textWidth), size, alpha, weight });
  };
  input.before.forEach(t => push(t, 44, 0.45, 600));
  push(input.line, 76, 1, 800);
  input.after.forEach(t => push(t, 44, 0.45, 600));

  const gap = 26;
  let total = 0;
  for (const b of blocks) total += b.lines.length * b.size * 1.28 + gap;
  let y = Math.max(150, 120 + (780 - total) / 2);
  for (const b of blocks) {
    font(b.size, b.weight);
    ctx.fillStyle = `rgba(255,255,255,${b.alpha})`;
    for (const l of b.lines) {
      y += b.size * 1.28;
      ctx.fillText(l, pad, y);
    }
    y += gap;
  }

  // Footer: cover, title and artist.
  const footY = H - 250;
  const size = 150;
  if (cover) {
    ctx.save();
    ctx.beginPath();
    const r = 22;
    const x = pad;
    ctx.moveTo(x + r, footY);
    ctx.arcTo(x + size, footY, x + size, footY + size, r);
    ctx.arcTo(x + size, footY + size, x, footY + size, r);
    ctx.arcTo(x, footY + size, x, footY, r);
    ctx.arcTo(x, footY, x + size, footY, r);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(cover, x, footY, size, size);
    ctx.restore();
  }
  const tx = cover ? pad + size + 36 : pad;
  const tw = W - tx - pad;
  const fit = (text: string, sz: number, weight: number) => {
    font(sz, weight);
    let t = text;
    while (ctx.measureText(t).width > tw && t.length > 4) t = t.slice(0, -2);
    return t === text ? t : t.trimEnd() + '…';
  };
  ctx.fillStyle = '#ffffff';
  ctx.fillText(fit(input.title, 46, 800), tx, footY + 70);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(fit(input.artist, 36, 600), tx, footY + 122);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  font(28, 700);
  ctx.fillText('FRF Music', pad, H - 60);

  return new Promise(resolve => {
    try {
      canvas.toBlob(b => resolve(b), 'image/png');
    } catch {
      resolve(null); // a cover from another site can taint the canvas
    }
  });
}
