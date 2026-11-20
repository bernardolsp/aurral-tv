module.exports = {
  name: 'Aurral TV',
  slug: 'aurral-tv',
  version: '0.4.1',
  platforms: ['android'],
  orientation: 'landscape',
  icon: './assets/icon.png',
  android: { package: 'com.aurral.tv', versionCode: 6, allowBackup: false },
  plugins: [
    ['@react-native-tvos/config-tv', { isTV: true, androidTVBanner: './assets/banner.png', androidTVIcon: './assets/icon.png' }],
    ['expo-build-properties', { android: { usesCleartextTraffic: true, minSdkVersion: 28 } }],
    'expo-secure-store',

  ],
};
