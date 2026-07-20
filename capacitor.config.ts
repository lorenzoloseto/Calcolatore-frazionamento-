import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lorenzoloseto.frazio',
  appName: 'Conto economico',
  webDir: 'dist',
  server: {
    iosScheme: 'capacitor',
  },
  ios: {
    contentInset: 'never',
    allowsLinkPreview: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 2000,
      backgroundColor: '#0D2240',
      showSpinner: false,
    },
  },
};

export default config;
