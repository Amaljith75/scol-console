// Board pictures and the tutor creature, ported from app/lib/widgets/visuals.dart and avatar.dart
// so the preview looks like the app. Keep the two in step when the app changes.
const C = { violet: '#7B5CFA', violetDeep: '#5B3FD6', violetSoft: '#EDE7FF', cream: '#F8F5FF', ink: '#2A2350',
  coral: '#FF6B5E', mint: '#2BB673', sun: '#FFC233', cloud: '#E7E1F5', pink: '#E5488B' };
const PALETTE = [C.coral, C.violet, C.mint, C.sun, C.pink]; // visuals.dart _palette
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ui.dart darker(): same hue, 18% less lightness
function darker(hex, amount = 0.18) {
  let [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b); let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6;
  }
  l = Math.max(0, l - amount);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return '#' + [h + 1 / 3, h, h - 1 / 3].map(t => Math.round(f(t) * 255).toString(16).padStart(2, '0')).join('');
}

// Pop: each piece scales in a little after the one before (easeOutBack)
const pop = (i, gap, html, cls = '') => `<span class="pop ${cls}" style="animation-delay:${i * gap}ms">${html}</span>`;
const chip = (t, { bg = '#fff', border = C.cloud, color = C.ink, size = 22 } = {}) =>
  `<span class="v-chip" style="background:${bg};border-color:${border};color:${color};font-size:${size}px">${esc(t)}</span>`;

function shapeSvg(name, color, w = name === 'rectangle' ? 84 : 58, h = 58, dashed = false) {
  const body = {
    circle: `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - 3}" ry="${h / 2 - 3}"/>`,
    triangle: `<polygon points="${w / 2},4 ${w - 4},${h - 4} 4,${h - 4}"/>`,
  }[name] || `<rect x="3" y="3" width="${w - 6}" height="${h - 6}" rx="4"/>`;
  const style = dashed ? `fill="none" stroke="#B9A9F5" stroke-width="3" stroke-dasharray="8 6"`
    : `fill="${color}" stroke="${darker(color)}" stroke-width="4" stroke-linejoin="round"`;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ${style}>${body}</svg>`;
}

function rulerSvg(maxCm, width = 300) {
  const unit = width / (maxCm + 1), H = 46;
  let s = `<rect width="${width}" height="${H}" rx="8" fill="#FFE9A8"/>`;
  for (let i = 0; i <= maxCm; i++) {
    const x = unit * (i + 0.5);
    s += `<line x1="${x}" y1="0" x2="${x}" y2="${H * 0.42}" stroke="${C.ink}" stroke-width="2"/>`;
    if (i < maxCm) s += `<line x1="${x + unit / 2}" y1="0" x2="${x + unit / 2}" y2="${H * 0.22}" stroke="${C.ink}" stroke-width="1"/>`;
    s += `<text x="${x}" y="${H * 0.48 + 12}" text-anchor="middle" font-size="${Math.min(13, unit * 0.62)}" font-weight="800" fill="${C.ink}">${i}</text>`;
  }
  return `<svg width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" style="display:block;overflow:visible">${s}</svg>`;
}

function rulerHtml(len, emoji, { shift = null, width = 300 } = {}) {
  const maxCm = Math.max(10, len + 2), unit = width / (maxCm + 1);
  const objLeft = shift === null ? unit * 0.5 : unit * 2.5; // measure activity: object starts 2 cm in
  const obj = emoji || shift !== null ? `<div class="v-obj" style="margin-left:${objLeft}px;width:${Math.max(unit * len, 12)}px;background:${PALETTE[len % PALETTE.length]}">${esc(emoji)}</div>` : '';
  return `<div class="v-ruler" style="width:${width}px">${obj}<div class="v-scale" data-scale style="transform:translateX(${shift || 0}px)">${rulerSvg(maxCm, width)}</div></div>`;
}

function imgSrc(path) { return '/files/' + String(path || '').split('/').map(encodeURIComponent).join('/'); }

