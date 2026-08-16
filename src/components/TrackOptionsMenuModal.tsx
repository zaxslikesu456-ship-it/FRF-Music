import React, { useState } from 'react';
import {
  X,
  Download,
  ListPlus,
  Heart,
  Play,
  Trash2,
  Check,
  User,
  Radio,
  Share2,
  Timer,
  Info,
  ExternalLink,
} from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import { AddToPlaylistModal } from './AddToPlaylistModal';
import type { Track } from '../types/music';

const YoutubeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);

interface TrackOptionsMenuModalProps {
  track: Track | null;
  onClose: () => void;
  playlistId?: string;
  onRemoveFromPlaylist?: (trackId: string) => void;
}

const MenuItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: (e?: React.MouseEvent) => void;
  danger?: boolean;
  extraRight?: React.ReactNode;
}> = ({ icon, label, onClick, danger, extraRight }) => (
  <div
    onClick={onClick}
    className={`w-full flex items-center justify-between py-3.5 px-2 rounded-xl hover:bg-white/5 cursor-pointer transition-colors ${
      danger ? 'text-red-400 font-semibold' : 'text-white'
    }`}
  >
    <div className="flex items-center gap-4">
      <span className={danger ? 'text-red-400' : 'text-zinc-300'}>{icon}</span>
      <span className="text-base font-semibold">{label}</span>
    </div>
    {extraRight && <div onClick={e => e.stopPropagation()}>{extraRight}</div>}
  </div>
);

