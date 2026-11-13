// Scol Console front end: plain JS, no build step.
const $ = s => document.querySelector(s);
const view = $('#view');
const BOARDS = { 'kerala-scert': 'Kerala State (SCERT)', cbse: 'CBSE (NCERT)' };
const SUBJECTS = ['maths', 'english', 'malayalam', 'evs', 'science', 'social-science', 'hindi'];
const PICTURE_SUBJECTS = s => s !== 'maths'; // these need a picture AI for stories and scenes
const FIELD_HINTS = {
  header: ['title.ml', 'objective', 'objective.ml', 'concept', 'concept.name', 'concept.name.ml', 'minutes'],
  say: ['en', 'ml', 'visual', 'label'],
  ask: ['form', 'en', 'ml', 'visual', 'options', 'options.ml', 'answer', 'hint.en', 'hint.ml', 'explain.en', 'explain.ml', 'level', 'concept', 'mistake 0'],
  story: ['en', 'ml', 'visual'], picture: ['visual', 'en', 'ml'],
};
const TEMPLATES = {
  say: [['en', ''], ['ml', ''], ['visual', '']],
  ask: [['form', 'choice'], ['en', ''], ['ml', ''], ['options', ''], ['answer', ''], ['hint.en', ''], ['explain.en', '']],
  story: [['en', ''], ['ml', '']], picture: [['visual', ''], ['en', '']],
};
// Ready-made providers. Model names are only suggestions: type any model the provider offers.
const PRESETS = [
  { name: 'Gemini (text)', kind: 'gemini', model: 'gemini-2.5-flash', use: 'text' },
  { name: 'Gemini (pictures)', kind: 'gemini', model: 'gemini-2.5-flash-image', use: 'image' },
  { name: 'Claude', kind: 'anthropic', model: 'claude-sonnet-5-5', use: 'text' },
  { name: 'OpenAI', kind: 'openai', model: 'gpt-4o-mini', use: 'text' },
  { name: 'OpenAI (pictures)', kind: 'openai', model: 'gpt-image-1', use: 'image' },
  { name: 'OpenRouter', kind: 'openrouter', base_url: 'https://openrouter.ai/api/v1', model: '', use: 'text' },
  { name: 'Groq', kind: 'groq', base_url: 'https://api.groq.com/openai/v1', model: '', use: 'text' },
  { name: 'DeepSeek', kind: 'deepseek', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', use: 'text' },
  { name: 'Ollama (this computer)', kind: 'ollama', base_url: 'http://localhost:11434/v1', model: 'qwen3:4b', use: 'text' },
  { name: 'Rented GPU: text (vLLM, Ollama, LM Studio, TGI)', kind: 'gpu', base_url: 'https://YOUR-POD-ID-8000.proxy.runpod.net/v1', model: '', use: 'text' },
  { name: 'Rented GPU: pictures (OpenAI-compatible image server)', kind: 'gpu', base_url: 'https://YOUR-POD-ID-8000.proxy.runpod.net/v1', model: '', use: 'image' },
];
const KIND_LIST = ['gemini', 'anthropic', 'openai', 'openrouter', 'groq', 'deepseek', 'mistral', 'together', 'ollama', 'lmstudio', 'vllm', 'gpu'];

async function api(method, path, body, raw, type = 'application/pdf') {
  const opt = { method, headers: {} };
  if (raw) { opt.body = raw; opt.headers['Content-Type'] = type; }
  else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
  const r = await fetch('/api' + path, opt);
  const data = await r.json().catch(() => ({ error: r.statusText }));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'on' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ''), err ? 6000 : 2500);
}
async function busy(btn, label, fn) {
  const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span> ${label}`;
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = old; } }
}
const enc = encodeURIComponent;
const dur = s => s == null ? '–' : s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
const short = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : (n || 0);
const when = t => new Date(t * 1000).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const statusChip = s => `<span class="chip ${{ done: 'ok', running: '', failed: 'bad', interrupted: 'bad', 'partly done': 'warn' }[s] ?? ''}">${s === 'running' ? '<span class="spin"></span> ' : ''}${esc(s)}</span>`;

// ---------- router ----------
window.addEventListener('hashchange', render);
// one page load at a time, so a slow earlier load never draws over a newer one
function render() { return (render.q = (render.q || Promise.resolve()).then(draw)); }
async function draw() {
  const h = location.hash.slice(1) || '/';
  const m = h.match(/^\/p\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/);
  const tab = h.startsWith('/providers') ? 'providers' : h.startsWith('/history') ? 'history' : h.startsWith('/textbooks') || m ? 'textbooks' : 'overview';
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === tab));
  try {
    if (m) return await projectPage(m[1], m[2], m[3]);
    if (tab === 'providers') return await providersPage();
    if (tab === 'history') return await historyPage();
    if (tab === 'textbooks') return await textbooksPage();
    return await overviewPage();
  } catch (e) { view.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
}

// ---------- running conversions: polled in the header, so they never disappear when you change page ----------
let JOBS = [];
async function pollJobs() {
  try {
    const before = new Map(JOBS.map(j => [j.id, j.status]));
    JOBS = await api('GET', '/jobs');
    const running = JOBS.filter(j => j.status === 'running');
    $('#jobs').innerHTML = running.map(j => {
      const i = j.steps.findIndex(s => s.status === 'running'), n = j.steps.length;
      const now = j.steps[i];
      return `<a class="jobpill" href="#/history" title="Open conversion history"><span class="spin"></span>
        <b>${esc(j.title)}</b> ${n > 1 ? `· ${i + 1}/${n}` : ''} ${now ? '· ' + esc(now.title) : ''} · ${dur(Date.now() / 1000 - j.started)}
        <i style="width:${Math.round((j.steps.filter(s => !['waiting', 'running'].includes(s.status)).length / n) * 100)}%"></i></a>`;
    }).join('');
    for (const j of JOBS) {
      if (before.get(j.id) === 'running' && j.status !== 'running') {
        toast(`${j.title}: ${j.status} in ${dur(j.seconds)}`, j.status !== 'done');
        if (location.hash.includes(j.project) || location.hash.startsWith('#/history') || location.hash.length < 3) render();
      }
    }
    if (location.hash.startsWith('#/history') && running.length) drawHistory();
    if (P && running.some(j => j.project === P.id)) drawProjectJob();
  } catch { /* server restarting */ }
  setTimeout(pollJobs, JOBS.some(j => j.status === 'running') ? 1500 : 5000);
}
async function startJob(pid, kind, chapters = [], note = '') {
  const j = await api('POST', `/projects/${pid}/jobs`, { kind, chapters, note });
  JOBS.unshift(j); toast('Started. It keeps running while you use other pages.');
  clearTimeout(pollJobs.t); pollJobs();
}

// ---------- overview ----------
async function overviewPage() {
  const o = await api('GET', '/overview');
  const t = k => o.projects.reduce((s, p) => s + (p[k] || 0), 0);
  const lessons = t('lessons'), approved = t('approved');
  view.innerHTML = `
    <h1>Overview</h1><p class="sub">Textbooks turned into Scol levels. Everything stays in staging until Scol is connected.</p>
    <div class="kpis">
      ${kpi('Textbooks', o.projects.length)}${kpi('Chapters', t('chapters'))}${kpi('Lessons (levels)', lessons)}
      ${kpi('Approved', approved, lessons ? approved / lessons : 0)}${kpi('AI calls', o.ai.calls)}
      ${kpi('Tokens in / out', `${short(o.ai.in)} / ${short(o.ai.out)}`)}
    </div>
    <div class="grid2">
      <div class="card"><div class="row"><h2 class="grow">Textbooks</h2><a class="btn primary" href="#/textbooks">+ New textbook</a></div>
        ${o.projects.length ? `<table><tr><th>Title</th><th>Board</th><th>Class</th><th>Subject</th><th>Lessons</th><th>Approved</th></tr>
        ${o.projects.map(p => `<tr class="link" onclick="location.hash='#/p/${p.id}'"><td><b>${esc(p.title || p.id)}</b></td><td>${esc(BOARDS[p.board] || p.board)}</td>
          <td>${esc(p.class)}</td><td>${esc(p.subject)}</td><td>${p.lessons}</td><td><span class="chip ${p.approved === p.lessons && p.lessons ? 'ok' : ''}">${p.approved}/${p.lessons}</span></td></tr>`).join('')}</table>`
        : `<div class="empty">No textbooks yet.</div>`}
      </div>
      <div class="card"><div class="row"><h2 class="grow">Recent conversions</h2><a class="btn small" href="#/history">History</a></div>
        ${o.providers ? '' : `<p><a class="btn lime" href="#/providers">Add an AI provider first</a></p>`}
        ${o.jobs.map(j => `<div class="row" style="font-size:14px;padding:7px 0;border-bottom:1px solid var(--line)">
          <span class="grow"><b>${esc(j.title)}</b><br><small style="color:var(--muted)">${j.kind === 'find' ? 'Find chapters' : `${j.steps.length} chapter(s)`} · ${when(j.started)}</small></span>
          ${statusChip(j.status)}</div>`).join('') || '<p class="sub">None yet.</p>'}
      </div>
    </div>
    <div class="card" style="margin-top:14px"><h2>Tokens by provider</h2>
      ${o.ai.by_provider.length ? `<table><tr><th>Provider · model</th><th>Calls</th><th>Pictures</th><th>Tokens in</th><th>Tokens out</th><th>AI time</th></tr>
      ${o.ai.by_provider.map(b => `<tr><td><b>${esc(b.name)}</b></td><td>${b.calls}</td><td>${b.images}</td><td>${short(b.in)}</td><td>${short(b.out)}</td><td>${dur(b.seconds)}</td></tr>`).join('')}</table>`
      : '<p class="sub">No AI calls yet.</p>'}
      <p class="sub" style="margin:14px 0 0">Push target: <code>${esc(o.push_target)}</code></p>
    </div>`;
}
const kpi = (label, num, frac) => `<div class="card kpi"><div class="label">${label}</div><div class="num">${num}</div>${frac !== undefined ? `<div class="bar"><i style="width:${Math.round(frac * 100)}%"></i></div>` : ''}</div>`;

// ---------- history ----------
async function historyPage() {
  JOBS = await api('GET', '/jobs');
  view.innerHTML = `<h1>Conversion history</h1><p class="sub">Every conversion, its status, how long it took and the tokens each AI used.
    Conversions run on the server, so you can move between pages while they work.</p><div class="card" id="hist"></div>`;
  drawHistory();
}
function drawHistory() {
  const box = $('#hist'); if (!box) return;
  const open = new Set([...box.querySelectorAll('details[open]')].map(d => d.dataset.id));
  box.innerHTML = JOBS.length ? JOBS.map(j => `<details data-id="${j.id}" ${open.has(j.id) ? 'open' : ''} class="job">
    <summary><span class="grow"><b>${esc(j.title)}</b> <small style="color:var(--muted)">· ${j.kind === 'find' ? 'Find chapters' : `${j.steps.length} chapter(s)`} · ${when(j.started)}</small></span>
      ${statusChip(j.status)}<span class="tm">${dur(j.seconds ?? (Date.now() / 1000 - j.started))}</span>
      <span class="tm">${short(j.tokens_in ?? j.steps.reduce((s, x) => s + (x.tokens_in || 0), 0))} in · ${short(j.tokens_out ?? j.steps.reduce((s, x) => s + (x.tokens_out || 0), 0))} out</span>
      <a class="btn small" href="#/p/${j.project}" onclick="event.stopPropagation()">Open</a>
      <button class="btn small danger" data-deljob="${j.id}" ${j.status === 'running' ? 'disabled' : ''}>Delete</button></summary>
    <table><tr><th>Chapter</th><th>Status</th><th>Time</th><th>Tokens in / out</th><th>AI used</th><th>Result</th></tr>
    ${j.steps.map(s => `<tr><td>${esc(s.title)}</td><td>${statusChip(s.status)}</td><td>${dur(s.seconds)}</td>
      <td>${s.tokens_in != null ? `${short(s.tokens_in)} / ${short(s.tokens_out)}` : '–'}</td>
      <td><small>${[...new Set(s.calls || [])].map(esc).join('<br>') || '–'}</small></td>
      <td><small>${esc(s.error || s.result || '')}</small></td></tr>`).join('')}</table>
    ${j.note ? `<p class="sub">Note to AI: ${esc(j.note)}</p>` : ''}</details>`).join('') : '<div class="empty">No conversions yet.</div>';
  box.querySelectorAll('[data-deljob]').forEach(b => b.onclick = async e => {
    e.preventDefault();
    if (!confirm('Delete this history record? The lessons it made are kept.')) return;
    try { await api('DELETE', `/jobs/${b.dataset.deljob}`); JOBS = JOBS.filter(j => j.id !== b.dataset.deljob); drawHistory(); } catch (err) { toast(err.message, true); }
  });
}

// ---------- textbooks ----------
async function textbooksPage() {
  const [o, subs, pv] = await Promise.all([api('GET', '/overview'), api('GET', '/content-subjects'), api('GET', '/providers')]);
  const opts = use => pv.providers.filter(p => (p.use || 'text') === use).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  view.innerHTML = `
    <h1>Textbooks</h1><p class="sub">Upload a textbook PDF. The AI finds its chapters, then writes Scol levels for each chapter.</p>
    <div class="grid2">
      <div class="card"><h2>New textbook</h2>
        <div class="form">
          <label class="f">Title<input id="t-title" placeholder="Mathematics Standard III Part 1"></label>
          <label class="f">Board<select id="t-board">${Object.entries(BOARDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <label class="f">Class<select id="t-class">${Array.from({ length: 10 }, (_, i) => `<option ${i === 2 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
          <label class="f">Subject<input id="t-subject" list="subjects" value="maths"><datalist id="subjects">${SUBJECTS.map(s => `<option>${s}</option>`).join('')}</datalist></label>
          <label class="f">Lesson language<select id="t-lang"><option value="both">English + Malayalam</option><option value="en">English</option><option value="ml">Malayalam</option></select></label>
          <label class="f">Text AI<select id="t-prov">${opts('text') || '<option value="">(add one first)</option>'}</select></label>
          <label class="f">Picture AI<select id="t-img"><option value="">None</option>${opts('image')}</select></label>
        </div>
        <p class="sub" id="t-tip" style="margin:-4px 0 12px"></p>
        <div class="drop" id="drop" tabindex="0" role="button">Drop the textbook PDF here, or click to choose<br><small>Stays on this computer (studio/data, not committed)</small></div>
        <input type="file" id="file" accept="application/pdf" hidden>
        <hr style="border:0;border-top:1px solid var(--line);margin:20px 0">
        <h2>Or open lessons Scol already has</h2>
        <p class="sub" style="margin-bottom:10px">To compare with AI output and to test the preview against the real app's lessons.</p>
        <div class="row"><select id="t-from" class="grow" style="width:auto">${subs.map(s => `<option>${s}</option>`).join('')}</select>
          <button class="btn dark" id="t-open">Open copy</button></div>
      </div>
      <div class="card"><h2>All textbooks</h2>
        ${o.projects.map(p => `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--line)">
          <a class="grow" href="#/p/${p.id}"><b>${esc(p.title || p.id)}</b><br><small style="color:var(--muted)">${esc(p.board)} · class ${esc(p.class)} · ${esc(p.subject)} · ${p.pages ? p.pages + ' pages' : 'copy of Scol content'}</small></a>
          <span class="chip">${p.lessons} lessons</span>
          <button class="btn small danger" data-delp="${p.id}" aria-label="Delete ${esc(p.title || p.id)}">Delete</button></div>`).join('') || '<p class="sub">None yet.</p>'}
      </div>
    </div>`;
  const tip = () => $('#t-tip').innerHTML = PICTURE_SUBJECTS($('#t-subject').value.trim())
    ? `🎨 <b>${esc($('#t-subject').value)}</b> lessons need pictures for stories and scenes: choose a strong text AI (Gemini Pro, Claude, GPT) and a Picture AI.` : '';
  $('#t-subject').oninput = tip; tip();
  const meta = () => ({ title: $('#t-title').value, board: $('#t-board').value, class: $('#t-class').value,
    subject: $('#t-subject').value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'), lang: $('#t-lang').value,
    provider: $('#t-prov').value, image_provider: $('#t-img').value });
  const qs = m => Object.entries(m).map(([k, v]) => `${k}=${enc(v)}`).join('&');
  const upload = async f => {
    if (!f || f.type !== 'application/pdf') return toast('Choose a PDF file', true);
    const m = meta();
    if (PICTURE_SUBJECTS(m.subject) && !m.image_provider && !confirm(`${m.subject} has no Picture AI, so lessons will have no story pictures. Continue?`)) return;
    const d = $('#drop'); d.innerHTML = `<span class="spin"></span> Reading ${esc(f.name)}…`;
    try {
      if (!m.title) m.title = f.name.replace(/\.pdf$/i, '');
      const p = await api('POST', '/projects?' + qs(m), undefined, await f.arrayBuffer());
      toast(`${p.pages} pages read${p.scanned_pages ? `, ${p.scanned_pages} look scanned` : ''}`);
      location.hash = '#/p/' + p.id;
    } catch (e) { toast(e.message, true); d.textContent = 'Drop the textbook PDF here, or click to choose'; }
  };
  const d = $('#drop');
  d.onclick = () => $('#file').click(); d.onkeydown = e => e.key === 'Enter' && $('#file').click();
  $('#file').onchange = e => upload(e.target.files[0]);
  d.ondragover = e => { e.preventDefault(); d.classList.add('over'); };
  d.ondragleave = () => d.classList.remove('over');
  d.ondrop = e => { e.preventDefault(); d.classList.remove('over'); upload(e.dataTransfer.files[0]); };
  $('#t-open').onclick = e => busy(e.target, 'Copying', async () => {
    const src = $('#t-from').value, [board, cls, subject] = src.split('/');
    const p = await api('POST', '/projects?' + qs({ ...meta(), board, class: cls.replace('class-', ''), subject, title: `Scol copy: ${src}`, from: src }));
    location.hash = '#/p/' + p.id;
  });
  view.querySelectorAll('[data-delp]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this textbook with all its chapters, lessons and pictures? This cannot be undone.')) return;
    await api('DELETE', `/projects/${b.dataset.delp}`).then(render, e => toast(e.message, true));
  });
}

