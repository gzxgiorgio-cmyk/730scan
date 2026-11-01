/* Lettura OCR locale con PaddleOCR (modelli PP-OCR in formato ONNX) eseguita nel browser con onnxruntime-web.
   Pipeline: rilevamento delle righe di testo -> riconoscimento di ogni riga -> testo con righe ricomposte. */
const PaddleOCR = (function () {
  let ort = null, det = null, rec = null, dict = null, loading = null;
  const DET_MAX = (typeof window !== 'undefined' && window.PADDLE_DET) || 1600, DET_THRESH = 0.3, BOX_SCORE = 0.5, UNCLIP = 1.6;
  function base() { return (window.PADDLE_BASE || './'); }
  function load(onStatus) {
    if (loading) return loading;
    loading = (async () => {
      ort = window.ort;
      if (!ort) throw new Error('onnxruntime non caricato');
      ort.env.wasm.wasmPaths = new URL(base() + 'ort/', document.baseURI).href;
      ort.env.wasm.numThreads = 1;
      const opt = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
      if (onStatus) onStatus('Carico il motore di lettura (solo la prima volta)…', 0.1);
      const [d, r, c] = await Promise.all([
        fetch(base() + 'models/det.onnx').then(x => { if (!x.ok) throw new Error('modello det'); return x.arrayBuffer(); }),
        fetch(base() + 'models/rec.onnx').then(x => { if (!x.ok) throw new Error('modello rec'); return x.arrayBuffer(); }),
        fetch(base() + 'models/chars.json').then(x => x.json())
      ]);
      dict = c;
      det = await ort.InferenceSession.create(new Uint8Array(d), opt);
      rec = await ort.InferenceSession.create(new Uint8Array(r), opt);
      return true;
    })().catch(e => { loading = null; throw e; });
    return loading;
  }
  const r32 = v => Math.max(32, Math.round(v / 32) * 32);
  function toCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  async function detect(src) {
    const W = src.width, H = src.height, s = Math.min(1, DET_MAX / Math.max(W, H));
    const dw = r32(W * s), dh = r32(H * s);
    const c = toCanvas(dw, dh), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, dw, dh); x.drawImage(src, 0, 0, dw, dh);
    const px = x.getImageData(0, 0, dw, dh).data, n = dw * dh, f = new Float32Array(3 * n);
    const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
    for (let i = 0; i < n; i++) { /* ordine BGR come in PaddleOCR */
      f[i] = (px[i * 4 + 2] / 255 - mean[0]) / std[0];
      f[n + i] = (px[i * 4 + 1] / 255 - mean[1]) / std[1];
      f[2 * n + i] = (px[i * 4] / 255 - mean[2]) / std[2];
    }
    c.width = 0;
    const out = await det.run({ [det.inputNames[0]]: new ort.Tensor('float32', f, [1, 3, dh, dw]) });
    const p = out[det.outputNames[0]].data;
    /* binarizzazione + dilatazione 2x2 */
    const bin = new Uint8Array(n);
    for (let i = 0; i < n; i++) bin[i] = p[i] > DET_THRESH ? 1 : 0;
    const dil = new Uint8Array(n);
    for (let yy = 0; yy < dh; yy++) for (let xx = 0; xx < dw; xx++) {
      const i = yy * dw + xx;
      dil[i] = bin[i] | (xx + 1 < dw ? bin[i + 1] : 0) | (yy + 1 < dh ? bin[i + dw] : 0) | (xx + 1 < dw && yy + 1 < dh ? bin[i + dw + 1] : 0);
    }
    /* componenti connesse; per ognuna si calcola il rettangolo orientato (asse principale del testo) come il rilevatore originale */
    const seen = new Uint8Array(n), stack = new Int32Array(n), list = new Int32Array(n), boxes = [];
    for (let i0 = 0; i0 < n; i0++) {
      if (!dil[i0] || seen[i0]) continue;
      let sp = 0, cnt = 0, sum = 0, sx = 0, sy = 0;
      stack[sp++] = i0; seen[i0] = 1;
      while (sp) {
        const i = stack[--sp], yy = (i / dw) | 0, xx = i - yy * dw;
        list[cnt++] = i; sum += p[i]; sx += xx; sy += yy;
        if (xx > 0 && dil[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[sp++] = i - 1; }
        if (xx + 1 < dw && dil[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[sp++] = i + 1; }
        if (yy > 0 && dil[i - dw] && !seen[i - dw]) { seen[i - dw] = 1; stack[sp++] = i - dw; }
        if (yy + 1 < dh && dil[i + dw] && !seen[i + dw]) { seen[i + dw] = 1; stack[sp++] = i + dw; }
      }
      if (cnt < 12 || sum / cnt < BOX_SCORE) continue;
      const mx = sx / cnt, my = sy / cnt;
      let sxx = 0, syy = 0, sxy = 0;
      for (let k = 0; k < cnt; k++) { const yy = (list[k] / dw) | 0, xx = list[k] - yy * dw, ux = xx - mx, uy = yy - my; sxx += ux * ux; syy += uy * uy; sxy += ux * uy; }
      let th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      if (Math.abs(th) > 0.35) th = 0; /* oltre ~20 gradi non è una riga storta ma una forma anomala: rettangolo dritto */
      const co = Math.cos(th), si = Math.sin(th);
      let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
      for (let k = 0; k < cnt; k++) { const yy = (list[k] / dw) | 0, xx = list[k] - yy * dw, ux = xx - mx, uy = yy - my, u = ux * co + uy * si, v = -ux * si + uy * co; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
      const bw = u1 - u0 + 1, bh = v1 - v0 + 1;
      if (Math.min(bw, bh) < 3) continue;
      const d = bw * bh * UNCLIP / (2 * (bw + bh));
      const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
      boxes.push({ cx: (mx + cu * co - cv * si) / s, cy: (my + cu * si + cv * co) / s, th, w: (bw + 2 * d) / s, h: (bh + 2 * d) / s });
    }
    return boxes;
  }
  /* righe: box che si sovrappongono in verticale per almeno metà altezza stanno sulla stessa riga */
  function rows(boxes) {
    boxes.forEach(b => { b.y0 = b.cy - b.h / 2; b.y1 = b.cy + b.h / 2; });
    boxes.sort((a, b) => a.cy - b.cy);
    const out = [];
    for (const b of boxes) {
      const r = out.find(r => { const ov = Math.min(r.y1, b.y1) - Math.max(r.y0, b.y0); return ov > 0.5 * Math.min(r.y1 - r.y0, b.h); });
      if (r) { r.items.push(b); r.y0 = Math.min(r.y0, b.y0); r.y1 = Math.max(r.y1, b.y1); } else out.push({ y0: b.y0, y1: b.y1, items: [b] });
    }
    out.sort((a, b) => a.y0 - b.y0);
    out.forEach(r => r.items.sort((a, b) => a.cx - b.cx));
    return out;
  }
  async function recognize(src, b) {
    const bw = b.w + 0.6 * b.h, bh = b.h; /* margine laterale: l'OCR altrimenti perde il primo/ultimo carattere */
    if (bw < 4 || bh < 4) return { t: '', c: 0 };
    const tw = Math.max(16, Math.min(2400, Math.round(48 * bw / bh / 4) * 4 || 16));
    const c = toCanvas(tw, 48), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, tw, 48);
    x.save(); x.scale(tw / bw, 48 / bh); x.translate(bw / 2, bh / 2); x.rotate(-b.th); x.translate(-b.cx, -b.cy); x.drawImage(src, 0, 0); x.restore();
    const px = x.getImageData(0, 0, tw, 48).data, n = tw * 48, f = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) { f[i] = (px[i * 4 + 2] / 255 - 0.5) / 0.5; f[n + i] = (px[i * 4 + 1] / 255 - 0.5) / 0.5; f[2 * n + i] = (px[i * 4] / 255 - 0.5) / 0.5; }
    c.width = 0;
    const out = await rec.run({ [rec.inputNames[0]]: new ort.Tensor('float32', f, [1, 3, 48, tw]) });
    const o = out[rec.outputNames[0]], T = o.dims[1], K = o.dims[2], d = o.data, idx = dict.idx, ch = dict.ch;
    let txt = '', last = -1, conf = 0, nc = 0;
    for (let t = 0; t < T; t++) {
      let best = -1, bv = -1;
      for (let j = 0; j < idx.length; j++) { const v = d[t * K + idx[j]]; if (v > bv) { bv = v; best = j; } }
      if (best !== last && best > 0) { txt += ch[best]; conf += bv; nc++; }
      last = best;
    }
    return { t: txt, c: nc ? conf / nc : 0 };
  }
  /* legge un canvas e restituisce { text, lines:[{text,conf,y}] } */
  async function read(canvas, onStatus) {
    await load(onStatus);
    if (onStatus) onStatus('Cerco le righe di testo…', 0.3);
    const boxes = await detect(canvas), rs = rows(boxes), lines = [];
    let k = 0;
    for (const r of rs) {
      const parts = [];
      for (const b of r.items) { const q = await recognize(canvas, b); if (q.t.trim() && q.c >= 0.35) parts.push(q); }
      k++;
      if (onStatus && (k % 4 === 0)) onStatus('Lettura del testo…', 0.3 + 0.65 * k / rs.length);
      if (parts.length) lines.push({ text: parts.map(q => q.t).join('  '), conf: parts.reduce((a, q) => a + q.c, 0) / parts.length, y: r.y0 });
    }
    return { text: lines.map(l => l.text).join('\n'), lines };
  }
  return { load, read };
})();
if (typeof window !== 'undefined') window.PaddleOCR = PaddleOCR;
