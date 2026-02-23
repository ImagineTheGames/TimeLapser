# Releasing TimeLapser

## Option A: GitHub Actions (recommended)

1. Push your changes and ensure `main` is up to date.
2. Create and push a version tag to trigger the build and release:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
3. The workflow will build the Windows installer and create a GitHub Release with the `.exe` attached.

You can also run the workflow manually: **Actions → Build and release → Run workflow**.

## Option B: Build locally

1. Close Cursor and any app using Electron so `node_modules` is not locked.
2. Restore dependencies (if needed):
   ```bash
   npm install
   ```
3. Build the Windows exe:
   ```bash
   npm run dist:win
   ```
4. Find the installer in the `release/` folder (e.g. `TimeLapser Setup 1.0.0.exe`).
5. On GitHub: **Releases → Draft a new release** → choose a tag (or create one), add release notes, and upload the `.exe` file.

## Notes

- `npm run dist:win` uses esbuild for the Electron main/preload (no TypeScript compile) and then Vite and electron-builder.
- The `postinstall` script patches the `source-map` package (adds missing `lib/base64.js`) so electron-builder works.