// ---------- providers ----------
async function providersPage() {
  const { providers } = await api('GET', '/providers');
  let list = providers.map(p => ({ use: 'text', ...p }));
  const draw = () => {
    view.innerHTML = `
      <h1>AI Providers</h1><p class="sub">Add any AI by URL and key. Type any kind and model.
      <b>gemini</b> and <b>anthropic</b> use their own APIs; every other kind is treated as an OpenAI-compatible URL
      (OpenAI, OpenRouter, Groq, DeepSeek, Mistral, Ollama, or your own server on a rented GPU).
      Keys stay in <code>studio/data/providers.json</code> on this computer and are never shown again.</p>
      <datalist id="kinds">${KIND_LIST.map(k => `<option>${k}</option>`).join('')}</datalist>
      ${list.map((p, i) => `<div class="card" style="margin-bottom:12px"><div class="form">
        <label class="f">Name<input data-i="${i}" data-k="name" value="${esc(p.name)}" placeholder="My Gemini"></label>
        <label class="f">Used for<select data-i="${i}" data-k="use"><option value="text" ${p.use !== 'image' ? 'selected' : ''}>Lessons (text)</option><option value="image" ${p.use === 'image' ? 'selected' : ''}>Pictures</option></select></label>
        <label class="f">Kind (type any)<input data-i="${i}" data-k="kind" list="kinds" value="${esc(p.kind)}" placeholder="gemini, anthropic, openai, gpu…"></label>
        <label class="f">Model (type any)<input data-i="${i}" data-k="model" value="${esc(p.model)}" placeholder="model name"></label>
        <label class="f">Base URL<input data-i="${i}" data-k="base_url" value="${esc(p.base_url)}" placeholder="empty = the kind's default"></label>
        <label class="f">API key<input data-i="${i}" data-k="api_key" type="password" value="${esc(p.api_key)}" placeholder="not needed for local models" autocomplete="off"></label>
      </div><div class="row"><button class="btn small" data-test="${i}" ${p.id && p.use !== 'image' ? '' : 'disabled'} title="${p.use === 'image' ? 'test a picture AI by drawing a picture in a lesson' : 'save first'}">Test</button>
        <span class="grow" id="test-${i}" style="font-size:14px;color:var(--muted)"></span>
        <button class="btn small danger" data-del="${i}">Remove</button></div></div>`).join('')}
      <div class="row"><select id="preset" style="width:auto"><option value="">+ Add from preset…</option>${PRESETS.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join('')}</select>
        <button class="btn" id="add">+ Add blank</button><button class="btn primary" id="save">Save</button></div>
      <div class="card" style="margin-top:18px"><h2>Running on a rented GPU</h2>
        <p class="sub" style="margin:0">Rent a GPU (RunPod, Vast.ai, Lambda, Paperspace…), start an OpenAI-compatible server on it, for example
        <code>vllm serve Qwen/Qwen2.5-32B-Instruct --port 8000</code> or Ollama, then add it here with the preset
        <b>Rented GPU</b>: paste the pod's URL ending in <code>/v1</code> and the model name. Picture servers that speak
        <code>/v1/images/generations</code> (for example LocalAI with Stable Diffusion) work as a Picture provider the same way.
        Stop the pod when you finish: rented GPUs bill by the hour.</p></div>`;
    view.querySelectorAll('[data-k]').forEach(el => el.oninput = el.onchange = () => {
      list[el.dataset.i][el.dataset.k] = el.value; if (el.dataset.k === 'use') draw();
    });
    view.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { list.splice(b.dataset.del, 1); draw(); });
    view.querySelectorAll('[data-test]').forEach(b => b.onclick = () => busy(b, 'Testing', async () => {
      const r = await api('POST', '/providers/test', { id: list[b.dataset.test].id });
      $('#test-' + b.dataset.test).textContent = `✓ replied “${r.reply}” in ${r.seconds}s`;
    }));
    $('#preset').onchange = e => { if (e.target.value === '') return; list.push({ base_url: '', api_key: '', ...PRESETS[e.target.value], name: PRESETS[e.target.value].name.split(':')[0] }); draw(); };
    $('#add').onclick = () => { list.push({ name: '', kind: '', model: '', base_url: '', api_key: '', use: 'text' }); draw(); };
    $('#save').onclick = e => busy(e.target, 'Saving', async () => { list = (await api('POST', '/providers', list)).providers; draw(); toast('Saved'); });
  };
  draw();
}

