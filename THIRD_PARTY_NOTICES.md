# Third-party notices

嘟嘟五子棋 is MIT-licensed for its own code, but it ships one GPL-3.0-covered
component. Redistributions of this application — including the Android APK —
must keep the notices below and provide the corresponding source.

## Rapfi (GPL-3.0)

- Project: <https://github.com/dhbloo/rapfi>
- Version: 0.43.02, cloned commit `3c94c2a976f24a0dd1c5517623e9ab6fffe66bd7`
  (2026-07-23)
- License: GNU General Public License v3.0 — full text in
  `public/engine/rapfi/COPYING`, contributors in
  `public/engine/rapfi/AUTHORS`
- Files: `public/engine/rapfi/rapfi.js`, `rapfi.wasm`, `rapfi.data`
- Rebuild instructions and artifact checksums:
  `public/engine/rapfi/SOURCE.md`

Rapfi is loaded only as a standalone WebAssembly module from `public/`. It is
never imported into the application bundle, and it is only fetched when the
player explicitly picks the "Rapfi 引擎" option in the menu.

`public/engine/rapfi/worker-rapfi.js` is glue written for this project. It is
distributed under the same terms as the surrounding Rapfi build.

## Fonts

`@fontsource/zcool-kuaile` — ZCOOL KuaiLe, SIL Open Font License 1.1.

## Runtime dependencies

React, Zustand, Vite and the remaining npm dependencies keep their own
licenses; run `npm ls` for the full tree.
