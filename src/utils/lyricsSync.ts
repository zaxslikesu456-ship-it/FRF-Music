// Synced lyrics: LRC parsing (line times, and word times when the lyrics have
// them) and how far the karaoke fill has got through the line being sung.

export interface SyncedLine {
  time: number;
  text: string;
  /** Word start times, when the lyrics have them ("enhanced" LRC: <mm:ss.xx>word). */
  words?: { time: number; text: string }[];
}

const WORD_TAG = /<(\d{2}):(\d{2})(?:\.(\d{2,3}))?>/g;
const toSeconds = (m: string, s: string, frac?: string) =>
  parseInt(m, 10) * 60 + parseInt(s, 10) + parseInt((frac || '0').padEnd(3, '0').slice(0, 3), 10) / 1000;

/**
 * How far the karaoke fill has got through a line (0..1). With word timings it
 * follows them; otherwise the line fills over its own length (until the next
 * line, but not slower than a natural singing pace, so long gaps don't stall it).
 */
export function lineProgress(line: SyncedLine, next: SyncedLine | undefined, now: number): number {
  if (now <= line.time) return 0;
  if (line.words && line.words.length > 0) {
    const total = line.words.reduce((n, w) => n + w.text.length, 0) || 1;
    let done = 0;
    for (let i = 0; i < line.words.length; i++) {
      const w = line.words[i];
      const end = line.words[i + 1]?.time ?? next?.time ?? w.time + 0.6;
      if (now >= end) {
        done += w.text.length;
        continue;
      }
      if (now > w.time) done += w.text.length * Math.min(1, (now - w.time) / Math.max(0.05, end - w.time));
      break;
    }
    return Math.min(1, done / total);
  }
  const gap = (next?.time ?? line.time + 5) - line.time;
  const words = line.text.split(/\s+/).length;
  const pace = Math.max(1.2, words * 0.34 + 0.5);
  return Math.min(1, (now - line.time) / Math.min(gap, pace));
}

export const parseLrc = (lrcString: string): SyncedLine[] => {
  if (!lrcString) return [];
  const lines = lrcString.split('\n');
  const result: SyncedLine[] = [];
  const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/;

  for (const line of lines) {
    const match = timeRegex.exec(line);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const msStr = match[3] || '0';
      const ms = parseInt(msStr.padEnd(3, '0').slice(0, 3), 10);
      const time = min * 60 + sec + ms / 1000;
      const rest = line.replace(timeRegex, '');
      const words: { time: number; text: string }[] = [];
      if (rest.includes('<')) {
        const parts = rest.split(WORD_TAG);
        // split() with 3 groups yields: text, m, s, frac, text, m, s, frac, ...
        for (let i = 1; i + 3 < parts.length + 1; i += 4) {
          const wText = (parts[i + 3] || '').trim();
          if (wText) words.push({ time: toSeconds(parts[i], parts[i + 1], parts[i + 2]), text: wText });
        }
      }
      const text = rest.replace(WORD_TAG, '').replace(/\s+/g, ' ').trim();
      if (text) {
        result.push(words.length > 0 ? { time, text, words } : { time, text });
      }
    }
  }
  return result.sort((a, b) => a.time - b.time);
};