function renderVisual(v) {
  if (!v) return '';
  const a = (v.args || []).map(String), n = i => parseInt(a[i]) || 0;
  switch (v.kind) {
    case 'groups': {
      const size = n(0) * n(1) > 24 ? 18 : 28;
      return `<div class="v" style="gap:10px">${Array.from({ length: n(0) }, (_, g) =>
        pop(g, 140, `<span class="v-group" style="max-width:${size * (n(1) > 6 ? 6.2 : 3.6) + 16}px;font-size:${size}px">${esc(a[2] || '●').repeat(n(1))}</span>`)).join('')}</div>`;
    }
    case 'count':
      return `<div class="v" style="gap:4px;font-size:30px">${Array.from({ length: n(0) }, (_, i) => pop(i, 60, esc(a[1] || '●'))).join('')}</div>`;
    case 'array': {
      const size = n(1) > 5 ? 24 : 30;
      return `<div class="v" style="flex-direction:column;gap:0">${Array.from({ length: n(0) }, (_, r) =>
        pop(r, 160, `<span style="font-size:${size}px;letter-spacing:4px">${esc(a[2] || '●').repeat(n(1))}</span>`)).join('')}</div>`;
    }
    case 'numberline': {
      const from = n(0), to = n(1), mark = a.length > 2 ? n(2) : null;
      const span = Math.abs(to - from), step = span <= 10 ? 1 : Math.ceil(span / 10);
      let t = '';
      for (let x = from, i = 0; x <= to; x += step, i++) t += `<span class="${x === mark ? 'm' : ''}">${pop(i, 60, x)}</span>`;
      return `<div class="v-line"><div class="ticks">${t}</div><div class="rail"></div></div>`;
    }
    case 'shapes':
      return `<div class="v" style="gap:14px;row-gap:12px">${a.map((s, i) => pop(i, 120, shapeSvg(s, PALETTE[i % PALETTE.length]))).join('')}</div>`;
    case 'sticks':
      return `<div class="v" style="gap:12px;row-gap:8px">${Array.from({ length: n(0) }, (_, i) =>
        pop(i, 60, `<span class="v-stick" style="transform:rotate(${(i % 3 - 1) * 0.22}rad)"></span>`)).join('')}</div>`;
    case 'place': return abacusHtml([n(0), n(1), n(2)]);
    case 'notes':
      return `<div class="v" style="gap:8px">${a.map((x, i) => {
        const k = +x; return pop(i, 110, chip('₹' + x, { bg: k >= 100 ? '#D9F2E3' : k >= 10 ? '#FFE3D1' : '#FFF1B8', border: k >= 100 ? C.mint : k >= 10 ? C.coral : C.sun, size: 20 }));
      }).join('')}</div>`;
    case 'ruler': return rulerHtml(n(0), a[1] || '');
    case 'pattern':
      return `<div class="v" style="gap:6px">${a.map((x, i) => pop(i, 130, x === '?' ? chip('?', { bg: '#FFF1B8', border: C.sun, color: C.coral }) : chip(x, { size: x.length > 3 ? 18 : 22 }))).join('')}</div>`;
    case 'split': {
      const c = (t, i) => pop(i, 300, t === '?' ? chip('?', { bg: '#FFF1B8', border: C.sun, color: C.coral, size: 26 }) : chip(t, { border: C.violet, size: 26 }));
      return `<div class="v" style="flex-direction:column;gap:0">${c(a[0], 0)}
        <svg width="150" height="34"><path d="M75 2 L33 32 M75 2 L117 32" stroke="${C.violet}" stroke-width="4" stroke-linecap="round" fill="none"/></svg>
        <div class="v" style="gap:26px">${c(a[1], 1)}${c(a[2], 2)}</div></div>`;
    }
    case 'steps':
      return `<div class="v-steps">${a.map((s, i) => pop(i, 650, esc(s), i === a.length - 1 && a.length > 1 ? 'last' : '')).join('')}</div>`;
    case 'text': return `<div class="v-text">${pop(0, 0, esc(a.join(' ')))}</div>`;
    case 'emoji': return `<div class="v" style="font-size:64px;gap:10px">${a.map((e, i) => pop(i, 200, esc(e))).join('')}</div>`;
    case 'image': return `<img class="v-img" src="${imgSrc(a[0])}" alt="" onerror="this.outerHTML='<span style=&quot;font-size:64px&quot;>🖼️</span>'">`;
  }
  return `<span class="chip bad">unknown visual ${esc(v.kind)}</span>`;
}

function abacusHtml(counts, rods = false) {
  const labels = ['100', '10', '1'], colors = [C.coral, C.violet, C.mint];
  return `<div class="v-abacus">${counts.map((c, p) => `<div class="v-rod">
    <div class="pole" ${rods ? `data-rod="${p}" role="slider" aria-label="${labels[p]} beads" aria-valuenow="${c}" tabindex="0"` : ''}>
      ${Array.from({ length: c }, (_, b) => `<span class="bead" style="background:${colors[p]}"></span>`).join('')}</div>
    <div class="base"></div><b style="color:${colors[p]}">${labels[p]}</b></div>`).join('')}</div>`;
}

