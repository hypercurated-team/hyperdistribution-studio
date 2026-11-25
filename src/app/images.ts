/**
 * Images Claude looks at. They're shrunk on the device and sent only with
 * the one request that needs them; nothing is stored on the server.
 */

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error("unreadable image")); im.src = src; });

const toJpeg = (c: HTMLCanvasElement, q = 0.82) =>
  new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("couldn't encode"))), "image/jpeg", q));

/** A screenshot or photo scaled so its longer side is at most `max` px, as JPEG. */
export async function shrink(file: Blob, max = 1400): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const im = await loadImage(url);
    const s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(im.naturalWidth * s));
    c.height = Math.max(1, Math.round(im.naturalHeight * s));
    c.getContext("2d")!.drawImage(im, 0, 0, c.width, c.height);
    return await toJpeg(c);
  } finally { URL.revokeObjectURL(url); }
}

export const SHEET_MAX = 24;

/**
 * One image holding up to 24 numbered previews (6 × 4), so Claude can compare
 * many clips in a single request. Videos use their poster frame.
 */
export async function contactSheet(thumbs: string[]): Promise<Blob> {
  const list = thumbs.slice(0, SHEET_MAX);
  const cols = Math.min(6, list.length), rows = Math.ceil(list.length / cols);
  const W = 220, H = 280, pad = 6;
  const c = document.createElement("canvas");
  c.width = cols * W; c.height = rows * H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#111"; g.fillRect(0, 0, c.width, c.height);
  await Promise.all(list.map(async (src, i) => {
    const x = (i % cols) * W, y = Math.floor(i / cols) * H;
    try {
      const im = await loadImage(src);
      const r = Math.max((W - pad * 2) / im.naturalWidth, (H - pad * 2) / im.naturalHeight);
      const w = im.naturalWidth * r, h = im.naturalHeight * r;
      g.save(); g.beginPath(); g.rect(x + pad, y + pad, W - pad * 2, H - pad * 2); g.clip();
      g.drawImage(im, x + pad + (W - pad * 2 - w) / 2, y + pad + (H - pad * 2 - h) / 2, w, h);
      g.restore();
    } catch { /* leave the cell dark */ }
    g.fillStyle = "#3846F0"; g.fillRect(x + pad, y + pad, 46, 34);
    g.fillStyle = "#fff"; g.font = "bold 24px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(String(i + 1), x + pad + 23, y + pad + 18);
  }));
  return toJpeg(c, 0.8);
}