// ---------- project workspace ----------
let P = null, L = null, mode = 'blocks', blocks = [], focusBlock = null;
async function projectPage(pid, cid, lname) {
  P = await api('GET', `/projects/${pid}`);
  const pv = await api('GET', '/providers');
  const chs = P.chapter_list;
  const sel = (use, cur, none) => `${none ? `<option value="">${none}</option>` : ''}${pv.providers.filter(p => (p.use || 'text') === use).map(p => `<option value="${p.id}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`;
  view.innerHTML = `
    <div class="row" style="margin-top:6px"><a class="btn small" href="#/textbooks" aria-label="Back to textbooks">←</a>
      <h1 class="grow" style="font-size:32px">${esc(P.title || P.id)}</h1>
      <label class="mini">Text AI<select id="p-prov">${sel('text', P.provider) || '<option>(none)</option>'}</select></label>
      <label class="mini">Picture AI<select id="p-img">${sel('image', P.image_provider, 'None')}</select></label>
      ${P.has_pdf ? `<button class="btn dark" id="p-find">Find chapters</button><button class="btn" id="p-gen-all">Convert all chapters</button>` : ''}
      <button class="btn lime" id="p-push">Push to Scol (staging)</button>
      <button class="btn small danger" id="p-del">Delete</button></div>
    <p class="sub">${esc(BOARDS[P.board] || P.board)} · Class ${esc(P.class)} · ${esc(P.subject)} · ${P.pages ? P.pages + ' pages' : 'copy of existing Scol lessons'}
      ${P.scanned_pages ? ` · <span class="chip warn">${P.scanned_pages} scanned pages: use Gemini or Claude</span>` : ''}
      ${PICTURE_SUBJECTS(P.subject) && !P.image_provider ? ` · <span class="chip warn">no Picture AI: story pictures will be missing</span>` : ''}</p>
    <div id="pjob"></div>
    <div class="work">
      <aside class="side">
        <h3>Chapters <button class="btn small dark" id="ch-add" style="background:#3A3456">+ Add</button></h3>
        ${chs.map(c => `<div class="ch"><div class="ch-head ${c.id === cid && !lname ? 'on' : ''}" onclick="location.hash='#/p/${pid}/${c.id}'">
            <span class="grow">${esc(c.title.en)}</span><span class="n">${c.lessons.length}</span></div>
          ${c.id === cid ? `<ul class="ls">${c.lessons.map(l => `<li class="${l.name === lname ? 'on' : ''}" onclick="location.hash='#/p/${pid}/${c.id}/${l.name}'">
            <span class="dot ${l.status}"></span><span class="grow">${esc(l.name.replace(/\.md$/, ''))}</span></li>`).join('')}
            <li onclick="newLesson()" style="color:#A7A0C8">+ New lesson</li></ul>` : ''}</div>`).join('') ||
          `<p style="padding:8px;color:#A7A0C8">${P.has_pdf ? 'Press “Find chapters”.' : 'No chapters.'}</p>`}
      </aside>
      <section id="editor" class="card">${cid ? '' : '<div class="empty">Pick a chapter on the left.</div>'}</section>
      <div class="phone-col"><div class="row" style="justify-content:center;margin-bottom:8px">
          <select id="tutor-pick" style="width:auto" aria-label="Tutor"></select></div>
        <div class="phone"><div class="screen" id="screen"></div></div>
        <div class="inspect" id="inspect" hidden></div></div>
    </div>`;
  drawProjectJob();
  setupTutorPicker();
  idleScreen('Open a lesson to see it as a child sees it.');
  $('#p-prov').onchange = e => api('POST', `/projects/${pid}/settings`, { provider: e.target.value }).then(() => toast('Text AI set'));
  $('#p-img').onchange = e => api('POST', `/projects/${pid}/settings`, { image_provider: e.target.value }).then(m => { P.image_provider = m.image_provider; toast('Picture AI set'); });
  if ($('#p-find')) $('#p-find').onclick = e => busy(e.target, 'Starting', () => startJob(pid, 'find'));
  if ($('#p-gen-all')) $('#p-gen-all').onclick = e => {
    const todo = chs.filter(c => !c.lessons.length).map(c => c.id); // retry only chapters that have nothing yet
    if (!todo.length) return toast('Every chapter has lessons. Use “Regenerate” on a chapter to redo it.', true);
    busy(e.target, 'Starting', () => startJob(pid, 'generate', todo));
  };
  $('#p-push').onclick = e => busy(e.target, 'Building', async () => showPush(await api('POST', `/projects/${pid}/push`)));
  $('#p-del').onclick = async () => {
    if (!confirm(`Delete "${P.title || P.id}" and all its chapters, lessons and pictures? This cannot be undone.`)) return;
    await api('DELETE', `/projects/${pid}`); location.hash = '#/textbooks';
  };
  $('#ch-add').onclick = async () => {
    const title = prompt('Chapter title (English)'); if (!title) return;
    const start = P.pages ? prompt('First page in the PDF', '1') : 1, end = P.pages ? prompt('Last page in the PDF', start) : 1;
    try { const r = await api('POST', `/projects/${pid}/chapters`, { title, start, end }); location.hash = `#/p/${pid}/${r.id}`; } catch (e) { toast(e.message, true); }
  };
  if (cid && lname) return lessonEditor(pid, cid, lname);
  if (cid) return chapterEditor(pid, chs.find(c => c.id === cid));
}
function drawProjectJob() {
  const box = $('#pjob'); if (!box || !P) return;
  const j = JOBS.find(x => x.project === P.id && x.status === 'running');
  box.innerHTML = j ? `<div class="card jobcard"><div class="row"><span class="spin"></span><b class="grow">${j.kind === 'find' ? 'Finding chapters' : 'Converting'} · ${dur(Date.now() / 1000 - j.started)}</b><a class="btn small" href="#/history">History</a></div>
    <div class="steps">${j.steps.map(s => `<span class="step ${s.status}" title="${esc(s.error || s.result || '')}">${s.status === 'running' ? '<span class="spin"></span> ' : s.status === 'done' ? '✓ ' : s.status === 'failed' ? '✕ ' : ''}${esc(s.title)}${s.seconds ? ` · ${dur(s.seconds)}` : ''}</span>`).join('')}</div></div>` : '';
}

