// Loads each cover picture at the size it is shown. Covers are stored at their
// largest size (sharp on the big Now Playing view), but most appear as small
// list rows and cards; decoding those at full size kept hundreds of MB of
// pictures in memory once Home had been scrolled. This watches the pictures the
// app adds and swaps each one for the version that fits its space.
import { sizedCover } from './cover';

const done = new WeakMap<HTMLImageElement, string>(); // the src this module last chose
const chosenFor = new WeakMap<HTMLImageElement, number>(); // the width it was chosen for

// A picture measured while it was still small (the Now Playing cover is added
// while the screen opens and grows into place) kept the small version for good,
// so the big cover was blurry until another view loaded it fresh. Pictures that
// got a smaller version are watched, and get a bigger one once they grow.
const growth =
  typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(entries => {
        for (const e of entries) {
          const img = e.target as HTMLImageElement;
          const was = chosenFor.get(img) || 0;
          if (img.offsetWidth * (window.devicePixelRatio || 1) > was * 1.2) {
            done.delete(img);
            fit(img, true);
          }
        }
      })
    : null;

function fit(img: HTMLImageElement, growOnly = false) {
  const src = img.getAttribute('src');
  if (!src || !/^https?:/.test(src)) return;
  // The error handler switched to the small thumbnail because the large one is
  // missing; never switch back.
  if (img.dataset.noResize === '1' || img.dataset.fallback === '1') return;
  if (done.get(img) === src) return;
  // The laid-out width, not the on-screen one: an opening animation scales the
  // picture down for a moment.
  const w = img.offsetWidth || img.getBoundingClientRect().width;
  if (!w) return; // not laid out (hidden): leave it
  const px = Math.ceil(w * (window.devicePixelRatio || 1));
  if (growOnly && px <= (chosenFor.get(img) || 0)) return;
  const next = sizedCover(src, px);
  done.set(img, next);
  chosenFor.set(img, px);
  growth?.observe(img);
  if (next !== src) img.setAttribute('src', next);
}

function scan(node: Node) {
  if (node instanceof HTMLImageElement) fit(node);
  else if (node instanceof Element) node.querySelectorAll('img').forEach(img => fit(img));
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
