import { useState } from 'react';
import { Cast } from 'lucide-react';
import { t as tr } from '../i18n';
import { useAudio } from '../context/AudioContext';
import { CastModal } from './CastModal';

/** Opens the TV picker; lit up while the music plays on a TV. */
export function CastButton({ className = '', iconClassName = 'w-5 h-5' }: { className?: string; iconClassName?: string }) {
  const { castAvailable, castDevice } = useAudio();
  const [open, setOpen] = useState(false);
  if (!castAvailable) return null;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`${className} ${castDevice ? '!text-app-primary' : ''}`}
        title={castDevice ? tr('Playing on {name}', { name: castDevice.name }) : tr('Play on TV')}
      >
        <Cast className={`${iconClassName} ${castDevice ? 'drop-shadow-[0_0_6px_var(--bg-highlight)]' : ''}`} />
      </button>
      <CastModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** "Playing on Living Room TV", shown while casting. */
export function CastingLabel({ className = '' }: { className?: string }) {
  const { castDevice } = useAudio();
  if (!castDevice) return null;
  return (
    <div className={`flex items-center justify-center gap-1.5 text-xs font-semibold text-app-primary ${className}`}>
      <Cast className="w-3.5 h-3.5" />
      <span className="truncate">{tr('Playing on {name}', { name: castDevice.name })}</span>
    </div>
  );
}
