# TimeLapser v1.0.14

## Recording reliability and diagnostics

### Fixed

- **Recording when installed in a custom path** – On Windows, screen capture could fail when the app was installed in a custom directory (e.g. not the default). The `screenshot-desktop` Windows capture script is now unpacked from the app archive so it runs correctly regardless of install path.

### Changed

- **Recording diagnostics** – The main log now records when recording starts (with interval, source, and output folder), when the first frame is scheduled and saved, and when recording stops (with frame count). Capture errors now include the destination file path to help diagnose permission or path issues.
- **User-facing log instructions** – The README includes a **Getting logs (troubleshooting)** section so users can find and share `main.log` when reporting issues.

### Install

Download the latest Windows installer from the [Releases](https://github.com/ImagineTheGames/TimeLapser/releases) page.

### If you run into errors

See **Getting logs (troubleshooting)** in the [README](https://github.com/ImagineTheGames/TimeLapser#getting-logs-troubleshooting): the log file is at `%APPDATA%\timelapser\logs\main.log`. Attach or paste the last part of that file when reporting a problem.
