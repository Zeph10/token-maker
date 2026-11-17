/* ESONJ's Token Maker: browser-local cutout engine.
 * Runs U2-NetP (salient object detection) with ONNX Runtime Web, single-thread WASM.
 * Loaded inside cutout-worker.js, or on the page itself when workers are unavailable.
 * Preprocessing follows the reference U-2-Net / rembg pipeline for this checkpoint:
 *   stretch to 320x320, RGB / max(RGB), then (x - mean) / std per channel, NCHW float32.
 * Output: first output tensor (d0, sigmoid already applied), 1x1x320x320, min-max normalised.
 */
(function (g) {
  'use strict';
  var MODEL = {
    id: 'u2netp',
    file: 'models/u2netp.onnx.wasm',
    size: 320,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
    runtime: 'onnxruntime-web 1.19.2 (wasm, 1 thread)'
  };
  var session = null, loading = null;

  async function fetchBuf(url, stage, onp) {
    var r = await fetch(url);
    if (!r.ok) throw new Error(stage + ' asset failed to load (HTTP ' + r.status + ')');
    var total = +(r.headers.get('content-length') || 0);
    if (!r.body || !r.body.getReader || !total) { onp({ stage: stage, p: -1 }); return await r.arrayBuffer(); }
    var reader = r.body.getReader(), chunks = [], got = 0;
    for (;;) {
      var s = await reader.read();
      if (s.done) break;
      chunks.push(s.value); got += s.value.length;
      onp({ stage: stage, p: Math.min(1, got / total) });
    }
    var out = new Uint8Array(got), o = 0;
    for (var i = 0; i < chunks.length; i++) { out.set(chunks[i], o); o += chunks[i].length; }
    return out.buffer;
  }
  function injectScript(url) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = url; s.onload = res; s.onerror = function () { rej(new Error('runtime script blocked')); };
      document.head.appendChild(s);
    });
  }
  function init(base, onp, opts) {
    opts = opts || {}; onp = onp || function () {};
    if (session) return Promise.resolve();
    if (loading) return loading;
    loading = (async function () {
      if (!g.ort) {
        if (typeof importScripts === 'function') importScripts(base + 'vendor/ort.wasm.min.js');
        else await injectScript(base + 'vendor/ort.wasm.min.js');
      }
      var ort = g.ort;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      var wasm = await fetchBuf(base + 'vendor/ort-wasm-simd-threaded.wasm', 'runtime', onp);
      ort.env.wasm.wasmBinary = wasm;
      if (opts.blobMjs) {
        var txt = await (await fetch(base + 'vendor/ort-wasm-simd-threaded.mjs')).text();
        ort.env.wasm.wasmPaths = { mjs: URL.createObjectURL(new Blob([txt], { type: 'text/javascript' })) };
      } else {
        ort.env.wasm.wasmPaths = base + 'vendor/';
      }
      var model = await fetchBuf(base + MODEL.file, 'model', onp);
      onp({ stage: 'compile', p: -1 });
      session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'] });
    })();
    loading.catch(function () { loading = null; });
    return loading;
  }
  /* rgba: Uint8ClampedArray of a 320x320 opaque RGBA image. Returns Uint8Array(320*320) coverage. */
  async function run(rgba) {
    var n = MODEL.size * MODEL.size, x = new Float32Array(3 * n), mx = 1, i;
    for (i = 0; i < n * 4; i += 4) { if (rgba[i] > mx) mx = rgba[i]; if (rgba[i + 1] > mx) mx = rgba[i + 1]; if (rgba[i + 2] > mx) mx = rgba[i + 2]; }
    for (i = 0; i < n; i++) {
      x[i] = (rgba[i * 4] / mx - MODEL.mean[0]) / MODEL.std[0];
      x[n + i] = (rgba[i * 4 + 1] / mx - MODEL.mean[1]) / MODEL.std[1];
      x[2 * n + i] = (rgba[i * 4 + 2] / mx - MODEL.mean[2]) / MODEL.std[2];
    }
    var feeds = {};
    feeds[session.inputNames[0]] = new g.ort.Tensor('float32', x, [1, 3, MODEL.size, MODEL.size]);
    var out = await session.run(feeds);
    var d = out[session.outputNames[0]].data, lo = Infinity, hi = -Infinity;
    for (i = 0; i < n; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
    var m = new Uint8Array(n), k = hi - lo > 1e-6 ? 255 / (hi - lo) : 0;
    for (i = 0; i < n; i++) m[i] = Math.round((d[i] - lo) * k);
    return m;
  }
  g.CutoutEngine = { MODEL: MODEL, init: init, run: run };
})(typeof self !== 'undefined' ? self : this);
