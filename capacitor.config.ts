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
  server: {
    iosScheme: 'capacitor',
    allowNavigation: [
      'https://music.youtube.com',
      'https://www.youtube.com',
      'https://*.googlevideo.com',
      'https://*.invidious.*',
      'https://*.piped.*',
      'https://*.cobalt.tools',
      'https://*.wuk.sh',
      'https://*.kavin.rocks',
      'https://*.nadeko.net',
      'https://*.private.coffee'
    ]
  }
};

export default config;