function showPush(r) {
  $('#editor').innerHTML = `<h2>Push result</h2>
    <div class="problems ${r.problems.length ? '' : 'ok'}">${r.problems.length
      ? `The app's builder found problems. Nothing usable was built:<ul>${r.problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`
      : `Built with the app's own builder. Bundle version <b>${esc(r.version)}</b>.`}</div>
    <p><b>Pushed:</b> ${r.pushed.map(esc).join(', ') || 'none'}</p>
    <p><b>Skipped:</b> ${r.skipped.map(esc).join('; ') || 'none'}</p>
    <p class="sub">Staging folder: <code>${esc(r.target)}</code> plus <code>bundle.json</code> beside it. Scol's real <code>content/</code> was not changed.</p>`;
}

function chapterEditor(pid, c) {
  if (!c) return;
  const ed = $('#editor');
  const { lessons, id, ...cj } = c;
  const running = JOBS.some(j => j.project === pid && j.status === 'running');
  ed.innerHTML = `<div class="row"><h2 class="grow">Chapter</h2>
      ${P.has_pdf ? `<button class="btn primary" id="c-gen" ${running ? 'disabled title="a conversion is running"' : ''}>${lessons.length ? 'Regenerate lessons' : 'Generate lessons'}</button>` : ''}
      <button class="btn danger small" id="c-del">Delete chapter</button></div>
    <div class="form">
      <label class="f">Title (English)<input id="c-en" value="${esc(cj.title.en)}"></label>
      <label class="f">Title (Malayalam)<input id="c-ml" value="${esc(cj.title.ml || '')}"></label>
      ${P.has_pdf ? `<label class="f">From page<input id="c-a" type="number" value="${(cj.pages || [1])[0]}"></label>
      <label class="f">To page<input id="c-b" type="number" value="${(cj.pages || [1, 1])[1]}"></label>` : ''}
    </div>
    <label class="f">Learning objectives (one per line)<textarea id="c-obj" rows="4">${esc((cj.objectives || []).map(o => o.en).join('\n'))}</textarea></label>
    <label class="f">Source<input id="c-src" value="${esc(cj.source || '')}"></label>
    ${P.has_pdf ? `<label class="f">Note for the AI (optional)<input id="c-note" placeholder="e.g. use more examples from a Kerala market"></label>` : ''}
    <div class="row"><button class="btn primary" id="c-save">Save chapter</button>
      <span class="sub" style="margin:0">${lessons.length} lessons · ${lessons.filter(l => l.status === 'approved').length} approved</span></div>
    <h2 style="margin-top:22px">Pictures and animations</h2><div id="media"></div>`;
  mediaPanel(pid, id, $('#media'));
  $('#c-save').onclick = e => busy(e.target, 'Saving', async () => {
    const title = { en: $('#c-en').value }; if ($('#c-ml').value) title.ml = $('#c-ml').value;
    const body = { ...cj, title, source: $('#c-src').value,
      objectives: $('#c-obj').value.split('\n').map(s => s.trim()).filter(Boolean).map(en => ({ en })) };
    if ($('#c-a')) body.pages = [+$('#c-a').value, +$('#c-b').value];
    await api('PUT', `/projects/${pid}/chapters/${id}`, body); toast('Saved'); render();
  });
  $('#c-del').onclick = async () => {
    if (!confirm(`Delete chapter "${cj.title.en}" with its ${lessons.length} lessons and pictures? This cannot be undone.`)) return;
    await api('DELETE', `/projects/${pid}/chapters/${id}`); location.hash = `#/p/${pid}`;
  };
  if ($('#c-gen')) $('#c-gen').onclick = e => {
    if (lessons.length && !confirm('Regenerating replaces this chapter\'s lessons, including your edits. Continue?')) return;
    busy(e.target, 'Starting', () => startJob(pid, 'generate', [id], $('#c-note').value));
  };
}

