# Changelog

## [0.9.0] - {PR_MERGE_DATE}

- Self-contained dist (vendored serve-sim and ws), reproducible build (`npm run build`, verified with
  the catalog's verify-dist), and a launcher that finds Node outside Ghostex's PATH.
- One stream per device, shared by every viewer (second pane, remote viewer, Bench).
- The stream follows the pane size; without an H.264 decoder it falls back to MJPEG (iOS) or raw
  gRPC frames (emulators).
- Input methods (Japanese, Chinese, emoji picker, dictation) through a hidden textarea; non-ASCII
  text on Android is pasted.
- Cmd+A/C/X/Z reach the device; device copies land on the Mac clipboard.
- Option+drag pinches with two fingers on Android and iOS.
- iOS: Home is a bottom-edge swipe (also leaves the App Switcher); the app's orientation is
  rechecked every 2 s in landscape; wheel scrolling follows landscape.
- Android phones with auto-rotate on can be rotated (the next orientation is locked).
- Agent CLI: tap and swipe use the current rotation on Android 10+.

## [0.8.0] - {PR_MERGE_DATE}

- Device frame around the screen for every device (iPhone, iPad and Android profiles: bezel,
  rounded screen corners, side buttons), sized with container queries and turned for landscape.
  The **Frame** button switches it off; the choice is remembered.
- iOS: a portrait-only app in device landscape is no longer drawn sideways (the app's window
  orientation is read from the accessibility tree after a rotation).

## [0.7.0] - {PR_MERGE_DATE}

- Agent CLI (`dist/agent-cli.mjs`): devices, screenshot, ui (on-screen elements with 0..1
  centers), tap, swipe, type, key, install, launch, for Android and iOS Simulator.
- Ships the `mobile-pane` agent skill that teaches coding agents to use it.

## [0.6.0] - {PR_MERGE_DATE}

- Android emulators started from the Devices panel enable gRPC (token auth); their video then comes
  straight from the emulator's `streamScreenshot` as raw RGBA (about 56 fps instead of about 40),
  with input still through scrcpy (control only). `?transport=scrcpy` forces the H.264 path;
  phones always use it.
- The gRPC stream follows rotation.

## [0.5.0] - {PR_MERGE_DATE}

- Bench button: opens a black/white touch-test page on the device, taps it 20 times and
  reports input → pixel latency (p50/p95), split into device side and viewer side.
  Results are also saved to `$GHOSTEX_EXTENSION_DATA_DIR/bench.json`.

## [0.4.0] - {PR_MERGE_DATE}

- iOS Simulators: list, boot headless and shut down from the Devices panel; mirror and
  control them (tap, drag, scroll, keyboard, paste, Home, App Switcher, rotate) through
  serve-sim 0.1.49.
- iOS H.264 is converted from avcC to Annex-B on the server: Ghostex's CEF only decodes Annex-B.
- iOS landscape is drawn upright and touches are mapped back to the portrait frame.
- The Emulators panel is now Devices and lists Android emulators and iOS Simulators.

## [0.3.0] - {PR_MERGE_DATE}

- Emulators panel: list AVDs, start one headless (Quick Boot) or stop it; the screen
  appears by itself once it has booted. Opens on its own when no device is connected.
- POST requests, like WebSockets, only accept the extension's own page as origin.

## [0.2.0] - {PR_MERGE_DATE}

- Control the device: tap and drag, mouse wheel/trackpad scroll, typing, special keys,
  Ctrl+letter shortcuts, Cmd+V paste, right click = Back.
- Back, Home, Recents and Rotate buttons (emulators rotate their virtual sensor).
- WebSockets only accept the extension's own page as origin; the server forwards only
  known control message types.
- The mirror always fits the pane (object-fit: contain).

## [0.1.0] - {PR_MERGE_DATE}

- Mirror Android devices and emulators (view only) with bundled scrcpy-server v5.0.1.
- Decode and paint in a Worker on an OffscreenCanvas; skip to a fresh keyframe when behind.
- Pause decoding while the view is hidden.
- Fase 0 probe moved to /probe.html.

## [0.0.2] - {PR_MERGE_DATE}

- Probe waits until the view is visible; compares hardware and software H.264 decode.

## [0.0.1] - {PR_MERGE_DATE}

- Fase 0 capability probe.
