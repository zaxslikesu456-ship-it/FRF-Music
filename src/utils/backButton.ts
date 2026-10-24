// The Android back button. Screens that can be closed (a settings page, Now
// Playing) register a handler while they are open; back closes the newest one.
// With nothing open, the app goes to the background as before (MainActivity
// asks window.__frfBack first and only then moves the task back).
const handlers: Array<() => void> = [];

export function onBackButton(handler: () => void): () => void {
  handlers.push(handler);
  return () => {
    const i = handlers.lastIndexOf(handler);
    if (i >= 0) handlers.splice(i, 1);
  };
}

(window as unknown as { __frfBack?: () => boolean }).__frfBack = () => {
  const top = handlers[handlers.length - 1];
  if (!top) return false;
  top();
  return true;
};
