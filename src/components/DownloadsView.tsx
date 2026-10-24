import React, { useEffect, useState } from 'react';
import { Download, MoreVertical, Trash2, BarChart3 } from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import { TrackOptionsMenuModal } from './TrackOptionsMenuModal';
import { PlaylistHero } from './PlaylistHero';
import {
  subscribeDownloads,
  getActiveDownloads,
  type ActiveDownload,
} from '../utils/downloadManager';
import {
  getQueue,
  subscribeQueue,
  retryDownload,
  retryAllFailed,
  removeFromQueue,
  pauseQueue,
  resumeQueue,
  clearQueue,
  isQueuePaused,
  getQueuePauseReason,
  MAX_ATTEMPTS,
  type QueuedDownload,
} from '../utils/downloadQueue';
import type { Track } from '../types/music';

export const DownloadsView: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const { tracks, downloads, downloadedTracks: contextDownloadedTracks, removeDownload, playQueue, currentTrack, isPlaying, toggleShuffle, isShuffle } = useAudio();
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [activeDownloads, setActiveDownloads] = useState<ActiveDownload[]>(getActiveDownloads());
  const [queue, setQueue] = useState<QueuedDownload[]>(getQueue());
  const [paused, setPaused] = useState(isQueuePaused());
  const [pauseReason, setPauseReason] = useState(getQueuePauseReason());
  const [now, setNow] = useState(Date.now());
  const [sortAz, setSortAz] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    return subscribeDownloads(() => setActiveDownloads([...getActiveDownloads()]));
  }, []);

  useEffect(() => {
    return subscribeQueue(() => {
      setQueue(getQueue());
      setPaused(isQueuePaused());
      setPauseReason(getQueuePauseReason());
    });
  }, []);

  // Tick the "retrying in Ns" countdown while something is waiting to retry.
  const hasRetrying = queue.some(q => q.state === 'retrying');
  useEffect(() => {
    if (!hasRetrying) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasRetrying]);

  // Items that are actually transferring show as progress cards below; the
  // queue list is everything still waiting, retrying or failed.
  const queuedItems = queue.filter(q => q.state !== 'downloading');
  const failedCount = queue.filter(q => q.state === 'failed').length;

  // Combine library tracks matching downloads with full downloaded track objects
  const allDownloaded = React.useMemo(() => {
    const trackMap = new Map<string, Track>();
    contextDownloadedTracks.forEach(t => trackMap.set(t.id, t));
    tracks.filter(t => downloads.includes(t.id)).forEach(t => trackMap.set(t.id, t));
    return Array.from(trackMap.values());
  }, [tracks, downloads, contextDownloadedTracks]);

  // The list shown below the header: optionally searched and A-Z sorted.
  const downloadedTracks = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = q
      ? allDownloaded.filter(t => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q))
      : allDownloaded;
    if (sortAz) list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }, [allDownloaded, query, sortAz]);

  const formatDuration = (secs: number) => {
    if (!secs || isNaN(secs)) return '--:--';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const playAllDownloaded = () => {
    playQueue(downloadedTracks, 0);
  };

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-4 space-y-4 max-w-2xl mx-auto w-full">
      {/* Track Options Modal */}
      <TrackOptionsMenuModal
        track={selectedTrack}
        onClose={() => setSelectedTrack(null)}
      />

      <div className="-mx-4 -mt-4">
        <PlaylistHero
          title="Downloads"
          subtitle="playlist"
          count={allDownloaded.length}
          onBack={onBack}
          onPlay={playAllDownloaded}
          playDisabled={downloadedTracks.length === 0}
          isShuffle={isShuffle}
          onShuffle={toggleShuffle}
          sortAz={sortAz}
          onToggleSort={() => setSortAz(v => !v)}
          query={query}
          onQueryChange={setQuery}
        />
      </div>

      {/* Active Downloads with live progress */}
      {activeDownloads.length > 0 && (
        <div className="space-y-2 pb-3">
          {activeDownloads.map(d => {
            const pct = d.total > 0 ? Math.min(100, Math.round((d.bytes / d.total) * 100)) : 0;
            return (
              <div
                key={d.trackId}
                className="p-3 rounded-2xl border border-app-theme bg-app-surface flex items-center gap-3"
              >
                <img
                  src={d.coverUrl}
                  alt={d.title}
                  className="w-11 h-11 rounded-lg object-cover shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-app-primary truncate">{d.title}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex-1 h-1 rounded-full bg-app-card overflow-hidden">
                      <div
                        className={`h-full ${d.status === 'failed' ? 'bg-red-500' : 'bg-app-highlight'}`}
                        style={{ width: `${d.status === 'resolving' ? 4 : pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-app-secondary w-10 text-right shrink-0">
                      {d.status === 'resolving'
                        ? '...'
                        : d.status === 'failed'
                          ? '✕'
                          : d.status === 'done'
                            ? '✓'
                            : `${pct}%`}
                    </span>
                  </div>
                  <p className="text-[11px] text-app-secondary mt-1">
                    {d.status === 'resolving'
                      ? 'Finding audio stream...'
                      : d.status === 'downloading'
                        ? `Downloading ${pct}%`
                        : d.status === 'done'
                          ? 'Saved offline'
                          : 'Download failed'}
                  </p>
                </div>
                {(d.status === 'resolving' || d.status === 'downloading') && (
                  <button
                    onClick={() => removeFromQueue(d.trackId)}
                    className="p-2 text-app-secondary hover:text-red-400 shrink-0"
                    title="Skip this download"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Download queue: waiting, retrying and failed items */}
      {queuedItems.length > 0 && (
        <div className="space-y-2 pb-3">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs font-semibold text-app-secondary tracking-wider">
              DOWNLOAD QUEUE · {queuedItems.length}
            </p>
            <div className="flex items-center gap-4 text-xs font-semibold">
              {failedCount > 0 && (
                <button onClick={retryAllFailed} className="text-app-primary">
                  Retry failed
                </button>
              )}
              <button onClick={paused ? resumeQueue : pauseQueue} className="text-app-primary">
                {paused ? 'Resume' : 'Pause'}
              </button>
              <button onClick={clearQueue} className="text-app-secondary">
                Clear
              </button>
            </div>
          </div>
          {pauseReason && (
            <p className="px-3 py-2 rounded-xl bg-red-500/15 border border-red-500/30 text-xs text-red-300">
              {pauseReason}
            </p>
          )}
          {queuedItems.map(q => {
            const secs = Math.max(0, Math.ceil((q.nextAttemptAt - now) / 1000));
            return (
              <div
                key={q.track.id}
                className="p-3 rounded-2xl border border-app-theme bg-app-surface flex items-center gap-3"
              >
                <img
                  src={q.track.coverUrl}
                  alt={q.track.title}
                  className="w-11 h-11 rounded-lg object-cover shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-app-primary truncate">{q.track.title}</p>
                  <p className={`text-[11px] mt-1 ${q.state === 'failed' ? 'text-red-400' : 'text-app-secondary'}`}>
                    {paused && q.state !== 'failed'
                      ? 'Paused'
                      : q.state === 'waiting'
                        ? q.source === 'auto'
                          ? 'Waiting (auto-download)'
                          : 'Waiting'
                        : q.state === 'retrying'
                          ? `Retrying (${q.attempts}/${MAX_ATTEMPTS}) in ${secs}s`
                          : `Failed${q.lastError ? ` — ${q.lastError}` : ''}`}
                  </p>
                </div>
                {q.state === 'failed' && (
                  <button
                    onClick={() => retryDownload(q.track.id)}
                    className="px-3 py-1.5 rounded-xl bg-white/10 text-xs font-semibold text-app-primary shrink-0"
                  >
                    Retry
                  </button>
                )}
                <button
                  onClick={() => removeFromQueue(q.track.id)}
                  className="p-2 text-app-secondary hover:text-red-400 shrink-0"
                  title="Remove from queue"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty State */}
      {allDownloaded.length === 0 && activeDownloads.length === 0 && queuedItems.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-16 px-4 text-center border-2 border-dashed border-app-theme rounded-3xl my-auto space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-app-surface border border-app-theme flex items-center justify-center text-app-secondary">
            <Download className="w-8 h-8 text-app-secondary" />
          </div>
          <div className="space-y-1 max-w-xs">
            <h3 className="text-base font-bold text-app-primary uppercase tracking-wide">NO DOWNLOADED SONGS</h3>
            <p className="text-xs text-app-secondary font-mono">
              Click the 3 lines/dots option menu on any song and select Download to save songs to your download list.
            </p>
          </div>
        </div>
      ) : (
        /* Downloaded Tracks Listing */
        <div className="px-2 pt-2 space-y-1">
          {downloadedTracks.length === 0 && allDownloaded.length > 0 && (
            <p className="text-center text-sm text-app-secondary py-8">No matching songs</p>
          )}
          {downloadedTracks.map((track, index) => {
            const isCurrent = currentTrack?.id === track.id;

            return (
              <div
                key={track.id}
                onClick={() => playQueue(downloadedTracks, index)}
                className="w-full flex items-center gap-3.5 p-2 rounded-xl text-left hover:bg-white/5 cursor-pointer transition-colors group"
              >
                <img
                  src={track.coverUrl}
                  alt={track.title}
                  loading="lazy"
                  className="w-12 h-12 rounded-lg object-cover shrink-0 border border-white/5"
                />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm sm:text-base font-semibold truncate ${isCurrent ? 'text-white font-bold' : 'text-zinc-100'}`}>
                    {track.title}
                  </p>
                  <p className="text-xs text-zinc-400 truncate mt-0.5">{track.artist}</p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {isCurrent && isPlaying && (
                    <BarChart3 className="w-5 h-5 text-white fill-white/20 animate-pulse" />
                  )}

                  <span className="text-xs text-zinc-400 font-mono">{formatDuration(track.duration)}</span>

                  <span
                    role="button"
                    tabIndex={0}
                    onClick={e => {
                      e.stopPropagation();
                      removeDownload(track.id);
                    }}
                    className="p-1.5 text-zinc-500 hover:text-red-400"
                    title="Remove from Downloads"
                  >
                    <Trash2 className="w-4 h-4" />
                  </span>

                  <span
                    role="button"
                    tabIndex={0}
                    onClick={e => {
                      e.stopPropagation();
                      setSelectedTrack(track);
                    }}
                    className="p-1.5 text-zinc-400 hover:text-white"
                    title="More Options"
                  >
                    <MoreVertical className="w-5 h-5" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