async function newLesson() {
  const [, , pid, cid] = location.hash.split('/');
  const name = prompt('File name, like 05-more-practice.md'); if (!name) return;
  try {
    await api('PUT', `/projects/${pid}/chapters/${cid}/lessons/${enc(name)}`, { text: '# New lesson\nconcept: new-idea\n\n## say\nen: \n' });
    location.hash = `#/p/${pid}/${cid}/${name}`;
  } catch (e) { toast(e.message, true); }
}

// ---------- pictures and animations of a chapter ----------
async function mediaPanel(pid, cid, box, onPick) {
  const names = await api('GET', `/projects/${pid}/chapters/${cid}/images`);
  const base = `studio/data/projects/${pid}/chapters/${cid}/images/`;
  box.innerHTML = `<div class="media">${names.map(n => `<figure>
      <button class="thumb" data-pick="${esc(n)}" title="${onPick ? 'Put this picture on the board of the selected block' : esc(n)}"><img src="${imgSrc(base + n)}" alt="${esc(n)}"></button>
      <figcaption>${esc(n)} <button class="x" data-delimg="${esc(n)}" aria-label="Delete ${esc(n)}">×</button></figcaption></figure>`).join('') || '<p class="sub" style="margin:0">No pictures yet.</p>'}</div>
    <div class="row" style="margin-top:10px">
      <label class="btn small">⬆ Upload picture or clip<input type="file" id="m-up" accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime" hidden multiple></label>
      <input id="m-scene" class="grow" style="width:auto" placeholder="Draw with AI: describe the scene, e.g. a girl watering a coconut tree">
      <button class="btn small dark" id="m-draw">🎨 Draw</button></div>
    <p class="sub" style="margin:6px 0 0">Animations: GIF or animated WebP play in the app. MP4/WebM/MOV clips are turned into an 8-second animated WebP.</p>`;
  const again = () => mediaPanel(pid, cid, box, onPick);
  box.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => onPick ? onPick(b.dataset.pick) : null);
  box.querySelectorAll('[data-delimg]').forEach(b => b.onclick = async () => {
    if (!confirm(`Delete ${b.dataset.delimg}? Lessons that use it will fail the check.`)) return;
    await api('DELETE', `/projects/${pid}/chapters/${cid}/images/${enc(b.dataset.delimg)}`).then(again, e => toast(e.message, true));
  });
  $('#m-up').onchange = async e => {
    for (const f of e.target.files) {
      toast(`Uploading ${f.name}…`);
      try { const r = await api('POST', `/projects/${pid}/chapters/${cid}/images?name=${enc(f.name)}`, undefined, await f.arrayBuffer(), f.type || 'application/octet-stream'); toast(`Added ${r.name}`); if (onPick && e.target.files.length === 1) onPick(r.name); }
      catch (err) { toast(`${f.name}: ${err.message}`, true); }
    }
    again();
  };
  $('#m-draw').onclick = e => {
    const scene = $('#m-scene').value.trim(); if (!scene) return toast('Describe the picture first', true);
    busy(e.target, 'Drawing', async () => {
      const name = scene.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30).replace(/-+$/, '') + '.png';
      const r = await api('POST', `/projects/${pid}/chapters/${cid}/images/draw`, { name, scene });
      toast(`Drew ${r.name}`); if (onPick) onPick(r.name); again();
    });
  };
}

// ---------- lesson editor ----------
const KEY = /^([a-z][a-z_]*(?:\.[a-z]+)*(?: [^:]{1,40})?):\s*(.*)$/;
function parseBlocks(text) {
  const out = [{ kind: 'header', fields: [] }];
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('## ')) { out.push({ kind: line.slice(3).trim(), fields: [] }); continue; }
    if (line.startsWith('# ') && out.length === 1) { out[0].fields.unshift(['#', line.slice(2).trim()]); continue; }
    if (!line.trim()) continue;
    const m = line.trim().match(KEY), f = out[out.length - 1].fields;
    if (m) f.push([m[1], m[2]]); else if (f.length) f[f.length - 1][1] += ' ' + line.trim(); else f.push(['?', line.trim()]);
  }
  return out;
}
const serialize = bs => bs.map(b => [b.kind === 'header' ? null : `## ${b.kind}`,
  ...b.fields.map(([k, v]) => k === '#' ? `# ${v}` : `${k}: ${v}`)].filter(x => x !== null).join('\n')).join('\n\n') + '\n';

