/* ESONJ's Token Maker: auto-cutout client, local edge refinement, frame opening detection. */
(function () {
  'use strict';
  var TM = window.TM, S = TM.S;
  var base = new URL('./', document.baseURI).href;
  var worker = null, busy = false, pending = null, seq = 0, job = null;
  var paths = ['worker', 'worker-blob', 'main'], pathIdx = 0;
  TM.cut = { path: null, lastMs: 0, error: null, model: 'U2-NetP, ONNX Runtime Web 1.19.2 (WASM, 1 thread)' };

  function input320() {
    var c = TM.mk(320, 320), x = TM.cx(c, { willReadFrequently: true });
    x.fillStyle = '#fff'; x.fillRect(0, 0, 320, 320); x.imageSmoothingQuality = 'high';
    // step down for large sources so the stretch to 320 is properly filtered
    var src = S.art.img, w = S.art.w, h = S.art.h;
    while (w > 1280 || h > 1280) { var t = TM.mk(w / 2, h / 2); TM.cx(t).drawImage(src, 0, 0, t.width, t.height); src = t; w = t.width; h = t.height; }
    x.drawImage(src, 0, 0, 320, 320);
    return x.getImageData(0, 0, 320, 320).data;
  }
  function workerInfer(id, rgba, onp, blobMjs) {
    return new Promise(function (res, rej) {
      try { if (!worker) worker = new Worker(base + 'cutout-worker.js' + (blobMjs ? '?blobmjs=1' : '')); }
      catch (e) { return rej(new Error('workers are blocked here')); }
      busy = true;
      var w = worker, timer = setTimeout(function () { fail(new Error('the model did not respond in time')); }, 120000);
      function done() { clearTimeout(timer); busy = false; pending = null; }
      function fail(e) { done(); try { w.terminate(); } catch (x) {} if (worker === w) worker = null; rej(e); }
      pending = { cancel: function () { fail(new Error('cancelled')); } };
      w.onerror = function (e) { fail(new Error('worker failed: ' + (e.message || 'could not start'))); };
      w.onmessage = function (e) {
        var m = e.data; if (m.id !== id) return;
        if (m.type === 'progress') onp(m);
        else if (m.type === 'result') { done(); TM.cut.lastMs = m.ms; res(m.mask); }
        else if (m.type === 'error') fail(new Error(m.message));
      };
      w.postMessage({ type: 'run', id: id, rgba: rgba });
    });
  }
  async function mainInfer(rgba, onp) {
    if (!window.CutoutEngine) await new Promise(function (res, rej) { var s = document.createElement('script'); s.src = base + 'cutout-engine.js'; s.onload = res; s.onerror = function () { rej(new Error('engine script blocked')); }; document.head.appendChild(s); });
    await window.CutoutEngine.init(base, onp);
    onp({ stage: 'infer', p: -1 });
    var t = Date.now(), m = await window.CutoutEngine.run(rgba); TM.cut.lastMs = Date.now() - t; return m;
  }
  async function infer(id, rgba, onp) {
    var lastErr;
    for (; pathIdx < paths.length; pathIdx++) {
      var p = paths[pathIdx];
      try {
        var m = p === 'main' ? await mainInfer(rgba, onp) : await workerInfer(id, rgba, onp, p === 'worker-blob');
        TM.cut.path = p; TM.cut.error = null; return m;
      } catch (e) { if (e.message === 'cancelled') throw e; lastErr = e; }
    }
    pathIdx = 0; TM.cut.error = lastErr && lastErr.message;
    throw new Error('Auto-cutout could not load on this host (' + (lastErr && lastErr.message) + '). Manual masks still work.');
  }
  function upscale(m) {
    var s = TM.mk(320, 320), id = new ImageData(320, 320), d = id.data, i;
    for (i = 0; i < m.length; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = m[i]; }
    TM.cx(s).putImageData(id, 0, 0);
    var mk = S.masks.subject, c = TM.mk(mk.w, mk.h), x = TM.cx(c, { willReadFrequently: true });
    x.imageSmoothingQuality = 'high'; x.drawImage(s, 0, 0, mk.w, mk.h);
    // the 320 px prediction is soft after upscaling; firm the edge without moving it
    var im = x.getImageData(0, 0, mk.w, mk.h), a = im.data, lut = new Uint8Array(256);
    for (i = 0; i < 256; i++) { var t = TM.clamp((i / 255 - 0.18) / 0.44, 0, 1); lut[i] = Math.round(t * t * (3 - 2 * t) * 255); }
    for (i = 3; i < a.length; i += 4) a[i] = lut[a[i]];
    x.putImageData(im, 0, 0);
    return c;
  }
  /* Resolves to a candidate mask canvas, or null when the job was cancelled, superseded or outdated. */
  TM.cutoutRun = async function (onp) {
    TM.cutoutCancel();
    var id = ++seq, artId = S.art.id, sid = S.masks.subject.sid, me = job = { id: id };
    var mask;
    try { mask = await infer(id, input320(), function (p) { if (job === me) onp(p); }); }
    catch (e) { if (job === me) job = null; if (e.message === 'cancelled') return null; throw e; }
    if (job !== me || !S.art || S.art.id !== artId || S.masks.subject.sid !== sid) return null;
    job = null;
    var cand = upscale(mask);
    TM.autoRefine(cand);
    return cand;
  };
  TM.cutoutCancel = function () { var had = !!job; job = null; if (pending) pending.cancel(); return had; };
  TM.cutoutBusy = function () { return !!job; };

  /* ---------- local colour-based alpha estimation ---------- */
  function integral(src, w, h) {
    var W = w + 1, I = new Float64Array(W * (h + 1)), x, y, row;
    for (y = 0; y < h; y++) { row = 0; for (x = 0; x < w; x++) { row += src[y * w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row; } }
    return I;
  }
  function boxSum(I, W, x0, y0, x1, y1) { return I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0]; }
  /* alpha: Uint8Array w*h (edited in place). rgba: art pixels for the same tile. brush: Uint8Array coverage or null.
   * Confident foreground/background pixels near each unknown pixel give local colour models F and B;
   * alpha = projection of the pixel colour on the B->F line. Pixels with brush 0 never change. */
  TM.refineTile = function (alpha, rgba, brush, w, h, band, strength) {
    var n = w * h, W = w + 1, i, x, y;
    var a0 = new Float32Array(n); for (i = 0; i < n; i++) a0[i] = alpha[i] / 255;
    var Ia = integral(a0, w, h), fm = new Float32Array(n), bm = new Float32Array(n), t = new Float32Array(n);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var x0 = Math.max(0, x - band), y0 = Math.max(0, y - band), x1 = Math.min(w, x + band + 1), y1 = Math.min(h, y + band + 1);
      var ab = boxSum(Ia, W, x0, y0, x1, y1) / ((x1 - x0) * (y1 - y0)); i = y * w + x;
      if (ab >= 0.985) fm[i] = 1; else if (ab <= 0.015) bm[i] = 1;
    }
    function chan(mask, c) { for (var k = 0; k < n; k++) t[k] = mask[k] ? rgba[k * 4 + c] : 0; return integral(t, w, h); }
    var Fn = integral(fm, w, h), Bn = integral(bm, w, h);
    var F = [chan(fm, 0), chan(fm, 1), chan(fm, 2)], B = [chan(bm, 0), chan(bm, 1), chan(bm, 2)], R = band * 3 + 2, changed = false;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      if (fm[i] || bm[i]) continue;
      var bc = brush ? brush[i] / 255 : 1; if (bc <= 0) continue;
      var X0 = Math.max(0, x - R), Y0 = Math.max(0, y - R), X1 = Math.min(w, x + R + 1), Y1 = Math.min(h, y + R + 1);
      var nf = boxSum(Fn, W, X0, Y0, X1, Y1), nb = boxSum(Bn, W, X0, Y0, X1, Y1);
      if (nf < 6 || nb < 6) continue;
      var fr = boxSum(F[0], W, X0, Y0, X1, Y1) / nf, fg = boxSum(F[1], W, X0, Y0, X1, Y1) / nf, fb = boxSum(F[2], W, X0, Y0, X1, Y1) / nf;
      var br = boxSum(B[0], W, X0, Y0, X1, Y1) / nb, bg = boxSum(B[1], W, X0, Y0, X1, Y1) / nb, bb = boxSum(B[2], W, X0, Y0, X1, Y1) / nb;
      var dr = fr - br, dg = fg - bg, db = fb - bb, den = dr * dr + dg * dg + db * db;
      if (den < 350) continue;                          // colours too alike to separate: keep the hand-made edge
      var est = ((rgba[i * 4] - br) * dr + (rgba[i * 4 + 1] - bg) * dg + (rgba[i * 4 + 2] - bb) * db) / den;
      est = est < 0 ? 0 : est > 1 ? 1 : est;
      var k = strength * bc * Math.min(1, den / 2400), v = Math.round((a0[i] + (est - a0[i]) * k) * 255);
      if (v !== alpha[i]) { alpha[i] = v; changed = true; }
    }
    return changed;
  };
  /* Run refineTile over a rect of a mask canvas (art coordinates at mask scale), in padded tiles. */
  TM.refineRect = function (maskCanvas, rect, brushCanvas, band, strength) {
    var mw = maskCanvas.width, mh = maskCanvas.height, T = 640, pad = band * 3 + 4, any = false;
    var k = S.art.w / mw;
    for (var ty = rect.y; ty < rect.y + rect.h; ty += T) for (var tx = rect.x; tx < rect.x + rect.w; tx += T) {
      var ix1 = Math.min(rect.x + rect.w, tx + T), iy1 = Math.min(rect.y + rect.h, ty + T);
      var px = Math.max(0, tx - pad), py = Math.max(0, ty - pad), pw = Math.min(mw, ix1 + pad) - px, ph = Math.min(mh, iy1 + pad) - py;
      if (pw <= 0 || ph <= 0) continue;
      var r = { x: px, y: py, w: pw, h: ph }, alpha = TM.alphaOf(maskCanvas, r), lo = 255, hi = 0, q;
      for (q = 0; q < alpha.length; q += 3) { if (alpha[q] < lo) lo = alpha[q]; if (alpha[q] > hi) hi = alpha[q]; }
      if (lo === hi) continue;
      var ac = TM.scratch('refArt', pw, ph), ax = TM.cx(ac);
      ax.drawImage(S.art.img, px * k, py * k, pw * k, ph * k, 0, 0, pw, ph);
      var rgba = ax.getImageData(0, 0, pw, ph).data, brush = brushCanvas ? TM.alphaOf(brushCanvas, r) : null;
      if (!TM.refineTile(alpha, rgba, brush, pw, ph, band, strength)) continue;
      // write back only the inner tile so padded context stays untouched
      var ir = { x: tx, y: ty, w: ix1 - tx, h: iy1 - ty }, out = new Uint8Array(ir.w * ir.h), yy, xx;
      for (yy = 0; yy < ir.h; yy++) for (xx = 0; xx < ir.w; xx++) out[yy * ir.w + xx] = alpha[(yy + ty - py) * pw + (xx + tx - px)];
      TM.putAlpha(maskCanvas, ir, out); any = true;
    }
    return any;
  };
  /* After detection: one gentle colour-aware pass over the whole edge. */
  TM.autoRefine = function (cand) {
    try {
      var band = Math.max(3, Math.round(Math.max(cand.width, cand.height) / 320));
      TM.refineRect(cand, { x: 0, y: 0, w: cand.width, h: cand.height }, null, band, 0.6);
    } catch (e) { /* keep the unrefined candidate */ }
  };

  /* ---------- opening detection for uploaded borders ---------- */
  TM.detectOpening = function (fr) {
    var N = 400, k = Math.min(1, N / Math.max(fr.w, fr.h)), w = Math.max(8, Math.round(fr.w * k)), h = Math.max(8, Math.round(fr.h * k));
    var c = TM.mk(w, h), x = TM.cx(c, { willReadFrequently: true }); x.drawImage(fr.img, 0, 0, w, h);
    var d = x.getImageData(0, 0, w, h).data, n = w * h, lab = new Int32Array(n), comps = [], stack = new Int32Array(n), i, opaque = 0;
    for (i = 0; i < n; i++) if (d[i * 4 + 3] >= 40) { lab[i] = -1; opaque++; }
    var fallback = function (reason) {
      var r = Math.min(fr.w, fr.h) * 0.36;
      return { opening: { type: 'ellipse', cx: fr.w / 2, cy: fr.h / 2, rx: r, ry: r }, detected: false, reason: reason };
    };
    if (opaque === n) return fallback('This border has no transparency, so the opening starts as an adjustable ellipse.');
    for (i = 0; i < n; i++) {
      if (lab[i]) continue;
      var id = comps.length + 1, sp = 0, cp = { area: 0, edge: false, x0: w, y0: h, x1: 0, y1: 0, sx: 0, sy: 0, id: id };
      stack[sp++] = i; lab[i] = id;
      while (sp) {
        var p = stack[--sp], px = p % w, py = (p / w) | 0;
        cp.area++; cp.sx += px; cp.sy += py;
        if (px < cp.x0) cp.x0 = px; if (px > cp.x1) cp.x1 = px; if (py < cp.y0) cp.y0 = py; if (py > cp.y1) cp.y1 = py;
        if (px === 0 || py === 0 || px === w - 1 || py === h - 1) cp.edge = true;
        if (px > 0 && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
        if (px < w - 1 && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
        if (py > 0 && !lab[p - w]) { lab[p - w] = id; stack[sp++] = p - w; }
        if (py < h - 1 && !lab[p + w]) { lab[p + w] = id; stack[sp++] = p + w; }
      }
      comps.push(cp);
    }
    // exterior-connected transparency and tiny decorative holes do not qualify
    var ok = comps.filter(function (cp) { return !cp.edge && cp.area >= n * 0.03; });
    if (ok.length !== 1) return fallback(ok.length ? 'This border has more than one enclosed region, so the opening starts as an adjustable ellipse.' : 'No enclosed transparent region was found (the rim may have a gap), so the opening starts as an adjustable ellipse.');
    var o = ok[0], cx = (o.x0 + o.x1 + 1) / 2, cy = (o.y0 + o.y1 + 1) / 2, rx = (o.x1 - o.x0 + 1) / 2, ry = (o.y1 - o.y0 + 1) / 2, grow = 2.5;
    var ratio = o.area / (Math.PI * rx * ry);
    if (ratio > 0.955 && ratio < 1.03) return { opening: { type: 'ellipse', cx: cx / k, cy: cy / k, rx: (rx + grow) / k, ry: (ry + grow) / k }, detected: true };
    var gx = o.sx / o.area, gy = o.sy / o.area, pts = [], R = Math.hypot(w, h);
    if (lab[Math.round(gy) * w + Math.round(gx)] !== o.id) { gx = cx; gy = cy; }
    for (var a = 0; a < 72; a++) {
      var th = a / 72 * Math.PI * 2, dx = Math.cos(th), dy = Math.sin(th), last = 0;
      for (var t = 0; t < R; t += 0.5) {
        var qx = Math.round(gx + dx * t), qy = Math.round(gy + dy * t);
        if (qx < 0 || qy < 0 || qx >= w || qy >= h) break;
        if (lab[qy * w + qx] === o.id) last = t; else if (t - last > 3) break;
      }
      pts.push([(gx + dx * (last + grow)) / k, (gy + dy * (last + grow)) / k]);
    }
    return { opening: { type: 'poly', pts: pts }, detected: true };
  };
})();
