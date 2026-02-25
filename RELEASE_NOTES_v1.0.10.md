# TimeLapser v1.0.10

## Installer and first-run fixes

This release fixes several installer and first-run issues so the app appears correctly and you can choose where to install it.

### Installer

- **Choose install location** – The Windows installer is now an **assisted installer** (not one-click). You can pick the installation directory during setup instead of it installing to a fixed location.
- **Installer path option** – The NSIS installer shows a step to change the installation folder when needed.

### Fixed

- **Invisible window after install** – The installed app was loading the dev URL (`localhost:5173`) instead of the packaged UI, which produced a blank, invisible window that blocked clicks. The app now correctly loads the bundled interface when run from the installer (`app.isPackaged`).
- **Tray "Quit" not exiting** – Choosing **Quit** from the tray menu now fully closes the app instead of leaving it running in the background.
- **Tray click not showing window** – Clicking the tray icon (or **Show TimeLapser**) now reliably shows and focuses the overlay on Windows, including a short delayed bring-to-front so the window appears even if the installer was just closed.
- **Window not shown after "Run TimeLapser"** – Overlay is shown only when content has loaded (`ready-to-show`), and delayed bring-to-front runs so the window appears after the installer is dismissed.

### Other

- **Tray icon** – New timelapse-themed tray icon (film-strip style) with dark slate background so it's visible in the system tray. The `public` folder is included in the build so the icon is present in the installed app.
- **Log file** – Main log path is `%APPDATA%\TimeLapser\logs\main.log` (capital T). Logging can start before the app is fully ready to help diagnose startup issues.

### Install

Download the latest Windows installer from the [Releases](https://github.com/ImagineTheGames/TimeLapser/releases) page.
