# Aurral TV

A remote-controlled Android TV player for Aurral. Browse saved playlists and Flows, select a downloaded song, and use the remote to pause or skip. Android's media session keeps playing when you return to the TV home screen.

## Pair a TV

Open **Pair with Pocket** on the TV. Scan the QR code with your phone, compare the short code shown on both screens, and confirm in a Pocket build that supports TV setup. Both devices must be on the same local network. Pocket passes your server address, custom proxy headers, and a one-time pairing code. The TV exchanges the code for its own session and stores its connection in Android secure storage.

For manual setup, choose **Enter server and pairing code**. Enter your Aurral server URL and a code generated in **Settings → Profile → Pair a device**. Servers behind a proxy requiring custom headers need Pocket setup. The TV streams completed playlist tracks in order. Choose **Disconnect** to remove the saved TV connection.

## Play from Pocket

Keep Aurral TV open and connect both devices to the same local network. If the TV was paired before Pocket remote support was available, choose **Pair Pocket remote** on the TV and confirm the new QR code in Pocket using the same Aurral account. In Pocket, open Now Playing, a playlist or a Flow and choose **Play on TV**. Transferring the current song includes its position and up to 100 playable queue items. The phone can pause, resume and skip. Pair again if the TV's LAN address changes.

Now Playing shows album art and the next songs in play order. Press Down from Play/Pause to select an upcoming track. The TV requests MP3 at 320 kbps from servers that support transcoding. Known MP3 sources at or below 320 kbps keep their existing encoding.

## Build and install

Use Node.js 24 or newer, the Android SDK, and a JDK compatible with the Expo SDK 58 Android toolchain. On an Android TV with developer mode and ADB enabled:

```sh
npm ci --legacy-peer-deps
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

The prebuilt Android project uses a development signing key for local sideloading. Configure your own signing key for distribution. The application ID is `com.aurral.tv`.

The interface, pairing flow, API client, and session storage use TypeScript, Expo, and React Native TV. Two Android Expo modules provide the LAN pairing listener and background playback. API calls and the streaming data source attach proxy headers only to the configured server and decline redirects.

## Checks

```sh
npm run typecheck
npm test
```

For emulator integration testing, `python3 tests/server-fixture.py --port 48645` runs a loopback-only fixture. Use `adb reverse tcp:48645 tcp:48645` so the test TV can reach it. It requires the synthetic proxy headers `X-Aurral-Test-ID: tv-demo` and `X-Aurral-Test-Secret: fixture-only`. A mock phone bearing `fixture-mobile` can request a one-time code at `POST /api/auth/pairing-codes`. The fixture serves a silent audio sample, artwork, and two collections. Run it only for testing.

The Aurral logo comes from [Aurral Pocket](https://github.com/bernardolsp/aurral-pocket). See [LICENSE](LICENSE) for attribution.
