# Mobile Pane — extension Ghostex

Mirror device Android (USB/Wi-Fi/emulator) dan iOS Simulator di dalam view Ghostex,
bisa disentuh/diketik, start/stop emulator Android Studio & simulator Xcode, dan
target performa lebih baik dari emulator pane Orca.

## 1. Bentuk extension

Web extension `placements: ["view"]` + command server Node (pola template
`command-server-extension` di [Ghostex-extensions](https://github.com/maddada/Ghostex-extensions)).
Ghostex memberi `{port}`, polling `readiness.httpGet` sampai 200, dan mematikan proses.
Server tidak di-sandbox; `permissions` adalah bridge permission Ghostex (kosong cukup).

Aturan publish: bundle self-contained, `dist/` reproducible dari `src/`, dependency
pinned + lockfile, tanpa download kode saat runtime (scrcpy-server.jar harus dibundel
atau lewat `server.install` + SHA-256).

## 2. Arsitektur

```
┌──────────── Ghostex View ─────────────┐
│ UI thread: picker, toolbar, input     │
│ Worker: WS video → VideoDecoder →     │
│         OffscreenCanvas (latest wins) │
└──────┬──────────────────────┬─────────┘
       │ WS /video (biner)    │ WS /control (input, terpisah)
┌──────┴──────────────────────┴─────────┐
│ server.mjs (Node)                     │
│  Android: adb + scrcpy-server 3.x     │
│           (opsional: emulator gRPC)   │
│  iOS:     simctl + serve-sim (proxy)  │
└───────────────────────────────────────┘
```

## 3. Cara kerja Orca (dibaca dari source, belum diukur)

- Android: scrcpy-server **2.4** H.264 → adb forward → Electron main parse →
  `webContents.send` (copy per frame) → renderer → WebCodecs →
  `ctx.drawImage` **di main thread renderer**.
- Jalur Android (Annex-B) **tanpa batas antrian decode**; cap queue hanya di jalur iOS.
- Server scrcpy tanpa `max_fps`/`video_bit_rate`; codec string dipatok `avc1.640028`.
- iOS: serve-sim (helper Swift, H.264/MJPEG) → HTTP → main → IPC (dua hop).
- Sumber: [`src/main/emulator`](https://github.com/stablyai/orca/tree/main/src/main/emulator),
  [`use-emulator-video-stream.ts`](https://github.com/stablyai/orca/blob/main/src/renderer/src/components/emulator-pane/streaming/use-emulator-video-stream.ts).

## 4. Perbaikan performa vs Orca

| # | Orca | Kita | Efek |
|---|---|---|---|
| 1 | Decode+paint di main thread | Worker + OffscreenCanvas | UI berat tidak bikin video patah |
| 2 | Antrian Android tak terbatas | `decodeQueueSize > 2` → drop sampai keyframe + minta IDR; paint hanya frame terbaru per rAF | Latency tidak menumpuk |
| 3 | scrcpy 2.4, tanpa fps/bitrate | scrcpy 3.x, `max_size` = ukuran pane × DPR (re-nego saat resize), `max_fps=60`, bitrate adaptif | Encode/transfer/decode lebih kecil |
| 4 | IPC Electron, objek per frame | Satu WS biner, header beberapa byte | Lebih sedikit copy |
| 5 | Input tidak dipisah dari video | WS control terpisah, `pointermove` di-coalesce per frame | Tap tidak antri di belakang video |
| 6 | iOS dua hop | View → proxy kita → serve-sim (bind 127.0.0.1 + token) | Satu hop lebih sedikit, aman dari LAN |
| 7 | — | Pane hidden: pause decode, koneksi tetap; tampil lagi: minta keyframe | Buka ulang instan |
| 8 | Push jar tiap sesi | Push hanya jika hash beda; emulator Quick Boot | Start lebih cepat |

**Jalur cepat emulator:** emulator Android punya gRPC (`-grpc <port>`, dipakai
"Running Devices" Android Studio) yang bisa kirim frame tanpa encode di guest.
Dipakai hanya kalau menang di benchmark; device fisik & remote tetap scrcpy.

**Remote/multi-viewer:** server jalan di mesin device, fan-out satu stream ke banyak
viewer, turunkan bitrate saat `ws.bufferedAmount` naik.

## 5. Fase

| Fase | Isi | Selesai kalau |
|---|---|---|
| **0. Spike** | Manifest + view probe; cek WebCodecs/Worker/OffscreenCanvas/WS di view Ghostex; cek server jalan di mesin mana; cek adb/emulator/simctl | Laporan probe semua ✅ (atau rencana disesuaikan) |
| **1. Mirror Android** | scrcpy 3.x → WS → Worker decode, cap antrian | 60 fps stabil, latency < 100 ms |
| **2. Input** | WS control, coalesce, nav buttons, keyboard, rotasi | Tap terasa instan |
| **3. Emulator** | List AVD, start headless (`-no-window`) + Quick Boot, stop | Start → tampil < 10 dtk (warm) |
| **4. iOS** | simctl list/boot/shutdown, serve-sim via proxy, fallback idb/screenshot | Simulator 60 fps di pane |
| **5. gRPC emulator** | Spike gRPC vs scrcpy | Dipakai hanya jika lebih cepat |
| **6. Benchmark & HUD** | Overlay fps/queue/umur frame, tes tap→pixel, banding Orca di device sama | p50/p95 lebih baik dari Orca |
| **7. Hook agent** | screenshot/tap/install via `ghostex extensions message` | Agent bisa cek UI sendiri |

Target awal (emulator lokal): p50 glass-to-glass < 50 ms, p95 < 100 ms, 60 fps @1080p.

Di luar scope v1: iPhone fisik, rekam layar, audio, transfer file, grid multi-device.

## 6. Kondisi mesin (2026-11-24)

- Android SDK ada di `~/Library/Android/sdk`, `adb`/`emulator` tidak di PATH → server
  resolve via `ANDROID_HOME` / `ANDROID_SDK_ROOT` / path default.
- `scrcpy` tidak terinstal (tidak perlu, cukup jar server yang dibundel).
- `xcrun` ada. serve-sim butuh Apple Silicon + Xcode 26+.
- Ghostex 11.15.0 adalah app Electron (Chromium) → WebCodecs/OffscreenCanvas
  seharusnya tersedia; Fase 0 memastikan view extension tidak membatasinya.

## 7. Hasil Fase 0 (selesai 2026-11-24, Ghostex 11.15.0)

| Cek | Hasil di view Ghostex |
|---|---|
| Runtime view | Chromium (CEF) di dalam app GPUI, UA Chrome/156, origin `http://127.0.0.1:<port>`, secure context, bukan iframe |
| Worker + OffscreenCanvas + WebGL2 | ✅ |
| H.264 decode `prefer-hardware` (VideoToolbox) | ✅ 60/60 frame, p50 1,4 ms, p95 20 ms (frame pertama) |
| H.264 decode `prefer-software` | ❌ codec langsung closed: build CEF Ghostex tidak punya decoder H.264 software |
| `VideoDecoder.isConfigSupported` | Selalu `false` (juga `no-preference`) walau decode jalan → **jangan dipakai sebagai gate** |
| WebSocket | RTT p50 0,2 ms, ±1 GB/s, umur frame p95 0,3 ms |
| Refresh layar | 121 fps (ProMotion) |

Konsekuensi untuk Fase 1:
- Configure decoder tanpa hint / `prefer-hardware`, tangani error `configure`/`decode` sebagai sinyal fallback.
- Perlu fallback non-H.264 (JPEG per frame) untuk mesin tanpa decoder hardware.
- Hardware-only justru cocok untuk target latency (decode ±1–2 ms).

Gotcha pengembangan:
- gxserver tidak menemukan node dari Herd → symlink `~/.local/bin/node` (exit 127).
- Setelah `install-local` ulang, view bisa menunjuk port lama dan runtime tetap `stopped`
  tanpa log; Cmd+Q lalu buka Ghostex lagi memperbaikinya (gxserver tidak perlu restart).
- `install-local` hanya boleh dijalankan user; report probe ada di
  `~/.local/share/ghostex/extensions/data/mobile-pane-plugin/fase0-report.json`.

## 8. Hasil Fase 1 (2026-11-24): mirror Android, view only

- scrcpy-server **v5.0.1** (bukan 3.x): protokol diverifikasi dari source tag v5.0.1;
  `RESET_VIDEO` = control type 17 dipakai untuk minta keyframe.
- Smoke check `node src/android.mjs`: server scrcpy siap dalam ±0,6 dtk (jar tidak di-push ulang jika md5 sama).
- Emulator `Medium_Phone_API_37` (Android 17, 1080x2400), swipe terus-menerus:

| Tempat | Resolusi stream | fps | Server→tergambar p50/p95 | Drop |
|---|---|---|---|---|
| Chrome headless, paint via rAF | 390x868 | 48–50 dari 60 | 16,2 / 17,8 ms | 9–12/dtk |
| Chrome headless, paint langsung | 390x868 | 60 | 1,6 / 1,9 ms | 0 |
| Ghostex CEF (browser pane) | 900x2000 | 58–60 | 2,4–3,3 / ≤4,3 ms | 0 |

- Paint lewat `requestAnimationFrame` menambah satu frame lag → frame digambar langsung saat decoder output.
- Angka di atas belum termasuk encode di device + adb; itu diukur lewat tes tap→pixel (Fase 2/6).
- Belum dikerjakan: re-negosiasi `max_size` saat pane di-resize (sekarang hanya diskala CSS),
  fallback JPEG untuk mesin tanpa decoder hardware, fan-out satu stream ke banyak viewer.

## 9. Hasil Fase 2 (2026-11-24): input

Diuji di browser pane Ghostex (CEF) dengan emulator: Home (klik), swipe membuka app drawer,
ketik "set" (key event trusted) memunculkan pencarian, tap membuka Settings, wheel menggulir,
Back kembali, Rotate ke 1928x866 dan balik, Cmd+V menempel "bluetooth" ke kolom pencarian.

- Input dikirim lewat WebSocket video milik Worker, bukan WS terpisah: TCP full-duplex, arah
  client→server tidak antre di belakang video. Rencana poin 5 direvisi.
- Keamanan: WebSocket hanya menerima origin `http://127.0.0.1:<port>`/`localhost` (origin lain 403),
  dan server hanya meneruskan tipe kontrol 0,1,2,3,9.
- Rotate: `ROTATE_DEVICE` scrcpy tidak berefek saat auto-rotate menyala (freeze lalu thaw).
  Emulator memakai `adb emu rotate` (sensor virtual). HP fisik dengan auto-rotate menyala belum bisa.
  Launcher HP terkunci portrait, jadi rotate di home screen memang tidak berubah.
- Latency ujung ke ujung belum terukur dengan benar. `show_touches` tidak menggambar titik untuk
  touch hasil injeksi di Android 17: tap di area kosong baru menghasilkan frame saat timeout
  long-press (±490 ms). Panel volume juga tidak konsisten (71–300 ms, 5/12 tanpa frame).
  → Fase 6 butuh stimulus deterministik, mis. halaman web di Chrome emulator yang ganti warna saat
  `touchstart` (dilayani server via `adb reverse`).
- Belum: multi-touch/pinch, IME komposisi (huruf Jepang dsb.), clipboard device→Mac.

## 10. Hasil Fase 3 (2026-11-24): kelola emulator

- `GET /avds`, `POST /avds/start {name}`, `POST /avds/stop {serial}`; panel **Emulators** (popover native).
- Start: `emulator -avd <name> -port <port genap bebas> -no-window -no-audio -no-boot-anim -gpu host`,
  detached (emulator tetap hidup walau server extension mati), log ke data dir. Port dipilih sendiri
  supaya serial langsung diketahui. Siap = `sys.boot_completed=1`.
- Stop: `adb emu kill` (menyimpan snapshot Quick Boot).
- **Medium_Phone_API_37: Start → siap 4,1–4,2 dtk** (Quick Boot), target < 10 dtk tercapai.
  Setelah boot, viewer otomatis memilih device itu; stream 45 fps saat animasi, 0 drop, 3,4/4,8 ms.
- Keamanan: semua request non-GET juga dicek origin (CSRF dari halaman web lain → 403);
  nama AVD harus ada di `-list-avds` (`-wipe-data` ditolak).
- Belum: cold boot pertama kali (tanpa snapshot) bisa >30 dtk; tidak ada progress selain "Booting… N s".
  Membuat/menghapus AVD tetap lewat Android Studio.

## 11. Hasil Fase 4 (2026-11-24): iOS Simulator

Mesin: Xcode 27.2, runtime iOS 27.2, 12 simulator. Diuji dengan iPhone 17 di browser pane Ghostex.

- `GET /sims`, `POST /sims/boot`, `POST /sims/shutdown`; panel **Devices** punya bagian iOS.
  Boot headless (`simctl boot`, tanpa Simulator.app) sampai `bootstatus` selesai: ±27 dtk (cold).
- serve-sim 0.1.49 (npm, Apache-2.0, `--ignore-scripts`, 38 MB node_modules) dijalankan
  `serve-sim --detach`; server kita membaca `/stream.avcc` dan bicara ke WS HID helper dari Node,
  jadi browser hanya bicara ke server kita (satu origin, satu hop proxy).
- **Temuan penting:** CEF Ghostex menolak config VideoDecoder dengan `description` avcC
  ("H.264 decoding is not supported") tapi men-decode stream yang sama sebagai Annex-B
  (High@5.1, 1206x2622, 4/4 frame). Server mengubah avcC → Annex-B (length prefix → start code
  in-place). Self-check: `node src/ios.mjs`.
- Input terbukti: tap (buka Settings), wheel scroll, keyboard HID (ketik "gen" di Search,
  tanpa perlu Device Hub di depan), paste (`simctl pbcopy` + Cmd+V), Home dari dalam app,
  App Switcher, rotate ke landscape di Safari (frame tetap portrait, digambar diputar; touch
  di-remap seperti serve-sim) dan kembali.
- Saat scroll: 36 fps (satu sampel), 0 drop, server→tergambar 6,5/8,8 ms, ±7,7 Mbps di 1206x2622.
- Bug yang ditemukan & diperbaiki: simulator yang sudah booted sebelum server start dianggap
  "booting" selamanya → sekarang dicek sekali dengan `bootstatus`.
- Belum: Home tidak menutup App Switcher (tap kartu aplikasi bisa), scroll wheel belum diputar
  untuk landscape, iPhone fisik, bundel serve-sim untuk publish (aturan reproducible dist).

## 12. Hasil Fase 6 (2026-11-24): benchmark & HUD

**Metode (input → pixel berubah di canvas viewer).** Server menyajikan `/touchtest.html`
(layar penuh hitam ↔ putih per sentuhan, tanpa transisi), dibuka di Chrome emulator lewat
`adb reverse` dan di Safari simulator lewat `simctl openurl`. Worker mencatat luma pixel tengah,
mengirim touch, lalu membaca pixel itu tiap frame sampai berubah; jam kirim dan jam gambar sama
(Worker). Waktu terima frame di server memecah total menjadi sisi device dan sisi viewer.
Belum termasuk scanout layar Mac (≤ 1 refresh, 8 ms di 120 Hz).

Diukur di Chrome headless (2× DPR) via CDP, 20 tap, jeda acak terhadap vsync:

| Target | Resolusi stream | p50 | p95 | min | Sisi device p50 | Sisi viewer p50 |
|---|---|---|---|---|---|---|
| Android emulator API 37 (Chrome) | 814x1810 | **90 ms** | 100 ms | 64 ms | 81 ms | 10 ms |
| iOS Simulator iPhone 17 (Safari) | 1206x2622 | **63 ms** | 185 ms | 42 ms | 48 ms | 13 ms |

- Lag didominasi sisi device: render browser di device + encode (Android: encoder H.264 software
  `c2.android.avc.encoder` di dalam emulator) + transport. Sisi viewer 10–13 ms termasuk decode
  frame besar (ganti warna layar penuh) dan readback pixel untuk pengukuran.
- p95 iOS 185 ms dari 2 outlier (123, 185 ms); 18 sampel lain 42–73 ms.
- **Ketahanan terhadap UI berat:** main thread viewer dibuat sibuk 50 ms per 100 ms saat emulator
  bergerak → fps 34–44 (normal 33–36) dan server→tergambar 4,4 ms (normal 5,2–5,6 ms). Video tidak
  terpengaruh karena decode + paint di Worker. Di Orca keduanya di main thread (dari kode, tidak diukur).
- **Perbandingan langsung dengan Orca belum ada:** Orca tidak terpasang dan pane-nya tidak bisa
  diberi pengukur yang sama. Jalan yang adil: rekam layar Mac (≥ 120 fps) sambil men-tap kedua
  pane di device yang sama, ukur tap → pixel berubah di layar.
- Angka di view extension Ghostex (CEF) belum diambil: tombol **Bench** di v0.5.0.
- Sisi device Android (81 ms) adalah target Fase 5: jalur gRPC emulator melewati encoder
  software di dalam guest.

## 13. Hasil Fase 5 (2026-11-24): jalur gRPC emulator

- gRPC emulator mati secara default; perlu `-grpc <port> -grpc-use-token`. `startAvd` kini menambahkannya
  (port 8554 + offset console). Endpoint + token dibaca dari
  `~/Library/Caches/TemporaryItems/avd/running/pid_*.ini` (`port.serial` = console port).
- Klien tanpa dependency: `node:http2` + protobuf minimal (`src/emulator-grpc.mjs`). Video =
  `streamScreenshot` RGBA8888 di ukuran pane; input tetap lewat scrcpy `video=false` (koordinat
  device mentah, server me-rescale touch/scroll).
- Spike sisi device (tap → frame di server), 814x1810: gRPC p50 68 ms vs scrcpy 81 ms. Spike pertama
  terlihat lebih buruk (121 ms) karena buffer HTTP/2 disambung per chunk (O(n²) untuk frame 6 MB);
  diperbaiki dengan menyambung sekali per pesan.
- Ujung ke ujung di viewer, 3 putaran × 20 tap bergantian (emulator & resolusi sama):
  scrcpy p50 69,9 / 69,6 / 71,6 ms, gRPC p50 64,9 / 70,6 / 70,6 ms → **seri** (gRPC menang di device,
  kalah 3–4 ms di viewer karena 5,9 MB/frame).
- Saat layar bergerak: **gRPC 55–58 fps vs scrcpy 34–50 fps** (encoder software di guest jadi batas),
  ±330 MB/s lewat loopback. CPU (100% = 1 core): scrcpy server 1% / Chrome 11% / emulator 64%;
  gRPC 18% / 20% / 58% → biaya ±0,26 core.
- Keputusan: gRPC jadi default untuk emulator yang gRPC-nya aktif; HP fisik, emulator tanpa gRPC, dan
  `?transport=scrcpy` memakai jalur H.264. Rotasi diikuti (box diminta ulang saat orientasi berubah).
- Catatan alat ukur: angka CPU pertama (server 86%) salah karena pola `ps` ikut menghitung shell uji;
  profil `--cpu-prof` menunjukkan server 99% idle di jalur scrcpy.
- Belum: jalur gRPC tidak cocok untuk viewer remote (data mentah) → nanti fan-out/encode di host;
  shared-memory (`ImageTransport MMAP`) belum dicoba.

## 14. Hasil Fase 7 (2026-11-24): agent bisa melihat & mengendalikan device

- `ghostex extensions message` ditolak untuk extension view ("is not a sidebar extension"); panel
  sidebar hanya bisa memuat HTML ≤ 480 pt dari origin Ghostex, jadi mirror tidak bisa pindah ke sana.
  → **Agent CLI** `dist/agent-cli.mjs` yang dijalankan agent sendiri: tidak butuh izin, server, atau
  view terbuka. Rute `/ghostex/agent-message` + izin `agents.message` dihapus (tidak akan dipanggil).
- Aksi (`src/agent-actions.mjs`): devices, screenshot (adb screencap / simctl io), ui (Android
  `uiautomator dump`, iOS helper `/ax`; elemen dengan pusat 0..1), tap, swipe, type (Android
  `input text` ASCII; iOS pasteboard + Cmd+V), key, install (.apk / .app), launch.
- Skill `mobile-pane` (manifest `skill`) mengajari agent memakai CLI: loop ui → tap → screenshot.
- Diuji lewat CLI: iOS — launch Settings, ui menemukan "close", tutup pencarian, tap "General",
  screenshot + ui memastikan halaman General. Android — launch Settings, tap "Search Settings",
  ketik "it's wifi", ui menunjukkan hasil Wi-Fi; teks non-ASCII ditolak dengan pesan jelas.
- Belum diuji: install (.apk / .app) karena belum ada build app di mesin ini.

## 15. Frame device (2026-11-24)

- Stream tidak pernah membawa skin emulator / bezel Simulator.app (emulator `-no-window`, scrcpy/gRPC/
  serve-sim hanya layar), jadi semua device memakai frame kita.
- CSS murni + container queries: `.device` dipaskan ke stage (`min(100cqw, 100cqh × ar)`), bezel dan radius
  dalam `cqmin`; rasio luar dihitung dari rasio layar + bezel. Profil: iPhone (bezel 3,5%, radius 13,5%),
  iPad (4,5%, 5%), Android (3%, 8,5%) dari sisi pendek. Tombol samping hanya saat tegak. Toggle **Frame**
  disimpan di localStorage.
- Bug ditemukan saat uji: app iOS yang hanya portrait (Settings) di device landscape tergambar miring →
  setelah rotasi server membaca frame jendela app dari `/ax` dan melaporkan orientasi app.
- Insiden uji: port CDP 9334 ternyata milik Ghostex; script screenshot sempat menyentuh tab Mobile Pane
  di Ghostex (halaman error, tanpa efek). Uji headless sekarang memakai port 9336.

## 16. Persiapan publish & penutupan celah (2026-11-24)

Publish:
- `npm run build` (scripts/build.mjs): dist = src + serve-sim `dist` + `ws` di `dist/vendor/node_modules`,
  cek sha256 scrcpy-server, tolak symlink. 6,2 MB. Validator resmi lolos; **verify-dist resmi lolos**
  ("Verified 1 reproducible dist"), dijalankan pada salinan repo Ghostex-extensions berisi extension ini saja.
- `dist/start.sh` mencari Node (PATH, nvm, Herd, fnm, Volta, Homebrew); tanpa Node: pesan jelas, exit 127.
- `metadata/` screenshot store; README: izin, apa yang dijalankan, tabel kode pihak ketiga.

Celah yang ditutup (semua diuji di Chrome headless dengan emulator/simulator sungguhan):
- Stream mengikuti ukuran pane (reconnect saat berubah > 25%): 694x1542 → 1080x2400 saat pane 2×.
- Tanpa decoder H.264: iOS → MJPEG (diuji dipaksa `?video=mjpeg`), emulator → gRPC mentah. Pemicu otomatis
  belum teruji (CEF di Mac ini selalu punya decoder hardware).
- IME lewat textarea tersembunyi: komposisi "にほん"→"日本" + "a" masuk ke Android ("日本a") dan iOS Safari
  ("日本b"); non-ASCII di Android lewat clipboard paste.
- Cmd+A/C/X/Z ke device; clipboard device → Mac (Android `clipboard_autosync`, iOS `pbpaste`) terbukti.
- Option+drag pinch: iOS Safari membesar; Android terbaca "fingers: 2" di halaman uji (DevTools Chrome device).
- Satu stream per device untuk banyak viewer (hub): dua viewer + satu session scrcpy; viewer kedua langsung
  dapat gambar (keyframe diminta; gRPC: frame terakhir). Bug: RESET_VIDEO sebelum capture mulai membuat
  scrcpy-server berhenti → keyframe hanya diminta untuk stream yang sudah jalan.
- iOS: orientasi app dicek ulang tiap 2 dtk saat landscape (Safari↔Settings 2,5–2,8 dtk); scroll landscape
  mengikuti orientasi; Home = swipe dari tepi bawah (`edge: 3`), juga keluar dari App Switcher.
- HP Android dengan auto-rotate: kunci orientasi berikutnya (`cmd window user-rotation lock`); rotasi dibaca
  dari `dumpsys window` (`mRotation=`), karena `SurfaceOrientation` tidak ada lagi di Android 17 (juga
  memperbaiki koordinat tap agent CLI di landscape).
- Agent CLI `install`: APK uji (aapt2 + apksigner) dan app SwiftUI uji (swiftc + codesign ad-hoc) terpasang;
  `launch` + `ui` membaca teks app. App uji dihapus lagi.

Belum: iPhone fisik; perbandingan langsung dengan Orca (dilewati atas keputusan user).

## 17. Keputusan (default yang dipakai, bisa diubah)

- Frontend: vanilla JS (tanpa React).
- Prioritas: Android sampai Fase 3, lalu iOS.
- iOS: serve-sim utama, idb fallback.
- UI tetap web view, bukan GPUI: API extension Ghostex hanya menyediakan placement web
  (view/chat-bar/popup/modal), terminal-pane, dan panel sidebar JSON. Tidak ada cara
  memuat kode GPUI dari luar. Di Fase 0, overhead di sisi view kecil (WS ±0,3 ms,
  decode p50 1–2 ms); bottleneck ada di encode device + adb.
- Opsi nanti: server Node → binary Rust (`server.install` + SHA-256) kalau memori Node
  atau masalah PATH (exit 127 di Fase 0) jadi masalah bagi user lain.
- Pane GPUI native (VideoToolbox → Metal tanpa copy) hanya mungkin lewat kontribusi
  ke core Ghostex, bukan sebagai extension.
