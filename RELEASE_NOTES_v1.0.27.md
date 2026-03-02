# TimeLapser v1.0.27

## Export clarity, monitor sizes, and startup behaviour

### Changed

- **Export: target video length** – The “Target video length (s)” option in the export dialog now includes the line “How long your timelapse will be.” so it’s clear what this setting does.
- **Startup: always show window** – When you launch the app (e.g. from the installer “Run” or the Start menu), the overlay window is always shown. “Start with Windows” only controls whether the app runs at login; it no longer starts minimized to the tray.

### Fixed

- **Monitor sizes in packaged app** – In the packaged build, the monitor list now uses Electron only so each display’s name and size stay in sync. Physical resolution uses the primary display’s scale factor when needed so sizes are correct on Windows.
- **Off-by-one resolution** – Display resolutions are snapped to common values (e.g. 3440×1440) when within 1 pixel so ultrawide and other standard sizes show correctly (e.g. 3441 → 3440).

### Install

Download the Windows installer from the [Releases](https://github.com/ImagineTheGames/TimeLapser/releases) page.
