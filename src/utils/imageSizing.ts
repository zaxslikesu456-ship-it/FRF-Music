// Loads each cover picture at the size it is shown. Covers are stored at their
// largest size (sharp on the big Now Playing view), but most appear as small
// list rows and cards; decoding those at full size kept hundreds of MB of
// pictures in memory once Home had been scrolled. This watches the pictures the
// app adds and swaps each one for the version that fits its space.
import { sizedCover } from './cover';

const done = new WeakMap<HTMLImageElement, string>(); // the src this module last chose

function fit(img: HTMLImageElement) {
  const src = img.getAttribute('src');
  if (!src || !/^https?:/.test(src)) return;
  // The error handler switched to the small thumbnail because the large one is
  // missing; never switch back.
  if (img.dataset.noResize === '1' || img.dataset.fallback === '1') return;
  if (done.get(img) === src) return;
  const w = img.getBoundingClientRect().width;
  if (!w) return; // not laid out (hidden): leave it
  const next = sizedCover(src, Math.ceil(w * (window.devicePixelRatio || 1)));
  done.set(img, next);
  if (next !== src) img.setAttribute('src', next);
}

function scan(node: Node) {
  if (node instanceof HTMLImageElement) fit(node);
  else if (node instanceof Element) node.querySelectorAll('img').forEach(fit);
}

export function installImageSizing(): void {
  const observer = new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'attributes') {
        if (r.target instanceof HTMLImageElement) fit(r.target);
      } else {
        r.addedNodes.forEach(scan);
      }
    }
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['src'],
  });
  scan(document.documentElement);
}