async function lessonEditor(pid, cid, name, data) {
  L = data || await api('GET', `/projects/${pid}/chapters/${cid}/lessons/${enc(name)}`);
  blocks = parseBlocks(L.text); focusBlock = null;
  const base = `/projects/${pid}/chapters/${cid}/lessons/${enc(name)}`;
  const ed = $('#editor');
  const setPicture = img => {
    let i = focusBlock && blocks[focusBlock] && blocks[focusBlock].kind !== 'header' ? focusBlock : null;
    if (i === null) { blocks.push({ kind: 'say', fields: [['en', ''], ['visual', '']] }); i = blocks.length - 1; }
    const f = blocks[i].fields.find(x => x[0] === 'visual');
    f ? (f[1] = `image ${img}`) : blocks[i].fields.push(['visual', `image ${img}`]);
    mode = 'blocks'; draw(); toast(`Picture set on block ${i}. Save to check.`);
  };
  const draw = () => {
    ed.innerHTML = `<div class="row" style="margin-bottom:12px">
        <h2 class="grow" style="margin:0">${esc(name)} <span class="chip ${L.status === 'approved' ? 'ok' : ''}">${L.status}</span></h2>
        <div class="tabs"><button class="${mode === 'blocks' ? 'on' : ''}" data-mode="blocks">Blocks</button><button class="${mode === 'text' ? 'on' : ''}" data-mode="text">Text</button><button class="${mode === 'media' ? 'on' : ''}" data-mode="media">Pictures</button></div>
        <button class="btn primary" id="l-save">Save &amp; check</button>
        <button class="btn ${L.status === 'approved' ? '' : 'lime'}" id="l-rev">${L.status === 'approved' ? 'Unapprove' : 'Approve'}</button>
        <button class="btn danger small" id="l-del">Delete</button></div>
      <div class="problems ${L.problems.length ? '' : 'ok'}">${L.problems.length
        ? `<b>${L.problems.length} problem(s)</b> from Scol's checker:<ul>${L.problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`
        : '✓ Passes Scol\'s lesson checker and the sum check.'}</div>
      <div class="row" style="margin-bottom:14px"><input id="l-note" class="grow" style="width:auto" placeholder="Ask the AI to change this lesson, e.g. “add a level 2 question about money”">
        <button class="btn dark" id="l-ai">AI improve</button></div>
      <div id="l-body"></div>`;
    const body = $('#l-body');
    if (mode === 'text') {
      body.innerHTML = `<textarea class="raw" id="l-raw">${esc(serialize(blocks))}</textarea>`;
      $('#l-raw').oninput = e => (blocks = parseBlocks(e.target.value));
    } else if (mode === 'media') {
      body.innerHTML = `<p class="sub">Click a picture to put it on the board of the block you last clicked in the Blocks tab${focusBlock ? ` (block ${focusBlock}: ${esc(blocks[focusBlock]?.kind)})` : ' (none yet: a new say block is added)'}.</p><div id="lmedia"></div>`;
      mediaPanel(pid, cid, $('#lmedia'), setPicture);
    } else {
      body.innerHTML = blocks.map((b, i) => `<div class="block ${esc(b.kind)} ${i === focusBlock ? 'focus' : ''}" data-block="${i}">
        <div class="block-top"><b class="grow">${b.kind === 'header' ? 'lesson' : esc(b.kind)}</b>
          ${i ? `<button class="btn small" data-pics="${i}" title="Pick a picture or animation for this block">🖼 Picture</button>
          <button class="btn small" data-play="${i}" title="Play from this block">▶</button>
          <button class="btn small" data-mv="${i}" data-d="-1" aria-label="Move up" ${i < 2 ? 'disabled' : ''}>↑</button>
          <button class="btn small" data-mv="${i}" data-d="1" aria-label="Move down" ${i === blocks.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn small danger" data-rm="${i}">Delete block</button>` : ''}</div>
        ${b.fields.map(([k, v], j) => `<div class="fld"><code>${k === '#' ? 'title' : esc(k)}</code>
          <textarea rows="1" data-b="${i}" data-f="${j}" aria-label="${esc(k)}">${esc(v)}</textarea>
          <button class="x" data-rmf="${i}:${j}" aria-label="Remove ${esc(k)} line">×</button></div>`).join('')}
        ${(() => { const v = (b.fields.find(f => f[0] === 'visual') || [])[1]; return v ? `<div class="mini-board">${renderVisual(visualOf(v, cid))}</div>` : ''; })()}
        <select class="addf" data-add="${i}" style="width:auto;font-size:13px;padding:4px 8px" aria-label="Add a line">
          <option value="">+ add line…</option>${(FIELD_HINTS[b.kind] || []).map(k => `<option>${k}</option>`).join('')}</select>
      </div>`).join('') + `<div class="row">${Object.keys(TEMPLATES).map(k => `<button class="btn small" data-new="${k}">+ ${k}</button>`).join('')}</div>`;
      body.querySelectorAll('textarea[data-b]').forEach(t => {
        const fit = () => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; };
        fit(); t.oninput = () => { blocks[t.dataset.b].fields[t.dataset.f][1] = t.value.replace(/\n/g, ' '); fit(); };
      });
      body.querySelectorAll('[data-block]').forEach(el => el.addEventListener('focusin', () => {
        focusBlock = +el.dataset.block; body.querySelectorAll('.block.focus').forEach(x => x.classList.remove('focus')); el.classList.add('focus');
      }));
      body.querySelectorAll('[data-pics]').forEach(b => b.onclick = () => { focusBlock = +b.dataset.pics; mode = 'media'; draw(); });
      body.querySelectorAll('[data-play]').forEach(b => b.onclick = () => {
        const before = blocks.slice(1, +b.dataset.play).filter(x => x.kind === 'say' || x.kind === 'ask').length;
        if (L.lesson) play(L.lesson, before);
      });
      body.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => {
        const i = +b.dataset.mv, j = i + +b.dataset.d; [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; draw();
      });
      body.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { blocks.splice(+b.dataset.rm, 1); focusBlock = null; draw(); });
      body.querySelectorAll('[data-rmf]').forEach(b => b.onclick = () => {
        const [i, j] = b.dataset.rmf.split(':').map(Number); blocks[i].fields.splice(j, 1); draw();
      });
      body.querySelectorAll('[data-add]').forEach(s => s.onchange = () => {
        if (!s.value) return; const key = s.value === 'mistake 0' ? prompt('Wrong answer this mistake is for', '0') : s.value;
        if (key) blocks[s.dataset.add].fields.push([s.value === 'mistake 0' ? `mistake ${key}` : key, '']); draw();
      });
      body.querySelectorAll('[data-new]').forEach(b => b.onclick = () => {
        blocks.push({ kind: b.dataset.new, fields: TEMPLATES[b.dataset.new].map(f => [...f]) }); draw();
      });
    }
    ed.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; draw(); });
    $('#l-save').onclick = e => busy(e.target, 'Checking', async () => {
      const wasApproved = L.status === 'approved';
      L = await api('PUT', base, { text: serialize(blocks) }); blocks = parseBlocks(L.text); draw(); play(L.lesson);
      toast(L.problems.length ? `Saved with ${L.problems.length} problem(s)` : wasApproved ? 'Saved. Approve it again after checking.' : 'Saved, all checks pass');
      if (wasApproved) refreshSide();
    });
    $('#l-rev').onclick = e => busy(e.target, 'Saving', async () => {
      L = await api('POST', base + '/review', { status: L.status === 'approved' ? 'draft' : 'approved' }); draw(); refreshSide();
    });
    $('#l-del').onclick = async () => {
      if (!confirm(`Delete lesson ${name}? This cannot be undone.`)) return;
      await api('DELETE', base); location.hash = `#/p/${pid}/${cid}`;
    };
    $('#l-ai').onclick = e => {
      const note = $('#l-note').value.trim(); if (!note) return toast('Write what to change first', true);
      busy(e.target, 'Rewriting', async () => { L = await api('POST', base + '/improve', { note }); blocks = parseBlocks(L.text); draw(); play(L.lesson); refreshSide(); });
    };
  };
  draw();
  play(L.lesson);
}
// a 'visual:' line as the app's checker would turn it into JSON (for the small board under each block)
function visualOf(spec, cid) {
  const [kind, ...args] = spec.trim().split(/\s+/);
  if (kind === 'image') return { kind, args: [`studio/data/projects/${P.id}/chapters/${cid}/images/${args[0]}`] };
  if (kind === 'text') return { kind, args: [args.join(' ')] };
  if (kind === 'steps') return { kind, args: args.join(' ').split(' / ') };
  return { kind, args };
}
function refreshSide() { const y = scrollY; render().then(() => scrollTo(0, y)); }

// ---------- phone preview: TutorDirector (app/lib/tutor.dart) and the classroom screen, ported ----------
const STR = { next: ['Next', 'അടുത്തത്'], hint: ['Hint', 'സൂചന'], check: ['Check', 'നോക്കാം'], showAnswer: ['Show answer', 'ഉത്തരം കാണിക്കൂ'],
  gotIt: ['I got it', 'എനിക്ക് കിട്ടി'], notYet: ['Not yet', 'ഇനിയും വേണം'], continue: ['Continue', 'തുടരൂ'], lessonDone: ['Level complete!', 'ലെവൽ പൂർത്തിയായി!'],
  answerIs: ['The answer is', 'ഉത്തരം'], example: ['Example', 'ഉദാഹരണം'], story: ['A little story', 'ഒരു കൊച്ചു കഥ'], picture: ['Look at it this way', 'ഇങ്ങനെ നോക്കൂ'],
  think: ['Think about it, then tap the button.', 'ആലോചിച്ചിട്ട് ബട്ടൺ അമർത്തൂ.'], dragSticks: ['Drag a stick onto a shape', 'ഒരു ഈർക്കിൽ രൂപത്തിലേക്ക് വലിച്ചിടൂ'],
  moveBeads: ['Tap or drag on a rod to move beads', 'മണികൾ നീക്കാൻ കമ്പിയിൽ തൊടുകയോ വലിക്കുകയോ ചെയ്യൂ'], slideScale: ['Drag the scale left or right', 'സ്കെയിൽ ഇടത്തോട്ടോ വലത്തോട്ടോ വലിക്കൂ'] };
let APP = null, TUTOR = null, G = null;
const tr = (k, lang) => STR[k][lang === 'ml' ? 1 : 0];
const pk = (t, lang) => !t ? '' : typeof t === 'string' ? t : (t[lang] || t.en || t.ml || '');
const ph = (k, lang) => pk(APP?.phrases?.[k], lang) || tr(k, lang);

