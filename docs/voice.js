/*
 * Padel Socials — recording the organizer's voice for "Speak the names".
 * Records from the microphone, then turns the recording into a small WAV file (mono, 16 kHz) whatever the
 * browser recorded in, so the speech service always gets the same, widely accepted format. One minute at most.
 * The recognition itself happens elsewhere (see admin.js: the recording goes to a Make scenario that asks Gemini).
 */
(function (root) {
  'use strict';
  var RATE = 16000, MAX_MS = 60000;
  var AC = root.AudioContext || root.webkitAudioContext, OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
  var supported = !!(root.navigator && root.navigator.mediaDevices && root.navigator.mediaDevices.getUserMedia && root.MediaRecorder && AC && OAC);
  var cur = null;

  function start() {
    if (!supported) return Promise.reject(new Error('This browser cannot record sound.'));
    return root.navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
      var rec = new root.MediaRecorder(stream), chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      cur = { stream: stream, rec: rec, chunks: chunks, started: Date.now() };
      rec.start();
      return cur.started;
    });
  }
  function cancel() {
    var c = cur; cur = null;
    if (!c) return;
    try { c.rec.onstop = null; c.rec.stop(); } catch (e) { /* already stopped */ }
    c.stream.getTracks().forEach(function (t) { t.stop(); });
  }
  // Stops and resolves with { audio: base64 WAV, seconds }.
  function stop() {
    return new Promise(function (resolve, reject) {
      var c = cur; cur = null;
      if (!c) return reject(new Error('Nothing is being recorded.'));
      c.rec.onstop = function () {
        c.stream.getTracks().forEach(function (t) { t.stop(); });
        var blob = new Blob(c.chunks, { type: c.rec.mimeType || 'audio/webm' });
        if (!blob.size) return reject(new Error('The recording is empty.'));
        blob.arrayBuffer().then(decode).then(resample).then(function (samples) {
          resolve({ audio: wavBase64(samples), seconds: samples.length / RATE });
        }).catch(function () { reject(new Error('The recording could not be read. Try again.')); });
      };
      try { c.rec.stop(); } catch (e) { reject(e); }
    });
  }
  function decode(buf) {
    var ctx = new AC();
    return new Promise(function (res, rej) { ctx.decodeAudioData(buf, res, rej); })
      .then(function (audio) { if (ctx.close) ctx.close(); return audio; }, function (e) { if (ctx.close) ctx.close(); throw e; });
  }
  // One channel at 16 kHz, cut off after a minute.
  function resample(audio) {
    var seconds = Math.min(audio.duration, MAX_MS / 1000), frames = Math.max(1, Math.ceil(seconds * RATE));
    var off = new OAC(1, frames, RATE), src = off.createBufferSource();
    src.buffer = audio; src.connect(off.destination); src.start(0);
    var done = off.startRendering();
    if (done && done.then) return done.then(function (b) { return b.getChannelData(0); });
    return new Promise(function (res) { off.oncomplete = function (e) { res(e.renderedBuffer.getChannelData(0)); }; });   // older Safari
  }
  function wavBase64(samples) {
    var n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf), i;
    var str = function (at, s) { for (var k = 0; k < s.length; k++) v.setUint8(at + k, s.charCodeAt(k)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, RATE, true);
    v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
    for (i = 0; i < n; i++) { var x = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
    var bytes = new Uint8Array(buf), out = '';
    for (i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return root.btoa(out);
  }

  root.Voice = { supported: supported, maxMs: MAX_MS, start: start, stop: stop, cancel: cancel, recording: function () { return !!cur; } };
})(typeof self !== 'undefined' ? self : this);
