# TimeLapser v1.0.23

## Startup behaviour, title bar version, and recording test improvements

### New

- **Version in title bar** – The overlay title bar and window title show the app version (e.g. TimeLapser 1.0.23).

### Changed

- **Start with Windows** – Default for new installs remains off. When enabled, the app no longer pops up at login; it stays in the system tray until you click “Show TimeLapser”.
- **First run and reinstall** – The first time you run the app (or after an upgrade/reinstall), the window is shown. After that, “Start with Windows” only starts the app in the tray.
- **Recording test** – The automated test starts immediately when displays are ready; get-displays has a 5s timeout with fallback so the test no longer hangs. Test export clips are 5 seconds (2 fps) for easier verification. Script timeout increased to 8 minutes. New `npm run release:check` runs build then test.
- **Release process** – Release rules now require: build → run recording test (must pass) → then prepare release notes and tag.

### Fixed

- **get-displays hanging** – If the display list took too long, the UI could hang. A 5-second timeout with Electron screen fallback ensures the list always returns.

### Install

Download the Windows installer from the [Releases](https://github.com/ImagineTheGames/TimeLapser/releases) page.
