import { createPortal } from 'react-dom';
import React, { useMemo } from 'react';
import { X, BarChart3, Flame, Clock } from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import { computeStats, formatDuration } from '../utils/listening';

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="p-3 rounded-2xl bg-app-card border border-app-theme">
    <p className="text-xs text-app-secondary">{label}</p>
    <p className="text-lg font-bold text-app-primary mt-0.5">{value}</p>
  </div>
);

export const ListeningStatsModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const { mostPlayed } = useAudio();
  // Recomputed each time the screen opens.
  const stats = useMemo(() => (isOpen ? computeStats() : null), [isOpen]);
  if (!isOpen || !stats) return null;

  const maxDay = Math.max(1, ...stats.last14.map(d => d.seconds));
  const maxArtist = Math.max(1, ...stats.topArtists.map(a => a.seconds));

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center">
      <div className="w-full max-w-lg bg-app-surface border border-app-theme rounded-t-3xl sm:rounded-3xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-app-theme">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-app-card border border-app-theme text-app-primary">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-app-primary">Listening stats</h2>
              <p className="text-xs text-app-secondary">Kept on this device only</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-app-secondary rounded-full" title="Close">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {!stats.hasData ? (
            <p className="text-sm text-app-secondary text-center py-10 leading-relaxed">
              Nothing here yet. Play some music and your minutes, top artists and streaks will show
              up.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Today" value={formatDuration(stats.todaySeconds)} />
                <Stat label="This week" value={formatDuration(stats.weekSeconds)} />
                <Stat label="Last 30 days" value={formatDuration(stats.monthSeconds)} />
                <Stat label="All time" value={formatDuration(stats.totalSeconds)} />
              </div>

              <div className="p-4 rounded-2xl bg-app-card border border-app-theme flex items-center gap-4">
                <Flame className="w-8 h-8 text-orange-400 shrink-0" />
                <div className="flex-1">
                  <p className="text-lg font-bold text-app-primary">
                    {stats.currentStreak} day{stats.currentStreak === 1 ? '' : 's'} in a row
                  </p>
                  <p className="text-xs text-app-secondary">Longest streak: {stats.longestStreak}</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-app-secondary tracking-wider mb-2 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> LAST 14 DAYS
                </p>
                <div className="flex items-end gap-1.5 h-24 p-3 rounded-2xl bg-app-card border border-app-theme">
                  {stats.last14.map(d => (
                    <div key={d.key} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
                      <div
                        className="w-full rounded-t bg-app-highlight min-h-[2px]"
                        style={{ height: `${Math.max(3, (d.seconds / maxDay) * 100)}%`, opacity: d.seconds ? 1 : 0.25 }}
                        title={`${d.key}: ${formatDuration(d.seconds)}`}
                      />
                      <span className="text-[9px] text-app-secondary leading-none">{d.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {stats.topArtists.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-app-secondary tracking-wider mb-2">TOP ARTISTS</p>
                  <div className="space-y-2">
                    {stats.topArtists.map((a, i) => (
                      <div key={a.name} className="p-3 rounded-2xl bg-app-card border border-app-theme">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-app-secondary w-5">{i + 1}</span>
                          <p className="text-sm font-semibold text-app-primary flex-1 truncate">{a.name}</p>
                          <span className="text-xs text-app-secondary">{formatDuration(a.seconds)}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-app-surface mt-2 overflow-hidden">
                          <div
                            className="h-full bg-app-highlight"
                            style={{ width: `${(a.seconds / maxArtist) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {mostPlayed.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-app-secondary tracking-wider mb-2">TOP SONGS</p>
                  <div className="rounded-2xl bg-app-card border border-app-theme divide-y divide-white/5">
                    {mostPlayed.slice(0, 8).map(({ track, count }, i) => (
                      <div key={track.id} className="flex items-center gap-3 px-3 py-2">
                        <span className="text-sm font-bold text-app-secondary w-5">{i + 1}</span>
                        <img src={track.coverUrl} alt="" className="w-9 h-9 rounded-lg object-cover" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-app-primary truncate">{track.title}</p>
                          <p className="text-xs text-app-secondary truncate">{track.artist}</p>
                        </div>
                        <span className="text-xs text-app-secondary">{count}x</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
