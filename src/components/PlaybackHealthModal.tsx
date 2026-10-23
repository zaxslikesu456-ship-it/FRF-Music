import { createPortal } from 'react-dom';
import React, { useEffect, useState } from 'react';
import { X, Activity, RefreshCw, Copy, Trash2 } from 'lucide-react';
import {
  subscribeHealth,
  summarize,
  getEvents,
  clearHealth,
  statusOf,
  formatAgo,
  recordSource,
  type SourceSummary,
} from '../utils/streamHealth';
import { resolveAudioStreamUrlFull, resolveAudioStreamUrl, getLastStreamResolveNotes } from '../utils/downloadManager';

const TEST_VIDEO = 'dQw4w9WgXcQ';

const DOT: Record<string, string> = {
  healthy: 'bg-emerald-400',
  degraded: 'bg-amber-400',
  down: 'bg-red-500',
};
const LABEL: Record<string, string> = {
  healthy: 'Working',
  degraded: 'Unreliable',
  down: 'Failing',
};

function readNativeError(): { t: number; msg: string } | null {
  try {
    const raw = localStorage.getItem('frf_native_last_error');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const PlaybackHealthModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const [rows, setRows] = useState<SourceSummary[]>(summarize());
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState('');
  const [copied, setCopied] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    setRows(summarize());
    const unsub = subscribeHealth(() => setRows(summarize()));
    const id = window.setInterval(() => tick(n => n + 1), 15000);
    return () => {
      unsub();
      window.clearInterval(id);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const runTest = async () => {
    setTesting(true);
    setTestNote('Testing a known song...');
    const started = Date.now();
    // The two main routes, side by side. Each one records itself in the list above.
    const [full, general] = await Promise.allSettled([
      resolveAudioStreamUrlFull(TEST_VIDEO),
      resolveAudioStreamUrl(TEST_VIDEO, true),
    ]);
    if (full.status === 'rejected') recordSource('Full-length route', false, Date.now() - started, full.reason);
    else recordSource('Full-length route', true, Date.now() - started);
    if (general.status === 'rejected') recordSource('Quick route', false, Date.now() - started, general.reason);
    else recordSource('Quick route', true, Date.now() - started);

    if (full.status === 'fulfilled') {
      setTestNote('Playback should work: the full-length route found the song.');
    } else if (general.status === 'fulfilled') {
      setTestNote(
        'Only the quick route worked. Songs may cut out after about a minute until the full-length route works again.'
      );
    } else {
      const notes = getLastStreamResolveNotes();
      setTestNote(`Nothing could find the song.${notes ? ' ' + notes : ''} Check your internet connection.`);
    }
    setTesting(false);
  };

  const buildReport = () => {
    const lines: string[] = [];
    lines.push(`FRF Music playback report - ${new Date().toISOString()}`);
    lines.push(`Build: ${__APP_BUILD__}`);
    lines.push(`Online: ${navigator.onLine}`);
    const native = readNativeError();
    if (native) lines.push(`Last native player error (${formatAgo(native.t)}): ${native.msg}`);
    lines.push('');
    for (const r of rows) {
      lines.push(
        `${r.source}: ${LABEL[statusOf(r)]} (${r.ok} ok, ${r.fail} failed${r.avgMs ? `, avg ${r.avgMs} ms` : ''})` +
          (r.lastError ? ` - last error: ${r.lastError}` : '')
      );
    }
    const recent = getEvents().slice(-15);
    if (recent.length > 0) {
      lines.push('', 'Recent:');
      for (const e of recent) {
        lines.push(`${new Date(e.at).toISOString()} ${e.source} ${e.ok ? 'ok' : 'FAIL ' + (e.error || '')} ${e.ms}ms`);
      }
    }
    return lines.join('\n');
  };

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(buildReport());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // clipboard blocked
    }
  };

  const native = readNativeError();

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center">
      <div className="w-full max-w-lg bg-app-surface border border-app-theme rounded-t-3xl sm:rounded-3xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-app-theme">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-app-card border border-app-theme text-app-primary">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-app-primary">Playback health</h2>
              <p className="text-xs text-app-secondary">Which sources are working right now</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-app-secondary rounded-full" title="Close">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <button
            onClick={() => void runTest()}
            disabled={testing}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-app-highlight text-app-inverse font-bold text-sm disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${testing ? 'animate-spin' : ''}`} />
            {testing ? 'Testing...' : 'Run a test now'}
          </button>
          {testNote && <p className="text-sm text-app-secondary leading-relaxed">{testNote}</p>}

          {rows.length === 0 ? (
            <p className="text-sm text-app-secondary text-center py-8">
              Nothing recorded yet. Play or download a song, or run a test.
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map(r => {
                const st = statusOf(r);
                return (
                  <div key={r.source} className="p-3 rounded-2xl bg-app-card border border-app-theme">
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${DOT[st]}`} />
                      <p className="text-sm font-semibold text-app-primary flex-1 truncate">{r.source}</p>
                      <span className="text-xs text-app-secondary">{LABEL[st]}</span>
                    </div>
                    <p className="text-xs text-app-secondary mt-1">
                      {r.ok} worked · {r.fail} failed
                      {r.avgMs ? ` · ${(r.avgMs / 1000).toFixed(1)} s typical` : ''} · {formatAgo(r.lastAt)}
                    </p>
                    {r.lastError && st !== 'healthy' && (
                      <p className="text-xs text-red-300/90 mt-1 break-words">{r.lastError}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {native && (
            <div className="p-3 rounded-2xl bg-app-card border border-app-theme">
              <p className="text-xs font-semibold text-app-secondary tracking-wider">
                LAST PLAYER ERROR · {formatAgo(native.t)}
              </p>
              <p className="text-xs text-app-primary mt-1 break-words">{native.msg}</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-app-theme flex gap-3">
          <button
            onClick={() => void copyReport()}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-app-card border border-app-theme text-app-primary font-semibold text-sm"
          >
            <Copy className="w-4 h-4" />
            {copied ? 'Copied' : 'Copy report'}
          </button>
          <button
            onClick={clearHealth}
            className="px-4 py-3 rounded-xl bg-app-card border border-app-theme text-app-secondary"
            title="Clear history"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
