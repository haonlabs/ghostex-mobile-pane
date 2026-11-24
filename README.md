# Mobile Pane

Ghostex view extension to mirror and control Android devices, Android emulators and
iOS Simulators. See [PLAN.md](PLAN.md) for the roadmap.

**Current state: Fase 4, Android and iOS Simulator mirroring, input, and start/stop.** Pick a device in the toolbar;
the HUD shows fps, server→paint latency (p50/p95) and bitrate.

| Do | How |
|---|---|
| Tap / drag | Click / drag on the screen |
| Scroll | Mouse wheel or trackpad |
| Type | Click the screen, then type; Enter, Backspace, arrows, Tab, Esc work |
| Paste | Cmd+V (puts the text on the device clipboard and pastes it) |
| Back (Android) | Right click, or ◁ |
| Home / Recents / Rotate | ○ / ▢ / ⟳ |
| Device frame | **Frame** toggles our bezel. Streams never include an emulator skin or Simulator.app bezel (emulators run without a window and only the screen is captured), so every device gets the same style of frame: iPhone, iPad or Android. |
| Measure latency | **Bench**: opens a test page on the device (Chrome on Android via `adb reverse`, Safari on iOS) and taps it 20 times; the status line shows input → screen p50/p95. On a fresh emulator, dismiss Chrome's first-run screens once. |
| Start / stop an emulator or simulator | **Devices** in the toolbar. Emulators run without a window (`-no-window`) and keep running after the view closes; stop them from the same list. Their output goes to `$GHOSTEX_EXTENSION_DATA_DIR/emulator-<avd>.log`. |
The Fase 0 capability probe is still at `/probe.html`.

## For coding agents

The bundled `mobile-pane` skill tells agents how to use the CLI. It runs in the agent's own
process, so the view does not need to be open:

    node ~/.local/share/ghostex/extensions/installed/mobile-pane-plugin/dist/agent-cli.mjs help
    … screenshot '{"device":"iPhone 17"}'
    … ui '{"device":"emulator-5554"}'
    … tap '{"device":"emulator-5554","x":0.36,"y":0.26}'

Screenshots go to `~/.local/share/ghostex/extensions/data/mobile-pane-plugin/screenshots/`.
`ghostex extensions message` is not used: Ghostex only delivers it to sidebar extensions.

## Files

- `src/server.mjs`: HTTP + WebSocket server (`/devices`, `/video`, `/stats`, probe endpoints).
- `src/android.mjs`: adb discovery and the scrcpy-server v5.0.1 session.
  `node src/android.mjs [serial]` is a smoke check against a running device.
- `src/ws.mjs`: minimal WebSocket server.
- `src/public/index.html`, `src/public/viewer-worker.js`: the viewer.
- `src/agent-actions.mjs`, `src/agent-cli.mjs`: the agent actions and their CLI; `skill/SKILL.md`: the agent skill.
- `src/emulator-grpc.mjs`: emulator gRPC video (discovery file, minimal protobuf over `node:http2`).
- `src/ios.mjs`: simctl list/boot/shutdown, the serve-sim helper, avcC → Annex-B relay.
  `node src/ios.mjs` self-checks the Annex-B conversion.
- `src/public/control.js`: scrcpy control messages and serve-sim HID messages.
- `src/vendor/scrcpy-server-v5.0.1.jar`: from the official scrcpy v5.0.1 release
  (Apache-2.0), sha256 `764eb6f79811d5211fe9df341120882ba9994c7a61b897d7bf3fb662e53bc536`.

## Build

`dist/` is a plain copy of `src/`. iOS needs the pinned `serve-sim` package
(`.npmrc` turns off bin symlinks, which Ghostex refuses in local extensions):

    npm ci --ignore-scripts
    rm -rf dist && cp -R src dist

## Install locally

Settings > Extensions, or in your own terminal:

    ghostex extensions install-local /path/to/mobile-pane-plugin

After reinstalling, quit Ghostex (Cmd+Q) and reopen it if the view says the site
can't be reached.

## Requirements

- `node` on gxserver's PATH.
- Android SDK platform-tools (`adb`) under `ANDROID_HOME`, `ANDROID_SDK_ROOT` or
  `~/Library/Android/sdk`; the `emulator` package and at least one AVD for the
  Devices panel.
- iOS: an Apple Silicon Mac with Xcode (tested with Xcode 27.2, iOS 27.2 runtime).

## Permissions

None. The command server is an unsandboxed Node process; it runs `adb` (and pushes
scrcpy-server to the device's `/data/local/tmp`), `emulator`, `xcrun simctl` and the
serve-sim helper (which listens on 127.0.0.1:3100+), and itself only listens on 127.0.0.1.