export const TrackOptionsMenuModal: React.FC<TrackOptionsMenuModalProps> = ({
  track,
  onClose,
  playlistId,
  onRemoveFromPlaylist,
}) => {
  const {
    favorites,
    toggleFavorite,
    downloadTrack,
    downloads,
    removeTrackFromLibrary,
    removeTrackFromPlaylist,
    openArtistProfile,
    startRadio,
    sleepTimerMinutes,
    setSleepTimer,
  } = useAudio();

  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const [showSleepTimerModal, setShowSleepTimerModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);

  if (!track) return null;

  const isFav = favorites.includes(track.id);
  const isDownloaded = downloads.includes(track.id);

  const formatDuration = (secs: number) => {
    if (!secs || isNaN(secs)) return '--:--';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleOpenExternal = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const ytUrl = track.youtubeId
      ? `https://www.youtube.com/watch?v=${track.youtubeId}`
      : `https://www.youtube.com/results?search_query=${encodeURIComponent(`${track.artist} ${track.title}`)}`;

    const a = document.createElement('a');
    a.href = ytUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (document.body.contains(a)) {
        document.body.removeChild(a);
      }
    }, 100);
    onClose();
  };

  const handleShare = () => {
    const shareUrl = track.youtubeId
      ? `https://www.youtube.com/watch?v=${track.youtubeId}`
      : window.location.href;

    if (navigator.share) {
      navigator.share({
        title: track.title,
        text: `Listen to "${track.title}" by ${track.artist} on Aura Music!`,
        url: shareUrl,
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(`${track.title} - ${track.artist}: ${shareUrl}`);
      alert('Song link copied to clipboard!');
    }
  };

  return (
    <>
      {/* Add To Playlist Modal */}
      <AddToPlaylistModal
        track={showPlaylistModal ? track : null}
        onClose={() => {
          setShowPlaylistModal(false);
          onClose();
        }}
      />

      {/* Info Modal */}
      {showInfoModal && (
        <div
          className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setShowInfoModal(false)}
        >
          <div
            className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-2xl text-white space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Info className="w-5 h-5 text-blue-400" /> Track Details
              </h3>
              <button
                onClick={() => setShowInfoModal(false)}
                className="p-1 text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2 text-sm text-zinc-300">
              <p><strong className="text-white">Title:</strong> {track.title}</p>
              <p><strong className="text-white">Artist:</strong> {track.artist}</p>
              <p><strong className="text-white">Album:</strong> {track.album || 'Single'}</p>
              <p><strong className="text-white">Duration:</strong> {formatDuration(track.duration)}</p>
              {track.youtubeId && (
                <p className="truncate"><strong className="text-white">YouTube ID:</strong> {track.youtubeId}</p>
              )}
            </div>
            <button
              onClick={() => setShowInfoModal(false)}
              className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl font-semibold transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Sleep Timer Selector Modal */}
      {showSleepTimerModal && (
        <div
          className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-md flex items-end justify-center animate-in fade-in"
          onClick={() => setShowSleepTimerModal(false)}
        >
          <div
            className="w-full max-w-md bg-zinc-900 border-t border-zinc-800 rounded-t-3xl p-6 pb-28 text-white space-y-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1.5 rounded-full bg-zinc-700 mx-auto mb-2" />
            <h3 className="text-lg font-bold text-center pb-2 border-b border-zinc-800">
              Sleep Timer
            </h3>
            {[
              { label: 'Off', val: null },
              { label: '15 Minutes', val: 15 },
              { label: '30 Minutes', val: 30 },
              { label: '45 Minutes', val: 45 },
              { label: '60 Minutes', val: 60 },
            ].map(item => (
              <button
                key={`sleep-${item.label}`}
                onClick={() => {
                  setSleepTimer(item.val);
                  setShowSleepTimerModal(false);
                  onClose();
                }}
                className={`w-full py-3 px-4 rounded-xl text-left text-base font-semibold flex items-center justify-between transition-colors ${
                  sleepTimerMinutes === item.val
                    ? 'bg-white text-black font-bold'
                    : 'hover:bg-white/10 text-white'
                }`}
              >
                <span>{item.label}</span>
                {sleepTimerMinutes === item.val && <Check className="w-5 h-5" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Track Options Bottom Sheet Drawer */}
      {!showPlaylistModal && !showSleepTimerModal && !showInfoModal && (
        <div
          className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-end justify-center animate-in fade-in duration-150"
          onClick={onClose}
        >
          <div
            className="w-full max-w-md bg-black border-t border-zinc-800/80 rounded-t-3xl px-6 pt-4 pb-28 shadow-2xl max-h-[88vh] overflow-y-auto no-scrollbar"
            onClick={e => e.stopPropagation()}
          >
            {/* Top Drag Handle */}
            <div className="w-12 h-1.5 rounded-full bg-zinc-800 mx-auto mb-4" />

            {/* Track Info Header (Cover | Title, Subtitle | Info (i), Download ↓) */}
            <div className="flex items-center justify-between pb-5 border-b border-zinc-800/60">
              <div className="flex items-center gap-3.5 min-w-0 flex-1">
                <img
                  src={track.coverUrl}
                  alt={track.title}
                  className="w-12 h-12 rounded-lg object-cover shrink-0 shadow-md"
                />
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-bold text-white truncate">{track.title}</h3>
                  <p className="text-sm text-zinc-400 truncate mt-0.5">
                    Song, {track.artist}
                  </p>
                </div>
              </div>

              {/* Info (i) and Download icons on header right side */}
              <div className="flex items-center gap-2 shrink-0 ml-3">
                <button
                  onClick={() => setShowInfoModal(true)}
                  className="p-2 text-zinc-300 hover:text-white rounded-full bg-zinc-900 border border-zinc-800"
                  title="Song Info"
                >
                  <Info className="w-5 h-5" />
                </button>
                <button
                  onClick={() => downloadTrack(track)}
                  className="p-2 text-zinc-300 hover:text-white rounded-full bg-zinc-900 border border-zinc-800"
                  title="Download Song"
                >
                  {isDownloaded ? (
                    <Check className="w-5 h-5 text-green-400" />
                  ) : (
                    <Download className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            {/* Menu Items matching screenshot order */}
            <div className="py-2 space-y-1">
              {/* 1. Start radio */}
              <MenuItem
                icon={<Radio className="w-6 h-6" />}
                label="Start radio"
                onClick={() => {
                  startRadio(track);
                  onClose();
                }}
              />

              {/* 2. Add to playlist */}
              <MenuItem
                icon={<ListPlus className="w-6 h-6" />}
                label="Add to playlist"
                onClick={() => setShowPlaylistModal(true)}
              />

              {/* 3. View Artist */}
              <MenuItem
                icon={<User className="w-6 h-6" />}
                label={`View Artist (${track.artist})`}
                onClick={() => {
                  openArtistProfile(track.artist);
                  onClose();
                }}
              />

              {/* 4. Open in */}
              <MenuItem
                icon={<ExternalLink className="w-6 h-6" />}
                label="Open in"
                onClick={handleOpenExternal}
                extraRight={
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleOpenExternal}
                      className="p-1.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white transition-colors"
                      title="Open in YouTube"
                    >
                      <YoutubeIcon className="w-5 h-5 fill-current text-white" />
                    </button>
                    <button
                      onClick={handleOpenExternal}
                      className="p-1.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white transition-colors"
                      title="Open in Web Browser"
                    >
                      <Play className="w-4 h-4 fill-current text-white" />
                    </button>
                  </div>
                }
              />

              {/* 5. Sleep Timer */}
              <MenuItem
                icon={<Timer className="w-6 h-6" />}
                label={`Sleep Timer${sleepTimerMinutes ? ` (${sleepTimerMinutes}m)` : ''}`}
                onClick={() => setShowSleepTimerModal(true)}
              />

              {/* 6. Share this song */}
              <MenuItem
                icon={<Share2 className="w-6 h-6" />}
                label="Share this song"
                onClick={() => {
                  handleShare();
                  onClose();
                }}
              />

              {/* Liked / Favorite Option */}
              <MenuItem
                icon={
                  <Heart className={`w-6 h-6 ${isFav ? 'fill-white text-white' : ''}`} />
                }
                label={isFav ? 'Remove from Liked' : 'Like song'}
                onClick={() => {
                  toggleFavorite(track.id);
                  onClose();
                }}
              />

              {/* Remove from playlist (Red option if applicable) */}
              {(onRemoveFromPlaylist || playlistId) && (
                <MenuItem
                  icon={<Trash2 className="w-6 h-6 text-red-400" />}
                  label="Remove from playlist"
                  danger
                  onClick={() => {
                    if (onRemoveFromPlaylist) {
                      onRemoveFromPlaylist(track.id);
                    } else if (playlistId) {
                      removeTrackFromPlaylist(playlistId, track.id);
                    }
                    onClose();
                  }}
                />
              )}

              {/* Remove from library */}
              <MenuItem
                icon={<Trash2 className="w-6 h-6 text-red-400" />}
                label="Remove from library"
                danger
                onClick={() => {
                  removeTrackFromLibrary(track.id);
                  onClose();
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};
