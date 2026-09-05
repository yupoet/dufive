# Rapfi WebAssembly source and rebuild information

The adjacent `rapfi.js`, `rapfi.wasm`, and `rapfi.data` files are an
Emscripten build of [Rapfi](https://github.com/dhbloo/rapfi), a
Gomoku/Renju engine implementing the Piskvork (Gomocup) protocol. A second
build, `rapfi-nnue.*`, differs only in the preloaded weights: it carries the
mix9svq NNUE networks (~40 MB) for the strongest play.

Cloudflare Pages caps a single file at 25 MiB, so the NNUE artifacts are
**not deployed to the web**. They live in `apk-assets/engine/rapfi/` and
`npm run build:android` injects them into the Android assets after
`cap sync`; the web app probes for them and hides the option when absent.
The local smoke test stages them into `dist/` itself so the engine stays
covered.

- Upstream: <https://github.com/dhbloo/rapfi>
- Cloned commit: `3c94c2a976f24a0dd1c5517623e9ab6fffe66bd7` (2026-07-23)
- Submodules at that commit: `Gomocalc` `7710eddd34a8761fb183fb77b1bc685cdda1619c`,
  `Networks` `e32ad77a5364363b3e3a02b3f9e8610ade19ea98`,
  `Trainer` `3641196344856432c599d1c59e314e345dc7d1dd`

Both builds are configured by their config source: `config-source.toml`
(classical, preloaded as `config.toml`) and `config-source-nnue.toml` (NNUE).
They are derived from the `Networks/config-example/gomocalc-*.toml` files
with two changes:

- `coord_conversion_mode = "none"` — the app speaks raw Piskvork `x,y`
  coordinates with the origin at the top-left corner, matching Rapfi's
  row-major `Pos` packing (`index = y * size + x`).
- The classical build uses the `yixindb` evaluator (`model220723.bin`, 77 KB)
  so the default offline payload stays around 1.3 MB; the NNUE build lists
  the mix9svq weight files, which Rapfi selects automatically per board size
  and rule (freestyle, standard 15×15, renju black/white).

`worker-rapfi.js` in this directory is application glue (not part of Rapfi);
it loads the module — classical or NNUE, chosen by the `variant` field of
the `init` message — drives the Piskvork command stream, and forwards moves
to `src/engine/rapfi/RapfiEngine.ts`.

## Rebuild

Requirements: a POSIX shell, CMake >= 3.23, and the
[Emscripten SDK](https://emscripten.org/) (emsdk) activated in the
environment.

```bash
git clone --recurse-submodules https://github.com/dhbloo/rapfi.git rapfi-src
cd rapfi-src
git checkout 3c94c2a976f24a0dd1c5517623e9ab6fffe66bd7

# Point the wasm preload at our configs and weights.
# For the classical build, Networks/wasm_preloads.txt must contain exactly:
#   dufive.toml@config.toml
#   classical/model220723.bin@model220723.bin
# For the NNUE build, Networks/wasm_preloads-nnue.txt must contain:
#   dufive-nnue.toml@config.toml
#   classical/model210901.bin@model210901.bin
#   mix9svq/mix9svqfreestyle_bsmix.bin.lz4@mix9svqfreestyle_bsmix.bin.lz4
#   mix9svq/mix9svqstandard_bs15.bin.lz4@mix9svqstandard_bs15.bin.lz4
#   mix9svq/mix9svqrenju_bs15_black.bin.lz4@mix9svqrenju_bs15_black.bin.lz4
#   mix9svq/mix9svqrenju_bs15_white.bin.lz4@mix9svqrenju_bs15_white.bin.lz4
cp <this directory>/config-source.toml Networks/dufive.toml
cp <this directory>/config-source-nnue.toml Networks/dufive-nnue.toml

emcmake cmake -S Rapfi -B Rapfi/build/wasm \
  -DCMAKE_BUILD_TYPE=Release \
  -DNO_COMMAND_MODULES=ON \
  -DUSE_WASM_SIMD=ON \
  -DUSE_WASM_SIMD_RELAXED=OFF \
  -DNO_MULTI_THREADING=ON
emmake cmake --build Rapfi/build/wasm
```

`NO_COMMAND_MODULES` is mandatory for the wasm build, `NO_MULTI_THREADING`
keeps the worker single-threaded (a shared-memory build would need
`SharedArrayBuffer`/COOP-COEP headers), and plain SIMD (not relaxed) keeps
browser support wide. The `wasm_preloads.txt` line inside
`Rapfi/CMakeLists.txt` selects which preload list is used; it points at
`wasm_preloads.txt` (classical) by default.

The build writes `rapfi-single-simd128.{js,wasm,data}`. Copy them here with
the short names:

```bash
cp Rapfi/build/wasm/rapfi-single-simd128.js  rapfi.js
cp Rapfi/build/wasm/rapfi-single-simd128.wasm rapfi.wasm
cp Rapfi/build/wasm/rapfi-single-simd128.data rapfi.data
```

For the NNUE build, repeat with the preload list pointing at
`wasm_preloads-nnue.txt` and copy the outputs as `rapfi-nnue.*` instead.

`worker-rapfi.js` maps the long build names back to these short names via
`Module.locateFile`, so no post-processing of the glue files is required.

Artifact checksums:

```text
SHA-256 1592fb74c0ae5a427bfeaebf42a6437f4f1ef80cb4337be00935c6ea96a8af71 rapfi.js
SHA-256 8149f516be57fb4193667e375999079ac5e7e0687537a34bb80b71a2a7bdc365 rapfi.wasm
SHA-256 7f73401bdd89df0efe5233cf9b00da1f47eff73b413c9f18d1a0f80fac3cad73 rapfi.data
SHA-256 52e6133d8bab1e14634f2922a9ae255e47ba25da92f30353782ad981f8a22d4c rapfi-nnue.js
SHA-256 8149f516be57fb4193667e375999079ac5e7e0687537a34bb80b71a2a7bdc365 rapfi-nnue.wasm
SHA-256 2123404d414a2d2c040e8c437bac68fe50b5e4d4bc173b3363f3442112a7639a rapfi-nnue.data
```

Rapfi is GPL-3.0; the license text is in `COPYING` and contributors are
listed in `AUTHORS`. Do not redistribute the APK or the web build without
the corresponding source availability (this file and the config sources
document the exact provenance).
