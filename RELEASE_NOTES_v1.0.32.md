# TimeLapser v1.0.32

## 9:16 crop export fixed; export now matches preview

### Fixed

- **9:16 crop export** – Exporting to 9:16 (e.g. Instagram Reels, TikTok) with fit mode **Crop** now matches the preview. Previously the exported video could appear uncropped or zoomed out. The "mixed" case (landscape source → portrait output) now uses the same zoom and crop position as the UI: scale to content size, pad the short dimension, then crop so the result matches the preview. Effective fit mode is also derived from the crop option so crop is applied reliably.
- **Export filter pipeline** – Video export without a watermark now uses `-filter_complex` (same as the watermark path) so scale/crop is applied consistently with the concat demuxer.

### Changed

- **Version bump rule** – The run-and-verify rule now requires a version bump whenever you make a code or config change.

### Install

Download the Windows installer from the [Releases](https://github.com/ImagineTheGames/TimeLapser/releases) page.
