import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileAudio, ImagePlus, Images, Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import { t as tr } from '../i18n';
import { useAudio } from '../context/AudioContext';
import { readAudioMeta, generatedCover } from '../utils/audioMeta';
import { pickImage } from '../utils/pickImage';

// Shown after you choose song files to import: each song's title and artist
// (read from the file) can be changed, and each can get its own picture, or
// one picture for all of them. Songs without one get a colourful letter cover.

interface Row {
  key: string;
  file: File;
  title: string;
  artist: string;
  album: string;
  duration: number;
  /** Picture embedded in the file, if any. */
  filePicture?: string;
  /** Picture the user picked; wins over the file's. */
  picked?: string;
  loading: boolean;
}

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm|wma)$/i;

export const isAudioFile = (f: File) => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name);

const fmt = (s: number) => (s > 0 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');

export const ImportSongsModal: React.FC<{ files: File[]; onClose: () => void }> = ({ files, onClose }) => {
  const { importLocalSongs } = useAudio();
  const [rows, setRows] = useState<Row[]>(() =>
    files.filter(isAudioFile).map((file, i) => ({
      key: `${i}-${file.name}-${file.size}`,
      file,
      title: file.name.replace(/\.[^/.]+$/, ''),
      artist: '',
      album: '',
      duration: 0,
      loading: true,
    }))
  );
  const [busy, setBusy] = useState(false);
  const skipped = files.length - rows.length;

  // Read the tag of each file (title, artist, cover art).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const row of rows) {
        const meta = await readAudioMeta(row.file).catch(() => null);
        if (cancelled) return;
        setRows(prev =>
          prev.map(r =>
            r.key !== row.key
              ? r
              : meta
                ? {
                    ...r,
                    title: meta.title,
                    artist: meta.artist === 'Unknown Artist' ? '' : meta.artist,
                    album: meta.album,
                    duration: meta.duration,
                    filePicture: meta.picture,
                    loading: false,
                  }
                : { ...r, loading: false }
          )
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // The file list is fixed for the life of the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (key: string, patch: Partial<Row>) =>
    setRows(prev => prev.map(r => (r.key === key ? { ...r, ...patch } : r)));

  const coverOf = (r: Row) => r.picked || r.filePicture || generatedCover(r.title || '?', r.artist);

  const pickFor = async (key: string) => {
    const img = await pickImage();
    if (img) update(key, { picked: img });
  };

  const pickForAll = async () => {
    const img = await pickImage();
    if (img) setRows(prev => prev.map(r => ({ ...r, picked: img })));
  };

  const doImport = async () => {
    if (rows.length === 0 || busy) return;
    setBusy(true);
    try {
      await importLocalSongs(
        rows.map(r => ({
          file: r.file,
          title: r.title,
          artist: r.artist,
          album: r.album,
          duration: r.duration,
          // Leave it empty for no picture: the context then draws the letter
          // cover from the final title and artist.
          coverUrl: r.picked || r.filePicture,
        }))
      );
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const stillReading = rows.some(r => r.loading);

  return createPortal(
    <div
      className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center"
      data-testid="import-songs-modal"
    >
      <div className="w-full max-w-lg bg-app-solid border border-app-theme rounded-t-3xl sm:rounded-3xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-app-theme">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-2xl bg-app-card border border-app-theme text-app-primary">
              <FileAudio className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-app-primary">{tr('Import songs')}</h2>
              <p className="text-xs text-app-secondary truncate">
                {rows.length} {rows.length === 1 ? tr('song') : tr('songs')}
                {skipped > 0 ? ` · ${skipped} ${tr('not audio, skipped')}` : ''}
              </p>
            </div>
          </div>
          <button onClick={onClose} disabled={busy} className="p-2 text-app-secondary rounded-full" title={tr('Close')}>
            <X className="w-6 h-6" />
          </button>
        </div>

        {rows.length > 1 && (
          <div className="px-6 pt-4">
            <button
              onClick={pickForAll}
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl bg-app-card border border-app-theme text-app-primary text-sm font-semibold"
            >
              <Images className="w-4 h-4" />
              {tr('One picture for all')}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {rows.length === 0 && (
            <p className="text-sm text-app-secondary text-center py-8">{tr('None of these files are songs.')}</p>
          )}
          {rows.map(r => (
            <div key={r.key} className="flex gap-3 p-3 rounded-2xl bg-app-card border border-app-theme">
              <div className="relative shrink-0">
                <button
                  onClick={() => pickFor(r.key)}
                  disabled={busy}
                  className="relative w-20 h-20 rounded-xl overflow-hidden border border-app-theme group"
                  title={tr('Choose picture')}
                >
                  <img src={coverOf(r)} alt="" className="w-full h-full object-cover" />
                  <span className="absolute bottom-1 right-1 p-1 rounded-full bg-black/60 text-white">
                    <ImagePlus className="w-3.5 h-3.5" />
                  </span>
                </button>
                {r.picked && (
                  <button
                    onClick={() => update(r.key, { picked: undefined })}
                    className="absolute -top-1.5 -left-1.5 p-1 rounded-full bg-app-solid border border-app-theme text-app-secondary"
                    title={tr('Use original picture')}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-1.5">
                <input
                  value={r.title}
                  onChange={e => update(r.key, { title: e.target.value })}
                  placeholder={tr('Title')}
                  disabled={busy}
                  className="w-full bg-transparent border-b border-app-theme text-app-primary font-semibold text-sm py-1 outline-none focus:border-app-highlight"
                />
                <input
                  value={r.artist}
                  onChange={e => update(r.key, { artist: e.target.value })}
                  placeholder={tr('Artist')}
                  disabled={busy}
                  className="w-full bg-transparent border-b border-app-theme text-app-secondary text-sm py-1 outline-none focus:border-app-highlight"
                />
                <p className="text-[11px] text-app-secondary truncate flex items-center gap-1">
                  {r.loading && <Loader2 className="w-3 h-3 animate-spin" />}
                  {r.file.name}
                  {r.duration ? ` · ${fmt(r.duration)}` : ''}
                </p>
              </div>
              <button
                onClick={() => setRows(prev => prev.filter(x => x.key !== r.key))}
                disabled={busy}
                className="self-start p-1.5 text-app-secondary rounded-full"
                title={tr('Remove')}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-app-theme">
          <button
            onClick={doImport}
            disabled={busy || rows.length === 0 || stillReading}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full font-bold disabled:opacity-50"
            style={{ background: "var(--text-primary)", color: "var(--bg-primary)" }}
          >
            {(busy || stillReading) && <Loader2 className="w-4 h-4 animate-spin" />}
            {busy
              ? tr('Importing')
              : rows.length === 1
                ? tr('Add 1 song')
                : `${tr('Add')} ${rows.length} ${tr('songs')}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
