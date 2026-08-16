import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.frf.music',
  appName: 'FRFMusic',
  webDir: 'dist',
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
  ios: {
    allowsLinkPreview: false,
    scrollEnabled: true,
    webContentsDebuggingEnabled: true,
    appendUserAgent: 'Safari/605.1.15',
  },
  server: {
    // CRITICAL: Must be 'https' so YouTube IFrame API sees an https:// origin
    // and allows media playback. 'capacitor' scheme gets blocked by YouTube.
    iosScheme: 'https',
    allowNavigation: ['*'],
  },
};

export default config;