async function setupTutorPicker() {
  APP = APP || await api('GET', '/app-data');
  const sel = $('#tutor-pick'); if (!sel) return;
  let saved = null; try { saved = localStorage.getItem('scol-tutor'); } catch { /* storage off */ }
  TUTOR = APP.tutors.find(t => t.id === saved) || APP.tutors[0];
  sel.innerHTML = APP.tutors.map(t => `<option value="${t.id}" ${t.id === TUTOR.id ? 'selected' : ''}>Tutor: ${esc(t.name.en)}</option>`).join('') +
    `<option value="__lang" disabled>──</option>`;
  sel.onchange = () => { TUTOR = APP.tutors.find(t => t.id === sel.value); try { localStorage.setItem('scol-tutor', TUTOR.id); } catch { /* */ } if (G) play(G.lesson); else idleScreen(); };
}
function idleScreen(msg = 'Open a lesson to see it as a child sees it.') {
  const scr = $('#screen'); if (!scr) return;
  scr.innerHTML = `<div class="cel" style="background:var(--cream)"><div id="cel-av"></div><p style="color:#6B6F80;font-weight:600;text-align:center">${esc(msg)}</p></div>`;
  const go = () => !$('#cel-av') ? null : TUTOR ? $('#cel-av').append(creature(TUTOR, 140)) : setTimeout(go, 100); go();
}

