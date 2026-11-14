import React from 'react';
import { useAudio } from '../context/AudioContext';
import { sizedCover } from '../utils/cover';

/**
 * What the Liquid Glass look shows through its glass: the song's cover, huge and
 * blurred, with slowly drifting light in the cover's colours, under a dark veil
 * so white text stays readable. Without a song it is just the drifting light.
 * Mounted behind everything in the phone and PC frames, only while the look is on.
 */
export const LiquidGlassBackdrop: React.FC = () => {
  const { settings, currentTrack, artColors } = useAudio();
  if (!settings.liquidGlass) return null;

  const cover = currentTrack?.coverUrl ? sizedCover(currentTrack.coverUrl, 360) : '';
  const [r, g, b] = artColors?.rgb || [120, 120, 255];
  const accent = artColors?.accent || '#7c8cff';

  return (
    <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none" aria-hidden>
      {cover && (
        <img
          key={cover}
          src={cover}
          alt=""
          data-no-resize="1"
          className="absolute inset-0 w-full h-full object-cover scale-150 blur-[70px] saturate-[1.6] opacity-70 anim-fade"
        />
      )}
      <div
        className="lg-blob pause-when-hidden"
        style={{ background: `radial-gradient(circle, rgba(${r},${g},${b},0.75), transparent 65%)`, top: '-20%', left: '-15%' }}
      />
      <div
        className="lg-blob lg-blob-2 pause-when-hidden"
        style={{ background: `radial-gradient(circle, ${accent}99, transparent 65%)`, bottom: '-25%', right: '-20%' }}
      />
      <div className="absolute inset-0 bg-black/45" />
    </div>
  );
};
