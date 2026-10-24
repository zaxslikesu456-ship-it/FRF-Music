import { createPortal } from 'react-dom';
import React, { useEffect, useState } from 'react';
import { X, Share2, Download, Copy } from 'lucide-react';
import { renderLyricCard, type LyricCardInput } from '../utils/lyricCard';
import { copyText } from '../utils/clipboard';

export const LyricCardModal: React.FC<{
  input: LyricCardInput | null;
  onClose: () => void;
}> = ({ input, onClose }) => {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!input) return;
    let live = true;
    let made = '';
    setBusy(true);
    setNote('');
    setBlob(null);
    setUrl('');
    void renderLyricCard(input).then(b => {
      if (!live) return;
      setBusy(false);
      if (!b) {
        setNote('Could not draw the card. You can still copy the lyric text.');
        return;
      }
      made = URL.createObjectURL(b);
      setBlob(b);
      setUrl(made);
    });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [input]);

  if (!input) return null;
  const text = `"${input.line}"\n${input.title} - ${input.artist}`;
  const fileName = `${input.title.replace(/[^\w]+/g, '-').slice(0, 40) || 'lyric'}-lyric.png`;

  const share = async () => {
    try {
      if (blob && navigator.canShare) {
        const file = new File([blob], fileName, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], text });
          return;
        }
      }
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
    }
    setNote('Sharing is not available here. Use Save image or Copy text.');
  };

  const save = () => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setNote('Image saved to your downloads.');
  };

  const copy = async () => setNote((await copyText(text)) ? 'Lyric copied.' : 'Could not copy.');

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/85 backdrop-blur-md flex items-end sm:items-center justify-center">
      <div className="w-full max-w-md bg-app-surface border border-app-theme rounded-t-3xl sm:rounded-3xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-lg font-bold text-app-primary">Share this lyric</h2>
          <button onClick={onClose} className="p-2 text-app-secondary rounded-full" title="Close">
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-3">
          {busy ? (
            <div className="aspect-[4/5] rounded-2xl bg-app-card animate-pulse" />
          ) : url ? (
            <img src={url} alt="Lyric card" className="w-full rounded-2xl border border-app-theme" />
          ) : null}
          {note && <p className="text-sm text-app-secondary text-center mt-3">{note}</p>}
        </div>
        <div className="p-4 border-t border-app-theme flex gap-2">
          <button
            onClick={() => void share()}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-app-highlight text-app-inverse font-bold text-sm"
          >
            <Share2 className="w-4 h-4" /> Share
          </button>
          <button
            onClick={save}
            disabled={!url}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-app-card border border-app-theme text-app-primary font-semibold text-sm disabled:opacity-40"
          >
            <Download className="w-4 h-4" /> Save
          </button>
          <button
            onClick={() => void copy()}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-app-card border border-app-theme text-app-primary font-semibold text-sm"
          >
            <Copy className="w-4 h-4" /> Copy
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
