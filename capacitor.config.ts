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
    // WKWebView cannot register http/https as a custom scheme, so Capacitor
    // falls back to its native scheme on iOS. YouTube receives the bundle ID
    // separately through the IFrame Player's origin parameter.
    iosScheme: 'capacitor',
    androidScheme: 'https',
    allowNavigation: ['*'],
  },
};

export default config;
