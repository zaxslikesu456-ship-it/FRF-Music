import React, { useEffect, useState } from 'react';
import { Download, Play, Shuffle, MoreVertical, Trash2, Clock, ChevronLeft } from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import { TrackOptionsMenuModal } from './TrackOptionsMenuModal';
import {
  subscribeDownloads,
  getActiveDownloads,
  cancelDownload,
  type ActiveDownload,
} from '../utils/downloadManager';
import type { Track } from '../types/music';

export const DownloadsView: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const { tracks, downloads, downloadedTracks: contextDownloadedTracks, removeDownload, playQueue, currentTrack, isPlaying, toggleShuffle, isShuffle } = useAudio();
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [activeDownloads, setActiveDownloads] = useState<ActiveDownload[]>(getActiveDownloads());

  useEffect(() => {
    return subscribeDownloads(() => setActiveDownloads([...getActiveDownloads()]));
  }, []);

  // Combine library tracks matching downloads with full downloaded track objects
  const downloadedTracks = React.useMemo(() => {
    const trackMap = new Map<string, Track>();
    contextDownloadedTracks.forEach(t => trackMap.set(t.id, t));
    tracks.filter(t => downloads.includes(t.id)).forEach(t => trackMap.set(t.id, t));
    return Array.from(trackMap.values());
  }, [tracks, downloads, contextDownloadedTracks]);

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

      {/* Header Banner */}
      <div className="flex items-center justify-between pt-1 pb-3 border-b border-app-theme">
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="p-1 text-app-primary" title="Back">
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}
          <div className="w-12 h-12 rounded-2xl bg-app-highlight text-app-inverse flex items-center justify-center font-bold shadow-lg">
            <Download className="w-6 h-6 fill-current" />
          </div>
          <div>
            <h1 className="text-xl font-black text-app-primary tracking-tight uppercase">DOWNLOADS</h1>
            <p className="text-xs text-app-secondary font-mono">{downloadedTracks.length} Saved Songs</p>
          </div>
        </div>

        {downloadedTracks.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={toggleShuffle}
              className={`p-2.5 rounded-xl border transition-all ${
                isShuffle ? 'bg-app-highlight text-app-inverse font-bold border-app-highlight' : 'bg-app-surface border-app-theme text-app-secondary hover:text-app-primary'
              }`}
              title="Shuffle Downloads"
            >
              <Shuffle className="w-4 h-4" />
            </button>

            <button
              onClick={playAllDownloaded}
              className="flex items-center gap-2 bg-app-highlight text-app-inverse px-4 py-2 rounded-xl font-bold text-xs hover:opacity-90 active:scale-95 transition-all shadow-md"
            >
              <Play className="w-4 h-4 fill-current ml-0.5" />
              <span>PLAY ALL</span>
            </button>
          </div>
        )}
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
                    onClick={() => cancelDownload(d.trackId)}
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

      {/* Empty State */}
      {downloadedTracks.length === 0 && activeDownloads.length === 0 ? (
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
        <div className="space-y-2">
          {downloadedTracks.map((track, index) => {
            const isCurrent = currentTrack?.id === track.id;

            return (
              <div
                key={track.id}
                onClick={() => playQueue(downloadedTracks, index)}
                className={`group p-3 rounded-2xl border transition-all duration-200 flex items-center justify-between cursor-pointer ${
                  isCurrent
                    ? 'bg-app-surface border-app-highlight text-app-primary font-bold shadow-lg'
                    : 'bg-app-card border-app-theme text-app-secondary hover:border-app-highlight hover:text-app-primary'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-6 text-center font-mono text-xs text-app-secondary shrink-0">
                    {isCurrent && isPlaying ? (
                      <div className="flex items-end justify-center gap-0.5 h-4">
                        <span className="w-0.5 h-full bg-app-highlight animate-pulse" />
                        <span className="w-0.5 h-1/2 bg-app-highlight animate-pulse delay-75" />
                        <span className="w-0.5 h-3/4 bg-app-highlight animate-pulse delay-150" />
                      </div>
                    ) : (
                      <span>{index + 1}</span>
                    )}
                  </div>

                  <div className="w-12 h-12 rounded-full overflow-hidden bg-app-surface border border-app-theme shrink-0 relative shadow-md">
                    <img
                      src={track.coverUrl}
                      alt={track.title}
                      className={`w-full h-full object-cover rounded-full ${
                        isCurrent && isPlaying ? 'animate-[spin_10s_linear_infinite]' : 'opacity-90 scale-95'
                      }`}
                    />
                    <div className="absolute inset-0 m-auto w-3 h-3 rounded-full bg-app-primary border border-app-highlight" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold truncate text-app-primary">
                      {track.title}
                    </h3>
                    <p className="text-xs text-app-secondary font-mono truncate mt-0.5">
                      {track.artist} • {track.album}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 pl-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeDownload(track.id);
                    }}
                    className="p-1.5 text-app-secondary hover:text-red-400 transition-colors"
                    title="Remove from Downloads"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedTrack(track);
                    }}
                    className="p-1.5 text-app-secondary hover:text-app-primary transition-colors"
                    title="Options Menu"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>

                  <div className="flex items-center gap-1 text-xs font-mono text-app-secondary">
                    <Clock className="w-3 h-3" />
                    <span>{formatDuration(track.duration)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
