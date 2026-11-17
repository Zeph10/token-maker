/* ESONJ's Token Maker: core state, geometry, assets, masks, undo. */
(function () {
  'use strict';
  var TM = window.TM = { VERSION: '1.0.0' };
  var G = TM.G = 1024;               // export guide is the square [0,G] x [0,G] in world units
  TM.MASK_MAX = 2048;                // masks live in art coordinates, capped on the long side
  TM.ART_MAX = 4096;
  TM.UNDO_BYTES = 220 * 1024 * 1024;

  /* ---------- small helpers ---------- */
  TM.mk = function (w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  TM.cx = function (c, opts) { if (!c._x) { c._x = c.getContext('2d', opts || undefined); c._x.imageSmoothingQuality = 'high'; } return c._x; };
  TM.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  TM.uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); };
  var listeners = {};
  TM.on = function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); };
  TM.emit = function (ev, a) { (listeners[ev] || []).forEach(function (f) { f(a); }); };

  /* ---------- 2D affine matrices [a,b,c,d,e,f] ---------- */
  var Mx = TM.Mx = {
    id: function () { return [1, 0, 0, 1, 0, 0]; },
    mul: function (m, n) { // apply n first, then m
      return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
    },
    inv: function (m) {
      var d = m[0] * m[3] - m[1] * m[2];
      return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
    },
    pt: function (m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; },
    tr: function (x, y) { return [1, 0, 0, 1, x, y]; },
    sc: function (x, y) { return [x, 0, 0, y === undefined ? x : y, 0, 0]; },
    rot: function (a) { var c = Math.cos(a), s = Math.sin(a); return [c, s, -s, c, 0, 0]; },
    set: function (ctx, m) { ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]); }
  };

  /* ---------- state ---------- */
  function defGrade() { return { b: 0, c: 0, s: 0, t: 0, h: 0 }; }
  function defRep() { return { on: false, from: '#3a6ea5', to: '#a53a3a', tol: 30, str: 100 }; }
  TM.defColor = function () {
    return { art: Object.assign(defGrade(), { rep: defRep() }), border: Object.assign(defGrade(), { rep: defRep() }), final: defGrade(), tint: { on: false, color: '#b08d57', str: 60 } };
  };
  var S = TM.S = {
    art: null, masks: null, frame: null,
    artT: { x: G / 2, y: G / 2, scale: 1, rot: 0, flip: false },
    frameT: { x: G / 2, y: G / 2, scale: 0.8 },
    opening: { type: 'ellipse', cx: 512, cy: 512, rx: 400, ry: 400 },
    frameVisible: true, bgMode: 'original', restrict: true, hasSubject: false,
    color: TM.defColor(),
    exp: { size: 512, format: 'png', name: 'token' },
    foundry: { dx: 0, dy: 0, zoom: 1 },
    portrait: { cx: 0.5, cy: 0.5, zoom: 1, aspect: 'square', bg: 'original', init: false },
    view: { x: 0, y: 0, scale: 1 }
  };
  var SNAP_KEYS = ['artT', 'frameT', 'opening', 'frameVisible', 'bgMode', 'restrict', 'hasSubject', 'color', 'exp', 'foundry', 'portrait'];
  TM.snap = function () { var o = {}; SNAP_KEYS.forEach(function (k) { o[k] = S[k]; }); return JSON.stringify(o); };
  TM.restore = function (str) { var o = JSON.parse(str); SNAP_KEYS.forEach(function (k) { if (k in o) S[k] = o[k]; }); };

  TM.artMatrix = function (T, art) {
    T = T || S.artT; art = art || S.art;
    var m = Mx.mul(Mx.tr(T.x, T.y), Mx.rot(T.rot));
    m = Mx.mul(m, Mx.sc(T.scale * (T.flip ? -1 : 1), T.scale));
    return Mx.mul(m, Mx.tr(-art.w / 2, -art.h / 2));
  };
  TM.frameMatrix = function (F, fr) {
    F = F || S.frameT; fr = fr || S.frame;
    return Mx.mul(Mx.mul(Mx.tr(F.x, F.y), Mx.sc(F.scale)), Mx.tr(-fr.w / 2, -fr.h / 2));
  };
  TM.openingPath = function (ctx, op) {
    op = op || S.opening;
    ctx.beginPath();
    if (op.type === 'ellipse') ctx.ellipse(op.cx, op.cy, Math.max(1, op.rx), Math.max(1, op.ry), 0, 0, Math.PI * 2);
    else { op.pts.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.closePath(); }
  };
  TM.openingBox = function (op) { // in frame coordinates
    op = op || S.opening;
    if (op.type === 'ellipse') return { x: op.cx - op.rx, y: op.cy - op.ry, w: op.rx * 2, h: op.ry * 2 };
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    op.pts.forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  TM.openingWorld = function (op, F, fr) { // centre and size in world units
    var b = TM.openingBox(op), m = TM.frameMatrix(F, fr), c = Mx.pt(m, b.x + b.w / 2, b.y + b.h / 2), s = (F || S.frameT).scale;
    return { cx: c[0], cy: c[1], w: b.w * s, h: b.h * s };
  };
  TM.coverScale = function (art, op, F, fr) { var o = TM.openingWorld(op, F, fr); return Math.max(o.w / art.w, o.h / art.h); };
  TM.coverFit = function () {
    var o = TM.openingWorld();
    S.artT = { x: o.cx, y: o.cy, scale: TM.coverScale(S.art), rot: 0, flip: false };
  };

  /* ---------- masks (coverage stored in alpha, art coordinates) ---------- */
  function Mask(w, h) { this.w = w; this.h = h; this.c = TM.mk(w, h); this.prev = TM.mk(w, h); this.rev = 0; this.sid = TM.uid(); }
  TM.Mask = Mask;
  Mask.prototype.fill = function (v) {
    var x = TM.cx(this.c); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, this.w, this.h);
    if (v) { x.fillStyle = '#fff'; x.fillRect(0, 0, this.w, this.h); }
  };
  function alphaOf(c, r) { var d = TM.cx(c).getImageData(r.x, r.y, r.w, r.h).data, a = new Uint8Array(r.w * r.h); for (var i = 0; i < a.length; i++) a[i] = d[i * 4 + 3]; return a; }
  function putAlpha(c, r, a) {
    var id = new ImageData(r.w, r.h), d = id.data;
    for (var i = 0; i < a.length; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = a[i]; }
    TM.cx(c).setTransform(1, 0, 0, 1, 0, 0); TM.cx(c).putImageData(id, r.x, r.y);
  }
  TM.alphaOf = alphaOf; TM.putAlpha = putAlpha;
  /* Record the change inside rect since the last commit; returns a delta for the undo stack. */
  Mask.prototype.commit = function (which, rect) {
    var r = rect ? { x: Math.max(0, Math.floor(rect.x)), y: Math.max(0, Math.floor(rect.y)) } : { x: 0, y: 0 };
    r.w = rect ? Math.min(this.w, Math.ceil(rect.x + rect.w)) - r.x : this.w;
    r.h = rect ? Math.min(this.h, Math.ceil(rect.y + rect.h)) - r.y : this.h;
    if (r.w <= 0 || r.h <= 0) return null;
    var before = alphaOf(this.prev, r), after = alphaOf(this.c, r), same = true;
    for (var i = 0; i < before.length; i++) if (before[i] !== after[i]) { same = false; break; }
    if (same) return null;
    var p = TM.cx(this.prev); p.setTransform(1, 0, 0, 1, 0, 0); p.globalCompositeOperation = 'source-over';
    p.clearRect(0, 0, this.w, this.h); p.drawImage(this.c, 0, 0);
    this.rev++; this.sid = TM.uid();
    return { which: which, r: r, before: before, after: after };
  };
  Mask.prototype.apply = function (delta, useAfter) {
    var a = useAfter ? delta.after : delta.before;
    putAlpha(this.c, delta.r, a); putAlpha(this.prev, delta.r, a); this.rev++; this.sid = TM.uid();
  };
  Mask.prototype.revert = function () { var x = TM.cx(this.c); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, this.w, this.h); x.drawImage(this.prev, 0, 0); };
  Mask.prototype.isEmpty = function () {
    var s = TM.mk(64, 64), x = TM.cx(s, { willReadFrequently: true }); x.drawImage(this.c, 0, 0, 64, 64);
    var d = x.getImageData(0, 0, 64, 64).data; for (var i = 3; i < d.length; i += 4) if (d[i] > 6) return false; return true;
  };
  TM.newMasks = function (art) {
    var k = Math.min(1, TM.MASK_MAX / Math.max(art.w, art.h)), w = Math.round(art.w * k), h = Math.round(art.h * k);
    return { subject: new Mask(w, h), popout: new Mask(w, h), scale: w / art.w };
  };

  /* ---------- undo / redo ---------- */
  var undo = [], redo = [], committed = null;
  TM.undoInfo = function () { return { undo: undo.length, redo: redo.length, label: undo.length ? undo[undo.length - 1].label : '' }; };
  TM.markClean = function () { committed = TM.snap(); };
  TM.resetHistory = function () { undo = []; redo = []; committed = TM.snap(); TM.emit('history'); };
  function bytesOf(e) {
    var b = 2000; (e.deltas || []).forEach(function (d) { b += d.before.length * 2; });
    if (e.assets) b += 24 * 1024 * 1024; return b;
  }
  /* One call = one undo step. deltas: mask deltas; assets: {before, after} snapshots from TM.assetRef(). */
  TM.commit = function (label, deltas, assets) {
    var now = TM.snap();
    deltas = (deltas || []).filter(Boolean);
    if (now === committed && !deltas.length && !assets) return false;
    var e = { label: label, sBefore: committed, sAfter: now, deltas: deltas, assets: assets || null };
    e.bytes = bytesOf(e); undo.push(e); redo = []; committed = now;
    var total = 0; for (var i = undo.length - 1; i >= 0; i--) { total += undo[i].bytes; if (total > TM.UNDO_BYTES || undo.length - i > 80) { undo.splice(0, i + 1); break; } }
    TM.emit('history'); TM.emit('edit', label);
    return true;
  };
  TM.assetRef = function () { return { art: S.art, masks: S.masks, frame: S.frame }; };
  function step(from, to, back) {
    if (!from.length) return;
    var e = from.pop();
    if (e.assets) { var a = back ? e.assets.before : e.assets.after; S.art = a.art; S.masks = a.masks; S.frame = a.frame; TM.emit('assets'); }
    (back ? e.deltas.slice().reverse() : e.deltas).forEach(function (d) { if (S.masks) S.masks[d.which].apply(d, !back); });
    TM.restore(back ? e.sBefore : e.sAfter); committed = TM.snap();
    to.push(e); TM.emit('history'); TM.emit('edit', (back ? 'Undo ' : 'Redo ') + e.label);
  }
  TM.undo = function () { step(undo, redo, true); };
  TM.redo = function () { step(redo, undo, false); };
  TM.lastUndo = function () { return undo[undo.length - 1]; };

  /* ---------- image decoding ---------- */
  TM.decode = function (blob) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(blob), im = new Image();
      im.onload = function () { URL.revokeObjectURL(url); if (!im.naturalWidth) return rej(new Error('empty image')); res(im); };
      im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('This file is not an image the browser can read.')); };
      im.src = url;
    });
  };
  TM.hasAlpha = function (img, w, h) {
    var s = TM.mk(128, 128), x = TM.cx(s, { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h, 0, 0, 128, 128);
    var d = x.getImageData(0, 0, 128, 128).data; for (var i = 3; i < d.length; i += 4) if (d[i] < 250) return true; return false;
  };
  TM.makeArt = async function (blob, name) {
    var im = await TM.decode(blob), k = Math.min(1, TM.ART_MAX / Math.max(im.naturalWidth, im.naturalHeight));
    var c = TM.mk(im.naturalWidth * k, im.naturalHeight * k); TM.cx(c).drawImage(im, 0, 0, c.width, c.height);
    return { img: c, w: c.width, h: c.height, blob: blob, name: name || 'artwork', id: TM.uid(), hasAlpha: TM.hasAlpha(c, c.width, c.height) };
  };
  TM.makeFrame = async function (blob, name, builtin) {
    var im = await TM.decode(blob), k = Math.min(1, 2048 / Math.max(im.naturalWidth, im.naturalHeight));
    var c = TM.mk(im.naturalWidth * k, im.naturalHeight * k); TM.cx(c).drawImage(im, 0, 0, c.width, c.height);
    return { img: c, w: c.width, h: c.height, blob: blob, name: name || 'border', id: TM.uid(), builtin: builtin || null };
  };
  TM.canvasBlob = function (c, type, q) {
    return new Promise(function (res, rej) { c.toBlob(function (b) { b ? res(b) : rej(new Error('The browser could not encode this image.')); }, type || 'image/png', q); });
  };

  /* ---------- built-in round frame ---------- */
  TM.BUILTIN_OPENING = { type: 'ellipse', cx: 512, cy: 512, rx: 400, ry: 400 };
  TM.drawBuiltinFrame = function () {
    var c = TM.mk(1024, 1024), x = TM.cx(c), R = 480, r = 392, i;
    function ring(ro, ri, fill) { x.beginPath(); x.arc(512, 512, ro, 0, Math.PI * 2); x.closePath(); x.arc(512, 512, ri, 0, Math.PI * 2, true); x.closePath(); x.fillStyle = fill; x.fill('evenodd'); }
    var g = x.createLinearGradient(140, 60, 880, 960);
    g.addColorStop(0, '#f3d79a'); g.addColorStop(0.22, '#b98a3e'); g.addColorStop(0.5, '#6e4a1c'); g.addColorStop(0.74, '#c79a4c'); g.addColorStop(1, '#4a2f10');
    ring(R, r, g);
    var g2 = x.createLinearGradient(880, 960, 140, 60);
    g2.addColorStop(0, '#f6e0ac'); g2.addColorStop(0.5, '#8a6126'); g2.addColorStop(1, '#3a2409');
    ring(R - 14, R - 30, g2); ring(r + 22, r + 8, g2);
    ring(R, R - 5, '#2a1a08'); ring(r + 5, r, '#22140a');
    x.save(); x.beginPath(); x.arc(512, 512, R - 30, 0, Math.PI * 2); x.closePath(); x.arc(512, 512, r + 22, 0, Math.PI * 2, true); x.closePath(); x.clip('evenodd');
    x.globalAlpha = 0.16; x.strokeStyle = '#000'; x.lineWidth = 2;
    for (i = 0; i < 72; i++) { var a = i / 72 * Math.PI * 2; x.beginPath(); x.moveTo(512 + Math.cos(a) * 380, 512 + Math.sin(a) * 380); x.lineTo(512 + Math.cos(a + 0.05) * 480, 512 + Math.sin(a + 0.05) * 480); x.stroke(); }
    x.restore();
    for (i = 0; i < 12; i++) {
      var an = i / 12 * Math.PI * 2 - Math.PI / 2, px = 512 + Math.cos(an) * 432, py = 512 + Math.sin(an) * 432;
      var rg = x.createRadialGradient(px - 4, py - 5, 1, px, py, 13); rg.addColorStop(0, '#fff3cf'); rg.addColorStop(0.5, '#c2913f'); rg.addColorStop(1, '#3b250b');
      x.beginPath(); x.arc(px, py, 12, 0, 7); x.fillStyle = rg; x.fill();
    }
    return c;
  };

  /* ---------- demo artwork (drawn locally, no network) ---------- */
  function sword(x) {
    x.save(); x.translate(770, 830); x.rotate(Math.atan2(-720, 330) + Math.PI / 2);
    var g = x.createLinearGradient(-22, 0, 22, 0); g.addColorStop(0, '#8fa3b5'); g.addColorStop(0.48, '#f2f7fb'); g.addColorStop(0.52, '#9fb2c2'); g.addColorStop(1, '#5d6f80');
    x.beginPath(); x.moveTo(-22, -60); x.lineTo(-18, -700); x.lineTo(0, -790); x.lineTo(18, -700); x.lineTo(22, -60); x.closePath(); x.fillStyle = g; x.fill();
    x.strokeStyle = '#2c3640'; x.lineWidth = 4; x.stroke();
    x.fillStyle = '#c9a24a'; x.strokeStyle = '#4d3a12'; x.lineWidth = 4;
    x.beginPath(); x.roundRect(-78, -74, 156, 30, 10); x.fill(); x.stroke();
    x.fillStyle = '#5a2e1a'; x.beginPath(); x.roundRect(-15, -46, 30, 120, 8); x.fill(); x.stroke();
    x.fillStyle = '#c9a24a'; x.beginPath(); x.arc(0, 88, 22, 0, 7); x.fill(); x.stroke();
    x.restore();
  }
  function plume(x) {
    x.save();
    var g = x.createLinearGradient(520, 330, 200, 110); g.addColorStop(0, '#8e1022'); g.addColorStop(0.5, '#e02a44'); g.addColorStop(1, '#ff7a6b');
    x.beginPath(); x.moveTo(548, 352); x.bezierCurveTo(470, 250, 330, 150, 168, 104); x.bezierCurveTo(250, 190, 300, 250, 330, 300);
    x.bezierCurveTo(260, 262, 214, 250, 150, 252); x.bezierCurveTo(260, 300, 380, 360, 500, 392); x.closePath();
    x.fillStyle = g; x.fill(); x.strokeStyle = '#4d0812'; x.lineWidth = 5; x.stroke();
    x.strokeStyle = 'rgba(255,220,210,.55)'; x.lineWidth = 3; x.beginPath(); x.moveTo(530, 366); x.bezierCurveTo(440, 280, 320, 180, 190, 118); x.stroke();
    x.restore();
  }
  function figure(x) {
    // cloak and shoulders
    var g = x.createLinearGradient(300, 600, 900, 1200); g.addColorStop(0, '#24406b'); g.addColorStop(1, '#101c33');
    x.beginPath(); x.moveTo(250, 1200); x.bezierCurveTo(260, 900, 380, 760, 520, 720); x.lineTo(690, 720); x.bezierCurveTo(840, 760, 950, 900, 960, 1200); x.closePath();
    x.fillStyle = g; x.fill(); x.strokeStyle = '#0a1222'; x.lineWidth = 6; x.stroke();
    // breastplate
    var gb = x.createLinearGradient(470, 760, 740, 1100); gb.addColorStop(0, '#c3ccd6'); gb.addColorStop(1, '#5b6876');
    x.beginPath(); x.moveTo(470, 770); x.lineTo(740, 770); x.lineTo(760, 1200); x.lineTo(450, 1200); x.closePath(); x.fillStyle = gb; x.fill(); x.stroke();
    x.fillStyle = '#c9a24a'; x.beginPath(); x.moveTo(605, 850); x.lineTo(650, 930); x.lineTo(605, 1010); x.lineTo(560, 930); x.closePath(); x.fill(); x.stroke();
    // neck, face
    x.fillStyle = '#b97b56'; x.beginPath(); x.roundRect(560, 640, 90, 130, 20); x.fill(); x.stroke();
    var gf = x.createLinearGradient(500, 420, 700, 700); gf.addColorStop(0, '#e9b48c'); gf.addColorStop(1, '#c58a63');
    x.beginPath(); x.ellipse(605, 560, 112, 138, 0, 0, 7); x.fillStyle = gf; x.fill(); x.stroke();
    x.fillStyle = '#1b1310'; x.beginPath(); x.ellipse(562, 555, 13, 9, 0, 0, 7); x.ellipse(650, 555, 13, 9, 0, 0, 7); x.fill();
    x.strokeStyle = '#5b2f1c'; x.lineWidth = 5; x.beginPath(); x.moveTo(575, 632); x.quadraticCurveTo(606, 648, 640, 630); x.stroke();
    x.beginPath(); x.moveTo(538, 528); x.lineTo(585, 536); x.moveTo(628, 536); x.lineTo(674, 528); x.stroke();
    // helmet
    var gh = x.createLinearGradient(480, 330, 730, 520); gh.addColorStop(0, '#dfe6ee'); gh.addColorStop(1, '#6b7887');
    x.strokeStyle = '#0a1222'; x.lineWidth = 6;
    x.beginPath(); x.moveTo(478, 520); x.bezierCurveTo(470, 380, 540, 320, 606, 320); x.bezierCurveTo(680, 320, 742, 380, 734, 520);
    x.lineTo(700, 500); x.lineTo(606, 486); x.lineTo(512, 500); x.closePath(); x.fillStyle = gh; x.fill(); x.stroke();
    x.fillStyle = '#c9a24a'; x.beginPath(); x.roundRect(590, 330, 32, 170, 8); x.fill(); x.stroke();
    // sword arm and gauntlet
    x.fillStyle = '#1b3157'; x.beginPath(); x.moveTo(720, 790); x.bezierCurveTo(820, 780, 850, 850, 800, 900); x.lineTo(730, 880); x.closePath(); x.fill(); x.stroke();
    x.fillStyle = '#8a97a6'; x.beginPath(); x.ellipse(772, 842, 46, 40, -0.4, 0, 7); x.fill(); x.stroke();
  }
  function backdrop(x) {
    var g = x.createLinearGradient(0, 0, 0, 1200); g.addColorStop(0, '#2b1f3d'); g.addColorStop(0.55, '#3d2a35'); g.addColorStop(1, '#17131c');
    x.fillStyle = g; x.fillRect(0, 0, 1200, 1200);
    x.fillStyle = 'rgba(0,0,0,.28)';
    for (var r = 0; r < 9; r++) for (var c = 0; c < 7; c++) { x.fillRect(c * 190 - (r % 2) * 95 + 6, r * 140 + 6, 178, 128); }
    var t = x.createRadialGradient(210, 520, 10, 210, 520, 420); t.addColorStop(0, 'rgba(255,170,80,.75)'); t.addColorStop(1, 'rgba(255,140,60,0)');
    x.fillStyle = t; x.fillRect(0, 0, 1200, 1200);
    x.fillStyle = '#3a2413'; x.fillRect(196, 520, 28, 150); x.fillStyle = '#ffcf7a'; x.beginPath(); x.ellipse(210, 500, 26, 44, 0, 0, 7); x.fill();
  }
  TM.drawDemo = function () {
    var art = TM.mk(1200, 1200), a = TM.cx(art); backdrop(a); plume(a); figure(a); sword(a);
    var sub = TM.mk(1200, 1200), s = TM.cx(sub); plume(s); figure(s); sword(s);
    var pop = TM.mk(1200, 1200), p = TM.cx(pop); plume(p); sword(p);
    return { art: art, subject: sub, popout: pop };
  };

  /* ---------- world-space measurement of the visible composite ---------- */
  TM.measure = function () {
    if (!S.art) return { empty: true, overflow: false };
    var N = 384, span = 3 * G, k = N / span, c = TM._measureC || (TM._measureC = TM.mk(N, N));
    TM.compose(c, [k, 0, 0, k, G * k, G * k], { noFinal: true, proxy: true });
    var d = TM.cx(c, { willReadFrequently: true }).getImageData(0, 0, N, N).data, x0 = N, y0 = N, x1 = -1, y1 = -1, x, y;
    for (y = 0; y < N; y++) for (x = 0; x < N; x++) if (d[(y * N + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return { empty: true, overflow: false };
    var b = { x0: x0 / k - G, y0: y0 / k - G, x1: (x1 + 1) / k - G, y1: (y1 + 1) / k - G }, e = 1 / k;
    return { box: b, overflow: b.x0 < -e || b.y0 < -e || b.x1 > G + e || b.y1 > G + e };
  };
  /* Fit Token: scale art and frame together so the whole visible composite sits inside the guide. */
  TM.fitToken = function () {
    for (var pass = 0; pass < 3; pass++) {
      var m = TM.measure(); if (m.empty) return false;
      var b = m.box, bw = b.x1 - b.x0, bh = b.y1 - b.y0, s = G * 0.94 / Math.max(bw, bh), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      if (pass && Math.abs(s - 1) < 0.004 && Math.abs(cx - G / 2) < 3 && Math.abs(cy - G / 2) < 3) break;
      [S.artT, S.frameT].forEach(function (T) { T.x = (T.x - cx) * s + G / 2; T.y = (T.y - cy) * s + G / 2; T.scale *= s; });
    }
    return true;
  };
})();
