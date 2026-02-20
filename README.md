# TimeLapser

Desktop timelapse recorder: capture your monitor, a window, or a region at set intervals, with session management and export to social media formats.

## Features

- **Capture source**: Full monitor (choose which one), or a custom region (crop rectangle).
- **Settings**: Time interval, output folder, resolution, image format (PNG/JPEG), and file size optimization (compression).
- **Sessions**: Each recording is one session. Pause keeps the same session; Stop or quitting starts a new session next time. Option to "Continue" into the last session.
- **Overlay**: Compact bar with Record / Pause / Stop and expandable settings. Always on top.
- **Notifications**: Option to open Windows Focus assist to reduce interruptions during recording.
- **Export**: Convert a session to MP4 with presets for Instagram Reels/Stories, YouTube/Shorts, TikTok, and Facebook Reels/Stories. Optional "speed up to fit" platform max duration.

## Requirements

- **Windows** (tested on 10/11)
- **Node.js** 18+
- **FFmpeg** in PATH (for export to video)

## Setup

```bash
npm install
```

Put FFmpeg on your PATH or install via [ffmpeg.org](https://ffmpeg.org/) or `winget install FFmpeg`.

## Run (development)

1. Build the Electron main process and start the dev server:

```bash
npm run build:electron
npm run dev
```

2. In another terminal:

```bash
npm run electron
```

Or use a single command (builds electron, runs Vite, then launches Electron when the app is ready):

```bash
npm run build:electron && npm run electron:dev
```

## Build (production)

```bash
npm run build
npm run electron
```

To package an installer:

```bash
npm run dist
```

Output is in `release/`.

## Usage

1. **Record**: Click **● Record** to start a new session. Frames are saved under the output folder in `session_YYYY-MM-DDTHH-mm-ss`.
2. **Pause / Resume**: Use **⏸ Pause** and **▶ Resume** within the same session.
3. **Stop**: **■ Stop** ends the session; the next Record will create a new session unless you use **▶ Continue**.
4. **Continue**: If you stopped or quit, **▶ Continue** appends to the last session folder.
5. **Export**: After stopping (or from the overlay while recording), use **Export** to open the export dialog. Pick a platform, optionally enable "Speed up to fit platform max duration", and export to MP4.

## Social platform limits (used for export)

| Platform           | Max duration | Aspect | Resolution   |
|--------------------|-------------|--------|--------------|
| Instagram Reels    | 90 s        | 9:16   | 1080×1920    |
| Instagram Stories  | 60 s        | 9:16   | 1080×1920    |
| YouTube Shorts     | 60 s        | 9:16   | 1080×1920    |
| YouTube (standard) | —           | 16:9   | 1920×1080    |
| TikTok             | 180 s       | 9:16   | 1080×1920    |
| Facebook Reels     | 90 s        | 9:16   | 1080×1920    |
| Facebook Stories   | 60 s        | 9:16   | 1440×2560    |

## License

MIT
