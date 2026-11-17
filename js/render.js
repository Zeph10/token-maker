/* ESONJ's Token Maker: non-destructive colour and the single compositor used by preview and export. */
(function () {
  'use strict';
  var TM = window.TM, S = TM.S, Mx = TM.Mx, G = TM.G;
  TM.bypass = { art: false, border: false, final: false };

  TM.hex2rgb = function (h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  TM.rgb2hex = function (r, g, b) { return '#' + [r, g, b].map(function (v) { v = Math.round(TM.clamp(v, 0, 255)); return (v < 16 ? '0' : '') + v.toString(16); }).join(''); };

  /* brightness, contrast, saturation, temperature and hue fold into one affine RGB transform */
  TM.gradeAffine = function (g) {
    if (!g || (!g.b && !g.c && !g.s && !g.t && !g.h)) return null;
    var M = [1, 0, 0, 0, 1, 0, 0, 0, 1], o = [0, 0, 0];
    function post(N, p) {
      var R = [], q = [], i, j;
      for (i = 0; i < 3; i++) { for (j = 0; j < 3; j++) R[i * 3 + j] = N[i * 3] * M[j] + N[i * 3 + 1] * M[3 + j] + N[i * 3 + 2] * M[6 + j]; q[i] = N[i * 3] * o[0] + N[i * 3 + 1] * o[1] + N[i * 3 + 2] * o[2] + p[i]; }
      M = R; o = q;
    }
    var I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    if (g.b) post(I, [g.b * 1.2, g.b * 1.2, g.b * 1.2]);
    if (g.c) { var k = g.c >= 0 ? 1 + g.c / 60 : 1 + g.c / 110, p = 128 * (1 - k); post([k, 0, 0, 0, k, 0, 0, 0, k], [p, p, p]); }
    if (g.s) { var s = 1 + g.s / 100, a = 0.299 * (1 - s), b = 0.587 * (1 - s), c = 0.114 * (1 - s); post([a + s, b, c, a, b + s, c, a, b, c + s], [0, 0, 0]); }
    if (g.t) post(I, [g.t * 0.45, g.t * 0.08, -g.t * 0.45]);
    if (g.h) {
      var th = g.h * Math.PI / 180, co = Math.cos(th), si = Math.sin(th);
      post([0.213 + co * 0.787 - si * 0.213, 0.715 - co * 0.715 - si * 0.715, 0.072 - co * 0.072 + si * 0.928,
        0.213 - co * 0.213 + si * 0.143, 0.715 + co * 0.285 + si * 0.140, 0.072 - co * 0.072 - si * 0.283,
        0.213 - co * 0.213 - si * 0.787, 0.715 - co * 0.715 + si * 0.715, 0.072 + co * 0.928 + si * 0.072], [0, 0, 0]);
    }
    return { M: M, o: o };
  };
  /* Order: replace colour, then grade, then tint. Alpha is never touched. */
  TM.applyPixels = function (d, rep, aff, tint) {
    var fr, to, fl, tol, str, tr, ts, M = aff && aff.M, o = aff && aff.o;
    if (rep) { fr = TM.hex2rgb(rep.from); to = TM.hex2rgb(rep.to); fl = 0.299 * fr[0] + 0.587 * fr[1] + 0.114 * fr[2]; tol = Math.max(3, rep.tol * 0.9); str = rep.str / 100; }
    if (tint) { tr = TM.hex2rgb(tint.color); ts = tint.str / 100; var tl = 0.299 * tr[0] + 0.587 * tr[1] + 0.114 * tr[2]; }
    for (var i = 0, n = d.length; i < n; i += 4) {
      if (!d[i + 3]) continue;
      var r = d[i], g = d[i + 1], b = d[i + 2], l, m;
      if (rep) {
        l = 0.299 * r + 0.587 * g + 0.114 * b;
        var dy = (l - fl) * 0.3, d1 = (b - l) - (fr[2] - fl), d2 = (r - l) - (fr[0] - fl), dist = Math.sqrt(dy * dy + d1 * d1 + d2 * d2);
        if (dist < tol) {
          m = dist <= tol * 0.5 ? 1 : 1 - (dist - tol * 0.5) / (tol * 0.5); m = m * m * (3 - 2 * m) * str;
          var ratio = fl > 24 ? Math.min(2.2, l / fl) : 1, ad = fl > 24 ? 0 : l - fl;
          r += (Math.min(255, to[0] * ratio + ad) - r) * m; g += (Math.min(255, to[1] * ratio + ad) - g) * m; b += (Math.min(255, to[2] * ratio + ad) - b) * m;
        }
      }
      if (M) {
        var r2 = M[0] * r + M[1] * g + M[2] * b + o[0], g2 = M[3] * r + M[4] * g + M[5] * b + o[1], b2 = M[6] * r + M[7] * g + M[8] * b + o[2];
        r = r2 < 0 ? 0 : r2 > 255 ? 255 : r2; g = g2 < 0 ? 0 : g2 > 255 ? 255 : g2; b = b2 < 0 ? 0 : b2 > 255 ? 255 : b2;
      }
      if (tint) {
        l = 0.299 * r + 0.587 * g + 0.114 * b;
        var dl = l - tl, cr = tr[0] + dl, cg = tr[1] + dl, cb = tr[2] + dl, mn = Math.min(cr, cg, cb), mxv = Math.max(cr, cg, cb);
        if (mn < 0) { var f = l / (l - mn); cr = l + (cr - l) * f; cg = l + (cg - l) * f; cb = l + (cb - l) * f; }
        if (mxv > 255) { var f2 = (255 - l) / (mxv - l); cr = l + (cr - l) * f2; cg = l + (cg - l) * f2; cb = l + (cb - l) * f2; }
        r += (cr - r) * ts; g += (cg - g) * ts; b += (cb - b) * ts;
      }
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  };

  /* ---------- cached graded layers ---------- */
  var cache = { art: {}, border: {} }, fullTimer = 0;
  function recipe(layer) {
    if (TM.bypass[layer]) return null;
    var c = S.color[layer], tint = layer === 'border' && S.color.tint.on && S.color.tint.str > 0 ? S.color.tint : null;
    var rep = c.rep.on && c.rep.str > 0 ? c.rep : null, aff = TM.gradeAffine(c);
    if (!rep && !aff && !tint) return null;
    return { rep: rep, aff: aff, tint: tint, key: JSON.stringify([c, tint]) };
  }
  function process(src, scale, rc) {
    var c = TM.mk(src.w * scale, src.h * scale), x = TM.cx(c, { willReadFrequently: true });
    x.drawImage(src.img, 0, 0, c.width, c.height);
    var id = x.getImageData(0, 0, c.width, c.height); TM.applyPixels(id.data, rc.rep, rc.aff, rc.tint); x.putImageData(id, 0, 0);
    return c;
  }
  /* quality: 'full' (export), 'proxy' (no scheduling), undefined = interactive */
  TM.graded = function (layer, quality) {
    var src = layer === 'art' ? S.art : S.frame, rc = recipe(layer);
    if (!rc) return src.img;
    var key = src.id + rc.key, c = cache[layer], pk = Math.min(1, 1024 / Math.max(src.w, src.h));
    if (c.fullKey === key) return c.full;
    if (quality === 'full' || pk === 1) { c.full = process(src, 1, rc); c.fullKey = key; return c.full; }
    if (c.proxyKey !== key) { c.proxy = process(src, pk, rc); c.proxyKey = key; }
    if (quality !== 'proxy') {
      clearTimeout(fullTimer);
      fullTimer = setTimeout(function () { if (S.art && S.frame) { TM.graded('art', 'full'); TM.graded('border', 'full'); TM.emit('render'); } }, 450);
    }
    return c.proxy;
  };
  TM.dropGradeCache = function () { cache.art = {}; cache.border = {}; };

  var pool = {};
  function scratch(name, w, h) {
    var c = pool[name]; if (!c) c = pool[name] = TM.mk(w, h);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    var x = TM.cx(c); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.clearRect(0, 0, w, h); x.imageSmoothingQuality = 'high';
    return c;
  }
  TM.scratch = scratch;
  function finalGrade(c) {
    if (TM.bypass.final) return;
    var aff = TM.gradeAffine(S.color.final); if (!aff) return;
    var x = TM.cx(c); x.setTransform(1, 0, 0, 1, 0, 0);
    var id = x.getImageData(0, 0, c.width, c.height); TM.applyPixels(id.data, null, aff, null); x.putImageData(id, 0, 0);
  }
  TM.finalGrade = finalGrade;

  /* The compositor. M maps world units to output pixels.
   * token: lerp between two complete premultiplied orderings by pop-out weight W:
   *   A = border over (base art clipped to the opening),  B = raised art over border,  out = A*(1-W) + B*W.
   * W is raw pop-out coverage, times the subject mask only for Keep Original Background with restriction.
   * With Subject Only and restriction the subject mask is applied to the raised art instead, so alpha counts once. */
  TM.compose = function (out, M, opts) {
    opts = opts || {};
    var W = out.width, H = out.height, mode = opts.mode || 'token', q = opts.full ? 'full' : opts.proxy ? 'proxy' : undefined;
    var ox = TM.cx(out); ox.setTransform(1, 0, 0, 1, 0, 0); ox.globalCompositeOperation = 'source-over'; ox.globalAlpha = 1; ox.clearRect(0, 0, W, H);
    if (!S.art || !S.frame) return;
    var artM = Mx.mul(M, TM.artMatrix()), frM = Mx.mul(M, TM.frameMatrix()), art = S.art, mk = S.masks;
    var useSub = S.hasSubject, restrict = S.restrict && useSub;
    var gArt = mode === 'border' ? null : TM.graded('art', q), gBorder = TM.graded('border', q);
    function drawArt(x, masked) {
      Mx.set(x, artM); x.globalCompositeOperation = 'source-over'; x.drawImage(gArt, 0, 0, art.w, art.h);
      if (masked) { x.globalCompositeOperation = 'destination-in'; x.drawImage(mk.subject.c, 0, 0, art.w, art.h); x.globalCompositeOperation = 'source-over'; }
    }
    function drawBorder(x, force) {
      if (!S.frameVisible && !force) return;
      Mx.set(x, frM); x.globalCompositeOperation = 'source-over'; x.drawImage(gBorder, 0, 0, S.frame.w, S.frame.h);
    }
    function weight(x) {
      Mx.set(x, artM); x.drawImage(mk.popout.c, 0, 0, art.w, art.h);
      if (S.bgMode === 'original' && restrict) { x.globalCompositeOperation = 'destination-in'; x.drawImage(mk.subject.c, 0, 0, art.w, art.h); x.globalCompositeOperation = 'source-over'; }
    }
    function baseArt(x) {
      drawArt(x, S.bgMode === 'subject' && useSub);
      Mx.set(x, frM); x.globalCompositeOperation = 'destination-in'; x.fillStyle = '#fff'; TM.openingPath(x); x.fill(); x.globalCompositeOperation = 'source-over';
    }
    function raisedArt(x) {   // drawn over whatever is already there, so the masked case needs its own buffer
      if (!(S.bgMode === 'subject' && restrict)) return drawArt(x, false);
      var r = scratch('r', W, H); drawArt(TM.cx(r), true);
      x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.drawImage(r, 0, 0);
    }
    var a, b, w, ax, bx;
    if (mode === 'border') { drawBorder(ox, true); return; }
    if (mode === 'layer-base') { baseArt(ox); return; }
    if (mode === 'layer-pop') {
      w = scratch('w', W, H); weight(TM.cx(w));
      // art over nothing, weighted: same pixels the raised ordering contributes
      a = scratch('a', W, H); ax = TM.cx(a); raisedArt(ax); ax.setTransform(1, 0, 0, 1, 0, 0); ax.globalCompositeOperation = 'destination-in'; ax.drawImage(w, 0, 0);
      ox.drawImage(a, 0, 0); return;
    }
    if (mode === 'foundry') {
      // subject once; outside the ring guide only pop-out areas remain
      w = scratch('w', W, H); var wx = TM.cx(w); Mx.set(wx, artM); wx.drawImage(mk.popout.c, 0, 0, art.w, art.h);
      wx.setTransform(1, 0, 0, 1, 0, 0); wx.fillStyle = '#fff'; wx.beginPath(); wx.arc(W / 2, H / 2, opts.ring || W / 3, 0, Math.PI * 2); wx.fill();
      drawArt(ox, useSub); ox.setTransform(1, 0, 0, 1, 0, 0); ox.globalCompositeOperation = 'destination-in'; ox.drawImage(w, 0, 0); ox.globalCompositeOperation = 'source-over';
      if (!opts.noFinal) finalGrade(out);
      return;
    }
    a = scratch('a', W, H); ax = TM.cx(a); baseArt(ax); drawBorder(ax);
    b = scratch('b', W, H); bx = TM.cx(b); drawBorder(bx); raisedArt(bx);
    w = scratch('w', W, H); weight(TM.cx(w));
    ax.setTransform(1, 0, 0, 1, 0, 0); ax.globalCompositeOperation = 'destination-out'; ax.drawImage(w, 0, 0);
    bx.setTransform(1, 0, 0, 1, 0, 0); bx.globalCompositeOperation = 'destination-in'; bx.drawImage(w, 0, 0);
    ox.drawImage(a, 0, 0); ox.globalCompositeOperation = 'lighter'; ox.drawImage(b, 0, 0); ox.globalCompositeOperation = 'source-over';
    if (!opts.noFinal) finalGrade(out);
  };

  /* ---------- export renders ---------- */
  TM.renderToken = function (size, mode) {
    var c = TM.mk(size, size), k = size / G;
    TM.compose(c, [k, 0, 0, k, 0, 0], { full: true, mode: mode || 'token', noFinal: !!mode && mode !== 'token' });
    return c;
  };
  TM.foundryMatrix = function (size) {
    var o = TM.openingWorld(), f = S.foundry, k = (size * 2 / 3) / Math.max(o.w, o.h) * f.zoom;
    return [k, 0, 0, k, size / 2 - o.cx * k + f.dx * size, size / 2 - o.cy * k + f.dy * size];
  };
  TM.renderFoundry = function (size, proxy) {
    var c = TM.mk(size, size); TM.compose(c, TM.foundryMatrix(size), { full: !proxy, proxy: proxy, mode: 'foundry' }); return c;
  };
  TM.foundryClipped = function () {
    var N = 256, c = TM.renderFoundry(N, true), d = TM.cx(c, { willReadFrequently: true }).getImageData(0, 0, N, N).data, i;
    for (i = 0; i < N; i++) if (d[i * 4 + 3] > 12 || d[((N - 1) * N + i) * 4 + 3] > 12 || d[(i * N) * 4 + 3] > 12 || d[(i * N + N - 1) * 4 + 3] > 12) return true;
    return false;
  };
  TM.fitFoundry = function () {
    for (var pass = 0; pass < 3; pass++) {
      var N = 384, c = TM.mk(N, N), m = TM.foundryMatrix(N), z = 1 / 3;
      TM.compose(c, Mx.mul([z, 0, 0, z, N / 2 * (1 - z), N / 2 * (1 - z)], m), { proxy: true, mode: 'foundry', noFinal: true, ring: N / 3 * z });
      // the ring fill itself is not subject pixels, so measure only what compose left visible
      var d = TM.cx(c, { willReadFrequently: true }).getImageData(0, 0, N, N).data, ext = 0, x, y;
      for (y = 0; y < N; y++) for (x = 0; x < N; x++) if (d[(y * N + x) * 4 + 3] > 12) ext = Math.max(ext, Math.abs(x + 0.5 - N / 2), Math.abs(y + 0.5 - N / 2));
      if (!ext) return;
      var s = (N / 2 * z * 0.96) / (ext + 1);
      if (s >= 1) return;
      S.foundry.zoom *= s; S.foundry.dx *= s; S.foundry.dy *= s;
    }
  };
  TM.initPortrait = function (force) {
    var p = S.portrait; if (p.init && !force) return;
    var o = TM.openingWorld(), a = Mx.pt(Mx.inv(TM.artMatrix()), o.cx, o.cy), side = Math.min(S.art.w, S.art.h);
    p.cx = TM.clamp(a[0] / S.art.w, 0, 1); p.cy = TM.clamp(a[1] / S.art.h, 0, 1);
    p.zoom = TM.clamp(side / (Math.max(o.w, o.h) / S.artT.scale * 1.35), 1, 8); p.init = true;
  };
  TM.portraitRect = function () {
    var p = S.portrait, a = S.art, w, h;
    if (p.aspect === 'square') { w = h = Math.min(a.w, a.h) / p.zoom; } else { w = a.w / p.zoom; h = a.h / p.zoom; }
    var x = TM.clamp(p.cx * a.w - w / 2, 0, a.w - w), y = TM.clamp(p.cy * a.h - h / 2, 0, a.h - h);
    return { x: x, y: y, w: w, h: h };
  };
  TM.renderPortrait = function (size, proxy) {
    var r = TM.portraitRect(), k = size / Math.max(r.w, r.h), c = TM.mk(r.w * k, r.h * k), x = TM.cx(c), a = S.art;
    var g = TM.graded('art', proxy ? 'proxy' : 'full');
    if (S.artT.flip) x.setTransform(-k, 0, 0, k, (r.x + r.w) * k, -r.y * k); else x.setTransform(k, 0, 0, k, -r.x * k, -r.y * k);
    x.drawImage(g, 0, 0, a.w, a.h);
    if (S.portrait.bg === 'subject' && S.hasSubject) { x.globalCompositeOperation = 'destination-in'; x.drawImage(S.masks.subject.c, 0, 0, a.w, a.h); x.globalCompositeOperation = 'source-over'; }
    finalGrade(c); return c;
  };
  /* Preview that shows what would be cut at the guide, tinted crimson. */
  TM.renderOverflow = function (N) {
    var c = TM.mk(N, N), span = 1.6 * G, k = N / span, off = (span - G) / 2 * k;
    TM.compose(c, [k, 0, 0, k, off, off], { proxy: true });
    var x = TM.cx(c); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-atop'; x.fillStyle = 'rgba(255,45,85,.78)';
    x.beginPath(); x.rect(0, 0, N, N); x.rect(off, off, G * k, G * k); x.fill('evenodd');
    x.globalCompositeOperation = 'source-over'; x.strokeStyle = '#fff'; x.lineWidth = 2; x.setLineDash([6, 4]); x.strokeRect(off, off, G * k, G * k); x.setLineDash([]);
    return c;
  };
  /* average colour of the graded artwork, before the final grade */
  TM.sampleArtColor = function () {
    var s = TM.mk(48, 48), x = TM.cx(s, { willReadFrequently: true }), k = 48 / G; x.clearRect(0, 0, 48, 48);
    var keep = { v: S.frameVisible }; S.frameVisible = false;
    var c = TM.mk(96, 96); TM.compose(c, [96 / G, 0, 0, 96 / G, 0, 0], { mode: 'layer-base', proxy: true }); S.frameVisible = keep.v;
    var d = TM.cx(c, { willReadFrequently: true }).getImageData(0, 0, 96, 96).data, r = 0, g = 0, b = 0, n = 0;
    for (var i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    if (!n) return '#b08d57';
    r /= n; g /= n; b /= n;
    // lift saturation a little so the tint reads on metal
    var l = 0.299 * r + 0.587 * g + 0.114 * b; r = l + (r - l) * 1.5; g = l + (g - l) * 1.5; b = l + (b - l) * 1.5;
    return TM.rgb2hex(r, g, b);
  };
})();
