# Rapfi WebAssembly source and rebuild information

The adjacent `rapfi.js`, `rapfi.wasm`, and `rapfi.data` files are an
Emscripten build of [Rapfi](https://github.com/dhbloo/rapfi), a
Gomoku/Renju engine implementing the Piskvork (Gomocup) protocol.

- Upstream: <https://github.com/dhbloo/rapfi>
- Cloned commit: `3c94c2a976f24a0dd1c5517623e9ab6fffe66bd7` (2026-07-23)
- Submodules at that commit: `Gomocalc` `7710eddd34a8761fb183fb77b1bc685cdda1619c`,
  `Networks` `e32ad77a5364363b3e3a02b3f9e8610ade19ea98`,
  `Trainer` `3641196344856432c599d1c59e314e345dc7d1dd`

The build is configured by `config-source.toml` (copied into the preload as
`config.toml`). It is derived from
`Networks/config-example/gomocalc-classical220723.toml` with two changes:

- `coord_conversion_mode = "none"` — the app speaks raw Piskvork `x,y`
  coordinates with the origin at the top-left corner, matching Rapfi's
  row-major `Pos` packing (`index = y * size + x`).
- The classical `yixindb` evaluator (`model220723.bin`, 77 KB) instead of
  the NNUE `mix9svq` networks, which weigh about 30 MB and are impractical
  for an offline PWA download.

`worker-rapfi.js` in this directory is application glue (not part of Rapfi);
it loads the module, drives the Piskvork command stream, and forwards moves
to `src/engine/rapfi/RapfiEngine.ts`.

## Rebuild

Requirements: a POSIX shell, CMake >= 3.23, and the
[Emscripten SDK](https://emscripten.org/) (emsdk) activated in the
environment.

```bash
git clone --recurse-submodules https://github.com/dhbloo/rapfi.git rapfi-src
cd rapfi-src
git checkout 3c94c2a976f24a0dd1c5517623e9ab6fffe66bd7

# Point the wasm preload at our config and the classical weights.
# Networks/wasm_preloads.txt must contain exactly these two lines:
#   dufive.toml@config.toml
#   classical/model220723.bin@model220723.bin
cp <this directory>/config-source.toml Networks/dufive.toml
printf 'dufive.toml@config.toml\nclassical/model220723.bin@model220723.bin\n' \
  > Networks/wasm_preloads.txt

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
browser support wide.

The build writes `Rapfi/build/wasm/rapfi-single-simd128.{js,wasm,data}`.
Copy them here with the short names:

```bash
cp Rapfi/build/wasm/rapfi-single-simd128.js  rapfi.js
cp Rapfi/build/wasm/rapfi-single-simd128.wasm rapfi.wasm
cp Rapfi/build/wasm/rapfi-single-simd128.data rapfi.data
```

`worker-rapfi.js` maps the long build names back to these short names via
`Module.locateFile`, so no post-processing of `rapfi.js` is required.

Artifact checksums:

```text
SHA-256 1592fb74c0ae5a427bfeaebf42a6437f4f1ef80cb4337be00935c6ea96a8af71 rapfi.js
SHA-256 8149f516be57fb4193667e375999079ac5e7e0687537a34bb80b71a2a7bdc365 rapfi.wasm
SHA-256 7f73401bdd89df0efe5233cf9b00da1f47eff73b413c9f18d1a0f80fac3cad73 rapfi.data
```

Rapfi is GPL-3.0; the license text is in `COPYING` and contributors are
listed in `AUTHORS`. Do not redistribute the APK or the web build without
the corresponding source availability (this file and
`config-source.toml` document the exact provenance).
