import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, LocateFixed, Copy, Check, Share2 } from 'lucide-react';
import { t as tr } from '../i18n';
import { useAudio } from '../context/AudioContext';
import { parseLrc, lineProgress } from '../utils/lyricsSync';
import { fetchLyrics } from '../utils/lyrics';
import { LyricCardModal } from './LyricCardModal';
import type { LyricCardInput } from '../utils/lyricCard';

/**
 * The lyrics view shared by the phone's Now Playing screen and the PC player:
 * synced karaoke lines (tap a line to jump there), Follow (keeps the sung line
 * in the middle, pauses while you scroll by hand), a per-song timing nudge,
 * Copy all and a shareable lyric card. Mount it only while it is visible.
 */
export const LyricsPanel: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { currentTrack, currentTime, duration, seekTo } = useAudio();

  const [rawLyrics, setRawLyrics] = useState<string | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricCard, setLyricCard] = useState<LyricCardInput | null>(null);
  const activeLyricRef = useRef<HTMLParagraphElement | null>(null);
  const lyricsContainerRef = useRef<HTMLDivElement | null>(null);

  // Length of the recording being played, used to pick the lyrics version that
  // is in time with it. 0 until the player knows it; the lyrics are looked up
  // again once it does.
  const songLength = duration > 1 ? Math.round(duration) : 0;
  const lyricsForTrackRef = useRef<string | null>(null);

  useEffect(() => {
    if (!currentTrack) return;
    let mounted = true;
    // Same song, length just became known: keep showing the current lyrics
    // while the better-timed version loads.
    const sameTrack = lyricsForTrackRef.current === currentTrack.id;
    if (!sameTrack) {
      setLyricsLoading(true);
      setRawLyrics(null);
    }
    fetchLyrics(currentTrack.title, currentTrack.artist, songLength).then(text => {
      if (mounted) {
        lyricsForTrackRef.current = currentTrack.id;
        if (text || !sameTrack) setRawLyrics(text);
        setLyricsLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, [currentTrack, songLength]);

  // Parse timed LRC synced lines
  const syncedLyrics = useMemo(() => {
    if (!rawLyrics) return [];
    return parseLrc(rawLyrics);
  }, [rawLyrics]);

  // Per-song timing nudge for lyrics that are still a little early or late.
  // Positive = lyrics shown later. Saved per track.
  const LYRIC_OFFSETS_KEY = 'bw_lyric_offsets';
  const [lyricOffset, setLyricOffset] = useState(0);
  useEffect(() => {
    try {
      const map = JSON.parse(localStorage.getItem(LYRIC_OFFSETS_KEY) || '{}');
      setLyricOffset(currentTrack ? Number(map[currentTrack.id]) || 0 : 0);
    } catch {
      setLyricOffset(0);
    }
  }, [currentTrack?.id]);
  const nudgeLyrics = (delta: number) => {
    if (!currentTrack) return;
    const trackId = currentTrack.id;
    // Builds on the latest value so quick repeated taps all count.
    setLyricOffset(prev => {
      const next = Math.round((prev + delta) * 10) / 10;
      try {
        const map = JSON.parse(localStorage.getItem(LYRIC_OFFSETS_KEY) || '{}');
        if (next === 0) delete map[trackId];
        else map[trackId] = next;
        localStorage.setItem(LYRIC_OFFSETS_KEY, JSON.stringify(map));
      } catch {
        // storage unavailable: the nudge still applies for now
      }
      return next;
    });
  };
  const lyricTime = currentTime - lyricOffset;

  // Determine currently active lyric line index based on playback currentTime
  const activeLyricIndex = useMemo(() => {
    if (syncedLyrics.length === 0) return -1;
    let index = -1;
    for (let i = 0; i < syncedLyrics.length; i++) {
      if (lyricTime >= syncedLyrics[i].time) {
        index = i;
      } else {
        break;
      }
    }
    return index;
  }, [syncedLyrics, lyricTime]);

  // Follow mode (like Spotify): the lyrics scroll by themselves so the line
  // being sung stays in the middle. Scrolling by hand pauses it; it picks up
  // again after a few seconds, or straight away from "Back to current line".
  const [followLyrics, setFollowLyrics] = useState(
    () => localStorage.getItem('bw_lyrics_follow') !== '0'
  );
  const [followPaused, setFollowPaused] = useState(false);
  const followResumeTimerRef = useRef<number | null>(null);

  const scrollToActiveLine = (smooth: boolean) => {
    const box = lyricsContainerRef.current;
    const line = activeLyricRef.current;
    if (!box || !line) return;
    const boxRect = box.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const top = box.scrollTop + (lineRect.top - boxRect.top) - (box.clientHeight - lineRect.height) / 2;
    box.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  };

  const resumeFollow = () => {
    if (followResumeTimerRef.current) window.clearTimeout(followResumeTimerRef.current);
    followResumeTimerRef.current = null;
    setFollowPaused(false);
    scrollToActiveLine(true);
  };

  const pauseFollowForManualScroll = (e: React.SyntheticEvent) => {
    if (!followLyrics) return;
    // Taps on the Follow / Copy / Share buttons are not scrolling.
    if ((e.target as HTMLElement | null)?.closest?.('button')) return;
    setFollowPaused(true);
    if (followResumeTimerRef.current) window.clearTimeout(followResumeTimerRef.current);
    followResumeTimerRef.current = window.setTimeout(() => {
      followResumeTimerRef.current = null;
      setFollowPaused(false);
    }, 6000);
  };

  const toggleFollowLyrics = () => {
    const next = !followLyrics;
    setFollowLyrics(next);
    localStorage.setItem('bw_lyrics_follow', next ? '1' : '0');
    if (next) resumeFollow();
  };

  useEffect(
    () => () => {
      if (followResumeTimerRef.current) window.clearTimeout(followResumeTimerRef.current);
    },
    []
  );

  // Keep the line being sung in the middle while following.
  useEffect(() => {
    if (!followLyrics || followPaused) return;
    scrollToActiveLine(true);
  }, [activeLyricIndex, followLyrics, followPaused]);

  // Copy the whole lyrics (every line), not just one line.
  const [lyricsCopied, setLyricsCopied] = useState(false);
  const copyLyrics = async () => {
    const text =
      syncedLyrics.length > 0
        ? syncedLyrics.map(l => l.text).filter(Boolean).join('\n')
        : (rawLyrics || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).join('\n');
    if (!text) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // Older WebViews: fall back to a temporary textarea.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
    }
    if (ok) {
      setLyricsCopied(true);
      window.setTimeout(() => setLyricsCopied(false), 1800);
    }
  };

  // Build a share card around the line that is playing now (or the first line).
  const shareLyric = () => {
    if (!currentTrack) return;
    let lines: string[];
    let at: number;
    if (syncedLyrics.length > 0) {
      lines = syncedLyrics.map(l => l.text).filter(Boolean);
      const cur = syncedLyrics[Math.max(0, activeLyricIndex)]?.text || lines[0];
      at = Math.max(0, lines.indexOf(cur));
    } else {
      lines = (rawLyrics || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      at = 0;
    }
    if (lines.length === 0) return;
    setLyricCard({
      title: currentTrack.title,
      artist: currentTrack.artist,
      coverUrl: currentTrack.coverUrl,
      before: lines.slice(Math.max(0, at - 1), at),
      line: lines[at],
      after: lines.slice(at + 1, at + 3),
    });
  };

  return (
    <>
      <LyricCardModal input={lyricCard} onClose={() => setLyricCard(null)} />
      <div
        ref={lyricsContainerRef}
        className={`overflow-y-auto w-full py-4 no-scrollbar space-y-5 px-2 animate-in fade-in duration-200 select-text ${className}`}
        style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
        onTouchStart={pauseFollowForManualScroll}
        onWheel={pauseFollowForManualScroll}
      >
        <div className="flex flex-wrap items-center justify-center gap-2 pb-1">
          <p className="text-center text-xs text-app-secondary tracking-wide uppercase">
            {syncedLyrics.length > 0 ? tr("Synced Lyrics") : tr("Lyrics")}
          </p>
          {!lyricsLoading && syncedLyrics.length > 0 && (
            <button
              onClick={toggleFollowLyrics}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-semibold ${
                followLyrics ? 'border-transparent' : 'bg-app-card border-app-theme text-app-secondary'
              }`}
              // On: inverted colours (readable in every theme).
              style={followLyrics ? { background: 'var(--text-primary)', color: 'var(--bg-primary)' } : undefined}
              title={followLyrics ? 'Stop following the lyrics' : 'Follow the lyrics as they play'}
              aria-pressed={followLyrics}
            >
              <LocateFixed className="w-3.5 h-3.5" /> {tr("Follow")}
            </button>
          )}
          {!lyricsLoading && syncedLyrics.length > 0 && (
            <div
              className="flex items-center rounded-full bg-app-card border border-app-theme text-xs font-semibold text-app-primary"
              title={tr("Lyrics early or late? Nudge them for this song")}
            >
              <button
                onClick={() => nudgeLyrics(-0.5)}
                className="px-2.5 py-1"
                aria-label={tr("Show lyrics earlier")}
              >
                −
              </button>
              <span className="min-w-[3.2rem] text-center tabular-nums text-app-secondary">
                {lyricOffset === 0 ? tr("Timing") : `${lyricOffset > 0 ? '+' : ''}${lyricOffset.toFixed(1)}s`}
              </span>
              <button
                onClick={() => nudgeLyrics(0.5)}
                className="px-2.5 py-1"
                aria-label={tr("Show lyrics later")}
              >
                +
              </button>
            </div>
          )}
          {!lyricsLoading && (syncedLyrics.length > 0 || rawLyrics) && (
            <button
              onClick={copyLyrics}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-app-card border border-app-theme text-xs font-semibold text-app-primary"
              title={tr("Copy all lyrics")}
            >
              {lyricsCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {lyricsCopied ? tr("Copied") : tr("Copy")}
            </button>
          )}
          {!lyricsLoading && (syncedLyrics.length > 0 || rawLyrics) && (
            <button
              onClick={shareLyric}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-app-card border border-app-theme text-xs font-semibold text-app-primary"
              title={tr("Share a lyric card")}
            >
              <Share2 className="w-3.5 h-3.5" /> {tr("Share")}
            </button>
          )}
        </div>

        {lyricsLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-app-primary" />
            <p className="text-app-secondary text-sm">{tr("Fetching lyrics...")}</p>
          </div>
        ) : syncedLyrics.length > 0 ? (
          syncedLyrics.map((line, idx) => {
            const isActive = idx === activeLyricIndex;
            // Karaoke: the line that is being sung fills in with the accent
            // colour from left to right (the fill eases between progress ticks).
            const fill = isActive ? lineProgress(line, syncedLyrics[idx + 1], lyricTime + 0.25) : 0;
            return (
              <p
                key={`lyric-${idx}`}
                ref={isActive ? activeLyricRef : null}
                onClick={() => {
                  seekTo(Math.max(0, line.time + lyricOffset));
                  // Jumping to a line means "carry on from here".
                  if (followLyrics) resumeFollow();
                }}
                className={`text-center transition-all duration-300 cursor-pointer select-text leading-relaxed ${
                  isActive
                    ? 'font-extrabold text-xl md:text-2xl scale-105'
                    : idx < activeLyricIndex
                      ? 'text-app-primary text-base opacity-50 hover:opacity-80'
                      : 'text-app-secondary text-base opacity-40 hover:opacity-80 hover:scale-100'
                }`}
              >
                {isActive ? (
                  <span
                    className="karaoke-line"
                    style={{ backgroundSize: `${Math.round(fill * 1000) / 10}% 100%, 100% 100%` }}
                  >
                    {line.text}
                  </span>
                ) : (
                  line.text
                )}
              </p>
            );
          }).concat(
            followLyrics && followPaused ? (
              <div key="lyrics-resume" className="sticky bottom-2 flex justify-center pointer-events-none">
                <button
                  onClick={resumeFollow}
                  className="pointer-events-auto flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold shadow-lg"
                  style={{ background: 'var(--text-primary)', color: 'var(--bg-primary)' }}
                >
                  <LocateFixed className="w-3.5 h-3.5" /> {tr("Back to current line")}
                </button>
              </div>
            ) : (
              []
            )
          )
        ) : rawLyrics ? (
          <div className="space-y-3 py-2 px-2">
            {rawLyrics.split('\n').map((line, idx) => (
              <p
                key={`plain-lyric-${idx}`}
                className="text-center text-base font-semibold text-app-primary leading-relaxed"
              >
                {line}
              </p>
            ))}
          </div>
        ) : (
          <div className="text-center text-app-secondary text-sm py-16">
            {tr("No lyrics found for this song")}
          </div>
        )}
      </div>
    </>
  );
};
