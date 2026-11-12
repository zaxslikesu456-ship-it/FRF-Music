// Synced lyrics: LRC parsing (line times, and word times when the lyrics have
// them) and how far the karaoke fill has got through the line being sung.

export interface SyncedLine {
  time: number;
  text: string;
  /** Word start times, when the lyrics have them ("enhanced" LRC: <mm:ss.xx>word). */
  words?: { time: number; text: string }[];
  /** When the last word ends (a closing word tag with no text after it). */
  end?: number;
}

const WORD_TAG = /<(\d{2}):(\d{2})(?:\.(\d{2,3}))?>/g;
const toSeconds = (m: string, s: string, frac?: string) =>
  parseInt(m, 10) * 60 + parseInt(s, 10) + parseInt((frac || '0').padEnd(3, '0').slice(0, 3), 10) / 1000;

/**
 * How far the karaoke fill has got through a line (0..1). With word timings it
 * follows them; otherwise the line fills over its own length (until the next
 * line, but not slower than a natural singing pace, so long gaps don't stall it).
 */
/** When word i of a line ends: the next word's start, else the line's own end. */
export function wordEnd(line: SyncedLine, i: number, next: SyncedLine | undefined): number {
  const w = line.words![i];
  return line.words![i + 1]?.time ?? line.end ?? next?.time ?? w.time + 0.6;
}

/** How far one word has been sung (0..1). */
export function wordProgress(line: SyncedLine, i: number, next: SyncedLine | undefined, now: number): number {
  const w = line.words![i];
  if (now <= w.time) return 0;
  const end = wordEnd(line, i, next);
  return Math.min(1, (now - w.time) / Math.max(0.05, end - w.time));
}

export function lineProgress(line: SyncedLine, next: SyncedLine | undefined, now: number): number {
  if (now <= line.time) return 0;
  if (line.words && line.words.length > 0) {
    const total = line.words.reduce((n, w) => n + w.text.length, 0) || 1;
    let done = 0;
    for (let i = 0; i < line.words.length; i++) {
      const w = line.words[i];
      const end = wordEnd(line, i, next);
      if (now >= end) {
        done += w.text.length;
        continue;
      }
      if (now > w.time) done += w.text.length * Math.min(1, (now - w.time) / Math.max(0.05, end - w.time));
      break;
    }
    return Math.min(1, done / total);
  }
  // No word times: the line is sung over most of the time until the next one,
  // at about 3 to 4 words a second (long gaps are music, not slow singing).
  const gap = (next?.time ?? line.time + 5) - line.time;
  const words = line.text.split(/\s+/).length;
  const pace = Math.max(1.2, words * 0.3 + 0.6);
  return Math.min(1, (now - line.time) / Math.max(0.4, Math.min(gap * 0.9, pace)));
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
      let end: number | undefined;
      if (rest.includes('<')) {
        const parts = rest.split(WORD_TAG);
        // split() with 3 groups yields: text, m, s, frac, text, m, s, frac, ...
        for (let i = 1; i + 3 < parts.length + 1; i += 4) {
          const at = toSeconds(parts[i], parts[i + 1], parts[i + 2]);
          // Keep the spacing as written ("love, maybe" is not "love , maybe").
          const wText = parts[i + 3] || '';
          if (wText.trim()) words.push({ time: at, text: wText });
          else if (i + 4 >= parts.length) end = at; // a closing tag: the line ends here
          else if (wText && words.length > 0) words[words.length - 1].text += wText;
        }
      }
      const text = rest.replace(WORD_TAG, '').replace(/\s+/g, ' ').trim();
      if (text) {
        result.push(words.length > 0 ? { time, text, words, ...(end !== undefined ? { end } : {}) } : { time, text });
      }
    }
  }
  return result.sort((a, b) => a.time - b.time);
};