// ---------- tutor creature (avatar.dart) ----------
function creatureRadius(shape, a, t) {
  const w = 0.035 * Math.sin(3 * a + t * 2 * Math.PI) + 0.025 * Math.sin(2 * a - t * 4 * Math.PI);
  switch (shape) {
    case 'spiky': return 0.70 + 0.30 * Math.pow(Math.abs(Math.cos(4 * a + 0.4)), 2.2) + w * 0.6;
    case 'cloud': return 0.80 + 0.17 * Math.abs(Math.sin(3 * a + 0.5)) + w * 0.5;
    case 'flower': return 0.70 + 0.28 * Math.abs(Math.cos(2.5 * a)) + w * 0.5;
    case 'bean': return 0.96 / Math.sqrt(Math.cos(a) ** 2 + (Math.sin(a) / 0.76) ** 2) + w;
    default: return 0.86 + 0.07 * Math.sin(3 * a + 1.0) + 0.05 * Math.sin(2 * a + 2.0) + w * 1.6;
  }
}
function creaturePath(ctx, shape, cx, cy, r, t) {
  ctx.beginPath();
  for (let i = 0; i <= 96; i++) {
    const a = i / 96 * 2 * Math.PI, rr = r * creatureRadius(shape, a, t);
    i ? ctx.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a)) : ctx.moveTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
  }
  ctx.closePath();
}
const CREATURES = new Set();
function drawCreature(cv) {
  const st = cv._c, tutor = st.tutor, s = cv.width, ctx = cv.getContext('2d'), now = Date.now();
  const t = (now % 3200) / 3200, e = tutor.energy || 1;
  if (now > (st.nextBlink || 0)) { st.blinkUntil = now + 130; st.nextBlink = now + 1800 + Math.random() * 3500; }
  if (now > (st.nextWander || 0)) { st.wander = [(Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.35]; st.nextWander = now + 900 + Math.random() * 2200; }
  let [gx, gy] = st.gaze || [0, 0]; const d = Math.hypot(gx, gy); if (d > 1) { gx /= d; gy /= d; }
  const k = gx || gy ? 0.3 : 1; gx += st.wander[0] * k; gy += st.wander[1] * k;
  st.eyes = [st.eyes[0] + (gx - st.eyes[0]) * 0.16, st.eyes[1] + (gy - st.eyes[1]) * 0.16];
  const hop = st.mood === 'happy' ? 0.10 : 0.035;
  const bob = -Math.abs(Math.sin(t * 2 * Math.PI * (e > 1.4 ? 2 : 1))) * s * hop * Math.min(1.6, Math.max(0.6, e)) + s * 0.04;
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = 'rgba(0,0,0,.13)'; ctx.beginPath(); ctx.ellipse(s / 2, s * 0.97, s * 0.25, s * 0.03, 0, 0, 7); ctx.fill();
  ctx.save(); ctx.translate(0, bob);
  const body = tutor.color, dark = '#23243A';
  creaturePath(ctx, tutor.shape, s / 2, s / 2, s * 0.46, t); ctx.fillStyle = body; ctx.fill();
  ctx.save(); ctx.clip(); ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.beginPath(); ctx.arc(s * 0.34, s * 0.26, s * 0.24, 0, 7); ctx.fill(); ctx.restore();
  const style = tutor.eyes, eyeR = s * (style === 'wide' ? 0.125 : style === 'soft' ? 0.085 : 0.105);
  const gap = s * (tutor.shape === 'bean' ? 0.17 : 0.14), lx = st.eyes[0] * s * 0.03, ly = st.eyes[1] * s * 0.025;
  for (const side of [-1, 1]) {
    let r = eyeR; if (style === 'curious' && side === 1) r *= 1.22;
    const ex = s / 2 + side * gap + lx, ey = s * 0.46 + ly;
    ctx.strokeStyle = dark; ctx.lineCap = 'round';
    if (now < st.blinkUntil) { ctx.lineWidth = s * 0.03; ctx.beginPath(); ctx.moveTo(ex - r * 0.8, ey); ctx.lineTo(ex + r * 0.8, ey); ctx.stroke(); continue; }
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, ey, r, 0, 7); ctx.fill();
    const pr = r * 0.58, px = ex + st.eyes[0] * (r - pr) * 0.95, py = ey + st.eyes[1] * (r - pr) * 0.95;
    ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(px, py, pr, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px + pr * 0.3, py - pr * 0.35, pr * 0.3, 0, 7); ctx.fill();
    if (style === 'sleepy') {
      ctx.save(); ctx.beginPath(); ctx.rect(ex - r * 1.2, ey - r * 1.2, r * 2.4, r * 1.05); ctx.clip();
      ctx.fillStyle = body; ctx.beginPath(); ctx.arc(ex, ey, r * 1.06, 0, 7); ctx.fill(); ctx.restore();
      ctx.lineWidth = s * 0.02; ctx.beginPath(); ctx.moveTo(ex - r, ey - r * 0.15); ctx.lineTo(ex + r, ey - r * 0.15); ctx.stroke();
    }
  }
  const mx = s / 2 + lx, my = s * 0.64 + ly;
  ctx.strokeStyle = dark; ctx.fillStyle = dark; ctx.lineWidth = s * 0.03; ctx.lineCap = 'round';
  if (st.talking && Math.floor(t * 14) % 2 === 0) { ctx.beginPath(); ctx.ellipse(mx, my, s * 0.055, s * 0.045, 0, 0, 7); ctx.fill(); }
  else {
    const w = st.mood === 'happy' ? s * 0.2 : s * 0.13;
    ctx.beginPath(); ctx.ellipse(mx, my - s * 0.035, w / 2, s * 0.055, 0, 0.12 * Math.PI, 0.88 * Math.PI); ctx.stroke();
  }
  ctx.restore();
}
function creature(tutor, size, opts = {}) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size * 2; cv.style.width = cv.style.height = size + 'px';
  cv._c = { tutor, eyes: [0, 0], wander: [0, 0], ...opts }; CREATURES.add(cv); return cv;
}
(function loop() {
  for (const cv of CREATURES) cv.isConnected ? drawCreature(cv) : CREATURES.delete(cv);
  requestAnimationFrame(loop);
})();
