/* ESONJ's Token Maker: canvas view, pointer and touch input, inspector. */
(function () {
  'use strict';
  var TM = window.TM, S = TM.S, Mx = TM.Mx, G = TM.G;
  var $ = function (id) { return document.getElementById(id); };
  var UI = TM.UI = {
    tool: 'compose', target: 'art', maskTarget: 'popout', brushTool: 'brush', brushMode: 'add', size: 44, soft: 40, feather: 3, edgeStr: 80,
    overlay: true, isolated: false, adjust: false, tracing: null, colorLayer: 'art', picking: null, candidate: null, overflow: false,
    hover: null, space: false, edgeBefore: false, lastEdge: null, openNote: ''
  };
  function h(tag, attrs, kids) {
    var e = document.createElement(tag), k;
    for (k in attrs || {}) { if (k === 'text') e.textContent = attrs[k]; else if (k.slice(0, 2) === 'on') e[k] = attrs[k]; else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]); }
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  TM.h = h;
  var cv = $('view'), ctx = cv.getContext('2d'), stage = $('stage'), dpr = 1, raf = 0, ctl = [], uidN = 0;

  /* ---------- toast ---------- */
  var toastT = 0;
  function toast(msg, ms, actions) {
    var t = $('toast'); t.textContent = ''; t.appendChild(h('span', { text: msg }));
    (actions || []).forEach(function (a) { t.appendChild(h('button', { class: 'btn small', type: 'button', text: a[0], onclick: function () { t.hidden = true; a[1](); } })); });
    t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, ms || 4200);
  }

  /* ---------- view ---------- */
  function viewM() { var v = S.view; return [v.scale, 0, 0, v.scale, v.x, v.y]; }
  function fitView() {
    var w = stage.clientWidth, hh = stage.clientHeight, drawer = $('insp'), cut = 0;
    if (window.matchMedia('(max-width:860px)').matches && !drawer.classList.contains('closed')) cut = Math.min(hh * 0.52, drawer.offsetHeight);
    var s = Math.min(w, hh - cut) / (G * 1.22); S.view = { scale: s, x: (w - G * s) / 2, y: (hh - cut - G * s) / 2 }; render();
  }
  function evPt(e) { var r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function toWorld(p) { return Mx.pt(Mx.inv(viewM()), p[0], p[1]); }
  function render() { if (!raf) raf = requestAnimationFrame(draw); }
  var checker = null;
  function checkerPat() { if (!checker) { var c = TM.mk(24, 24), x = TM.cx(c); x.fillStyle = '#3a363f'; x.fillRect(0, 0, 24, 24); x.fillStyle = '#28252c'; x.fillRect(0, 0, 12, 12); x.fillRect(12, 12, 12, 12); checker = ctx.createPattern(c, 'repeat'); } return checker; }
  function tinted(name, src, color, m) {
    var c = TM.scratch(name, cv.width, cv.height), x = TM.cx(c);
    x.fillStyle = color; x.fillRect(0, 0, c.width, c.height); x.globalCompositeOperation = 'destination-in'; Mx.set(x, m); x.drawImage(src, 0, 0, S.art.w, S.art.h);
    return c;
  }
  function openingHandles() {
    var op = S.opening, out = [];
    if (op.type === 'ellipse') { out.push({ k: 'c', p: [op.cx, op.cy] }, { k: 'rx', p: [op.cx + op.rx, op.cy] }, { k: 'rx', p: [op.cx - op.rx, op.cy] }, { k: 'ry', p: [op.cx, op.cy + op.ry] }, { k: 'ry', p: [op.cx, op.cy - op.ry] }); }
    else { var b = TM.openingBox(op); out.push({ k: 'c', p: [b.x + b.w / 2, b.y + b.h / 2] }); op.pts.forEach(function (p, i) { out.push({ k: 'v', i: i, p: p }); }); }
    return out;
  }
  function draw() {
    raf = 0;
    var w = stage.clientWidth, hh = stage.clientHeight; dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
    var V = Mx.mul(Mx.sc(dpr), viewM()), g0 = Mx.pt(V, 0, 0), gs = G * V[0];
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#070608'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = checkerPat(); ctx.fillRect(g0[0], g0[1], gs, gs);
    if (S.art && S.frame) {
      var artM = Mx.mul(V, TM.artMatrix()), frM = Mx.mul(V, TM.frameMatrix()), pop = UI.tool === 'popout';
      if (pop && UI.isolated) {
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(tinted('ov', S.masks[UI.maskTarget].c, '#fff', artM), 0, 0);
      } else {
        if (pop && (UI.hover || drag) && !UI.candidate) { ctx.globalAlpha = 0.24; Mx.set(ctx, artM); ctx.drawImage(S.art.img, 0, 0, S.art.w, S.art.h); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; }
        var comp = TM.scratch('view', cv.width, cv.height); TM.compose(comp, V, {});
        ctx.drawImage(comp, 0, 0);
        if (UI.candidate) { ctx.globalAlpha = 0.5; ctx.drawImage(tinted('ov', UI.candidate, '#ffb020', artM), 0, 0); ctx.globalAlpha = 1; }
        else if (pop && UI.overlay) {
          var ov = tinted('ov', S.masks[UI.maskTarget].c, UI.maskTarget === 'popout' ? '#2ee6d6' : '#ffb020', artM);
          if (UI.maskTarget === 'popout' && S.restrict && S.hasSubject) { var ovx = TM.cx(ov); ovx.drawImage(S.masks.subject.c, 0, 0, S.art.w, S.art.h); }   // show the effective pop-out
          ctx.globalAlpha = 0.5; ctx.drawImage(ov, 0, 0); ctx.globalAlpha = 1;
        }
        if (drag && drag.type === 'edge') { ctx.globalAlpha = 0.4; ctx.drawImage(tinted('ov', drag.region, '#ffffff', artM), 0, 0); ctx.globalAlpha = 1; }
      }
      if (drag && drag.type === 'lasso' && drag.pts.length > 1) {
        var k = 1 / S.masks.scale; Mx.set(ctx, artM); ctx.beginPath(); drag.pts.forEach(function (p, i) { if (i) ctx.lineTo(p[0] * k, p[1] * k); else ctx.moveTo(p[0] * k, p[1] * k); });
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.lineWidth = 2 * dpr; ctx.strokeStyle = '#fff'; ctx.setLineDash([6 * dpr, 4 * dpr]); ctx.stroke(); ctx.setLineDash([]);
      }
      // export guide
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.lineWidth = (UI.overflow ? 2.5 : 1) * dpr; ctx.strokeStyle = UI.overflow ? '#ff3b5c' : 'rgba(255,255,255,.75)'; ctx.setLineDash([8 * dpr, 6 * dpr]);
      ctx.strokeRect(g0[0] + 0.5, g0[1] + 0.5, gs, gs); ctx.setLineDash([]);
      ctx.font = (11 * dpr) + 'px system-ui,sans-serif'; ctx.fillStyle = UI.overflow ? '#ff8098' : 'rgba(255,255,255,.7)'; ctx.fillText(UI.overflow ? 'Export guide: art crosses it' : 'Export guide', g0[0] + 6 * dpr, g0[1] - 6 * dpr);
      if (UI.tool === 'compose' && UI.target === 'frame' && !UI.adjust) { Mx.set(ctx, frM); ctx.beginPath(); ctx.rect(0, 0, S.frame.w, S.frame.h); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.lineWidth = dpr; ctx.strokeStyle = '#2ee6d6'; ctx.stroke(); }
      if (UI.tool === 'compose' && (UI.adjust || UI.tracing)) {
        Mx.set(ctx, frM);
        if (UI.tracing) { ctx.beginPath(); UI.tracing.pts.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); if (UI.hover && UI.tracing.pts.length) { var hp = Mx.pt(Mx.inv(TM.frameMatrix()), UI.hover[0], UI.hover[1]); ctx.lineTo(hp[0], hp[1]); } }
        else TM.openingPath(ctx);
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.lineWidth = 2 * dpr; ctx.strokeStyle = '#2ee6d6'; ctx.setLineDash([7 * dpr, 5 * dpr]); ctx.stroke(); ctx.setLineDash([]);
        var hs = UI.tracing ? UI.tracing.pts.map(function (p, i) { return { k: i ? 'v' : 'first', p: p }; }) : openingHandles();
        hs.forEach(function (hd) {
          var p = Mx.pt(frM, hd.p[0], hd.p[1]), r = (hd.k === 'v' ? 4.5 : 7) * dpr;
          ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.fillStyle = hd.k === 'c' || hd.k === 'first' ? '#c81e3a' : '#0b0a0c'; ctx.fill(); ctx.lineWidth = 2 * dpr; ctx.strokeStyle = '#2ee6d6'; ctx.stroke();
        });
      }
      if (UI.hover && pop && !UI.candidate && UI.brushTool !== 'lasso') { ctx.beginPath(); ctx.arc(UI.hover[0] * dpr, UI.hover[1] * dpr, UI.size / 2 * dpr, 0, 7); ctx.lineWidth = 3 * dpr; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.stroke(); ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = '#fff'; ctx.stroke(); }
    }
  }

  /* ---------- derived checks, debounced ---------- */
  var chkT = 0;
  function scheduleChecks() { clearTimeout(chkT); chkT = setTimeout(runChecks, 260); }
  function runChecks() {
    if (!S.art) return;
    var of = TM.measure().overflow; if (of !== UI.overflow) { UI.overflow = of; render(); }
    hud(); previews();
  }
  function hud() {
    var hd = $('hud'); hd.textContent = '';
    if (UI.overflow && S.art) hd.appendChild(h('div', { class: 'bar warnbar' }, [h('span', { text: 'Visible art crosses the export guide.' }), h('button', { class: 'btn small', type: 'button', text: 'Fit Token', onclick: doFit })]));
    if (UI.picking) hd.appendChild(h('div', { class: 'bar' }, [h('span', { text: 'Click the ' + (UI.picking === 'art' ? 'artwork' : 'border') + ' to sample a colour.' }), h('button', { class: 'btn small', type: 'button', text: 'Cancel', onclick: function () { UI.picking = null; refresh(); } })]));
    if (UI.tracing) hd.appendChild(h('div', { class: 'bar' }, [h('span', { text: 'Click around the opening. Click the first point or press Enter to close.' }), h('button', { class: 'btn small', type: 'button', text: 'Close shape', onclick: finishTrace }), h('button', { class: 'btn small', type: 'button', text: 'Cancel', onclick: function () { UI.tracing = null; refresh(); } })]));
  }
  var pv = {};
  function previews() {
    if (!pv.c128 || !S.art) return;
    var a = TM.scratch('pv128', 128, 128); TM.compose(a, [128 / G, 0, 0, 128 / G, 0, 0], { proxy: true });
    var b = TM.scratch('pv64', 64, 64); TM.compose(b, [64 / G, 0, 0, 64 / G, 0, 0], { proxy: true });
    [[pv.l128, a], [pv.d128, a], [pv.l64, b], [pv.d64, b]].forEach(function (p) { var x = p[0].getContext('2d'); x.clearRect(0, 0, p[0].width, p[0].height); x.drawImage(p[1], 0, 0); });
  }
  function doFit() { if (TM.fitToken()) TM.commit('Fit Token'); }

  /* ---------- asset actions ---------- */
  function firstArt() { return !S.art; }
  async function setArt(blob, name) {
    var art; try { art = await TM.makeArt(blob, name); } catch (e) { toast(e.message); return; }
    var first = firstArt(), before = TM.assetRef();
    TM.cutoutCancel(); hideProgress(); UI.candidate = null; $('cutbar').hidden = true;
    S.art = art; S.masks = TM.newMasks(art); S.hasSubject = false; S.portrait.init = false; S.foundry = { dx: 0, dy: 0, zoom: 1 };
    TM.coverFit(); TM.emit('assets');
    if (first) { TM.resetHistory(); TM.emit('edit', 'Load artwork'); fitView(); } else TM.commit('Replace artwork', null, { before: before, after: TM.assetRef() });
  }
  async function setBorder(blob, name) {
    var fr; try { fr = await TM.makeFrame(blob, name); } catch (e) { toast(e.message); return; }
    var det = TM.detectOpening(fr), before = TM.assetRef(), world = Math.max(S.frame.w, S.frame.h) * S.frameT.scale;
    S.frame = fr; S.frameVisible = true; S.frameT.scale = world / Math.max(fr.w, fr.h); S.opening = det.opening;
    TM.emit('assets'); TM.commit('Replace border', null, { before: before, after: TM.assetRef() });
    UI.tool = 'compose'; UI.adjust = true; UI.openNote = det.detected ? 'Opening detected from the border. Check the outline and drag the handles if it needs adjusting.' : det.reason;
    refresh(); toast(UI.openNote, 6000);
  }
  async function useBuiltin() {
    if (S.frame && S.frame.builtin) { if (!S.frameVisible) { S.frameVisible = true; TM.commit('Show border'); } return; }
    var before = TM.assetRef(), world = Math.max(S.frame.w, S.frame.h) * S.frameT.scale;
    S.frame = await TM.builtinFrame(); S.frameVisible = true; S.frameT.scale = world / 1024; S.opening = JSON.parse(JSON.stringify(TM.BUILTIN_OPENING));
    TM.emit('assets'); TM.commit('Use built-in ring', null, { before: before, after: TM.assetRef() });
  }
  async function loadDemo() {
    var d = TM.drawDemo(), blob = await TM.canvasBlob(d.art), first = firstArt(), before = TM.assetRef();
    TM.cutoutCancel(); hideProgress(); UI.candidate = null; $('cutbar').hidden = true;
    var art = { img: d.art, w: 1200, h: 1200, blob: blob, name: 'demo-knight', id: TM.uid(), hasAlpha: false }, mk = TM.newMasks(art);
    [['subject', d.subject], ['popout', d.popout]].forEach(function (p) { TM.cx(mk[p[0]].c).drawImage(p[1], 0, 0, mk[p[0]].w, mk[p[0]].h); TM.cx(mk[p[0]].prev).drawImage(mk[p[0]].c, 0, 0); });
    S.art = art; S.masks = mk; S.frame = await TM.builtinFrame(); S.frameVisible = true; S.frameT = { x: G / 2, y: G / 2, scale: 0.8 }; S.opening = JSON.parse(JSON.stringify(TM.BUILTIN_OPENING));
    S.artT = { x: G / 2, y: G / 2, scale: 0.62, rot: 0, flip: false }; S.hasSubject = true; S.restrict = true; S.bgMode = 'original'; S.color = TM.defColor(); S.portrait.init = false; S.foundry = { dx: 0, dy: 0, zoom: 1 };
    TM.emit('assets');
    if (first) { TM.resetHistory(); TM.emit('edit', 'Load demo'); } else TM.commit('Load demo', null, { before: before, after: TM.assetRef() });
    fitView();
  }

  /* ---------- mask editing ---------- */
  function curMask() { return S.masks[UI.maskTarget]; }
  function maskPt(w) { var a = Mx.pt(Mx.inv(TM.artMatrix()), w[0], w[1]); return [a[0] * S.masks.scale, a[1] * S.masks.scale]; }
  function brushR() { return Math.max(0.75, UI.size / 2 / (S.view.scale * S.artT.scale) * S.masks.scale); }
  var stampC = null, stampKey = '';
  function stamp(r, soft) {
    var key = r.toFixed(2) + '|' + soft; if (key === stampKey) return stampC;
    var n = Math.ceil(r * 2 + 2), c = TM.mk(n, n), x = TM.cx(c), g = x.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, r), inner = TM.clamp(1 - soft / 100, 0, 0.97);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(inner, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, n, n); stampC = c; stampKey = key; return c;
  }
  function grow(d, x, y, r) { var b = d.rect; if (!b) d.rect = { x0: x - r - 2, y0: y - r - 2, x1: x + r + 2, y1: y + r + 2 }; else { b.x0 = Math.min(b.x0, x - r - 2); b.y0 = Math.min(b.y0, y - r - 2); b.x1 = Math.max(b.x1, x + r + 2); b.y1 = Math.max(b.y1, y + r + 2); } }
  function rectOf(d) { var b = d.rect; return b ? { x: Math.max(0, Math.floor(b.x0)), y: Math.max(0, Math.floor(b.y0)), w: Math.ceil(b.x1 - b.x0) + 1, h: Math.ceil(b.y1 - b.y0) + 1 } : null; }
  function strokeTo(d, p) {
    var x = TM.cx(d.canvas), r = d.r, s = stamp(r, d.soft), a = d.last || p, dist = Math.hypot(p[0] - a[0], p[1] - a[1]), step = Math.max(0.5, r * 0.22), n = Math.max(1, Math.ceil(dist / step));
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = d.erase ? 'destination-out' : 'source-over';
    for (var i = d.last ? 1 : 0; i <= n; i++) { var t = i / n, px = a[0] + (p[0] - a[0]) * t, py = a[1] + (p[1] - a[1]) * t; x.drawImage(s, px - s.width / 2, py - s.height / 2); grow(d, px, py, r); }
    x.globalCompositeOperation = 'source-over'; d.last = p;
  }
  function endStroke(d) {
    var m = curMask(), which = UI.maskTarget, label;
    if (d.type === 'brush') label = d.erase ? 'Erase stroke' : 'Brush stroke';
    else if (d.type === 'lasso') {
      label = d.erase ? 'Lasso subtract' : 'Lasso add';
      if (d.pts.length < 3) return;
      var f = UI.feather * S.masks.scale / (S.view.scale * S.artT.scale) * 1, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      d.pts.forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
      var pad = Math.ceil(f * 3) + 2, bx = Math.floor(x0) - pad, by = Math.floor(y0) - pad, bw = Math.ceil(x1 - x0) + pad * 2 + 2, bh = Math.ceil(y1 - y0) + pad * 2 + 2;
      var t = TM.scratch('lasso', bw, bh), tx = TM.cx(t), OFF = 20000;
      tx.fillStyle = '#fff'; tx.beginPath(); d.pts.forEach(function (p, i) { var px = p[0] - bx - (f > 0.3 ? OFF : 0), py = p[1] - by; if (i) tx.lineTo(px, py); else tx.moveTo(px, py); }); tx.closePath();
      if (f > 0.3) { tx.shadowColor = '#fff'; tx.shadowBlur = f * 2; tx.shadowOffsetX = OFF; }
      tx.fill(); tx.shadowColor = 'transparent'; tx.shadowBlur = 0; tx.shadowOffsetX = 0;
      var mx = TM.cx(m.c); mx.setTransform(1, 0, 0, 1, 0, 0); mx.globalCompositeOperation = d.erase ? 'destination-out' : 'source-over'; mx.drawImage(t, bx, by); mx.globalCompositeOperation = 'source-over';
      d.rect = { x0: bx, y0: by, x1: bx + bw, y1: by + bh };
    } else if (d.type === 'edge') {
      label = 'Refine edge'; var r = rectOf(d); if (!r) return;
      r.w = Math.min(m.w - r.x, r.w); r.h = Math.min(m.h - r.y, r.h);
      var band = Math.max(2, Math.round(d.r * 0.45));
      TM.refineRect(m.c, r, d.region, band, UI.edgeStr / 100);
    }
    var delta = m.commit(which, rectOf(d));
    if (!delta) { m.revert(); return; }
    if (which === 'subject') S.hasSubject = true;
    TM.commit(label, [delta]);
    UI.lastEdge = d.type === 'edge' ? TM.lastUndo() : null; UI.edgeBefore = false;
  }
  function ensureEdgeAfter() {
    if (!UI.edgeBefore) return; UI.edgeBefore = false;
    var e = UI.lastEdge; if (e && TM.lastUndo() === e) { S.masks.subject.apply(e.deltas[0], true); render(); }
  }
  function toggleEdgeBefore() {
    var e = UI.lastEdge; if (!e || TM.lastUndo() !== e) { toast('Paint a Refine Edge stroke first.'); return; }
    UI.edgeBefore = !UI.edgeBefore; S.masks.subject.apply(e.deltas[0], !UI.edgeBefore); refresh();
  }
  function clearMask() {
    var m = curMask(); m.fill(0); var d = m.commit(UI.maskTarget, null);
    if (UI.maskTarget === 'subject') S.hasSubject = false;
    TM.commit(UI.maskTarget === 'popout' ? 'Clear pop-out' : 'Clear subject', [d]);
  }
  function wholeSubject() {
    var m = S.masks.popout; m.fill(1); var d = m.commit('popout', null); S.restrict = true; TM.commit('Use whole subject', [d]);
  }

  /* ---------- opening ---------- */
  function finishTrace() {
    var t = UI.tracing; UI.tracing = null;
    if (t && t.pts.length >= 3) { S.opening = { type: 'poly', pts: t.pts }; TM.commit('Trace opening'); } else toast('A traced opening needs at least three points.');
    refresh();
  }
  function hitHandle(p) {
    var frM = Mx.mul(viewM(), TM.frameMatrix()), best = null, bd = 22;
    openingHandles().forEach(function (hd) { var q = Mx.pt(frM, hd.p[0], hd.p[1]), d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = hd; } });
    return best;
  }
  function pick(w) {
    var layer = UI.picking, src = layer === 'art' ? S.art : S.frame, p = Mx.pt(Mx.inv(layer === 'art' ? TM.artMatrix() : TM.frameMatrix()), w[0], w[1]);
    var c = TM.mk(3, 3), x = TM.cx(c, { willReadFrequently: true }); x.drawImage(src.img, Math.round(p[0]) - 1, Math.round(p[1]) - 1, 3, 3, 0, 0, 3, 3);
    var d = x.getImageData(0, 0, 3, 3).data, r = 0, g = 0, b = 0, n = 0;
    for (var i = 0; i < 36; i += 4) if (d[i + 3] > 40) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    if (!n) { toast('Nothing to sample there. Click a visible part of the ' + (layer === 'art' ? 'artwork' : 'border') + '.'); return; }
    var rep = S.color[layer].rep; rep.from = TM.rgb2hex(r / n, g / n, b / n); rep.on = true; UI.picking = null; TM.commit('Sample colour');
  }

  /* ---------- pointer input ---------- */
  var ptrs = new Map(), drag = null, gest = null, blockUntilUp = false;
  function cancelDrag() {
    if (!drag) return;
    if (drag.type === 'brush' || drag.type === 'lasso' || drag.type === 'edge') curMask().revert();
    else if (drag.type === 'move') { S[drag.key] = drag.T0; }
    else if (drag.type === 'handle') { S.opening = drag.op0; }
    drag = null; render();
  }
  function startGesture() {
    var a = Array.from(ptrs.values()), c = [(a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2], d = Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]) || 1;
    var onArt = UI.tool === 'compose' && !UI.adjust && !UI.tracing && S.art, key = UI.target === 'frame' ? 'frameT' : 'artT';
    gest = { c0: c, d0: d, onArt: onArt, key: key, T0: onArt ? JSON.parse(JSON.stringify(S[key])) : null, v0: { x: S.view.x, y: S.view.y, scale: S.view.scale } };
  }
  function moveGesture() {
    var a = Array.from(ptrs.values()), c = [(a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2], d = Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]) || 1, k = d / gest.d0;
    if (gest.onArt) {
      var w0 = toWorld(gest.c0), w1 = toWorld(c), T0 = gest.T0, T = S[gest.key];
      T.scale = TM.clamp(T0.scale * k, 0.01, 50); var kk = T.scale / T0.scale;
      T.x = w1[0] + (T0.x - w0[0]) * kk; T.y = w1[1] + (T0.y - w0[1]) * kk;
    } else {
      var v0 = gest.v0, s = TM.clamp(v0.scale * k, 0.05, 40), kk2 = s / v0.scale;
      S.view = { scale: s, x: c[0] - (gest.c0[0] - v0.x) * kk2, y: c[1] - (gest.c0[1] - v0.y) * kk2 };
    }
    render();
  }
  cv.addEventListener('pointerdown', function (e) {
    cv.focus({ preventScroll: true }); ensureEdgeAfter();
    try { cv.setPointerCapture(e.pointerId); } catch (x) {}
    var p = evPt(e); ptrs.set(e.pointerId, p);
    if (ptrs.size === 2) { cancelDrag(); startGesture(); blockUntilUp = true; return; }
    if (ptrs.size > 2 || blockUntilUp) return;
    var w = toWorld(p);
    if (e.button === 1 || e.button === 2 || UI.space || !S.art) { drag = { type: 'pan', p0: p, v0: { x: S.view.x, y: S.view.y } }; return; }
    if (UI.picking) { pick(w); return; }
    if (UI.candidate) { drag = { type: 'pan', p0: p, v0: { x: S.view.x, y: S.view.y } }; return; }
    if (UI.tool === 'compose') {
      if (UI.tracing) {
        var frM = Mx.mul(viewM(), TM.frameMatrix()), t = UI.tracing;
        if (t.pts.length >= 3) { var f0 = Mx.pt(frM, t.pts[0][0], t.pts[0][1]); if (Math.hypot(f0[0] - p[0], f0[1] - p[1]) < 18) { finishTrace(); return; } }
        t.pts.push(Mx.pt(Mx.inv(TM.frameMatrix()), w[0], w[1])); render(); return;
      }
      if (UI.adjust) {
        var hd = hitHandle(p);
        drag = hd ? { type: 'handle', hd: hd, op0: JSON.parse(JSON.stringify(S.opening)), w0: w } : { type: 'pan', p0: p, v0: { x: S.view.x, y: S.view.y } };
        return;
      }
      var key = UI.target === 'frame' ? 'frameT' : 'artT';
      drag = { type: 'move', key: key, w0: w, T0: JSON.parse(JSON.stringify(S[key])) }; cv.style.cursor = 'grabbing'; return;
    }
    if (UI.tool === 'popout') {
      var m = curMask(), mp = maskPt(w);
      if (UI.brushTool === 'edge') {
        if (!S.hasSubject) { toast('Refine Edge works on a subject mask. Run Auto-cutout or paint the subject first.'); return; }
        var reg = TM.scratch('edgeRegion', m.w, m.h);
        drag = { type: 'edge', canvas: reg, region: reg, r: brushR(), soft: 55, erase: false, last: null, rect: null }; strokeTo(drag, mp);
      } else if (UI.brushTool === 'lasso') drag = { type: 'lasso', pts: [mp], erase: UI.brushMode === 'erase' };
      else { drag = { type: 'brush', canvas: m.c, r: brushR(), soft: UI.soft, erase: UI.brushMode === 'erase', last: null, rect: null }; strokeTo(drag, mp); }
      render(); return;
    }
    drag = { type: 'pan', p0: p, v0: { x: S.view.x, y: S.view.y } };
  });
  cv.addEventListener('pointermove', function (e) {
    var p = evPt(e);
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, p);
    if (e.pointerType !== 'touch' || ptrs.size) UI.hover = p;
    if (gest && ptrs.size >= 2) { moveGesture(); return; }
    if (!drag) { if (UI.tool === 'popout' || UI.tracing) render(); return; }
    var w = toWorld(p);
    if (drag.type === 'pan') { S.view.x = drag.v0.x + p[0] - drag.p0[0]; S.view.y = drag.v0.y + p[1] - drag.p0[1]; }
    else if (drag.type === 'move') { var T = S[drag.key]; T.x = drag.T0.x + w[0] - drag.w0[0]; T.y = drag.T0.y + w[1] - drag.w0[1]; liveRefresh(); }
    else if (drag.type === 'handle') {
      var f = Mx.pt(Mx.inv(TM.frameMatrix()), w[0], w[1]), f0 = Mx.pt(Mx.inv(TM.frameMatrix()), drag.w0[0], drag.w0[1]), op = S.opening, o0 = drag.op0, hd = drag.hd;
      if (op.type === 'ellipse') { if (hd.k === 'c') { op.cx = o0.cx + f[0] - f0[0]; op.cy = o0.cy + f[1] - f0[1]; } else if (hd.k === 'rx') op.rx = Math.max(4, Math.abs(f[0] - op.cx)); else op.ry = Math.max(4, Math.abs(f[1] - op.cy)); }
      else if (hd.k === 'c') op.pts = o0.pts.map(function (q) { return [q[0] + f[0] - f0[0], q[1] + f[1] - f0[1]]; });
      else op.pts[hd.i] = f;
    }
    else if (drag.type === 'brush' || drag.type === 'edge') {
      var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; if (!evs.length) evs = [e];
      evs.forEach(function (ce) { strokeTo(drag, maskPt(toWorld(evPt(ce)))); });
    }
    else if (drag.type === 'lasso') { var mp = maskPt(w), l = drag.pts[drag.pts.length - 1]; if (Math.hypot(mp[0] - l[0], mp[1] - l[1]) > 1.5) drag.pts.push(mp); }
    render();
  });
  function pointerEnd(e) {
    ptrs.delete(e.pointerId);
    if (gest) { if (ptrs.size < 2) { if (gest.onArt) TM.commit(gest.key === 'artT' ? 'Pinch artwork' : 'Pinch frame'); gest = null; } if (!ptrs.size) blockUntilUp = false; return; }
    if (!ptrs.size) blockUntilUp = false;
    var d = drag; drag = null; if (d && d.type === 'move') cv.style.cursor = 'grab';
    if (e.pointerType === 'touch') UI.hover = null;
    if (!d) { render(); return; }
    if (e.type === 'pointercancel') { drag = d; cancelDrag(); return; }
    if (d.type === 'move') TM.commit(d.key === 'artT' ? 'Move artwork' : 'Move frame');
    else if (d.type === 'handle') TM.commit('Adjust opening');
    else if (d.type === 'brush' || d.type === 'lasso' || d.type === 'edge') endStroke(d);
    render();
  }
  cv.addEventListener('pointerup', pointerEnd); cv.addEventListener('pointercancel', pointerEnd);
  cv.addEventListener('pointerleave', function () { if (!drag) { UI.hover = null; render(); } });
  cv.addEventListener('dblclick', function () { if (UI.tracing) finishTrace(); });
  cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  var wheelT = 0;
  cv.addEventListener('wheel', function (e) {
    e.preventDefault();
    var p = evPt(e), k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016));
    if (e.altKey && UI.tool === 'compose' && S.art) {
      var key = UI.target === 'frame' ? 'frameT' : 'artT', T = S[key], w = toWorld(p), s = TM.clamp(T.scale * k, 0.01, 50), kk = s / T.scale;
      T.x = w[0] + (T.x - w[0]) * kk; T.y = w[1] + (T.y - w[1]) * kk; T.scale = s; liveRefresh();
      clearTimeout(wheelT); wheelT = setTimeout(function () { TM.commit(key === 'artT' ? 'Scale artwork' : 'Scale frame'); }, 350);
    } else {
      var v = S.view, s2 = TM.clamp(v.scale * k, 0.05, 40), k2 = s2 / v.scale; S.view = { scale: s2, x: p[0] - (p[0] - v.x) * k2, y: p[1] - (p[1] - v.y) * k2 };
    }
    render();
  }, { passive: false });

  /* ---------- keyboard ---------- */
  var nudgeT = 0;
  window.addEventListener('keydown', function (e) {
    var t = e.target, typing = t && (t.tagName === 'INPUT' && t.type !== 'range' && t.type !== 'checkbox' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    if (document.querySelector('.modal')) { if (e.key === 'Escape') TM.closeModal && TM.closeModal(); return; }
    var mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); ensureEdgeAfter(); if (e.shiftKey) TM.redo(); else TM.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); ensureEdgeAfter(); TM.redo(); return; }
    if (typing || mod) return;
    if (e.key === ' ') { UI.space = true; if (t === cv) e.preventDefault(); return; }
    if (e.key === 'Escape') { UI.picking = null; UI.tracing = null; if (UI.candidate) TM.cutUI.cancel(); refresh(); return; }
    if (e.key === 'Enter' && UI.tracing) { finishTrace(); return; }
    if (k === '0' || k === 'f') { fitView(); return; }
    if (k === '1') return setTool('compose'); if (k === '2') return setTool('popout'); if (k === '3') return setTool('color');
    if (k === '[') { UI.size = Math.max(4, Math.round(UI.size * 0.85)); refresh(); return; }
    if (k === ']') { UI.size = Math.min(300, Math.round(UI.size * 1.18) + 1); refresh(); return; }
    if (k === 'x') { UI.brushMode = UI.brushMode === 'add' ? 'erase' : 'add'; refresh(); return; }
    if (k === '=' || k === '+' || k === '-') { var c = [stage.clientWidth / 2, stage.clientHeight / 2], v = S.view, s = TM.clamp(v.scale * (k === '-' ? 0.8 : 1.25), 0.05, 40), kk = s / v.scale; S.view = { scale: s, x: c[0] - (c[0] - v.x) * kk, y: c[1] - (c[1] - v.y) * kk }; render(); return; }
    var dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0, dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if ((dx || dy) && S.art && t.type !== 'range') {
      e.preventDefault(); var key = UI.target === 'frame' ? 'frameT' : 'artT', st = e.shiftKey ? 10 : 1; S[key].x += dx * st; S[key].y += dy * st; liveRefresh();
      clearTimeout(nudgeT); nudgeT = setTimeout(function () { TM.commit(key === 'artT' ? 'Nudge artwork' : 'Nudge frame'); }, 450);
    }
  });
  window.addEventListener('keyup', function (e) { if (e.key === ' ') UI.space = false; });

  /* ---------- inspector controls ---------- */
  function liveRefresh() { render(); scheduleChecks(); syncCtl(); }
  function syncCtl() { ctl.forEach(function (f) { f(); }); }
  function slider(label, o) {
    var id = 'c' + (++uidN), inp = h('input', { type: 'range', id: id, min: o.min, max: o.max, step: o.step || 1 }), out = h('output', { for: id }), fmt = o.fmt || function (v) { return String(Math.round(v)); };
    inp.oninput = function () { o.set(+inp.value); out.textContent = fmt(+inp.value); render(); scheduleChecks(); };
    inp.onchange = function () { if (o.undo) TM.commit(o.undo); else refresh(); };
    var row = h('label', { class: 'row', for: id }, [h('span', { text: label }), inp, out]);
    ctl.push(function () { if (o.show) row.hidden = !o.show(); if (row.hidden) return; var v = o.get(); if (document.activeElement !== inp || +inp.value !== v) inp.value = v; out.textContent = fmt(v); });
    return row;
  }
  function seg(label, opts, get, set, show) {
    var box = h('div', { class: 'seg', role: 'group', 'aria-label': label }), bs = opts.map(function (o) { var b = h('button', { type: 'button', text: o[1], onclick: function () { set(o[0]); } }); box.appendChild(b); return b; });
    ctl.push(function () { if (show) box.hidden = !show(); var v = get(); bs.forEach(function (b, i) { b.setAttribute('aria-pressed', String(opts[i][0] === v)); if (opts[i][2]) b.hidden = !opts[i][2](); if (opts[i][3]) b.textContent = opts[i][3](); }); });
    return box;
  }
  function check(label, get, set, show, dis) {
    var id = 'c' + (++uidN), inp = h('input', { type: 'checkbox', id: id }), l = h('label', { class: 'check', for: id }, [inp, h('span', { text: label })]);
    inp.onchange = function () { set(inp.checked); };
    ctl.push(function () { if (show) l.hidden = !show(); inp.checked = !!get(); if (dis) inp.disabled = dis(); });
    return l;
  }
  function btn(text, fn, cls, show, on) {
    var b = h('button', { class: 'btn small ' + (cls || ''), type: 'button', text: text, onclick: fn });
    if (show || on) ctl.push(function () { if (show) b.hidden = !show(); if (on) b.classList.toggle('on', !!on()); });
    return b;
  }
  function note(fn, cls, show) { var p = h('p', { class: 'note ' + (cls || '') }); ctl.push(function () { if (show) p.hidden = !show(); if (!p.hidden) p.textContent = typeof fn === 'function' ? fn() : fn; }); return p; }
  function sec(title, kids, show) { var s = h('section', { class: 'sec' }, [title ? h('h3', { text: title }) : null].concat(kids)); if (show) ctl.push(function () { s.hidden = !show(); }); return s; }
  function color(label, get, set, undo) {
    var id = 'c' + (++uidN), inp = h('input', { type: 'color', id: id }), l = h('label', { class: 'swatch', for: id }, [inp, h('span', { text: label })]);
    inp.oninput = function () { set(inp.value); render(); }; inp.onchange = function () { TM.commit(undo); };
    ctl.push(function () { inp.value = get(); }); return l;
  }
  function setState(fn, label) { return function (v) { fn(v); TM.commit(label); refresh(); }; }
  function setUI(key) { return function (v) { ensureEdgeAfter(); UI[key] = v; refresh(); }; }

  function buildInspector() {
    var root = $('insp'), pC, pP, pK;
    var isC = function () { return UI.tool === 'compose'; };
    /* Compose */
    pv.l128 = h('canvas', { width: 128, height: 128, class: 'pv-light' }); pv.d128 = h('canvas', { width: 128, height: 128, class: 'pv-dark' });
    pv.l64 = h('canvas', { width: 64, height: 64, class: 'pv-light' }); pv.d64 = h('canvas', { width: 64, height: 64, class: 'pv-dark' }); pv.c128 = true;
    var presetName = h('input', { class: 'field', id: 'presetName', type: 'text', placeholder: 'Preset name', 'aria-label': 'Preset name', maxlength: 60 });
    pC = h('div', {}, [
      h('h2', { text: 'Compose' }),
      sec('Artwork', [
        h('div', { class: 'btns' }, [btn('Replace artwork', function () { $('fileArt').click(); }), btn('Flip', function () { S.artT.flip = !S.artT.flip; TM.commit('Flip artwork'); }), btn('Cover fit', function () { TM.coverFit(); TM.commit('Cover fit'); })]),
        seg('Background', [['original', 'Keep Original Background'], ['subject', 'Subject Only']], function () { return S.bgMode; }, setState(function (v) { S.bgMode = v; }, 'Background mode')),
        note('Subject Only needs a subject mask. Create one to hide the background.', 'warn', function () { return S.bgMode === 'subject' && !S.hasSubject; }),
        h('div', { class: 'btns' }, [btn('Auto-cutout', function () { setTool('popout'); TM.cutUI.start(); }, 'primary', function () { return S.bgMode === 'subject' && !S.hasSubject; }), btn('Paint subject', function () { UI.maskTarget = 'subject'; UI.brushTool = 'brush'; UI.brushMode = 'add'; setTool('popout'); }, '', function () { return S.bgMode === 'subject' && !S.hasSubject; })]),
        slider('Scale', { min: 20, max: 400, get: function () { return S.art ? Math.round(S.artT.scale / TM.coverScale(S.art) * 100) : 100; }, set: function (v) { S.artT.scale = TM.coverScale(S.art) * v / 100; }, fmt: function (v) { return Math.round(v) + '%'; }, undo: 'Scale artwork' }),
        slider('Rotate', { min: -180, max: 180, get: function () { return Math.round(S.artT.rot * 180 / Math.PI); }, set: function (v) { S.artT.rot = v * Math.PI / 180; }, fmt: function (v) { return Math.round(v) + '°'; }, undo: 'Rotate artwork' }),
        note('Linked: the base art and the pop-out art are one image with one move, scale, rotate and flip.')
      ]),
      sec('Drag moves', [seg('Drag target', [['art', 'Artwork'], ['frame', 'Frame']], function () { return UI.target; }, setUI('target')), note('Arrow keys nudge. Alt + wheel scales. Two fingers pinch.')]),
      sec('Frame', [
        h('div', { class: 'btns' }, [btn('Built-in ring', useBuiltin, '', null, function () { return S.frame && S.frame.builtin; }), btn('Upload border', function () { $('fileBorder').click(); })]),
        check('Show border (the opening still crops)', function () { return S.frameVisible; }, setState(function (v) { S.frameVisible = v; }, 'Toggle border')),
        slider('Frame size', { min: 20, max: 140, get: function () { return S.frame ? Math.round(Math.max(S.frame.w, S.frame.h) * S.frameT.scale / G * 100) : 80; }, set: function (v) { S.frameT.scale = v / 100 * G / Math.max(S.frame.w, S.frame.h); }, fmt: function (v) { return Math.round(v) + '%'; }, undo: 'Scale frame' }),
        btn('Adjust Opening', function () { UI.adjust = !UI.adjust; UI.tracing = null; if (!UI.adjust) UI.openNote = ''; refresh(); }, 'wide', null, function () { return UI.adjust; }),
        note(function () { return UI.openNote || 'Drag the handles. The red handle moves the whole opening.'; }, '', function () { return UI.adjust; }),
        h('div', { class: 'btns' }, [
          btn('Ellipse', function () { var b = TM.openingBox(); S.opening = { type: 'ellipse', cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: b.w / 2, ry: b.h / 2 }; TM.commit('Ellipse opening'); }, '', function () { return UI.adjust; }),
          btn('Trace polygon', function () { UI.tracing = { pts: [] }; refresh(); }, '', function () { return UI.adjust; }, function () { return !!UI.tracing; }),
          btn('Detect from border', function () { var d = TM.detectOpening(S.frame); S.opening = d.opening; UI.openNote = d.detected ? 'Opening detected from the border.' : d.reason; TM.commit('Detect opening'); }, '', function () { return UI.adjust && S.frame && !S.frame.builtin; })
        ])
      ]),
      sec('Token', [
        h('div', { class: 'btns' }, [btn('Fit Token', doFit, 'primary')]),
        note('Fit Token scales art and frame together so everything visible sits inside the export guide.'),
        h('div', { class: 'previews' }, [h('figure', {}, [pv.l128, h('figcaption', { text: '128 px' })]), h('figure', {}, [pv.d128, h('figcaption', { text: '128 px' })]), h('figure', {}, [pv.l64, h('figcaption', { text: '64 px' })]), h('figure', {}, [pv.d64, h('figcaption', { text: '64 px' })])])
      ]),
      sec('Layout presets', [presetName, h('div', { class: 'btns' }, [btn('Save Layout Preset', function () { TM.dialogs.savePreset(presetName.value); }), btn('Apply Layout Preset', function () { $('filePreset').click(); })]), note('A preset keeps the border, opening, framing, colour and export settings. It never contains a portrait or masks.')])
    ]);
    /* Pop-out */
    var isSub = function () { return UI.maskTarget === 'subject'; };
    pP = h('div', {}, [
      h('h2', { text: 'Pop-out' }),
      sec('Auto-cutout', [
        h('div', { class: 'btns' }, [btn('Auto Pop-out', function () { TM.cutUI.autoPop(); }, 'primary'), btn('Auto-cutout', function () { TM.cutUI.start(); }), btn('Use Existing Transparency', function () { TM.cutUI.existing(); }, '', function () { return S.art && S.art.hasAlpha; })]),
        note(function () { return TM.cut.error ? 'The model could not load here: ' + TM.cut.error + '. Brush and lasso still work.' : 'Auto Pop-out finds the subject and raises its top over the rim in one step (Undo reverses it). Auto-cutout previews the subject first and lets you choose. Both run in this browser; nothing is uploaded.'; }, null)
      ]),
      sec('Mask', [
        seg('Mask', [['popout', 'Pop-out'], ['subject', 'Refine Subject']], function () { return UI.maskTarget; }, function (v) { ensureEdgeAfter(); UI.maskTarget = v; if (v !== 'subject' && UI.brushTool === 'edge') UI.brushTool = 'brush'; refresh(); }),
        note(function () { return isSub() ? (S.hasSubject ? 'Subject: the figure and its gear. Add missed gear or erase background.' : 'No subject mask yet. Paint one, or run Auto-cutout.') : 'Pop-out: paint the parts that should cross over the rim. It starts empty.'; }),
        seg('Tool', [['brush', 'Brush'], ['lasso', 'Lasso'], ['edge', 'Refine Edge', isSub]], function () { return UI.brushTool; }, setUI('brushTool')),
        seg('Mode', [['add', 'Add'], ['erase', 'Erase', null, function () { return UI.brushTool === 'lasso' ? 'Subtract' : 'Erase'; }]], function () { return UI.brushMode; }, setUI('brushMode'), function () { return UI.brushTool !== 'edge'; }),
        slider('Size', { min: 4, max: 300, get: function () { return UI.size; }, set: function (v) { UI.size = v; }, fmt: function (v) { return Math.round(v) + ' px'; }, show: function () { return UI.brushTool !== 'lasso'; } }),
        slider('Softness', { min: 0, max: 100, get: function () { return UI.soft; }, set: function (v) { UI.soft = v; }, show: function () { return UI.brushTool === 'brush'; } }),
        slider('Edge feather', { min: 0, max: 40, get: function () { return UI.feather; }, set: function (v) { UI.feather = v; }, fmt: function (v) { return Math.round(v) + ' px'; }, show: function () { return UI.brushTool === 'lasso'; } }),
        slider('Strength', { min: 10, max: 100, get: function () { return UI.edgeStr; }, set: function (v) { UI.edgeStr = v; }, fmt: function (v) { return Math.round(v) + '%'; }, show: function () { return UI.brushTool === 'edge'; } }),
        note('Brush along hair, fur or feathers. Size is the radius of the area that gets re-estimated; everything outside the stroke stays fixed.', '', function () { return UI.brushTool === 'edge'; }),
        h('div', { class: 'btns' }, [btn('Show before', toggleEdgeBefore, '', function () { return UI.brushTool === 'edge'; }, function () { return UI.edgeBefore; })])
      ]),
      sec('View', [
        check('Show mask overlay', function () { return UI.overlay; }, setUI('overlay')),
        check('Mask only preview', function () { return UI.isolated; }, setUI('isolated')),
        check('Restrict pop-out to the subject', function () { return S.restrict; }, setState(function (v) { S.restrict = v; }, 'Restrict to subject'), null, function () { return !S.hasSubject; }),
        note('Turn restriction off to raise gear the subject mask missed.', '', function () { return S.hasSubject; }),
        h('div', { class: 'btns' }, [btn('Use Whole Subject', wholeSubject, '', function () { return S.hasSubject && !isSub(); }), btn('Clear this mask', clearMask)])
      ])
    ]);
    /* Color */
    var L = function () { return UI.colorLayer; }, gr = function () { return S.color[L()]; }, hasRep = function () { return L() !== 'final'; };
    function gs(label, key, min, max, unit) { return slider(label, { min: min, max: max, get: function () { return gr()[key]; }, set: function (v) { gr()[key] = v; }, fmt: function (v) { return (v > 0 ? '+' : '') + Math.round(v) + (unit || ''); }, undo: label + ' (' + L() + ')' }); }
    pK = h('div', {}, [
      h('h2', { text: 'Color' }),
      sec('Layer', [seg('Layer', [['art', 'Artwork'], ['border', 'Border'], ['final', 'Final']], L, function (v) { TM.bypass.art = TM.bypass.border = TM.bypass.final = false; UI.picking = null; UI.colorLayer = v; refresh(); }),
        note(function () { return L() === 'art' ? 'One grade for the artwork, shared by the base and the pop-out.' : L() === 'border' ? 'Grades the border only.' : 'Applied once to the finished composite.'; })]),
      sec('Grade', [gs('Brightness', 'b', -100, 100), gs('Contrast', 'c', -100, 100), gs('Saturation', 's', -100, 100), gs('Temperature', 't', -100, 100), gs('Hue', 'h', -180, 180, '°'),
        h('div', { class: 'btns' }, [btn('Reset', function () { var g = gr(); g.b = g.c = g.s = g.t = g.h = 0; TM.commit('Reset grade'); }), btn('Show before', function () { TM.bypass[L()] = !TM.bypass[L()]; refresh(); }, '', null, function () { return TM.bypass[L()]; })])]),
      sec('Replace Color', [
        check('Replace a colour', function () { return hasRep() && gr().rep.on; }, setState(function (v) { gr().rep.on = v; }, 'Replace colour')),
        h('div', { class: 'btns' }, [btn('Eyedropper', function () { UI.picking = UI.picking ? null : L(); refresh(); }, '', null, function () { return !!UI.picking; })]),
        color('From (sampled before adjustments)', function () { return hasRep() ? gr().rep.from : '#000000'; }, function (v) { gr().rep.from = v; gr().rep.on = true; }, 'Replace colour source'),
        color('To', function () { return hasRep() ? gr().rep.to : '#000000'; }, function (v) { gr().rep.to = v; gr().rep.on = true; }, 'Replace colour target'),
        slider('Tolerance', { min: 2, max: 100, get: function () { return hasRep() ? gr().rep.tol : 0; }, set: function (v) { gr().rep.tol = v; }, undo: 'Replace tolerance' }),
        slider('Strength', { min: 0, max: 100, get: function () { return hasRep() ? gr().rep.str : 0; }, set: function (v) { gr().rep.str = v; }, fmt: function (v) { return Math.round(v) + '%'; }, undo: 'Replace strength' })
      ], hasRep),
      sec('Match Border to Art', [
        h('div', { class: 'btns' }, [btn('Match Border to Art', function () { S.color.tint.color = TM.sampleArtColor(); S.color.tint.on = true; TM.commit('Match border to art'); }, 'primary')]),
        check('Tint the border', function () { return S.color.tint.on; }, setState(function (v) { S.color.tint.on = v; }, 'Border tint')),
        color('Tint colour', function () { return S.color.tint.color; }, function (v) { S.color.tint.color = v; S.color.tint.on = true; }, 'Tint colour'),
        slider('Strength', { min: 0, max: 100, get: function () { return S.color.tint.str; }, set: function (v) { S.color.tint.str = v; }, fmt: function (v) { return Math.round(v) + '%'; }, undo: 'Tint strength' }),
        note('Samples the graded artwork before the final grade. Highlights and texture of the border are kept.')
      ], function () { return L() === 'border'; })
    ]);
    root.appendChild(pC); root.appendChild(pP); root.appendChild(pK);
    ctl.push(function () { pC.hidden = UI.tool !== 'compose'; pP.hidden = UI.tool !== 'popout'; pK.hidden = UI.tool !== 'color'; });
  }

  function refresh() {
    syncCtl();
    ['Compose', 'Popout', 'Color'].forEach(function (n) { $('tool' + n).setAttribute('aria-pressed', String(UI.tool === n.toLowerCase())); });
    $('start').hidden = !!S.art;
    var u = TM.undoInfo(); $('btnUndo').disabled = !u.undo; $('btnRedo').disabled = !u.redo; $('btnUndo').title = u.undo ? 'Undo ' + u.label + ' (Ctrl+Z)' : 'Undo (Ctrl+Z)';
    $('btnExport').disabled = !S.art;
    cv.style.cursor = UI.picking || UI.tracing || UI.tool === 'popout' ? 'crosshair' : UI.tool === 'compose' && !UI.adjust ? 'grab' : 'default';
    hud(); render(); scheduleChecks();
  }
  function setTool(t) {
    ensureEdgeAfter(); UI.tool = t; UI.picking = null; UI.tracing = null; if (t !== 'compose') UI.adjust = false;
    TM.bypass.art = TM.bypass.border = TM.bypass.final = false; refresh();
  }
  function showProgress(label, p) { $('progress').hidden = false; $('progLabel').textContent = label; var f = $('progFill'); if (p < 0) { f.classList.add('ind'); f.style.width = ''; } else { f.classList.remove('ind'); f.style.width = Math.round(p * 100) + '%'; } }
  function hideProgress() { $('progress').hidden = true; }

  TM.ui = { refresh: refresh, render: render, toast: toast, setTool: setTool, fitView: fitView, setArt: setArt, setBorder: setBorder, loadDemo: loadDemo, showProgress: showProgress, hideProgress: hideProgress, ensureEdgeAfter: ensureEdgeAfter, doFit: doFit, runChecks: runChecks };

  /* ---------- wiring ---------- */
  buildInspector();
  $('toolCompose').onclick = function () { setTool('compose'); }; $('toolPopout').onclick = function () { setTool('popout'); }; $('toolColor').onclick = function () { setTool('color'); };
  $('toolPanel').onclick = function () { var c = $('insp').classList.toggle('closed'); $('toolPanel').setAttribute('aria-pressed', String(!c)); fitView(); };
  if (window.matchMedia('(max-width:860px)').matches) $('insp').classList.add('closed'); else $('toolPanel').setAttribute('aria-pressed', 'true');
  $('btnUndo').onclick = function () { ensureEdgeAfter(); TM.undo(); }; $('btnRedo').onclick = function () { ensureEdgeAfter(); TM.redo(); }; $('btnFitView').onclick = fitView;
  $('btnDrop').onclick = function () { $('fileArt').click(); }; $('btnDemo').onclick = loadDemo;
  TM.on('edit', function () { TM.dropGradeCacheIfNeeded && TM.dropGradeCacheIfNeeded(); refresh(); TM.queueSave(); });
  TM.on('history', function () { var u = TM.undoInfo(); $('btnUndo').disabled = !u.undo; $('btnRedo').disabled = !u.redo; });
  TM.on('assets', function () { TM.dropGradeCache(); UI.candidate = null; UI.lastEdge = null; UI.edgeBefore = false; });
  TM.on('render', render);
  window.addEventListener('resize', function () { render(); });
  if (window.ResizeObserver) new ResizeObserver(function () { render(); }).observe(stage);
})();
