# TimeLapser v1.0.21

## Region capture on external monitor and multi-monitor

### Fixed

- **Region selection matches export** – Selecting a region on an external monitor (or half of any screen) now records and exports exactly that area. The region picker uses the actual window position for coordinates so the selection is no longer shifted (e.g. as if the selection were in the middle of the screen).
- **Multi-monitor region recording** – Region capture across two or more displays no longer fails with “Image to composite must have same dimensions or smaller”. Overlay dimensions are clamped to the virtual canvas and the composite step uses strict sizing so frames are built correctly.
- **Scaled displays (DPI)** – Region extract uses each display’s scale factor so the captured area is correct when Windows display scaling is not 100%. Screenshot buffers (physical pixels) are now aligned with the selected region (DIP).

### Install

Download the Windows installer from the [Releases](https://github.com/ImagineTheGames/TimeLapser/releases) page.
