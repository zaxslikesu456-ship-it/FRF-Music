import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Cast, Check, Loader2, RefreshCw, Tv, X } from 'lucide-react';
import { t as tr } from '../i18n';
import { useAudio } from '../context/AudioContext';
import { discoverDevices, type CastDevice } from '../utils/cast';
import { onBackButton } from '../utils/backButton';

interface CastModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// TVs found during this app run, shown right away the next time the list opens.
let remembered: CastDevice[] = [];

/** Pick a TV to play on, or bring the music back to this device. */
export function CastModal({ isOpen, onClose }: CastModalProps) {
  const { castDevice, startCasting, stopCasting } = useAudio();
  const [devices, setDevices] = useState<CastDevice[]>(remembered);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scanId = useRef(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const scan = useCallback(async () => {
    const id = ++scanId.current;
    setScanning(true);
    setError(null);
    try {
      const found = await discoverDevices(2500);
      if (id !== scanId.current) return;
      remembered = found;
      setDevices(found);
    } catch (e) {
      if (id === scanId.current) setError(String((e as Error)?.message || e));
    } finally {
      if (id === scanId.current) setScanning(false);
    }
  }, []);

  // Scan once each time the list opens (onClose changes every render, so it is read from a ref).
  useEffect(() => {
    if (!isOpen) return;
    void scan();
    return onBackButton(() => closeRef.current());
  }, [isOpen, scan]);

  if (!isOpen) return null;

  const pick = async (d: CastDevice) => {
    if (connecting) return;
    if (castDevice?.id === d.id) {
      onClose();
      return;
    }
    setConnecting(d.id);
    setError(null);
    try {
      await startCasting(d);
      onClose();
    } catch (e) {
      setError(`${tr("Couldn't connect to {name}", { name: d.name })}: ${String((e as Error)?.message || e)}`);
    } finally {
      setConnecting(null);
    }
  };

  const list = castDevice && !devices.some(d => d.id === castDevice.id) ? [castDevice, ...devices] : devices;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-app-surface border border-app-theme rounded-t-3xl sm:rounded-3xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl anim-sheet-up"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-app-theme">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-app-card border border-app-theme text-app-primary">
              <Cast className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-app-primary">{tr('Play on TV')}</h2>
              <p className="text-xs text-app-secondary">{tr('TVs on the same Wi-Fi as this device')}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void scan()}
              disabled={scanning}
              className="p-2 rounded-full text-app-secondary hover:text-app-primary hover:bg-app-card transition-colors disabled:opacity-50"
              title={tr('Search again')}
            >
              <RefreshCw className={`w-5 h-5 ${scanning ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-full text-app-secondary hover:text-app-primary hover:bg-app-card transition-colors"
              title={tr('Close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-2">
          {castDevice && (
            <button
              onClick={() => {
                void stopCasting();
                onClose();
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-app-card border border-app-theme hover:border-app-primary/40 transition-colors text-left"
            >
              <div className="p-2 rounded-xl bg-app-surface text-app-secondary">
                <X className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-app-primary">{tr('Stop casting')}</div>
                <div className="text-xs text-app-secondary truncate">{tr('Play on this device again')}</div>
              </div>
            </button>
          )}

          {list.map(d => {
            const active = castDevice?.id === d.id;
            const busy = connecting === d.id;
            return (
              <button
                key={d.id}
                onClick={() => void pick(d)}
                disabled={!!connecting && !busy}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border transition-colors text-left disabled:opacity-50 ${
                  active
                    ? 'bg-app-primary/10 border-app-primary/50'
                    : 'bg-app-card border-app-theme hover:border-app-primary/40'
                }`}
              >
                <div className={`p-2 rounded-xl bg-app-surface ${active ? 'text-app-primary' : 'text-app-secondary'}`}>
                  {d.kind === 'chromecast' ? <Cast className="w-5 h-5" /> : <Tv className="w-5 h-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-app-primary truncate">{d.name}</div>
                  <div className="text-xs text-app-secondary truncate">
                    {d.kind === 'chromecast' ? 'Google Cast' : 'DLNA'}
                    {d.model ? ` · ${d.model}` : ''}
                  </div>
                </div>
                {busy ? (
                  <Loader2 className="w-5 h-5 text-app-secondary animate-spin shrink-0" />
                ) : active ? (
                  <Check className="w-5 h-5 text-app-primary shrink-0" />
                ) : null}
              </button>
            );
          })}

          {list.length === 0 && (
            <div className="px-4 py-8 text-center">
              {scanning ? (
                <div className="flex flex-col items-center gap-3 text-app-secondary">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="text-sm">{tr('Looking for TVs...')}</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <Tv className="w-8 h-8 mx-auto text-app-secondary" />
                  <p className="font-semibold text-app-primary">{tr('No TVs found')}</p>
                  <p className="text-xs text-app-secondary leading-relaxed">
                    {tr(
                      'Turn the TV on and connect it to the same Wi-Fi as this device. Chromecast, Google TV and most Samsung, LG and Sony TVs work.'
                    )}
                  </p>
                </div>
              )}
            </div>
          )}

          {error && <p className="px-2 text-xs text-red-400 leading-relaxed">{error}</p>}
        </div>
      </div>
    </div>,
    document.body
  );
}
