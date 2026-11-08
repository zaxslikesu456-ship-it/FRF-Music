// Pictures that fail to load (flaky network, offline with a cold cache) used to
// show as a blank box or the alt text. Retry once, then swap in a placeholder
// so every song and artist still has a picture.

import { fallbackThumb } from './cover';

const PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<rect width="100" height="100" fill="#1c1c1e"/>' +
      '<path fill="#8e8e93" d="M58 24v32.5a11 11 0 1 0 6 9.8V38h12V24z"/>' +
      '</svg>'
  );

const RETRY_DELAY_MS = 2500;

// Videos without a 1280x720 thumbnail answer 404 (or a 120x90 grey stand-in).
function swapToSmallThumb(img: HTMLImageElement): boolean {
  const small = fallbackThumb(img.src);
  if (!small) return false;
  img.dataset.noResize = '1';
  img.src = small;
  return true;
}

export function installImageFallback(): void {
  document.addEventListener(
    'error',
    event => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement)) return;
      if (img.src === PLACEHOLDER || img.dataset.fallback === '1') return;
      if (img.src.startsWith('data:')) return;
      if (swapToSmallThumb(img)) return;

      if (img.dataset.retried !== '1') {
        img.dataset.retried = '1';
        const src = img.src;
        window.setTimeout(() => {
          // A different URL forces a fresh request now that the network may be back.
          img.src = src + (src.includes('?') ? '&' : '?') + 'retry=1';
        }, RETRY_DELAY_MS);
        return;
      }

      img.dataset.fallback = '1';
      img.src = PLACEHOLDER;
    },
    // Image load errors do not bubble, so listen in the capture phase.
    true
  );
  document.addEventListener(
    'load',
    event => {
      const img = event.target;
      if (img instanceof HTMLImageElement && img.naturalWidth > 0 && img.naturalWidth <= 120) {
        swapToSmallThumb(img);
      }
    },
    true
  );
}
