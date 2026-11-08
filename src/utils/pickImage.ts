// Let the user pick a picture (for a song or playlist cover) and shrink it to
// a small square-ish JPEG, so a cover adds tens of KB to storage, not megabytes.

const MAX_SIDE = 600;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function shrink(dataUrl: string): Promise<string> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0, w, h);
      try {
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/** Opens the file chooser for one image. Resolves with a data URL, or null if cancelled. */
export function pickImage(): Promise<string | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(v);
    };
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      try {
        finish(await shrink(await readAsDataUrl(file)));
      } catch {
        finish(null);
      }
    };
    // Cancelling the chooser fires no change event; the window regains focus.
    window.addEventListener(
      'focus',
      () => window.setTimeout(() => (input.files?.length ? undefined : finish(null)), 1500),
      { once: true }
    );
    document.body.appendChild(input);
    input.click();
  });
}
