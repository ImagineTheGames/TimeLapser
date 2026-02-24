# Release notes – v1.0.6

## Export and UX

- **GIF export**: GIF is now a dedicated export target (alongside Instagram, YouTube, Custom). Choose **GIF** in the export target dropdown to get:
  - **Aspect ratio**: 9:16 (portrait) or 16:9 (landscape)
  - **Max dimension**: 480px, 720px, 1080px, or Full
  - **Quality** slider (smaller vs larger file)
  - **Max file size** (e.g. 5 MB, 9.9 MB for Discord)
  - FPS control
- **Per-target video format**: Each export target has its own **Video format** (MP4, WebM, or MOV). No more single global format; filename extension matches the chosen format.
- **Minimize to tray**: Closing the overlay window (X or Alt+F4) now hides it to the system tray instead of quitting. Use the tray icon or **Show TimeLapser** to bring it back; use **Quit** from the tray to exit.

## Fixes and polish

- Export path and filename now correctly use `.gif` for GIF targets and the right extension per target for video.
- README updated with GIF and per-target format description.
