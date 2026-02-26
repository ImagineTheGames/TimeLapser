# TimeLapser v1.0.20

## Multi-monitor region, UX, and stability

### Fixed

- **Multi-monitor region recording** – Region capture spanning two or more displays now records both (or all) monitors correctly. The app captures each display individually, matches by position to the region picker’s coordinate system, and composites one overlay at a time with strict size clamping so the full span is included in each frame.
- **Output resolution inputs** – Width and height fields in Settings no longer lose input when settings refresh (e.g. after picking a region). They use local state so typing is preserved.
- **Settings/Export collapse when reshowing from tray** – When you minimize to tray (X) and then show the app again from the tray icon, the Settings and Export panels are closed so you always start from the collapsed bar.
- **Stop-while-capturing error** – Stopping recording while a frame was still being captured could log “path argument must be of type string. Received null”. The in-flight capture is now skipped cleanly when the session is already closed.

### Install

Download the Windows installer from the [Releases](https://github.com/ImagineTheGames/TimeLapser/releases) page.
