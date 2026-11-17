/* ESONJ's Token Maker: file menu, auto-cutout flow, export, presets, runtime status, start-up. */
(function () {
  'use strict';
  var TM = window.TM, S = TM.S, G = TM.G, UI = TM.UI, h = TM.h, ui = TM.ui;
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- modal plumbing ---------- */
  var modalCleanup = null;
  function openModal(title, body, narrow, onClose) {
    closeModal();
    var m = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [h('div', { class: 'dlg' + (narrow ? ' narrow' : '') }, [
      h('header', {}, [h('h2', { text: title }), h('button', { class: 'btn small', type: 'button', text: 'Close', onclick: closeModal })]), body])]);
    m.addEventListener('pointerdown', function (e) { if (e.target === m) closeModal(); });
    $('modals').appendChild(m); modalCleanup = onClose || null;
    var f = m.querySelector('button, input'); if (f) f.focus();
    return m;
  }
  function closeModal() { var m = document.querySelector('.modal'); if (m) m.remove(); if (modalCleanup) { var f = modalCleanup; modalCleanup = null; f(); } }
  TM.closeModal = closeModal;

  /* When a host blocks downloads, show the full-resolution image so it can be saved by hand. */
  function saveImagePanel(blob, name, msg) {
    var url = URL.createObjectURL(blob), img = h('img', { src: url, alt: name });
    openModal('Save ' + name, h('div', { class: 'body' }, [h('div', { class: 'col' }, [h('div', { class: 'pvbox' }, [img])]), h('div', { class: 'col' }, [
      h('p', { class: 'note warn', text: msg || 'This host blocked the download.' }),
      h('p', { text: 'This is the full-resolution image. Press and hold it, or right-click it, and choose Save image.' }),
      h('p', { class: 'note', text: name })])]), false, function () { URL.revokeObjectURL(url); });
  }
  async function deliver(name, blob, isImage, statusEl) {
    var r = await TM.saveFile(name, blob);
    if (r.ok) { if (statusEl) statusEl.textContent = 'Saved ' + name; else ui.toast('Saved ' + name); return true; }
    if (r.declined) { if (statusEl) statusEl.textContent = 'Download cancelled.'; return false; }
    if (isImage) saveImagePanel(blob, name, r.message); else ui.toast(r.message + ' Try the static build for file downloads.', 7000);
    return false;
  }
  async function encode(canvas, format) {
    var want = format === 'webp' && TM.env.webp ? 'image/webp' : 'image/png', b = await TM.canvasBlob(canvas, want, want === 'image/webp' ? 1 : undefined);
    return { blob: b, ext: b.type === 'image/webp' ? 'webp' : 'png' };   // extension follows the encoded MIME type
  }

  /* ---------- file menu and inputs ---------- */
  function menu() {
    var m = $('menu'); m.textContent = '';
    function item(t, fn, dis) { var b = h('button', { type: 'button', text: t, onclick: function () { m.hidden = true; $('btnMenu').setAttribute('aria-expanded', 'false'); fn(); } }); if (dis) b.disabled = true; m.appendChild(b); }
    item('Open artwork…', function () { $('fileArt').click(); });
    item('Try Demo', ui.loadDemo);
    m.appendChild(h('hr'));
    item('Open Project…', function () { $('fileProject').click(); });
    item('Save Project', saveProject, !S.art);
    m.appendChild(h('hr'));
    item('Redo', TM.redo, !TM.undoInfo().redo);
    item('Zoom to fit', ui.fitView);
    item('Runtime status', statusDialog);
    m.hidden = !m.hidden; $('btnMenu').setAttribute('aria-expanded', String(!m.hidden));
  }
  $('btnMenu').onclick = function (e) { e.stopPropagation(); menu(); };
  document.addEventListener('pointerdown', function (e) { var m = $('menu'); if (!m.hidden && !m.contains(e.target) && e.target !== $('btnMenu')) { m.hidden = true; $('btnMenu').setAttribute('aria-expanded', 'false'); } });
  function onFile(id, fn) { $(id).addEventListener('change', function () { var f = this.files && this.files[0]; this.value = ''; if (f) fn(f); }); }
  onFile('fileArt', function (f) { ui.setArt(f, f.name.replace(/\.[^.]+$/, '')); });
  onFile('fileBorder', function (f) { if (!S.art) return ui.toast('Load artwork first, then add a border.'); ui.setBorder(f, f.name.replace(/\.[^.]+$/, '')); });
  onFile('fileProject', openProject);
  onFile('filePreset', applyPresetFile);
  async function saveProject() {
    if (!S.art) return;
    try { await deliver(TM.safeName(S.exp.name) + '.token.json', await TM.projectBlob(), false); } catch (e) { ui.toast('Could not save the project: ' + e.message); }
  }
  async function openProject(f) {
    try { var st = await TM.stageProject(await f.text()); var first = !S.art; TM.adopt(st, first ? null : 'Open project'); if (first) TM.emit('edit', 'Open project'); ui.fitView(); ui.toast('Project opened.'); }
    catch (e) { ui.toast(e.message, 7000); }
  }
  /* drag and drop */
  var dragDepth = 0;
  window.addEventListener('dragenter', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0) { dragDepth++; $('dropHint').hidden = false; e.preventDefault(); } });
  window.addEventListener('dragover', function (e) { if (dragDepth) e.preventDefault(); });
  window.addEventListener('dragleave', function () { if (dragDepth && --dragDepth === 0) $('dropHint').hidden = true; });
  window.addEventListener('drop', function (e) {
    dragDepth = 0; $('dropHint').hidden = true;
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return; e.preventDefault();
    if (/json$/i.test(f.type) || /\.json$/i.test(f.name)) { f.text().then(function (t) { if (t.indexOf(TM.PRESET) >= 0 && t.indexOf(TM.PROJECT) < 0) applyPresetFile(f); else openProject(f); }); return; }
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return ui.toast('Drop a PNG, JPEG or WebP image, or a Token Maker project file.');
    var nm = f.name.replace(/\.[^.]+$/, '');
    if (!S.art) return ui.setArt(f, nm);
    ui.toast('Use ' + f.name + ' as:', 9000, [['Artwork', function () { ui.setArt(f, nm); }], ['Border', function () { if (f.type === 'image/jpeg') ui.toast('Borders need transparency. Use a PNG or WebP.'); else ui.setBorder(f, nm); }]]);
  });

  /* ---------- auto-cutout flow ---------- */
  var STAGES = { runtime: 'Loading runtime', model: 'Loading model', compile: 'Preparing model', infer: 'Finding the subject' };
  function setCutbar(kids) { var b = $('cutbar'); b.textContent = ''; kids.forEach(function (k) { b.appendChild(k); }); b.hidden = !kids.length; }
  function bbtn(t, fn, cls) { return h('button', { class: 'btn small ' + (cls || ''), type: 'button', text: t, onclick: fn }); }
  function offer(cand, sourceNote) {
    UI.candidate = cand; ui.hideProgress();
    var first = !S.hasSubject && S.masks.popout.isEmpty(), kids = [h('span', { text: sourceNote + (first ? ' Use it how?' : ' Update the subject?') })];
    if (first) kids.push(bbtn('Auto Pop-out', function () { apply('top'); }, 'primary'), bbtn('Use Whole Subject', function () { apply('whole'); }), bbtn('Choose Parts', function () { apply('parts'); }));
    else kids.push(bbtn('Update Subject, keep pop-out', function () { apply('subject'); }, 'primary'), bbtn('Auto Pop-out (replaces pop-out)', function () { apply('top'); }), bbtn('Replace pop-out with whole subject', function () { apply('whole'); }));
    kids.push(bbtn('Cancel', cancel));
    setCutbar(kids); ui.refresh();
  }
  function apply(how) {
    var cand = UI.candidate; if (!cand) return;
    var sub = S.masks.subject, x = TM.cx(sub.c), deltas = [];
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, sub.w, sub.h); x.drawImage(cand, 0, 0, sub.w, sub.h);
    deltas.push(sub.commit('subject', null)); S.hasSubject = true;
    if (how === 'whole') { S.masks.popout.fill(1); deltas.push(S.masks.popout.commit('popout', null)); S.restrict = true; }
    if (how === 'top') { fillTop(); deltas.push(S.masks.popout.commit('popout', null)); S.restrict = true; }
    var grew = (how === 'whole' || how === 'top') && ensureCrossing();
    if (how === 'whole' || how === 'top') UI.tool = 'compose';   // show the finished result without the mask overlay
    if (how === 'parts') { S.restrict = true; UI.maskTarget = 'popout'; UI.brushTool = 'brush'; UI.brushMode = 'add'; UI.overlay = true; UI.tool = 'popout'; }
    UI.candidate = null; setCutbar([]);
    TM.commit(how === 'top' ? 'Auto-cutout: auto pop-out' : how === 'whole' ? 'Auto-cutout: whole subject' : how === 'parts' ? 'Auto-cutout: choose parts' : 'Auto-cutout: update subject', deltas);
    if (how === 'parts') ui.toast('Subject found (amber). Paint the parts that should cross the rim.', 6000);
    if (how !== 'parts') {
      var acts = S.bgMode === 'original' ? [['Hide background', function () { S.bgMode = 'subject'; TM.commit('Background mode'); }]] : [];
      ui.toast(how === 'subject' ? 'Subject updated.' : how === 'top' && !grew ? 'The top of the subject now crosses the rim; the rest stays inside the frame.' : grew ? 'Artwork enlarged so the subject crosses the rim. Drag it into place in Compose.' : 'The subject now sits over the rim.', 8000, acts);
    }
  }
  /* Classic pop-out: everything above a line just below the opening's middle is raised, the rest stays behind the rim. */
  function fillTop() {
    var m = S.masks.popout, x = TM.cx(m.c), o = TM.openingWorld(), y0 = o.cy + o.h * 0.12, soft = o.h * 0.05, k = m.scale || S.masks.scale;
    m.fill(0);
    TM.Mx.set(x, TM.Mx.mul(TM.Mx.sc(k), TM.Mx.inv(TM.artMatrix())));
    var g = x.createLinearGradient(0, y0 - soft, 0, y0); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(-6 * G, -6 * G, 13 * G, 6 * G + y0);
    x.setTransform(1, 0, 0, 1, 0, 0);
  }
  function popTop() { if (!S.hasSubject) return ui.toast('Run Auto-cutout first so there is a subject to raise.'); fillTop(); var d = S.masks.popout.commit('popout', null); S.restrict = true; ensureCrossing(); UI.tool = 'compose'; TM.commit('Auto pop-out', [d]); ui.toast('The top of the subject now crosses the rim; the rest stays inside the frame. Paint in Pop-out to add or remove parts.', 7000); }
  /* How much of the raised art is visible outside the opening, as a share of the opening's area. */
  function crossing() {
    var N = 192, k = N / (3 * G), c = TM.mk(N, N), x = TM.cx(c, { willReadFrequently: true }), M = [k, 0, 0, k, G * k, G * k];
    TM.compose(c, M, { mode: 'layer-pop', proxy: true });
    TM.Mx.set(x, TM.Mx.mul(M, TM.frameMatrix())); x.globalCompositeOperation = 'destination-out'; x.fillStyle = '#fff'; TM.openingPath(x); x.fill();
    var d = x.getImageData(0, 0, N, N).data, n = 0, o = TM.openingWorld(); for (var i = 3; i < d.length; i += 4) if (d[i] > 60) n++;
    return n / (Math.PI * o.w * o.h / 4 * k * k);
  }
  /* A pop-out only shows when the subject reaches past the opening. If it does not, enlarge the art about the opening centre. */
  function ensureCrossing() {
    var o = TM.openingWorld(), T = S.artT, grew = false;
    for (var i = 0; i < 4 && crossing() < 0.04; i++) {
      var f = i === 0 ? Math.max(1.2, 1.3 * TM.coverScale(S.art) / T.scale) : 1.18;
      T.x = o.cx + (T.x - o.cx) * f; T.y = o.cy + (T.y - o.cy) * f; T.scale *= f; grew = true;
    }
    return grew;
  }
  function cancel() { TM.cutoutCancel(); UI.candidate = null; setCutbar([]); ui.hideProgress(); ui.refresh(); }
  async function start(auto) {
    if (!S.art) return;
    ui.ensureEdgeAfter(); UI.candidate = null; setCutbar([]);
    ui.showProgress('Starting', -1);
    try {
      var cand = await TM.cutoutRun(function (p) { ui.showProgress(STAGES[p.stage] || 'Working', p.stage === 'infer' || p.stage === 'compile' ? -1 : p.p); });
      if (!cand) { if (!TM.cutoutBusy()) ui.hideProgress(); return; }      // cancelled, superseded or outdated: nothing changes
      if (auto === 'top') { UI.candidate = cand; ui.hideProgress(); apply('top'); } else offer(cand, 'Subject detected.');
    } catch (e) {
      ui.hideProgress(); ui.refresh();
      ui.toast(e.message, 9000, [['Retry', function () { start(auto); }]]);
    }
  }
  function existing() {
    if (!S.art) return; TM.cutoutCancel();
    var m = S.masks.subject, c = TM.mk(m.w, m.h), x = TM.cx(c); x.fillStyle = '#fff'; x.fillRect(0, 0, m.w, m.h);   // full mask: the artwork's own alpha is then the only alpha
    offer(c, 'Using the artwork’s own transparency.');
  }
  $('progCancel').onclick = cancel;
  function autoPop() { if (S.hasSubject) popTop(); else start('top'); }
  TM.cutUI = { start: function () { start(); }, cancel: cancel, existing: existing, apply: apply, popTop: popTop, autoPop: autoPop };

  /* ---------- export ---------- */
  var MODES = [
    ['token', 'Finished Token', 'Art, border and pop-out, with the final grade'],
    ['foundry', 'Foundry Dynamic Ring Subject', 'Subject only, centred in Foundry’s ring guide'],
    ['portrait', 'Character Portrait', 'Matching unframed portrait'],
    ['border', 'Recolored Border', 'The positioned border alone'],
    ['layers', 'Layer PNGs', 'Base art, border and pop-out in a ZIP']
  ];
  var LAYER_TXT = 'ESONJ\'s Token Maker layer export\n\nAll PNGs share one square canvas, the same coordinates and the same crop.\nStack them in this order, bottom to top:\n  1. 01-base-art.png   artwork clipped to the frame opening\n  2. 02-border.png     the border (rim)\n  3. 03-pop-out.png    the selected pop-out artwork, drawn over the rim\n\nEach layer carries its own adjustments (artwork grade and colour replacement, border grade and tint).\nfinished-token.png is the reference composite. It also applies two things a plain stack cannot:\nsoft pop-out edges are blended between the two orderings (art under rim, art over rim) so partial\ncoverage is not doubled, and the final grade is applied once to the whole token.\n';
  function exportDialog() {
    if (!S.art) return;
    ui.ensureEdgeAfter();
    var st = { mode: 'token', clip: false, drag: null }, pvc = h('canvas', { width: 640, height: 640 }), pvx = pvc.getContext('2d');
    var status = h('p', { class: 'note', role: 'status' }), extra = h('div', { class: 'col' }), callout = h('div', { class: 'col' });
    var nameIn = h('input', { class: 'field', id: 'expName', type: 'text', value: S.exp.name, 'aria-label': 'File name', maxlength: 80 });
    var dl = h('button', { class: 'btn primary wide', type: 'button', text: 'Download', onclick: function () { download(false); } });
    var modeBox = h('div', { class: 'modes' }), sizeSeg = h('div', { class: 'seg' }), fmtSeg = h('div', { class: 'seg' }), pvNote = h('p', { class: 'note' });
    MODES.forEach(function (m) { modeBox.appendChild(h('button', { type: 'button', 'data-mode': m[0], onclick: function () { st.mode = m[0]; st.clip = false; if (m[0] === 'portrait') TM.initPortrait(); sync(); } }, [m[1], h('small', { text: m[2] })])); });
    [256, 512, 1024, 2048].forEach(function (s) { sizeSeg.appendChild(h('button', { type: 'button', text: String(s), 'data-size': s, onclick: function () { S.exp.size = s; TM.commit('Export size'); sync(); } })); });
    [['png', 'PNG'], ['webp', 'WebP']].forEach(function (f) { fmtSeg.appendChild(h('button', { type: 'button', text: f[1], 'data-fmt': f[0], onclick: function () { S.exp.format = f[0]; TM.commit('Export format'); sync(); } })); });
    nameIn.onchange = function () { S.exp.name = TM.safeName(nameIn.value); nameIn.value = S.exp.name; TM.commit('Export name'); };
    function sl(label, min, max, step, get, set) {
      var i = h('input', { type: 'range', min: min, max: max, step: step, value: get(), 'aria-label': label });
      i.oninput = function () { set(+i.value); st.clip = false; preview(); }; i.onchange = function () { TM.commit(label); sync(); };
      return h('label', { class: 'row' }, [h('span', { text: label }), i, h('output')]);
    }
    function sg(opts, get, set) { var b = h('div', { class: 'seg' }); opts.forEach(function (o) { b.appendChild(h('button', { type: 'button', text: o[1], 'aria-pressed': String(get() === o[0]), onclick: function () { set(o[0]); TM.commit('Export option'); sync(); } })); }); return b; }
    function needSubject() {
      return h('div', { class: 'callout' }, [h('span', { text: 'This export needs a subject mask.' }), h('div', { class: 'btns' }, [
        bbtn('Detect subject', function () { closeModal(); ui.setTool('popout'); start(); }, 'primary'),
        bbtn('Mask by hand', function () { closeModal(); UI.maskTarget = 'subject'; UI.brushTool = 'brush'; UI.brushMode = 'add'; ui.setTool('popout'); }),
        S.art.hasAlpha ? bbtn('Use existing transparency', function () { var m = S.masks.subject; m.fill(1); var d = m.commit('subject', null); S.hasSubject = true; TM.commit('Use existing transparency', [d]); sync(); }) : null])]);
    }
    function clipPrompt(what) {
      return h('div', { class: 'callout' }, [h('span', { text: what + ' The crimson areas would be cut off.' }), h('div', { class: 'btns' }, [
        bbtn('Fit & Preview', function () { if (st.mode === 'token') { TM.fitToken(); TM.commit('Fit Token'); } else { TM.fitFoundry(); TM.commit('Fit Foundry framing'); } st.clip = false; sync(); status.textContent = 'Fitted. Check the preview, then download. Undo restores the old framing.'; }, 'primary'),
        bbtn('Export as Framed', function () { download(true); }),
        bbtn('Back to Editor', closeModal)])]);
    }
    function preview() {
      var N = 640, c; pvx.clearRect(0, 0, N, N); pvc.width = N; pvc.height = N;
      if (st.mode === 'token') { if (st.clip) c = TM.renderOverflow(N); else { c = TM.mk(N, N); TM.compose(c, [N / G, 0, 0, N / G, 0, 0], { proxy: true }); } pvx.drawImage(c, 0, 0); }
      else if (st.mode === 'foundry') {
        if (S.hasSubject) {
          if (st.clip) {   // zoomed-out view of the same framing, with the cut region tinted
            var z = 1 / 1.6, o = N / 2 * (1 - z), big = TM.mk(N, N), bx = TM.cx(big);
            TM.compose(big, TM.Mx.mul([z, 0, 0, z, o, o], TM.foundryMatrix(N)), { proxy: true, mode: 'foundry', ring: N / 3 * z });
            bx.setTransform(1, 0, 0, 1, 0, 0); bx.globalCompositeOperation = 'source-atop'; bx.fillStyle = 'rgba(255,45,85,.78)'; bx.beginPath(); bx.rect(0, 0, N, N); bx.rect(o, o, N * z, N * z); bx.fill('evenodd');
            bx.globalCompositeOperation = 'source-over'; bx.strokeStyle = '#fff'; bx.lineWidth = 2; bx.setLineDash([6, 4]); bx.strokeRect(o, o, N * z, N * z);
            pvx.drawImage(big, 0, 0);
          } else {
            c = TM.renderFoundry(N, true); pvx.drawImage(c, 0, 0);
            pvx.strokeStyle = 'rgba(46,230,214,.9)'; pvx.lineWidth = 2; pvx.setLineDash([8, 6]); pvx.beginPath(); pvx.arc(N / 2, N / 2, N / 3, 0, 7); pvx.stroke(); pvx.setLineDash([]);
          }
        }
      }
      else if (st.mode === 'portrait') { c = TM.renderPortrait(N, true); pvc.width = c.width; pvc.height = c.height; pvx.drawImage(c, 0, 0); }
      else if (st.mode === 'border') { c = TM.mk(N, N); TM.compose(c, [N / G, 0, 0, N / G, 0, 0], { proxy: true, mode: 'border' }); pvx.drawImage(c, 0, 0); }
      else { var q = N / 2, k = q / G; [['layer-base', 0, 0, 'Base art'], ['border', q, 0, 'Border'], ['layer-pop', 0, q, 'Pop-out'], ['token', q, q, 'Finished']].forEach(function (L) { c = TM.mk(q, q); TM.compose(c, [k, 0, 0, k, 0, 0], { proxy: true, mode: L[0], noFinal: L[0] !== 'token' }); pvx.drawImage(c, L[1], L[2]); pvx.fillStyle = '#fff'; pvx.font = '600 16px system-ui'; pvx.fillText(L[3], L[1] + 10, L[2] + 24); pvx.strokeStyle = 'rgba(255,255,255,.25)'; pvx.strokeRect(L[1] + 0.5, L[2] + 0.5, q - 1, q - 1); }); }
    }
    function sync() {
      Array.prototype.forEach.call(modeBox.children, function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === st.mode)); });
      Array.prototype.forEach.call(sizeSeg.children, function (b) { b.setAttribute('aria-pressed', String(+b.getAttribute('data-size') === S.exp.size)); });
      var webpOK = TM.env.webp && st.mode !== 'layers'; fmtSeg.hidden = !webpOK;
      Array.prototype.forEach.call(fmtSeg.children, function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-fmt') === (webpOK ? S.exp.format : 'png'))); });
      extra.textContent = ''; callout.textContent = ''; dl.hidden = false; dl.textContent = st.mode === 'layers' ? 'Download ZIP' : 'Download';
      var p = S.portrait, f = S.foundry;
      if (st.mode === 'token') pvNote.textContent = 'Transparent square, ' + S.exp.size + ' px. Exactly what the editor shows inside the export guide.';
      if (st.mode === 'foundry') {
        pvNote.textContent = 'The dashed circle is Foundry’s ring guide (two thirds of the canvas). Outside it only pop-out areas remain. Border and background are left out.';
        if (!S.hasSubject) { callout.appendChild(needSubject()); dl.hidden = true; }
        else { extra.appendChild(sl('Zoom', 0.3, 3, 0.01, function () { return f.zoom; }, function (v) { f.zoom = v; })); extra.appendChild(sl('Left / right', -0.5, 0.5, 0.005, function () { return f.dx; }, function (v) { f.dx = v; })); extra.appendChild(sl('Up / down', -0.5, 0.5, 0.005, function () { return f.dy; }, function (v) { f.dy = v; }));
          extra.appendChild(h('p', { class: 'note', text: 'This framing is separate from the finished token.' })); }
      }
      if (st.mode === 'portrait') {
        pvNote.textContent = 'Drag the preview to move the crop. Artwork colour and the final grade are applied; no border.';
        extra.appendChild(sg([['square', 'Square'], ['source', 'Source aspect']], function () { return p.aspect; }, function (v) { p.aspect = v; }));
        extra.appendChild(sl('Zoom', 1, 8, 0.01, function () { return p.zoom; }, function (v) { p.zoom = v; }));
        extra.appendChild(sg([['original', 'Original background'], ['subject', 'Subject on transparency']], function () { return p.bg; }, function (v) { p.bg = v; }));
        if (p.bg === 'subject' && !S.hasSubject) callout.appendChild(needSubject());
      }
      if (st.mode === 'border') pvNote.textContent = 'Same square canvas as the token. Replacement colours, border grade and tint are applied; the final grade is left for the finished token so the border stays reusable.';
      if (st.mode === 'layers') {
        pvNote.textContent = 'Four PNGs with identical size, coordinates and crop, plus a note on layer order.';
        extra.appendChild(h('p', { class: 'note', text: 'If the ZIP cannot be downloaded here, save the PNGs one at a time:' }));
        extra.appendChild(h('div', { class: 'btns' }, layerList().map(function (L) { return bbtn(L.label, function () { saveOne(L); }); })));
      }
      if (st.clip) callout.appendChild(clipPrompt(st.mode === 'token' ? 'Visible art crosses the export guide.' : 'The subject crosses the edge of the square.'));
      preview();
    }
    function layerList() {
      var n = TM.safeName(S.exp.name);
      return [{ mode: 'layer-base', file: n + '-01-base-art.png', label: 'Base art' }, { mode: 'border', file: n + '-02-border.png', label: 'Border' }, { mode: 'layer-pop', file: n + '-03-pop-out.png', label: 'Pop-out' }, { mode: 'token', file: n + '-finished-token.png', label: 'Finished token' }];
    }
    async function saveOne(L) { status.textContent = 'Rendering…'; var b = await TM.canvasBlob(TM.renderToken(S.exp.size, L.mode)); status.textContent = ''; await deliver(L.file, b, true, status); }
    async function download(framed) {
      var n = TM.safeName(S.exp.name), size = S.exp.size, c, out;
      try {
        if (st.mode === 'token') {
          if (!framed && TM.measure().overflow) { st.clip = true; sync(); status.textContent = ''; return; }
          c = TM.renderToken(size); out = await encode(c, S.exp.format); st.clip = false; sync();
          await deliver(n + '.' + out.ext, out.blob, true, status);
        } else if (st.mode === 'foundry') {
          if (!S.hasSubject) return;
          if (!framed && TM.foundryClipped()) { st.clip = true; sync(); status.textContent = ''; return; }
          c = TM.renderFoundry(size); out = await encode(c, S.exp.format); st.clip = false; sync();
          await deliver(n + '-ring-subject.' + out.ext, out.blob, true, status);
        } else if (st.mode === 'portrait') {
          c = TM.renderPortrait(size); out = await encode(c, S.exp.format); await deliver(n + '-portrait.' + out.ext, out.blob, true, status);
        } else if (st.mode === 'border') {
          c = TM.renderToken(size, 'border'); out = await encode(c, S.exp.format); await deliver(n + '-border.' + out.ext, out.blob, true, status);
        } else {
          status.textContent = 'Rendering layers…';
          var files = [], ls = layerList();
          for (var i = 0; i < ls.length; i++) { var b = await TM.canvasBlob(TM.renderToken(size, ls[i].mode)); files.push({ name: ls[i].file, data: new Uint8Array(await b.arrayBuffer()) }); }
          files.push({ name: 'LAYERS.txt', data: new TextEncoder().encode(LAYER_TXT) });
          var r = await TM.saveFile(n + '-layers.zip', TM.zip(files));
          status.textContent = r.ok ? 'Saved ' + n + '-layers.zip' : r.declined ? 'Download cancelled.' : (r.message || 'The ZIP could not be downloaded.') + ' Use the buttons above to save each PNG.';
        }
      } catch (e) { status.textContent = 'Export failed: ' + e.message; }
    }
    // drag the portrait crop
    pvc.addEventListener('pointerdown', function (e) { if (st.mode !== 'portrait') return; pvc.setPointerCapture(e.pointerId); st.drag = { x: e.clientX, y: e.clientY, cx: S.portrait.cx, cy: S.portrait.cy }; });
    pvc.addEventListener('pointermove', function (e) {
      if (!st.drag) return; var r = TM.portraitRect(), k = r.w / pvc.getBoundingClientRect().width, fl = S.artT.flip ? -1 : 1;
      S.portrait.cx = TM.clamp(st.drag.cx - (e.clientX - st.drag.x) * k * fl / S.art.w, 0, 1); S.portrait.cy = TM.clamp(st.drag.cy - (e.clientY - st.drag.y) * k / S.art.h, 0, 1); preview();
    });
    pvc.addEventListener('pointerup', function () { if (st.drag) { st.drag = null; TM.commit('Portrait crop'); } });
    var body = h('div', { class: 'body' }, [
      h('div', { class: 'col' }, [h('div', { class: 'pvbox' }, [pvc]), pvNote]),
      h('div', { class: 'col' }, [modeBox, sizeSeg, fmtSeg, nameIn, extra, callout, dl, status])]);
    openModal('Export', body);
    sync();
  }
  $('btnExport').onclick = exportDialog;

  /* ---------- layout presets ---------- */
  async function savePreset(name) {
    if (!S.art) return ui.toast('Load artwork first.');
    name = TM.safeName(name, 'layout');
    try { await deliver(name + '.preset.json', await TM.presetBlob(name), false); } catch (e) { ui.toast('Could not save the preset: ' + e.message); }
  }
  async function applyPresetFile(f) {
    if (!S.art) return ui.toast('Load a portrait first, then apply a preset to it.');
    var pr; try { pr = await TM.stagePreset(await f.text()); } catch (e) { return ui.toast(e.message, 7000); }
    var pvc = h('canvas', { width: 480, height: 480 }), resample = h('input', { type: 'checkbox', id: 'presetResample' });
    function withPreset(fn) { var keepSnap = TM.snap(), keepFrame = S.frame; TM.applyPreset(pr, resample.checked); try { return fn(); } finally { S.frame = keepFrame; TM.restore(keepSnap); } }
    function prev() { withPreset(function () { TM.compose(pvc, [480 / G, 0, 0, 480 / G, 0, 0], { proxy: true }); }); }
    resample.onchange = prev;
    var body = h('div', { class: 'body' }, [h('div', { class: 'col' }, [h('div', { class: 'pvbox' }, [pvc])]), h('div', { class: 'col' }, [
      h('p', { text: 'Preview of “' + pr.name + '” on your current portrait.' }),
      h('p', { class: 'note', text: 'The border, opening, framing, colour and export settings come from the preset. Your portrait and its masks stay as they are.' }),
      h('label', { class: 'check', for: 'presetResample' }, [resample, h('span', { text: 'Resample the border tint from this portrait' })]),
      h('div', { class: 'btns' }, [bbtn('Apply preset', function () {
        var before = TM.assetRef(); TM.applyPreset(pr, resample.checked); TM.emit('assets'); TM.commit('Apply preset: ' + pr.name, null, { before: before, after: TM.assetRef() }); closeModal(); ui.toast('Preset applied. Undo restores your previous layout.');
      }, 'primary'), bbtn('Cancel', closeModal)])])]);
    openModal('Apply Layout Preset', body); prev();
  }
  TM.dialogs = { savePreset: savePreset, exportDialog: exportDialog };

  /* ---------- runtime status ---------- */
  function statusDialog() {
    var e = TM.env, rows = [
      ['Host', e.host ? 'Claude Artifact' : 'Static page'],
      ['Downloads', e.downloads === 'direct' ? 'Direct browser downloads' : e.downloads === 'host' ? 'Through the host save prompt' : e.downloads === 'blocked' ? 'Blocked here. Images open full-size to save by hand.' : 'Checking'],
      ['Local drafts', e.storage === 'unavailable' ? 'Unavailable: browser storage is blocked' : e.storage === 'error' ? 'Last save failed. ' + (e.storageMsg || '') : 'Working (IndexedDB)'],
      ['Auto-cutout', TM.cut.error ? 'Could not load: ' + TM.cut.error : TM.cut.path ? 'Ready, ' + (TM.cut.path === 'main' ? 'on the page thread' : 'in a worker') + ', last run ' + TM.cut.lastMs + ' ms' : 'Loads on first use'],
      ['Model', TM.cut.model],
      ['WebP export', e.webp ? 'Supported' : 'Not supported in this browser'],
      ['Version', TM.VERSION]
    ], dlEl = h('dl', { class: 'status' });
    rows.forEach(function (r) { dlEl.appendChild(h('dt', { text: r[0] })); dlEl.appendChild(h('dd', { text: r[1] })); });
    openModal('Runtime status', h('div', { class: 'body' }, [h('div', { class: 'col' }, [dlEl, h('p', { class: 'note', text: 'Artwork, masks and projects stay in this browser. Only the model and runtime files are fetched, from this page’s own folder.' })])]), true);
  }
  function saveChip() {
    var c = $('saveState'), s = TM.env.storage; c.className = 'chip'; c.onclick = null;
    if (s === 'saving') { c.hidden = false; c.textContent = 'Saving…'; }
    else if (s === 'saved') { c.hidden = false; c.textContent = 'Saved locally'; c.classList.add('ok'); }
    else if (s === 'unavailable' || s === 'error') { c.hidden = false; c.textContent = 'Recovery unavailable'; c.classList.add('warn'); c.title = 'Local drafts are not being saved. Click to download a project file instead.'; c.onclick = saveProject; }
    else c.hidden = true;
  }
  TM.on('savestate', saveChip);

  /* ---------- start-up ---------- */
  (async function boot() {
    S.frame = await TM.builtinFrame();
    TM.markClean();
    ui.fitView(); ui.refresh();
    var restored = await TM.initDrafts();
    if (restored) { ui.fitView(); ui.refresh(); ui.toast('Restored your last session from this browser.'); }
    saveChip();
    TM.ready = true;
  })();
})();
