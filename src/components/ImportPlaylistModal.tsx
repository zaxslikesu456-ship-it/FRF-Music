import { createPortal } from 'react-dom';
import React, { useRef, useState } from 'react';
import { X, ClipboardPaste, FileUp, Check } from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import { searchYouTubeMusic } from '../utils/ytMusicApi';
import {
  parseImportText,
  trackFromSong,
  type SharedPlaylist,
  type SharedSong,
} from '../utils/playlistShare';
import type { Track } from '../types/music';
import { looksLikeSpotify, fetchSpotifyImport } from '../utils/spotifyImport';

type Phase = 'input' | 'preview' | 'importing' | 'done';

// Look a song up on YouTube Music by title and artist and take the best hit.
async function findSong(song: SharedSong): Promise<Track | null> {
  const direct = trackFromSong(song);
  if (direct) return direct;
  try {
    const results = await searchYouTubeMusic(`${song.t} ${song.a}`.trim());
    const hit = results?.find(r => r.isYouTube && r.youtubeId) || null;
    return hit;
  } catch {
    return null;
  }
}

export const ImportPlaylistModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const { importPlaylistToLibrary } = useAudio();
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [phase, setPhase] = useState<Phase>('input');
  const [parsed, setParsed] = useState<SharedPlaylist | null>(null);
  const [kind, setKind] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0, missed: 0 });
  const [result, setResult] = useState({ added: 0, missed: 0 });
  const cancelRef = useRef(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const reset = () => {
    cancelRef.current = true;
    setText('');
    setName('');
    setPhase('input');
    setParsed(null);
    setKind('');
    setNotice('');
    setError('');
    setProgress({ done: 0, total: 0, missed: 0 });
  };

  const close = () => {
    reset();
    onClose();
  };

  const analyse = async (raw: string, suggestedName?: string) => {
    setError('');
    setNotice('');
    // A Spotify share link: read the song list from Spotify, then look each
    // song up on YouTube Music like any other import.
    if (looksLikeSpotify(raw)) {
      setBusy(true);
      try {
        const sp = await fetchSpotifyImport(raw);
        setParsed(sp.playlist);
        setKind('spotify');
        setName(sp.playlist.name);
        if (sp.maybeTruncated) {
          setNotice(
            'Spotify only shares the first 100 songs of a playlist link. If yours is longer, export it as a CSV with exportify.net and choose that file here instead.'
          );
        }
        setPhase('preview');
      } catch (e) {
        setError(
          String((e as Error)?.message || e).includes('Spotify') || String((e as Error)?.message || e).includes('That is not')
            ? String((e as Error).message)
            : 'Could not reach Spotify. Check your connection, and that the playlist is public.'
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    const res = await parseImportText(raw, suggestedName || 'Imported playlist');
    if (!res.playlist) {
      setError(
        "That doesn't look like a playlist. Paste a share code, a list of songs (one per line), or choose a CSV file."
      );
      return;
    }
    setParsed(res.playlist);
    setKind(res.kind);
    setName(res.playlist.name);
    setPhase('preview');
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const content = await file.text();
    setText(content);
    await analyse(content, file.name.replace(/\.[^.]+$/, ''));
  };

  const runImport = async () => {
    if (!parsed) return;
    cancelRef.current = false;
    setPhase('importing');
    const songs = parsed.songs;
    const found: Track[] = [];
    let missed = 0;
    setProgress({ done: 0, total: songs.length, missed: 0 });

    // Songs with an id need no lookup; the rest are searched a few at a time.
    const queue = songs.map((s, i) => ({ s, i }));
    const slots: (Track | null)[] = new Array(songs.length).fill(null);
    let finished = 0;
    const worker = async () => {
      while (queue.length > 0 && !cancelRef.current) {
        const job = queue.shift()!;
        const track = await findSong(job.s);
        slots[job.i] = track;
        if (!track) missed++;
        finished++;
        setProgress({ done: finished, total: songs.length, missed });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (cancelRef.current) return;

    const seen = new Set<string>();
    for (const t of slots) {
      if (t && !seen.has(t.id)) {
        seen.add(t.id);
        found.push(t);
      }
    }
    if (found.length === 0) {
      setError('None of those songs could be found. Check your connection and try again.');
      setPhase('preview');
      return;
    }
    importPlaylistToLibrary(
      name.trim() || 'Imported playlist',
      `Imported playlist (${found.length} songs)`,
      found
    );
    setResult({ added: found.length, missed: songs.length - found.length });
    setPhase('done');
  };

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center">
      <div className="w-full max-w-lg bg-app-solid border border-app-theme rounded-t-3xl sm:rounded-3xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-app-theme">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-app-card border border-app-theme text-app-primary">
              <ClipboardPaste className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-bold text-app-primary">Import playlist</h2>
          </div>
          <button onClick={close} className="p-2 text-app-secondary rounded-full" title="Close">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {phase === 'input' && (
            <>
              <p className="text-sm text-app-secondary leading-relaxed">
                Paste a Spotify playlist, album or song link (Share, then Copy link), a share code
                from a friend, a list of songs (one per line, like "Blinding Lights - The Weeknd"),
                or choose a CSV file exported from another music app. For Spotify Liked Songs,
                export them as a CSV with exportify.net.
              </p>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Paste here..."
                rows={7}
                className="w-full rounded-2xl bg-app-card border border-app-theme p-3 text-sm text-app-primary placeholder:text-app-secondary outline-none resize-none"
              />
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,.json,text/*"
                className="hidden"
                onChange={e => void onFile(e.target.files?.[0])}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-app-card border border-app-theme text-sm font-semibold text-app-primary"
              >
                <FileUp className="w-4 h-4" />
                Choose a file
              </button>
              {error && <p className="text-sm text-red-400">{error}</p>}
            </>
          )}

          {phase === 'preview' && parsed && (
            <>
              <p className="text-sm text-app-secondary">
                Found <span className="font-bold text-app-primary">{parsed.songs.length} songs</span>
                {kind === 'code'
                  ? ' in this share code.'
                  : kind === 'csv'
                    ? ' in the CSV file.'
                    : kind === 'spotify'
                      ? ' on Spotify.'
                      : ' in your list.'}
                {kind !== 'code' && ' Each one is looked up on YouTube Music.'}
              </p>
              {notice && <p className="text-xs text-amber-300 leading-relaxed">{notice}</p>}
              <label className="block">
                <span className="text-xs font-semibold text-app-secondary tracking-wider">PLAYLIST NAME</span>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="mt-1 w-full rounded-2xl bg-app-card border border-app-theme px-3 py-3 text-sm text-app-primary outline-none"
                />
              </label>
              <div className="rounded-2xl bg-app-card border border-app-theme divide-y divide-white/5 max-h-48 overflow-y-auto">
                {parsed.songs.slice(0, 30).map((s, i) => (
                  <div key={i} className="px-3 py-2">
                    <p className="text-sm text-app-primary truncate">{s.t}</p>
                    {s.a && <p className="text-xs text-app-secondary truncate">{s.a}</p>}
                  </div>
                ))}
                {parsed.songs.length > 30 && (
                  <p className="px-3 py-2 text-xs text-app-secondary">
                    and {parsed.songs.length - 30} more...
                  </p>
                )}
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
            </>
          )}

          {phase === 'importing' && (
            <div className="py-6 space-y-4 text-center">
              <p className="text-sm text-app-primary font-semibold">
                Adding songs... {progress.done} of {progress.total}
              </p>
              <div className="h-2 rounded-full bg-app-card overflow-hidden">
                <div className="h-full bg-app-highlight transition-all" style={{ width: `${pct}%` }} />
              </div>
              {progress.missed > 0 && (
                <p className="text-xs text-app-secondary">{progress.missed} not found so far</p>
              )}
            </div>
          )}

          {phase === 'done' && (
            <div className="py-8 text-center space-y-3">
              <div className="mx-auto w-14 h-14 rounded-full bg-app-highlight text-app-inverse flex items-center justify-center">
                <Check className="w-7 h-7" />
              </div>
              <p className="text-base font-bold text-app-primary">
                Added {result.added} song{result.added === 1 ? '' : 's'}
              </p>
              {result.missed > 0 && (
                <p className="text-sm text-app-secondary">
                  {result.missed} could not be found and were skipped.
                </p>
              )}
              <p className="text-sm text-app-secondary">Find it in Library &gt; Playlists.</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-app-theme flex gap-3">
          {phase === 'input' && (
            <button
              onClick={() => void analyse(text)}
              disabled={!text.trim() || busy}
              className="flex-1 py-3 rounded-xl bg-app-highlight text-app-inverse font-bold text-sm disabled:opacity-40"
            >
              {busy ? 'Reading the Spotify playlist...' : 'Continue'}
            </button>
          )}
          {phase === 'preview' && (
            <>
              <button
                onClick={reset}
                className="px-5 py-3 rounded-xl bg-app-card border border-app-theme text-app-primary font-semibold text-sm"
              >
                Back
              </button>
              <button
                onClick={() => void runImport()}
                className="flex-1 py-3 rounded-xl bg-app-highlight text-app-inverse font-bold text-sm"
              >
                Import {parsed?.songs.length} songs
              </button>
            </>
          )}
          {phase === 'importing' && (
            <button
              onClick={reset}
              className="flex-1 py-3 rounded-xl bg-app-card border border-app-theme text-app-primary font-semibold text-sm"
            >
              Cancel
            </button>
          )}
          {phase === 'done' && (
            <button
              onClick={close}
              className="flex-1 py-3 rounded-xl bg-app-highlight text-app-inverse font-bold text-sm"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
