import { createPortal } from 'react-dom';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { X, Smartphone, Copy, Download, Share2, FileUp, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import { copyText } from '../utils/clipboard';
import {
  buildSyncData,
  describeSync,
  encodeSyncBody,
  isEmptySync,
  mergeSync,
  parseSyncText,
  splitForQr,
  summaryIsEmpty,
  type SyncData,
  type SyncSummary,
} from '../utils/deviceSync';

// A QR code holds roughly 2-3 KB, so the code is cut into a few numbered pieces and
// shown one at a time. Past this many pieces the file or "Copy code" is the better way.
const MAX_QR_PARTS = 6;

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

function qrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

function downloadFile(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const Stat: React.FC<{ label: string; value: number | string }> = ({ label, value }) => (
  <div className="p-3 rounded-2xl bg-app-card border border-app-theme">
    <p className="text-xs text-app-secondary">{label}</p>
    <p className="text-lg font-bold text-app-primary mt-0.5">{value}</p>
  </div>
);

const Btn: React.FC<{
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  primary?: boolean;
  disabled?: boolean;
}> = ({ onClick, icon, children, primary, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-sm font-semibold active:scale-98 transition-all disabled:opacity-40 ${
      primary
        ? 'bg-app-highlight text-app-inverse'
        : 'bg-app-card border border-app-theme text-app-primary'
    }`}
  >
    {icon}
    {children}
  </button>
);

export const DeviceSyncModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const { getSyncLocal, applySyncData } = useAudio();
  const [tab, setTab] = useState<'send' | 'receive'>('send');
  const [note, setNote] = useState('');

  // ---- send
  const [fullBody, setFullBody] = useState('');
  const [fullJson, setFullJson] = useState('');
  const [exportData, setExportData] = useState<SyncData | null>(null);
  const [parts, setParts] = useState<string[] | null>(null); // null = too big for QR
  const [partIdx, setPartIdx] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let live = true;
    setNote('');
    setBusy(true);
    (async () => {
      try {
        const local = getSyncLocal();
        const full = buildSyncData(local);
        const lite = buildSyncData(local, { lite: true });
        const [body, liteBody] = await Promise.all([encodeSyncBody(full), encodeSyncBody(lite)]);
        if (!live) return;
        setExportData(full);
        setFullBody(body);
        setFullJson(JSON.stringify(full));
        const pieces = splitForQr(liteBody);
        setParts(pieces.length <= MAX_QR_PARTS ? pieces : null);
        setPartIdx(0);
      } finally {
        if (live) setBusy(false);
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const qr = useMemo(() => {
    if (!parts) return '';
    try {
      return qrSvg(parts[partIdx]);
    } catch {
      return '';
    }
  }, [parts, partIdx]);

  const fileName = `FRF-Music-Sync-${new Date().toISOString().slice(0, 10)}.json`;
  const canShareFile = useMemo(() => {
    try {
      if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
      return navigator.canShare({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] });
    } catch {
      return false;
    }
  }, []);

  const saveFile = () => {
    downloadFile(fileName, fullJson);
    setNote('Backup file saved to your downloads.');
  };
  const shareFile = async () => {
    try {
      const file = new File([fullJson], fileName, { type: 'application/json' });
      await navigator.share({ files: [file], title: 'FRF Music sync' });
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') setNote('Sharing did not work here. Use Save file or Copy code.');
    }
  };
  const copyCode = async () => {
    const ok = await copyText(`FRFSYNC1:${fullBody}`);
    setNote(ok ? 'Code copied. Paste it on the other device under Receive.' : 'Could not copy.');
  };

  // ---- receive
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<SyncData | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SyncSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const check = async (source: string) => {
    setResult(null);
    const r = await parseSyncText(source);
    if (r.ok) {
      setParsed(r.data);
      setError(isEmptySync(r.data) ? 'This code has no playlists, likes or history in it.' : '');
    } else {
      setParsed(null);
      setError(source.trim() ? r.error : '');
    }
  };

  const onFile = async (file?: File | null) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setError('That file is too large to be a sync file.');
      return;
    }
    const content = await file.text();
    setText(content.length > 4000 ? `(${file.name})` : content);
    await check(content);
  };

  const preview = useMemo(() => {
    if (!parsed || isEmptySync(parsed)) return null;
    return { have: describeSync(parsed), would: mergeSync(getSyncLocal(), parsed).summary };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed]);

  const doImport = () => {
    if (!parsed) return;
    setResult(applySyncData(parsed));
    setParsed(null);
    setText('');
  };

  if (!isOpen) return null;
  const sd = exportData ? describeSync(exportData) : null;

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center">
      <div className="w-full max-w-lg bg-app-solid border border-app-theme rounded-t-3xl sm:rounded-3xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-app-theme">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-app-card border border-app-theme text-app-primary">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-app-primary">Sync with another device</h2>
              <p className="text-xs text-app-secondary">Playlists, likes, history and stats</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-app-secondary rounded-full" title="Close">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="px-6 pt-4 flex gap-2">
          {(['send', 'receive'] as const).map(t => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setNote('');
              }}
              className={`flex-1 py-2.5 rounded-2xl text-sm font-semibold transition-all ${
                tab === t
                  ? 'bg-app-highlight text-app-inverse'
                  : 'bg-app-card border border-app-theme text-app-secondary'
              }`}
            >
              {t === 'send' ? 'Send from this device' : 'Receive here'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {tab === 'send' && (
            <>
              {busy || !sd ? (
                <p className="text-sm text-app-secondary text-center py-10">Preparing...</p>
              ) : isEmptySync(exportData!) ? (
                <p className="text-sm text-app-secondary text-center py-10 leading-relaxed">
                  Nothing to send yet. Make a playlist or like some songs first.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Stat label="Playlists" value={sd.playlists} />
                    <Stat label="Liked songs" value={sd.liked} />
                    <Stat label="History" value={sd.recent} />
                    <Stat label="Listening days" value={sd.logDays} />
                  </div>
                  {!!exportData?.skipped && (
                    <p className="text-xs text-app-secondary">
                      {plural(exportData.skipped, 'local file')} stay on this device. Only online
                      songs can be synced.
                    </p>
                  )}

                  <div className="p-4 rounded-2xl bg-app-card border border-app-theme space-y-3">
                    <p className="text-sm font-semibold text-app-primary">QR code</p>
                    {parts && qr ? (
                      <>
                        <div
                          className="mx-auto w-64 max-w-full bg-white rounded-xl p-1"
                          dangerouslySetInnerHTML={{ __html: qr }}
                        />
                        {parts.length > 1 && (
                          <div className="flex items-center justify-center gap-4">
                            <button
                              onClick={() => setPartIdx(i => Math.max(0, i - 1))}
                              disabled={partIdx === 0}
                              className="p-2 rounded-full bg-app-surface border border-app-theme text-app-primary disabled:opacity-30"
                              title="Previous code"
                            >
                              <ChevronLeft className="w-5 h-5" />
                            </button>
                            <p className="text-sm font-semibold text-app-primary">
                              Code {partIdx + 1} of {parts.length}
                            </p>
                            <button
                              onClick={() => setPartIdx(i => Math.min(parts.length - 1, i + 1))}
                              disabled={partIdx === parts.length - 1}
                              className="p-2 rounded-full bg-app-surface border border-app-theme text-app-primary disabled:opacity-30"
                              title="Next code"
                            >
                              <ChevronRight className="w-5 h-5" />
                            </button>
                          </div>
                        )}
                        <p className="text-xs text-app-secondary leading-relaxed">
                          Scan {parts.length > 1 ? 'every code in turn' : 'it'} with the other
                          device's camera app, then paste the text it shows under Receive
                          {parts.length > 1 ? ' (all parts in one box)' : ''}. The QR holds a
                          shortened version: the most played songs and the last 90 days of
                          stats.
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-app-secondary leading-relaxed">
                        Your library is too big for a QR code. Use the backup file or Copy code
                        below, which carry everything.
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Btn primary onClick={saveFile} icon={<Download className="w-4 h-4" />}>
                      Save file
                    </Btn>
                    <Btn onClick={copyCode} icon={<Copy className="w-4 h-4" />}>
                      Copy code
                    </Btn>
                    {canShareFile && (
                      <Btn onClick={shareFile} icon={<Share2 className="w-4 h-4" />}>
                        Share file
                      </Btn>
                    )}
                  </div>
                  <p className="text-xs text-app-secondary leading-relaxed">
                    The file and the copied code hold everything. Send them to yourself in any
                    messaging app, then open this screen on the other device.
                  </p>
                </>
              )}
            </>
          )}

          {tab === 'receive' && (
            <>
              <p className="text-sm text-app-secondary leading-relaxed">
                Paste a sync code (or the text from the QR code) or pick a backup file. It is
                merged with this device. Nothing is removed.
              </p>
              <textarea
                value={text}
                onChange={e => {
                  setText(e.target.value);
                  void check(e.target.value);
                }}
                placeholder="Paste sync code here"
                rows={4}
                className="w-full p-3 rounded-2xl bg-app-card border border-app-theme text-app-primary text-xs font-mono outline-none resize-none"
              />
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json,text/plain"
                className="hidden"
                onChange={e => {
                  void onFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <Btn onClick={() => fileRef.current?.click()} icon={<FileUp className="w-4 h-4" />}>
                Choose backup file
              </Btn>

              {error && <p className="text-sm text-red-400">{error}</p>}

              {preview && (
                <div className="p-4 rounded-2xl bg-app-card border border-app-theme space-y-2">
                  <p className="text-sm font-semibold text-app-primary">This code contains</p>
                  <p className="text-sm text-app-secondary">
                    {plural(preview.have.playlists, 'playlist')} ({plural(preview.have.playlistSongs, 'song')}),{' '}
                    {plural(preview.have.liked, 'liked song')}, {plural(preview.have.recent, 'history entry', 'history entries')},{' '}
                    {plural(preview.have.logDays, 'listening day')}
                  </p>
                  <p className="text-sm font-semibold text-app-primary pt-1">New on this device</p>
                  {summaryIsEmpty(preview.would) ? (
                    <p className="text-sm text-app-secondary">Nothing new, you already have it all.</p>
                  ) : (
                    <p className="text-sm text-app-secondary">
                      {plural(preview.would.playlistsNew, 'new playlist')},{' '}
                      {plural(preview.would.playlistSongsAdded, 'playlist song')} added,{' '}
                      {plural(preview.would.likesAdded, 'new like')},{' '}
                      {plural(preview.would.historyAdded, 'history entry', 'history entries')},{' '}
                      {plural(preview.would.logDaysChanged, 'stats day')} updated
                    </p>
                  )}
                  <div className="pt-2">
                    <Btn
                      primary
                      onClick={doImport}
                      disabled={summaryIsEmpty(preview.would)}
                      icon={<Check className="w-4 h-4" />}
                    >
                      Merge into this device
                    </Btn>
                  </div>
                </div>
              )}

              {result && (
                <div className="p-4 rounded-2xl bg-app-card border border-app-theme space-y-1">
                  <p className="text-sm font-semibold text-app-primary">Done</p>
                  <p className="text-sm text-app-secondary">
                    {plural(result.playlistsNew, 'playlist')} added, {plural(result.playlistsUpdated, 'playlist')} updated
                    (+{plural(result.playlistSongsAdded, 'song')}), {plural(result.likesAdded, 'like')} added,{' '}
                    {plural(result.historyAdded, 'history entry', 'history entries')} merged, stats updated for{' '}
                    {plural(result.logDaysChanged, 'day')}.
                  </p>
                </div>
              )}
            </>
          )}

          {note && <p className="text-sm text-app-secondary text-center">{note}</p>}
        </div>
      </div>
    </div>,
    document.body
  );
};
