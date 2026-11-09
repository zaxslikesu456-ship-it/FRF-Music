import { Capacitor, registerPlugin } from '@capacitor/core';

// Opens links outside the app. On the Android app, a YouTube link opens in the
// YouTube app (see openYouTube in BackgroundAudioPlugin.java).

interface OpenExternalPlugin {
  openYouTube(options: { url: string }): Promise<void>;
}

const IS_ANDROID = Capacitor.getPlatform() === 'android';
const OpenExternal = IS_ANDROID ? registerPlugin<OpenExternalPlugin>('BackgroundAudio') : null;

/** True where YouTube links open in the YouTube app (the Android app). */
export const OPENS_YOUTUBE_APP = IS_ANDROID;

/**
 * Opens a YouTube link in the YouTube app, or in the phone's browser if YouTube is
 * not installed. Resolves false if the phone could not open it at all.
 */
export async function openYouTubeApp(url: string): Promise<boolean> {
  if (!OpenExternal) return false;
  try {
    await OpenExternal.openYouTube({ url });
    return true;
  } catch {
    return false;
  }
}
