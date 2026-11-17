/* ESONJ's Token Maker: downloads, project files, layout presets, ZIP, local draft recovery. */
(function () {
  'use strict';
  var TM = window.TM, S = TM.S, G = TM.G;
  TM.debug = { failNextSave: false };

  /* ---------- environment and downloads ---------- */
  var host = !!(window.claude && typeof window.claude.use === 'function');
  TM.env = { host: host, downloads: host ? 'checking' : 'direct', storage: 'checking', webp: false };
  var capP = host ? window.claude.use('downloads').then(function (d) { TM.env.downloads = d ? 'host' : 'blocked'; TM.emit('env'); return d; }, function () { TM.env.downloads = 'blocked'; TM.emit('env'); return null; }) : Promise.resolve(null);
  (function () { try { TM.mk(2, 2).toBlob(function (b) { TM.env.webp = !!b && b.type === 'image/webp'; TM.emit('env'); }, 'image/webp'); } catch (e) {} })();
  /* Resolves {ok}, {declined} or {blocked, message}. */
  TM.saveFile = async function (name, blob) {
    if (host) {
      var d = await capP;
      if (!d) return { blocked: true, message: 'This host does not allow downloads from the page.' };
      try { await d.save({ filename: name, data: blob }); return { ok: true }; }
      catch (e) { if (e && e.code === 'declined') return { declined: true }; return { blocked: true, message: 'The host refused the download (' + (e && (e.code || e.message)) + ').' }; }
    }
    try {
      var a = document.createElement('a'), url = URL.createObjectURL(blob);
      a.href = url; a.download = name; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
      return { ok: true };
    } catch (e2) { return { blocked: true, message: 'The browser blocked the download.' }; }
  };
  TM.safeName = function (s, fb) { s = String(s || '').trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\.+$/, '').slice(0, 80); return s || fb || 'token'; };

  /* ---------- base64 ---------- */
  function b64(blob) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1] || ''); }; r.onerror = function () { rej(new Error('could not read image data')); }; r.readAsDataURL(blob); }); }
  function unb64(s, type) { var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: type || 'image/png' }); }

  /* ---------- state validation ---------- */
  function num(v, lo, hi, what) { if (typeof v !== 'number' || !isFinite(v) || v < lo || v > hi) throw new Error('bad value for ' + what); return v; }
  function vGrade(g, d) { var o = {}; ['b', 'c', 's', 't', 'h'].forEach(function (k) { o[k] = g && typeof g[k] === 'number' && isFinite(g[k]) ? TM.clamp(g[k], -180, 180) : d[k]; }); return o; }
  function vHex(h, d) { return typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h) ? h : d; }
  function vRep(r, d) { r = r || {}; return { on: !!r.on, from: vHex(r.from, d.from), to: vHex(r.to, d.to), tol: TM.clamp(+r.tol || 0, 0, 100), str: TM.clamp(r.str === undefined ? 100 : +r.str || 0, 0, 100) }; }
  TM.validColor = function (c) {
    var d = TM.defColor(); c = c || {};
    var o = { art: vGrade(c.art, d.art), border: vGrade(c.border, d.border), final: vGrade(c.final, d.final) };
    o.art.rep = vRep(c.art && c.art.rep, d.art.rep); o.border.rep = vRep(c.border && c.border.rep, d.border.rep);
    var t = c.tint || {}; o.tint = { on: !!t.on, color: vHex(t.color, d.tint.color), str: TM.clamp(t.str === undefined ? 60 : +t.str || 0, 0, 100) };
    return o;
  };
  TM.validOpening = function (op) {
    if (!op || typeof op !== 'object') throw new Error('missing frame opening');
    if (op.type === 'ellipse') return { type: 'ellipse', cx: num(op.cx, -1e5, 1e5, 'opening'), cy: num(op.cy, -1e5, 1e5, 'opening'), rx: num(op.rx, 1, 1e5, 'opening'), ry: num(op.ry, 1, 1e5, 'opening') };
    if (op.type === 'poly' && Array.isArray(op.pts) && op.pts.length >= 3 && op.pts.length <= 2000) return { type: 'poly', pts: op.pts.map(function (p) { return [num(p[0], -1e5, 1e5, 'opening'), num(p[1], -1e5, 1e5, 'opening')]; }) };
    throw new Error('unreadable frame opening');
  };
  TM.validExp = function (e) { e = e || {}; return { size: [256, 512, 1024, 2048].indexOf(e.size) >= 0 ? e.size : 512, format: e.format === 'webp' ? 'webp' : 'png', name: TM.safeName(e.name, 'token') }; };
  function vState(s) {
    if (!s || typeof s !== 'object') throw new Error('missing editor state');
    var a = s.artT || {}, f = s.frameT || {}, fo = s.foundry || {}, p = s.portrait || {};
    return {
      artT: { x: num(a.x, -1e5, 1e5, 'art position'), y: num(a.y, -1e5, 1e5, 'art position'), scale: num(a.scale, 1e-4, 1e3, 'art scale'), rot: num(a.rot, -100, 100, 'art rotation'), flip: !!a.flip },
      frameT: { x: num(f.x, -1e5, 1e5, 'frame position'), y: num(f.y, -1e5, 1e5, 'frame position'), scale: num(f.scale, 1e-4, 1e3, 'frame scale') },
      opening: TM.validOpening(s.opening), frameVisible: s.frameVisible !== false, bgMode: s.bgMode === 'subject' ? 'subject' : 'original',
      restrict: s.restrict !== false, hasSubject: !!s.hasSubject, color: TM.validColor(s.color), exp: TM.validExp(s.exp),
      foundry: { dx: TM.clamp(+fo.dx || 0, -2, 2), dy: TM.clamp(+fo.dy || 0, -2, 2), zoom: TM.clamp(+fo.zoom || 1, 0.05, 20) },
      portrait: { cx: TM.clamp(+p.cx || 0.5, 0, 1), cy: TM.clamp(+p.cy || 0.5, 0, 1), zoom: TM.clamp(+p.zoom || 1, 1, 8), aspect: p.aspect === 'source' ? 'source' : 'square', bg: p.bg === 'subject' ? 'subject' : 'original', init: !!p.init }
    };
  }
  async function maskFrom(blob, w, h) { var im = await TM.decode(blob), m = new TM.Mask(w, h); TM.cx(m.c).drawImage(im, 0, 0, w, h); TM.cx(m.prev).drawImage(m.c, 0, 0); return m; }
  async function builtinFrame() { var c = TM.drawBuiltinFrame(); return { img: c, w: 1024, h: 1024, blob: null, name: 'Bronze ring', id: 'builtin-ring', builtin: 'ring' }; }
  TM.builtinFrame = builtinFrame;

  /* ---------- project files ---------- */
  TM.PROJECT = 'esonj-token-maker/project'; TM.PRESET = 'esonj-token-maker/preset';
  async function frameJSON() { return S.frame.builtin ? { builtin: S.frame.builtin } : { name: S.frame.name, type: S.frame.blob.type || 'image/png', data: await b64(S.frame.blob) }; }
  TM.projectBlob = async function () {
    var o = {
      format: TM.PROJECT, version: 1, app: TM.VERSION, savedAt: new Date().toISOString(),
      art: { name: S.art.name, type: S.art.blob.type || 'image/png', data: await b64(S.art.blob) },
      frame: await frameJSON(),
      masks: { w: S.masks.subject.w, h: S.masks.subject.h, subject: await b64(await TM.canvasBlob(S.masks.subject.c)), popout: await b64(await TM.canvasBlob(S.masks.popout.c)) },
      state: JSON.parse(TM.snap())
    };
    return new Blob([JSON.stringify(o)], { type: 'application/json' });
  };
  async function frameFrom(f) {
    if (f && f.builtin) return builtinFrame();
    if (!f || typeof f.data !== 'string') throw new Error('missing border image');
    return TM.makeFrame(unb64(f.data, f.type), f.name);
  }
  /* Parses and fully decodes a project before anything in the editor changes. */
  TM.stageProject = async function (text) {
    var o; try { o = JSON.parse(text); } catch (e) { throw new Error('This is not a Token Maker project file (it is not valid JSON).'); }
    if (!o || o.format !== TM.PROJECT) throw new Error('This file is not a Token Maker project.');
    if (typeof o.version !== 'number' || o.version > 1) throw new Error('This project was saved by a newer version of Token Maker.');
    try {
      var st = vState(o.state);
      if (!o.art || typeof o.art.data !== 'string') throw new Error('missing artwork');
      var art = await TM.makeArt(unb64(o.art.data, o.art.type), o.art.name), frame = await frameFrom(o.frame), mk = TM.newMasks(art);
      if (!o.masks || typeof o.masks.subject !== 'string' || typeof o.masks.popout !== 'string') throw new Error('missing masks');
      mk.subject = await maskFrom(unb64(o.masks.subject), mk.subject.w, mk.subject.h);
      mk.popout = await maskFrom(unb64(o.masks.popout), mk.popout.w, mk.popout.h);
      return { art: art, frame: frame, masks: mk, state: st };
    } catch (e2) { throw new Error('This project file is damaged (' + e2.message + '). Your open token was not changed.'); }
  };
  TM.adopt = function (staged, label) {
    var before = TM.assetRef();
    TM.cutoutCancel();
    S.art = staged.art; S.frame = staged.frame; S.masks = staged.masks;
    Object.keys(staged.state).forEach(function (k) { S[k] = staged.state[k]; });
    TM.emit('assets');
    if (label) TM.commit(label, null, { before: before, after: TM.assetRef() }); else TM.resetHistory();
  };

  /* ---------- layout presets ---------- */
  TM.presetBlob = async function (name) {
    var o = TM.openingWorld(), d = Math.max(o.w, o.h), a = S.artT;
    var p = {
      format: TM.PRESET, version: 1, app: TM.VERSION, name: name, savedAt: new Date().toISOString(),
      frame: await frameJSON(), frameVisible: S.frameVisible, frameT: S.frameT, opening: S.opening,
      portrait: { offX: (a.x - o.cx) / d, offY: (a.y - o.cy) / d, zoom: a.scale / TM.coverScale(S.art), rot: a.rot, flip: a.flip },
      color: S.color, exp: S.exp
    };
    return new Blob([JSON.stringify(p)], { type: 'application/json' });
  };
  TM.stagePreset = async function (text) {
    var o; try { o = JSON.parse(text); } catch (e) { throw new Error('This is not a layout preset file (it is not valid JSON).'); }
    if (!o || o.format !== TM.PRESET) throw new Error('This file is not a Token Maker layout preset.');
    if (typeof o.version !== 'number' || o.version > 1) throw new Error('This preset was saved by a newer version of Token Maker.');
    try {
      var f = o.frameT || {}, p = o.portrait || {};
      return {
        name: String(o.name || 'Preset').slice(0, 80), frame: await frameFrom(o.frame), frameVisible: o.frameVisible !== false,
        frameT: { x: num(f.x, -1e5, 1e5, 'frame'), y: num(f.y, -1e5, 1e5, 'frame'), scale: num(f.scale, 1e-4, 1e3, 'frame') },
        opening: TM.validOpening(o.opening),
        portrait: { offX: num(p.offX, -50, 50, 'framing'), offY: num(p.offY, -50, 50, 'framing'), zoom: num(p.zoom, 1e-3, 1e3, 'framing'), rot: num(p.rot, -100, 100, 'framing'), flip: !!p.flip },
        color: TM.validColor(o.color), exp: TM.validExp(o.exp)
      };
    } catch (e2) { throw new Error('This preset file is damaged (' + e2.message + ').'); }
  };
  /* Apply a staged preset to the current portrait. The portrait and both masks stay as they are. */
  TM.applyPreset = function (pr, resampleTint) {
    S.frame = pr.frame; S.frameVisible = pr.frameVisible; S.frameT = JSON.parse(JSON.stringify(pr.frameT)); S.opening = JSON.parse(JSON.stringify(pr.opening));
    S.color = JSON.parse(JSON.stringify(pr.color)); S.exp = JSON.parse(JSON.stringify(pr.exp));
    var o = TM.openingWorld(), d = Math.max(o.w, o.h);
    S.artT = { x: o.cx + pr.portrait.offX * d, y: o.cy + pr.portrait.offY * d, scale: TM.coverScale(S.art) * pr.portrait.zoom, rot: pr.portrait.rot, flip: pr.portrait.flip };
    if (resampleTint) S.color.tint.color = TM.sampleArtColor();
  };

  /* ---------- ZIP (stored, no compression: PNGs are already compressed) ---------- */
  var crcT = null;
  function crc32(u) { if (!crcT) { crcT = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; } } var crc = 0xFFFFFFFF; for (var i = 0; i < u.length; i++) crc = crcT[(crc ^ u[i]) & 255] ^ (crc >>> 8); return (crc ^ 0xFFFFFFFF) >>> 0; }
  TM.zip = function (files) { // [{name, data: Uint8Array}]
    var parts = [], central = [], off = 0, enc = new TextEncoder();
    files.forEach(function (f) {
      var nm = enc.encode(f.name), crc = crc32(f.data), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, 0, true); h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), nm, f.data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, 0, true); c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), nm);
      off += 30 + nm.length + f.data.length;
    });
    var cs = 0; central.forEach(function (p) { cs += p.length; });
    var e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
    return new Blob(parts.concat(central, [new Uint8Array(e.buffer)]), { type: 'application/zip' });
  };

  /* ---------- local draft recovery (IndexedDB) ---------- */
  var DB = 'esonj-token-maker', db = null, stored = {}, saveSeq = 0, timer = 0, enabled = false, saving = false, again = false;
  function setStatus(s, msg) { TM.env.storage = s; TM.env.storageMsg = msg || ''; TM.emit('savestate'); }
  function openDB() {
    return new Promise(function (res, rej) {
      var rq; try { rq = indexedDB.open(DB, 1); } catch (e) { return rej(e); }
      rq.onupgradeneeded = function () { var d = rq.result; if (!d.objectStoreNames.contains('draft')) d.createObjectStore('draft'); if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs'); };
      rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { rej(rq.error || new Error('storage blocked')); }; rq.onblocked = function () { rej(new Error('storage busy')); };
    });
  }
  function req(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
  async function buf(blob) { return blob.arrayBuffer ? blob.arrayBuffer() : new Response(blob).arrayBuffer(); }
  async function doSave() {
    if (!db || !S.art) return;
    var mySeq = ++saveSeq; saving = true; setStatus('saving');
    try {
      var ids = { art: 'art:' + S.art.id, frame: S.frame.builtin ? null : 'frame:' + S.frame.id, subject: 'mask:' + S.masks.subject.sid, popout: 'mask:' + S.masks.popout.sid }, puts = {};
      if (!stored[ids.art]) puts[ids.art] = await buf(S.art.blob);
      if (ids.frame && !stored[ids.frame]) puts[ids.frame] = await buf(S.frame.blob);
      if (!stored[ids.subject]) puts[ids.subject] = await buf(await TM.canvasBlob(S.masks.subject.c));
      if (!stored[ids.popout]) puts[ids.popout] = await buf(await TM.canvasBlob(S.masks.popout.c));
      var rec = { v: 1, savedAt: Date.now(), state: TM.snap(), ids: ids, art: { name: S.art.name, type: S.art.blob.type }, frame: S.frame.builtin ? { builtin: S.frame.builtin } : { name: S.frame.name, type: S.frame.blob.type }, complete: true };
      if (mySeq !== saveSeq) return;                         // a newer snapshot is queued; never write a stale one
      await new Promise(function (res, rej) {
        var tx = db.transaction(['draft', 'blobs'], 'readwrite'), bs = tx.objectStore('blobs'), keep = {};
        tx.oncomplete = res; tx.onerror = function () { rej(tx.error || new Error('write failed')); }; tx.onabort = function () { rej(tx.error || new Error('write aborted')); };
        Object.keys(puts).forEach(function (k) { bs.put(puts[k], k); });
        tx.objectStore('draft').put(rec, 'current');
        Object.keys(ids).forEach(function (k) { if (ids[k]) keep[ids[k]] = 1; });
        var kr = bs.getAllKeys(); kr.onsuccess = function () { kr.result.forEach(function (k) { if (!keep[k]) bs.delete(k); }); if (TM.debug.failNextSave) { TM.debug.failNextSave = false; tx.abort(); } };
        stored._next = keep;
      });
      stored = stored._next; setStatus('saved');
    } catch (e) {
      setStatus('error', /quota/i.test(String(e && e.name) + String(e && e.message)) ? 'Local storage is full.' : 'Local save failed.');
    } finally { saving = false; if (again) { again = false; TM.queueSave(); } }
  }
  TM.queueSave = function () {
    if (!enabled) return;
    if (!db) { setStatus('unavailable'); return; }
    setStatus('saving'); clearTimeout(timer);
    timer = setTimeout(function () { if (saving) { again = true; return; } doSave(); }, 700);
  };
  /* Load the last complete draft, then allow autosaves. Resolves true when a draft was restored. */
  TM.initDrafts = async function () {
    var restored = false;
    try {
      db = await openDB();
      var tx = db.transaction(['draft', 'blobs'], 'readonly'), rec = await req(tx.objectStore('draft').get('current'));
      if (rec && rec.complete && rec.ids && rec.ids.art) {
        var bs = tx.objectStore('blobs'), ab = await req(bs.get(rec.ids.art)), sb = await req(bs.get(rec.ids.subject)), pb = await req(bs.get(rec.ids.popout)), fb = rec.ids.frame ? await req(bs.get(rec.ids.frame)) : null;
        if (ab && sb && pb && (!rec.ids.frame || fb)) {
          var st = vState(JSON.parse(rec.state)), art = await TM.makeArt(new Blob([ab], { type: rec.art.type || 'image/png' }), rec.art.name);
          art.id = rec.ids.art.slice(4);
          var frame = rec.ids.frame ? await TM.makeFrame(new Blob([fb], { type: rec.frame.type || 'image/png' }), rec.frame.name) : await builtinFrame();
          if (rec.ids.frame) frame.id = rec.ids.frame.slice(6);
          var mk = TM.newMasks(art);
          mk.subject = await maskFrom(new Blob([sb], { type: 'image/png' }), mk.subject.w, mk.subject.h); mk.subject.sid = rec.ids.subject.slice(5);
          mk.popout = await maskFrom(new Blob([pb], { type: 'image/png' }), mk.popout.w, mk.popout.h); mk.popout.sid = rec.ids.popout.slice(5);
          TM.adopt({ art: art, frame: frame, masks: mk, state: st });
          Object.keys(rec.ids).forEach(function (k) { if (rec.ids[k]) stored[rec.ids[k]] = 1; });
          restored = true;
        }
      }
      setStatus(restored ? 'saved' : 'idle');
    } catch (e) { if (!db) setStatus('unavailable'); else setStatus('idle'); }
    enabled = true;
    return restored;
  };
  TM.clearDraft = function () { if (!db) return; try { var tx = db.transaction(['draft', 'blobs'], 'readwrite'); tx.objectStore('draft').clear(); tx.objectStore('blobs').clear(); stored = {}; } catch (e) {} };
})();
