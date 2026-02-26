# TimeLapser v1.0.16

## Windows build fix

v1.0.15’s installer failed to build on Windows (icon size requirement). This release fixes the build and delivers the same features as 1.0.15.

### Included (from v1.0.15)

- **Custom app icon** – App and installer use the TimeLapser icon (no default Electron logo).
- **Extended logging** – In Settings, enable “Extended logging” for full log detail; by default only startup, shutdown, and errors are logged.
- **Open log folder** – One-click button in Settings opens the log directory.
- **EPIPE fix** – No crash when the terminal that launched the app is closed.
- **Recording/export validation** – Empty captures rejected; export refuses 0-byte first frame with a clear message.

### Fixed

- **Windows installer build** – Build now generates a 256×256 icon and ICO for the installer so the packaged app builds successfully.

### Install

Download the Windows installer from the [Releases](https://github.com/ImagineTheGames/TimeLapser/releases) page.
