// The cover "flies" between the mini player and the Now Playing screen: the big
// cover starts at the small one's position and size and grows into place, and
// shrinks back into the mini player when the screen closes.

/** The mini player's cover, if it is on screen. */
export function miniCoverRect(): DOMRect | null {
  const el = document.querySelector('[data-mini-cover]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
}

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function transformFor(from: DOMRect, to: DOMRect): string {
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  return `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
}

/** Grows `el` from `from` into its own place (open) or shrinks it into `from` (close). */
export function flyCover(el: HTMLElement, from: DOMRect, direction: 'open' | 'close'): Promise<void> {
  if (prefersReducedMotion() || typeof el.animate !== 'function') return Promise.resolve();
  const to = el.getBoundingClientRect();
  if (to.width === 0) return Promise.resolve();
  const small = { transform: transformFor(from, to), borderRadius: '24px' };
  const big = { transform: 'none', borderRadius: '16px' };
  el.style.transformOrigin = 'top left';
  const anim = el.animate(direction === 'open' ? [small, big] : [big, small], {
    duration: direction === 'open' ? 420 : 300,
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    fill: direction === 'close' ? 'forwards' : 'none',
  });
  return anim.finished.then(
    () => undefined,
    () => undefined
  );
}
