# ESONJ's Token Maker

A browser-only D&D token builder: drop a portrait, frame it in a ring, and let chosen parts (a sword, a wing, a plume) pop out over the rim. Artwork, masks and projects never leave the device. There is no backend, no account, no API key and no build step.

## Publish on GitHub Pages

1. Create a repository and copy every file in this folder into it, keeping the folder layout (`index.html` at the top).
2. Commit and push. Keep the empty `.nojekyll` file so Pages serves the files as they are.
3. In the repository: **Settings → Pages → Build and deployment → Deploy from a branch**, pick `main` and `/ (root)`, then Save.
4. Open `https://<user>.github.io/<repo>/`. All paths are relative, so it works from that subpath (or any other).

To run it locally, serve the folder over HTTP (for example `python3 -m http.server`) and open the printed address. Opening `index.html` straight from disk (`file://`) will not load the cutout model.

## What is in the package

| Path | Purpose |
| --- | --- |
| `index.html` | Entry point, layout and styles |
| `js/core.js` | State, transforms, masks, undo, built-in frame, demo art |
| `js/render.js` | Colour pipeline and the one compositor used by preview and export |
| `js/cutout.js` | Auto-cutout client, Refine Edge, frame-opening detection |
| `js/store.js` | Downloads, project and preset files, ZIP writer, local drafts |
| `js/ui.js`, `js/dialogs.js` | Canvas, input, inspector, export and preset dialogs |
| `cutout-engine.js`, `cutout-worker.js` | Model pre/post-processing and the inference worker |
| `vendor/` | ONNX Runtime Web 1.19.2 (WASM build, three files) |
| `models/u2netp.onnx.wasm` | The U²-NetP model (see the note on its file name below) |
| `licenses/` | Licence texts for the bundled runtime and model |

## Model and runtime

- **Model:** U²-NetP (the small U²-Net), salient-object detection. Xuebin Qin, Zichen Zhang, Chenyang Huang, Masood Dehghan, Osmar Zaiane and Martin Jagersand, "U²-Net: Going Deeper with Nested U-Structure for Salient Object Detection", Pattern Recognition 2020. Source: https://github.com/xuebinqin/U-2-Net (Apache-2.0).
- **Checkpoint:** the ONNX export published with rembg, `https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx` (rembg is MIT). Unmodified bytes, 4,574,861 bytes, SHA-256 `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`.
- **File name:** the file is stored as `models/u2netp.onnx.wasm`. It is the plain ONNX file; the extra suffix exists only because the Claude Artifact host serves a fixed list of file extensions and `.onnx` is not on it. The app fetches it as raw bytes, so the name does not matter. If you rename it, update `file:` in `cutout-engine.js`.
- **Runtime:** onnxruntime-web 1.19.2 (MIT, Microsoft), WASM backend, one thread, loaded only when Auto-cutout is first used, run in a Web Worker. If a worker cannot start, the same engine runs on the page thread.
- **Pre-processing (confirmed against the checkpoint):** input `input.1`, float32 `[1,3,320,320]`; the image is stretched to 320×320 on white, divided by its maximum value, then normalised with mean `[0.485, 0.456, 0.406]` and std `[0.229, 0.224, 0.225]`, channel order RGB, NCHW.
- **Output:** the first of seven outputs (`[1,1,320,320]`, sigmoid already applied) is min-max normalised, upscaled to the mask, firmed with a smoothstep around 0.4, then given one colour-aware edge pass.
- **Where cleanup is needed:** tested on photographs (a portrait, an astronaut, a cat) and on the built-in drawn knight, it finds the figure cleanly. It is a 320 px saliency model, so expect to fix: thin or detached gear (a spear standing apart, a plume) that it leaves out, flat-shaded shapes with little texture, which it may only partly select, and hair or fur edges, which come out soft. Use **Refine Subject** (brush, lasso) for missed parts and **Refine Edge** for wisps.

Only static files from this folder are fetched: the three runtime files and the model. Nothing is uploaded.

## Compositing and colour order

The token is a blend of two complete premultiplied orderings, weighted by pop-out coverage `W`: `A = border over (base art clipped to the opening)`, `B = art over border`, `out = A·(1−W) + B·W`. `W` is the raw pop-out mask, multiplied by the subject mask only in Keep Original Background with restriction on; in Subject Only with restriction on, the subject mask is applied to the art in `B` instead. Source transparency is already in the artwork and is never applied a second time. Colour runs in this order in both preview and export: replace colours → grade art and border → tint border → composite → final grade once.

## Foundry Dynamic Ring Subject

The Foundry export follows the dynamic token ring layout: a square transparent subject image with a centred circular guide two thirds of the canvas wide, with deliberate pop-outs allowed into the padding. Reference: https://foundryvtt.com/article/dynamic-token-rings/

## Layer PNGs

The ZIP holds `01-base-art`, `02-border`, `03-pop-out` and `finished-token`, all the same size, coordinates and crop. Stack base art, then rim, then pop-out. Each layer carries only its own adjustments. Two things exist only in the finished token: soft pop-out edges are blended between the two orderings so partial coverage is not doubled, and the final grade is applied once to the whole image.

## File formats

- **Project** (`*.token.json`, format `esonj-token-maker/project`, version 1): the original artwork, the border (or a reference to the built-in ring), both masks as PNG, the opening, transforms, colour and export settings. Portable between the Artifact, the static build and other devices. Files are fully decoded and validated before they replace open work.
- **Layout preset** (`*.preset.json`, format `esonj-token-maker/preset`, version 1): border, opening and placement, portrait framing relative to cover-fit, grades, colour replacement, tint and export settings. No portrait and no masks.
- **Local draft:** the last session is kept in IndexedDB (`esonj-token-maker`) and restored on reload in the same browser.

## Differences between the two environments

Both run the same files. The differences come from the host.

| | Static build (GitHub Pages or any HTTP host) | Claude Artifact |
| --- | --- | --- |
| Downloads | Direct browser downloads | Through the host's save prompt (`downloads` capability), one confirmation per file. If the host refuses, images open at full resolution to save by hand; project, preset and ZIP files then need the static build |
| Local drafts | IndexedDB, per browser and site | IndexedDB inside the artifact frame; may be unavailable, in which case the app says so and offers Save Project |
| Model loading | From `vendor/` and `models/` beside the page | From the artifact's own files |

**Verified in headless Chrome over HTTP at a `/token-maker/` subpath:** local image input, real worker inference (about 1.6 s per run after a 2 to 3 s first load on the test machine), PNG and WebP export with transparency, direct downloads, project and preset round-trips, layer ZIP, draft restore after reload, a failed save leaving the previous draft intact, touch painting, pinch and two-finger cancel.

**Not verified at packaging time:** the live Claude Artifact could not be opened in a signed-in browser from the build session, so worker inference, IndexedDB persistence and the save prompt inside the artifact frame are untested there. Open **File → Runtime status** in the artifact to see what the host allows. Also untested: Safari and Firefox, real phones and tablets (touch was emulated), and painted character illustrations (no such test art was available offline; photographs and drawn test figures were used).

## Not included

Batch editing, animation, cloud libraries and direct VTT integration.
