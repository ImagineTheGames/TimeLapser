# TimeLapser v1.0.22

## Region capture on scaled displays and recording test reliability

### Fixed

- **Region extract on scaled / external displays** – When a display returns DIP-sized capture (logical pixels) instead of physical pixels, region extract now detects the actual buffer size and uses the correct coordinates. This fixes "extract_area: bad extract area" and failed frames on external or scaled monitors (e.g. Region 16:9 / 9:16 on Screen 2).
- **Recording test false failures** – The automated recording test no longer fails due to old log lines or renderer-forwarded messages; only main-process errors from the current run are counted.

### Changed

- **Recording test: single instance** – The recording test script kills any existing Electron processes before starting and waits before spawning, so each run uses one app instance and repeated runs don’t leave multiple windows.

### Install

Download the Windows installer from the [Releases](https://github.com/ImagineTheGames/TimeLapser/releases) page.
