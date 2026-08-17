import { Capacitor } from '@capacitor/core';

// Hosted HTTPS twin of the in-app IFrame player. iOS WKWebView runs the app on
// a capacitor:// origin, which sends YouTube no HTTPS Referer, so videos with
// embed restrictions fail with error 150. This page lives on GitHub Pages, so
// YouTube sees a normal HTTPS referer and playback matches Android/PC.
export const YT_BRIDGE_URL =
  'https://zaxslikesu456-ship-it.github.io/FRF-Music/yt-bridge.html';

const BRIDGE_ORIGIN = new URL(YT_BRIDGE_URL).origin;
const READY_TIMEOUT_MS = 8000;

export interface YtSharedEvents {
  onReady?: () => void;
  onStateChange?: (event: { data: number }) => void;
  onError?: (event: { data: number }) => void;
}

export function shouldUseYtBridge(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

// Creates an iframe-backed player exposing the same small surface of the
// YouTube IFrame Player API that the app uses (loadVideoById, playVideo,
// pauseVideo, stopVideo, seekTo, setVolume, unMute, mute, setPlaybackRate,
// getCurrentTime, getDuration). Commands and events travel over postMessage.
// onGiveUp fires once if the bridge page never reports ready, so the caller
// can fall back to the inline player.
export function createYtBridgePlayer(
  elementId: string,
  events: YtSharedEvents,
  onGiveUp: () => void
): any | null {
  const host = document.getElementById(elementId);
  if (!host) return null;

  const iframe = document.createElement('iframe');
  iframe.id = elementId;
  iframe.src = YT_BRIDGE_URL;
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('tabindex', '-1');
  // Keep the same DOM contract as YT.Player: the replacement element carries
  // the host id and the host's parked style, so NowPlayingScreen keeps working.
  iframe.style.cssText = host.style.cssText;
  iframe.style.border = '0';
  host.replaceWith(iframe);

  let ready = false;
  let gaveUp = false;
  let lastTime = 0;
  let lastDuration = 0;

  const cleanup = () => {
    window.removeEventListener('message', onMessage);
    iframe.remove();
  };

  const giveUpTimer = window.setTimeout(() => {
    if (ready || gaveUp) return;
    gaveUp = true;
    cleanup();
    onGiveUp();
  }, READY_TIMEOUT_MS);

  function onMessage(e: MessageEvent) {
    if (e.origin !== BRIDGE_ORIGIN) return;
    const d = e.data;
    if (!d || d.source !== 'frf-yt-bridge') return;
    if (d.event === 'ready') {
      ready = true;
      window.clearTimeout(giveUpTimer);
      events.onReady?.();
    } else if (d.event === 'state') {
      events.onStateChange?.({ data: Number(d.data) });
    } else if (d.event === 'error') {
      events.onError?.({ data: Number(d.data) });
    } else if (d.event === 'time') {
      if (typeof d.currentTime === 'number') lastTime = d.currentTime;
      if (typeof d.duration === 'number') lastDuration = d.duration;
    }
  }

  window.addEventListener('message', onMessage);

  const post = (cmd: string, params: Record<string, unknown> = {}) => {
    try {
      iframe.contentWindow?.postMessage({ source: 'frf-app', cmd, ...params }, BRIDGE_ORIGIN);
    } catch {
      // iframe not attached anymore
    }
  };

  return {
    loadVideoById: (arg: any) => {
      if (typeof arg === 'string') {
        post('loadVideoById', { videoId: arg, startSeconds: 0 });
      } else if (arg && typeof arg === 'object') {
        post('loadVideoById', { videoId: arg.videoId, startSeconds: arg.startSeconds || 0 });
      }
    },
    cueVideoById: (arg: any) => {
      if (typeof arg === 'string') {
        post('cueVideoById', { videoId: arg, startSeconds: 0 });
      } else if (arg && typeof arg === 'object') {
        post('cueVideoById', { videoId: arg.videoId, startSeconds: arg.startSeconds || 0 });
      }
    },
    playVideo: () => post('playVideo'),
    pauseVideo: () => post('pauseVideo'),
    stopVideo: () => post('stopVideo'),
    seekTo: (seconds: number, allowSeekAhead?: boolean) => {
      lastTime = seconds;
      post('seekTo', { seconds, allowSeekAhead: Boolean(allowSeekAhead) });
    },
    setVolume: (volume: number) => post('setVolume', { volume }),
    unMute: () => post('unMute'),
    mute: () => post('mute'),
    setPlaybackRate: (rate: number) => post('setPlaybackRate', { rate }),
    getCurrentTime: () => lastTime,
    getDuration: () => lastDuration,
    getIframe: () => iframe,
    destroy: cleanup,
  };
}
