# TimeLapser v1.0.24

## Export defaults, remembered format, and bug fixes

### Changed

- **Export: crop to fit off by default** – “Crop to fit resolution” is now unchecked by default so exports keep the full frame unless you enable it.
- **Export: default format 16:9 (YouTube)** – The export dialog now defaults to **YouTube (16:9)** instead of a vertical format. The format list shows YouTube (16:9) first.
- **Export: remember last format** – Your last chosen export format and “Crop to fit” setting are saved and restored the next time you open the export dialog.

### Fixed

- **Overlay always-on-top** – The overlay no longer re-applies always-on-top on every focus/blur, so switching to another window does not pull the overlay back on top.
- **Capture interval minimum** – Interval is now clamped to a minimum of 0.1 s in the capture loop and when saving settings (allows faster timelapses).
- **Display list: physical size** – get-displays now returns physical size (width×height in physical pixels) per display so the Settings monitor list can show it.
- **Recording test safeguard** – The automated recording test only runs when the app is using the test userData path (`.timelapser-test`), so it never runs on a normal install.

### Install

Download the Windows installer from the [Releases](https://github.com/ImagineTheGames/TimeLapser/releases) page.