function play(lesson, startAt = 0) {
  if (!$('#screen')) return;
  if (!lesson) { G = null; return idleScreen('Fix the problems to preview this lesson.'); }
  if (!TUTOR) return setTimeout(() => play(lesson, startAt), 100);
  const lang = P.lang === 'ml' ? 'ml' : 'en';
  G = { lesson, lang, bilingual: P.lang === 'both', queue: lesson.steps.map(step => ({ step })), index: Math.min(startAt, lesson.steps.length - 1),
    usedStyles: new Set(), questions: 0, firstTryRight: 0, typed: '', beads: [0, 0, 0], shift: 0 };
  G.total = G.queue.length;
  G.av = creature(TUTOR, 88, { mood: 'calm' });
  enter();
}
function say(parts) { G.bubble = parts.filter(Boolean).join(' '); G.av._c.talking = true; clearTimeout(G.talkT); G.talkT = setTimeout(() => (G.av._c.talking = false), Math.min(4000, 60 * G.bubble.length)); }
function enter() {
  if (G.index >= G.queue.length) { G.phase = 'finished'; G.mood = 'happy'; G.spot = 'center'; return finish(); }
  const item = G.queue[G.index], step = item.step;
  Object.assign(G, { visual: step.visual, wrong: new Set(), hintShown: false, attempts: 0, mood: 'calm', typed: '', beads: [0, 0, 0], shift: 0, item,
    badge: ['example', 'story', 'picture'].includes(step.label) ? tr(step.label, G.lang) : '' });
  const text = pk(step.text, G.lang);
  if (step.t !== 'ask') {
    G.question = null; G.phase = 'talking';
    G.spot = !G.visual ? 'center' : G.index % 2 === 0 ? 'left' : 'right'; G.look = G.visual ? 'board' : 'child';
    say([text]);
  } else {
    G.question = step; G.phase = step.form === 'think' ? 'thinkAsk' : 'asking'; G.spot = 'right'; G.look = 'answers';
    say(item.retry ? [ph('again', G.lang), text] : [text]);
  }
  paint();
}
function next() { if (G.phase === 'talking' || G.phase === 'feedback') { G.index++; enter(); } }
function showHint() {
  if (G.phase !== 'asking' || G.hintShown || !pk(G.question.hint, G.lang)) return;
  G.hintShown = true; G.mood = 'caring'; G.look = 'board'; say([pk(G.question.hint, G.lang)]); paint();
}
function answer(given) {
  const q = G.question; if (!q || G.phase !== 'asking') return;
  const praise = (TUTOR.praise || {})[G.lang] || ['Well done!'];
  if (given.trim().toLowerCase() === q.answer.trim().toLowerCase()) {
    const clean = G.attempts === 0 && !G.hintShown && !G.item.retry;
    G.questions++; if (clean) G.firstTryRight++;
    G.phase = 'feedback'; G.mood = 'happy'; G.look = 'child';
    const ex = pk(q.explain, G.lang);
    say(clean || !ex ? [praise[Math.floor(Math.random() * praise.length)]] : [praise[0], ex]);
  } else {
    G.attempts++; G.wrong.add(given); G.mood = 'caring';
    G.note = (q.mistakes || {})[given] || '';
    const oops = pk(TUTOR.oops, G.lang);
    if (G.attempts === 1) {
      G.hintShown = true; G.look = 'board';
      say([oops, pk(q.hint, G.lang) || ph('lookAgain', G.lang)]);
    } else {
      G.questions++; G.phase = 'feedback'; G.look = 'child';
      const i = (q.options || []).indexOf(q.answer);
      const shown = i >= 0 ? ((G.lang === 'ml' && q.optionsMl) ? q.optionsMl[i] : q.options[i]) : q.answer;
      const body = pk(q.explain, G.lang) || `${tr('answerIs', G.lang)} ${shown}.`;
      const already = G.queue.slice(G.index + 1).some(x => x.retry && x.step === q);
      const left = Object.keys(G.lesson.alts || {}).filter(k => !G.usedStyles.has(k));
      if (!G.item.retry && !already && left.length) {
        const chosen = left[0]; G.usedStyles.add(chosen);
        const alt = G.lesson.alts[chosen];
        G.queue.splice(G.index + 1, 0, { step: { t: 'say', text: alt.text, visual: alt.visual, label: chosen } }, { step: q, retry: true, style: chosen });
        G.total = G.queue.length; say([body, ph('anotherWay', G.lang)]);
      } else if (!G.item.retry && !already) {
        G.queue.push({ step: q, retry: true }); G.total = G.queue.length; say([body, ph('tryLater', G.lang)]);
      } else say([body]);
    }
  }
  paint();
}
function chunky(label, { color = C.violet, cls = '', attrs = '', disabled = false, ink = false } = {}) {
  const c = disabled ? C.cloud : color;
  return `<button class="chunky ${cls}" ${attrs} ${disabled ? 'disabled' : ''} style="--c:${c};--d:${darker(c)};color:${disabled ? '#9A948A' : ink || color === '#fff' ? C.ink : '#fff'}">${label}</button>`;
}
function board() {
  const q = G.question;
  if (q && G.phase === 'asking') {
    if (q.form === 'abacus') return `<div class="softcard">${abacusHtml(G.beads, true)}</div>`;
    if (q.form === 'measure') return `<div class="softcard measure">${rulerHtml(+q.visual.args[0] || 5, q.visual.args[1] || '', { shift: G.shift, width: 290 })}</div>`;
    if (q.form === 'build') return `<div class="softcard"><div class="v" style="gap:22px">${q.options.map(o => `<button class="outline ${G.wrong.has(o) ? 'off' : ''}" data-build="${esc(o)}" aria-label="Build a ${esc(o)}">${shapeSvg(o, '', o === 'triangle' ? 80 : 110, 80, true)}</button>`).join('')}</div>
      <div class="tray">${[0, 1, 2, 3].map(i => `<span class="v-stick big" draggable="true" style="transform:rotate(${(i % 3 - 1) * 0.22}rad)"></span>`).join('')}</div></div>`;
  }
  let v = G.visual;
  if (q && G.phase === 'feedback') {
    if (q.form === 'abacus') { const n = +q.answer; v = { kind: 'place', args: [Math.floor(n / 100), Math.floor(n / 10) % 10, n % 10] }; }
    else if (q.form === 'build') v = { kind: 'shapes', args: [q.answer] };
  }
  return v ? `<div class="softcard">${renderVisual(v)}</div>` : `<span style="font-size:64px">${{ maths: '🔢', english: '🔤', malayalam: '📖', evs: '🌿' }[P.subject] || '📘'}</span>`;
}
function controls() {
  const q = G.question, L2 = G.lang;
  const hint = G.phase === 'asking' && !G.hintShown && pk(q?.hint, L2) ? chunky(`💡 ${tr('hint', L2)}`, { color: '#fff', attrs: 'data-hint', cls: 'mt' }) : '';
  const tip = k => `<p class="tip">${tr(k, L2)}</p>`;
  switch (G.phase) {
    case 'talking': return chunky(`${tr('next', L2)}  ▶️`, { attrs: 'data-next' });
    case 'feedback': return chunky(tr('continue', L2), { color: C.mint, attrs: 'data-next' });
    case 'thinkAsk': return `<p class="tip">${pk(APP.phrases.think, L2) || tr('think', L2)}</p>${chunky(tr('showAnswer', L2), { attrs: 'data-reveal' })}`;
    case 'thinkReveal': return `<div class="row2">${chunky(`🤔 ${tr('notYet', L2)}`, { color: C.sun, ink: true, attrs: 'data-rate="0"' })}${chunky(`👍 ${tr('gotIt', L2)}`, { color: C.mint, attrs: 'data-rate="1"' })}</div>`;
    case 'asking':
      if (q.form === 'build') return tip('dragSticks') + hint;
      if (q.form === 'abacus') return tip('moveBeads') + chunky(`${tr('check', L2)} ✓`, { color: C.mint, attrs: 'data-abacus' }) + hint;
      if (q.form === 'choice') return q.options.map((o, i) => chunky(esc((L2 === 'ml' && q.optionsMl) ? q.optionsMl[i] : o), { color: '#fff', cls: 'opt', disabled: G.wrong.has(o), attrs: `data-ans="${esc(o)}"` })).join('') + hint;
      return (q.form === 'measure' ? tip('slideScale') : '') +
        `<div class="typed ${G.typed ? '' : 'empty'}">${esc(G.typed || '?')}</div>
        <div class="pad">${'1234567890'.split('').map(k => chunky(k, { color: '#fff', cls: 'key', attrs: `data-key="${k}"` })).join('')}</div>
        <div class="row2">${chunky('⌫', { color: '#fff', attrs: 'data-back', disabled: !G.typed })}${chunky(`${tr('check', L2)} ✓`, { color: C.mint, cls: 'wide', attrs: 'data-check', disabled: !G.typed })}</div>` + hint;
  }
  return '';
}
function paint() {
  const scr = $('#screen'); if (!scr || !G) return;
  const L2 = G.lang, other = L2 === 'ml' ? 'en' : 'ml', st = G.item.step;
  const second = G.bilingual && ['talking', 'asking', 'thinkAsk'].includes(G.phase) && typeof st.text === 'object' ? st.text[other] || '' : '';
  const qLine = G.phase === 'asking' && G.question && !G.bubble.endsWith(pk(G.question.text, L2)) ? pk(G.question.text, L2) : '';
  const border = G.mood === 'happy' ? C.mint : G.mood === 'caring' ? C.sun : C.cloud;
  G.av._c.mood = G.mood;
  const toward = { left: 0.55, center: 0, right: -0.55 }[G.spot];
  G.av._c.gaze = G.look === 'board' ? [toward, -0.9] : G.look === 'answers' ? [toward * 0.8, 0.9] : [0, 0];
  if (!scr.querySelector('.cls') || !scr.contains(G.av)) { // the layout stays, so the tutor can walk between spots
    scr.innerHTML = `<div class="cls"><div class="cls-top"></div><div class="cls-board"></div>
      <div class="cls-tutor"><div class="walk"></div></div><div class="cls-bubble"></div><div class="cls-controls"></div></div>`;
    scr.querySelector('.walk').append(G.av);
  }
  scr.querySelector('.cls-top').innerHTML = `<button class="close" data-restart aria-label="Restart lesson">✕</button>
      <div class="prog"><i style="width:${(G.index / G.total) * 100}%"></i></div>
      <button class="langbtn" data-lang title="Language">${G.bilingual ? (L2 === 'en' ? 'EN+മ' : 'മ+EN') : L2 === 'en' ? 'EN' : 'മ'}</button>`;
  const bd = board();
  if (scr.querySelector('.cls-board')._html !== bd) { scr.querySelector('.cls-board').innerHTML = bd; scr.querySelector('.cls-board')._html = bd; }
  const walk = scr.querySelector('.walk');
  walk.style.left = { left: '0%', center: '50%', right: '100%' }[G.spot];
  walk.style.transform = `translateX(-${{ left: 0, center: 50, right: 100 }[G.spot]}%)`;
  const bub = scr.querySelector('.cls-bubble');
  bub.style.borderColor = border;
  bub.innerHTML = `${G.badge ? `<span class="badge">${esc(G.badge)}</span>` : ''}
      ${qLine ? `<p class="qline">${esc(qLine)}</p>` : ''}
      <p class="main">${esc(G.bubble)}</p>
      ${second ? `<p class="second">${esc(second)}</p>` : ''}
      ${G.note && G.mood === 'caring' ? `<p class="devnote">mistake noted: ${esc(G.note)}</p>` : ''}`;
  scr.querySelector('.cls-controls').innerHTML = controls();
  const ins = $('#inspect'); ins.hidden = false;
  ins.textContent = `step ${G.index + 1}/${G.total} · ${G.phase}${G.item.retry ? ' · asked again' : ''}\n${JSON.stringify({ ...st, text: undefined }, null, 1)}`;
  const on = (sel, fn) => scr.querySelectorAll(sel).forEach(b => b.onclick = () => fn(b));
  on('[data-next]', next); on('[data-hint]', showHint); on('[data-restart]', () => play(G.lesson));
  on('[data-lang]', () => { G.lang = G.lang === 'en' ? 'ml' : 'en'; enter(); });
  on('[data-ans]', b => answer(b.dataset.ans));
  on('[data-key]', b => { if (G.typed.length < 4) G.typed += b.dataset.key; paint(); });
  on('[data-back]', () => { G.typed = G.typed.slice(0, -1); paint(); });
  on('[data-check]', () => { const v = G.typed; G.typed = ''; answer(v); });
  on('[data-abacus]', () => answer(String(G.beads[0] * 100 + G.beads[1] * 10 + G.beads[2])));
  on('[data-reveal]', () => { G.phase = 'thinkReveal'; G.look = 'child'; say([G.question.answer]); paint(); });
  on('[data-rate]', b => { G.questions++; if (b.dataset.rate === '1') G.firstTryRight++; G.phase = 'feedback'; G.mood = b.dataset.rate === '1' ? 'happy' : 'calm'; next(); });
  on('[data-build]', b => answer(b.dataset.build));
  // build: drag a stick onto an outline (click works too)
  scr.querySelectorAll('.tray .v-stick').forEach(s => s.ondragstart = e => e.dataTransfer.setData('text', 'stick'));
  scr.querySelectorAll('[data-build]').forEach(o => { o.ondragover = e => e.preventDefault(); o.ondrop = e => { e.preventDefault(); answer(o.dataset.build); }; });
  // abacus: tap or drag on a rod, like AbacusPad
  scr.querySelectorAll('[data-rod]').forEach(rod => {
    const set = (e, tap) => { const r = rod.getBoundingClientRect(); let n = Math.max(0, Math.min(9, Math.round((r.bottom - e.clientY) / 16)));
      const p = +rod.dataset.rod; if (tap && n === G.beads[p]) n--; G.beads[p] = Math.max(0, n); paint(); };
    rod.onpointerdown = e => set(e, true);
  });
  // measure: drag the scale
  const sc = scr.querySelector('[data-scale]');
  if (sc) sc.onpointerdown = e => {
    const x0 = e.clientX, s0 = G.shift; sc.setPointerCapture(e.pointerId);
    sc.onpointermove = m => { G.shift = Math.max(-40, Math.min(80, s0 + m.clientX - x0)); sc.style.transform = `translateX(${G.shift}px)`; };
    sc.onpointerup = () => { sc.onpointermove = null; };
  };
}
function finish() {
  const stars = G.questions === 0 ? 3 : G.firstTryRight / G.questions >= 0.99 ? 3 : G.firstTryRight / G.questions >= 0.6 ? 2 : 1;
  $('#screen').innerHTML = `<div class="cel"><div id="cel-av"></div>
    <h2>${tr('lessonDone', G.lang)}</h2>
    <div class="stars">${[0, 1, 2].map(i => `<span style="animation-delay:${i * 300}ms">${i < stars ? '⭐' : '☆'}</span>`).join('')}</div>
    <span class="pill">⚡ +${10 + 5 * G.firstTryRight} XP</span>
    <div style="width:100%;margin-top:28px">${chunky(tr('continue', G.lang), { color: C.mint, attrs: 'id="again"' })}</div></div>`;
  $('#cel-av').append(creature(TUTOR, 160, { mood: 'happy' }));
  $('#again').onclick = () => play(G.lesson);
}

pollJobs();
render();
