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
  },
  server: {
    iosScheme: 'capacitor',
    allowNavigation: [
      '*',
      'https://*.youtube.com',
      'https://*.youtube-nocookie.com',
      'https://*.googlevideo.com',
      'https://*.invidious.*',
      'https://*.piped.*',
      'https://*.cobalt.tools'
    ]
  }
};

export default config;
