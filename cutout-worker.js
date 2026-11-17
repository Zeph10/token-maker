/* ESONJ's Token Maker: inference worker. Keeps model work off the editing thread. */
'use strict';
var base = new URL('./', self.location.href).href;
importScripts(base + 'cutout-engine.js');
var blobMjs = /[?&]blobmjs=1/.test(self.location.search);
self.onmessage = async function (e) {
  var m = e.data;
  if (m.type !== 'run') return;
  try {
    await CutoutEngine.init(base, function (p) { self.postMessage({ type: 'progress', id: m.id, stage: p.stage, p: p.p }); }, { blobMjs: blobMjs });
    self.postMessage({ type: 'progress', id: m.id, stage: 'infer', p: -1 });
    var t0 = Date.now();
    var mask = await CutoutEngine.run(m.rgba);
    self.postMessage({ type: 'result', id: m.id, mask: mask, ms: Date.now() - t0 }, [mask.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) });
  }
};
