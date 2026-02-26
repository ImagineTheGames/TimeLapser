# TimeLapser v1.0.15

## Logging, icon, and reliability

### New

- **Custom app icon** – The app and installer use the TimeLapser icon instead of the default Electron logo (exe, windows, and installer/uninstaller).
- **Extended logging option** – In Settings, enable **Extended logging** to record full detail (recording, overlay, export) in the log file. By default only startup, shutdown, and errors are logged so first-time run issues are easier to see without huge logs.
- **Open log folder** – One-click **Open log folder** in Settings opens the log directory (`%APPDATA%\timelapser\logs`) so you can attach `main.log` when reporting issues.

### Fixed

- **EPIPE errors** – If the terminal or launcher that started the app was closed, the app no longer crashes with "EPIPE: broken pipe" when logging or handling errors; logging goes only to the log file when the console is unavailable.
- **Recording/export** – Empty capture buffers are rejected so 0-byte frame files are not written. Export checks the first frame and refuses to export with a clear message if it is 0 bytes (recording did not capture correctly).

### Install

Download the latest Windows installer from the [Releases](https://github.com/ImagineTheGames/TimeLapser/releases) page.

### If you run into errors

Use **Open log folder** in Settings, or see **Getting logs (troubleshooting)** in the [README](https://github.com/ImagineTheGames/TimeLapser#getting-logs-troubleshooting). Attach or paste the last part of `main.log` when reporting a problem.
