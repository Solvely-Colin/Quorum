/**
 * Workspace Server — serves a real-time deliberation UI.
 * HTTP server with WebSocket for live streaming, REST API for session data & intervention.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Intervention } from './intervention.js';

// ── Types ──

export interface WorkspaceOptions {
  port: number;
  sessionId?: string;
  live?: boolean;
}

export interface WorkspaceEvent {
  type: string;
  data: unknown;
  timestamp: number;
}

// ── Session loading ──

const SESSIONS_DIR = join(homedir(), '.quorum', 'sessions');

function resolveSessionId(shortId: string): string | null {
  if (existsSync(join(SESSIONS_DIR, shortId))) return shortId;
  // Try prefix match
  try {
    const dirs = readdirSync(SESSIONS_DIR) as unknown as string[];
    const match = dirs.find((d: string) => d.startsWith(shortId));
    return match ?? null;
  } catch {
    return null;
  }
}

async function loadSessionData(sessionId: string) {
  const resolved = resolveSessionId(sessionId);
  if (!resolved) return null;
  const sessionDir = join(SESSIONS_DIR, resolved);
  if (!existsSync(sessionDir)) return null;

  const meta = await safeReadJSON(join(sessionDir, 'meta.json'));
  if (!meta) return null;

  const phases: Record<string, unknown> = {};
  const phaseFiles = [
    { file: '01-gather', name: 'GATHER' },
    { file: '02-plan', name: 'PLAN' },
    { file: '03-formulate', name: 'FORMULATE' },
    { file: '04-debate', name: 'DEBATE' },
    { file: '05-adjust', name: 'ADJUST' },
    { file: '06-rebuttal', name: 'REBUTTAL' },
    { file: '07-vote', name: 'VOTE' },
  ];

  for (const pf of phaseFiles) {
    const data = await safeReadJSON(join(sessionDir, `${pf.file}.json`));
    if (data) phases[pf.name] = data;
  }

  const synthesis = await safeReadJSON(join(sessionDir, 'synthesis.json'));

  // Load interventions
  const interventions: Intervention[] = [];
  try {
    const files = await readdir(sessionDir);
    for (const f of files.sort()) {
      if (f.startsWith('intervention-') && f.endsWith('.json')) {
        const iv = await safeReadJSON(join(sessionDir, f));
        if (iv) interventions.push(iv as Intervention);
      }
    }
  } catch {
    /* ignore */
  }

  return { meta, phases, synthesis, interventions, sessionId };
}

async function safeReadJSON(path: string): Promise<unknown | null> {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(await readFile(path, 'utf-8'));
  } catch {
    return null;
  }
}

// ── HTML UI ──

function getHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Quorum Workspace</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0f1117;
    --surface: #1a1d27;
    --surface2: #252836;
    --border: #2e3245;
    --text: #e4e6f0;
    --text-dim: #8b8fa3;
    --ultramarine: #4f5bd5;
    --amber: #d5a04f;
    --rose: #d54f5b;
    --emerald: #4fd5a0;
    --accent: #6c72cb;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Inter', -apple-system, sans-serif;
    background: var(--bg);
    color: var(--text);
    height: 100vh;
    overflow: hidden;
  }

  .layout {
    display: grid;
    grid-template-columns: 220px 1fr 280px;
    grid-template-rows: 1fr 56px;
    height: 100vh;
  }

  /* Sidebar */
  .sidebar {
    background: var(--surface);
    border-right: 1px solid var(--border);
    padding: 20px 16px;
    overflow-y: auto;
  }

  .sidebar h2 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: var(--text-dim);
    margin-bottom: 16px;
  }

  .phase-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 6px;
    margin-bottom: 4px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  .phase-item:hover { background: var(--surface2); }
  .phase-item.active { background: var(--surface2); color: var(--accent); }

  .phase-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .phase-dot.pending { background: var(--border); }
  .phase-dot.active { background: var(--amber); animation: pulse 1.5s infinite; }
  .phase-dot.complete { background: var(--emerald); }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .session-info {
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
    font-size: 12px;
    color: var(--text-dim);
    line-height: 1.6;
  }

  /* Main area */
  .main {
    padding: 20px 24px;
    overflow-y: auto;
  }

  .main h1 {
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 4px;
  }

  .main .subtitle {
    font-size: 13px;
    color: var(--text-dim);
    margin-bottom: 20px;
  }

  .cards {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }

  .card-provider {
    font-size: 13px;
    font-weight: 600;
  }

  .card-model {
    font-size: 11px;
    color: var(--text-dim);
  }

  .card-body {
    font-size: 13px;
    line-height: 1.7;
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .card-body .cursor {
    display: inline-block;
    width: 2px;
    height: 14px;
    background: var(--accent);
    animation: blink 0.8s infinite;
    vertical-align: text-bottom;
    margin-left: 1px;
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }

  /* Right panel */
  .right-panel {
    background: var(--surface);
    border-left: 1px solid var(--border);
    padding: 20px 16px;
    overflow-y: auto;
  }

  .right-panel h3 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: var(--text-dim);
    margin-bottom: 14px;
  }

  .heatmap {
    display: grid;
    gap: 3px;
    margin-bottom: 24px;
  }

  .heatmap-cell {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    font-weight: 600;
    color: rgba(255,255,255,0.8);
  }

  .vote-bar {
    margin-bottom: 10px;
  }

  .vote-bar-label {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    margin-bottom: 4px;
  }

  .vote-bar-track {
    height: 6px;
    background: var(--surface2);
    border-radius: 3px;
    overflow: hidden;
  }

  .vote-bar-fill {
    height: 100%;
    border-radius: 3px;
    transition: width 0.6s ease;
  }

  .synthesis-box {
    background: var(--surface2);
    border-radius: 6px;
    padding: 14px;
    margin-top: 16px;
    font-size: 12px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 300px;
    overflow-y: auto;
  }

  /* Bottom bar */
  .bottom-bar {
    grid-column: 1 / -1;
    background: var(--surface);
    border-top: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 20px;
  }

  .bottom-bar button {
    padding: 6px 14px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--surface2);
    color: var(--text);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .bottom-bar button:hover {
    background: var(--border);
  }

  .bottom-bar button.challenge { border-color: var(--rose); color: var(--rose); }
  .bottom-bar button.challenge:hover { background: rgba(213,79,91,0.15); }

  .bottom-bar button.pause-btn { border-color: var(--amber); color: var(--amber); }
  .bottom-bar button.pause-btn.paused { background: rgba(213,160,79,0.2); }

  .bottom-bar input {
    flex: 1;
    max-width: 400px;
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--surface2);
    color: var(--text);
    font-size: 12px;
    outline: none;
  }

  .bottom-bar input:focus {
    border-color: var(--accent);
  }

  .bottom-bar .status {
    margin-left: auto;
    font-size: 11px;
    color: var(--text-dim);
  }

  .status-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    margin-right: 5px;
  }

  .status-dot.connected { background: var(--emerald); }
  .status-dot.disconnected { background: var(--rose); }

  .empty-state {
    text-align: center;
    padding: 60px 20px;
    color: var(--text-dim);
  }

  .empty-state h2 { font-size: 16px; margin-bottom: 8px; color: var(--text); }
  .empty-state p { font-size: 13px; }

  /* Responsive */
  @media (max-width: 900px) {
    .layout {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr auto 56px;
    }
    .sidebar {
      display: flex;
      gap: 8px;
      padding: 12px;
      overflow-x: auto;
      border-right: none;
      border-bottom: 1px solid var(--border);
    }
    .sidebar h2 { display: none; }
    .phase-item { white-space: nowrap; margin-bottom: 0; }
    .session-info { display: none; }
    .right-panel { border-left: none; border-top: 1px solid var(--border); }
  }
</style>
</head>
<body>
<div class="layout">
  <div class="sidebar">
    <h2>Phases</h2>
    <div id="phase-list"></div>
    <div class="session-info" id="session-info"></div>
  </div>

  <div class="main" id="main">
    <div class="empty-state" id="empty-state">
      <h2>🏛️ Quorum Workspace</h2>
      <p>Waiting for deliberation data...</p>
    </div>
    <div id="phase-content" style="display:none">
      <h1 id="phase-title"></h1>
      <div class="subtitle" id="phase-subtitle"></div>
      <div class="cards" id="cards"></div>
    </div>
  </div>

  <div class="right-panel" id="right-panel">
    <h3>Consensus</h3>
    <div id="heatmap-container"></div>
    <h3>Vote Results</h3>
    <div id="vote-results"></div>
    <div id="synthesis-container"></div>
  </div>

  <div class="bottom-bar">
    <button class="challenge" onclick="doChallenge()">⚡ Challenge</button>
    <input type="text" id="redirect-input" placeholder="Redirect message..." onkeydown="if(event.key==='Enter')doRedirect()">
    <button onclick="doRedirect()">↩ Redirect</button>
    <button class="pause-btn" id="pause-btn" onclick="togglePause()">⏸ Pause</button>
    <span class="status" id="status"><span class="status-dot disconnected"></span>Disconnected</span>
  </div>
</div>

<script>
const PHASES = ['GATHER','PLAN','FORMULATE','DEBATE','ADJUST','REBUTTAL','VOTE','SYNTHESIZE'];
const COLORS = ['#4f5bd5','#d5a04f','#d54f5b','#4fd5a0','#6c72cb','#cb6c9f','#72cb6c','#cb9f6c'];

let state = {
  phases: {},
  synthesis: null,
  meta: null,
  activePhase: null,
  selectedPhase: null,
  votes: null,
  paused: false,
  streamBuffers: {},
};

let ws = null;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(proto + '://' + location.host + '/ws');

  ws.onopen = () => {
    document.getElementById('status').innerHTML = '<span class="status-dot connected"></span>Connected';
  };

  ws.onclose = () => {
    document.getElementById('status').innerHTML = '<span class="status-dot disconnected"></span>Disconnected';
    setTimeout(connect, 2000);
  };

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      handleEvent(msg);
    } catch {}
  };
}

function handleEvent(msg) {
  switch (msg.type) {
    case 'session':
      loadSession(msg.data);
      break;
    case 'phase':
      state.activePhase = msg.data.phase;
      if (!state.phases[msg.data.phase]) {
        state.phases[msg.data.phase] = { status: 'active', responses: {} };
      } else {
        state.phases[msg.data.phase].status = 'active';
      }
      state.selectedPhase = msg.data.phase;
      render();
      break;
    case 'phase:done':
      if (state.phases[msg.data.phase]) {
        state.phases[msg.data.phase].status = 'complete';
        state.phases[msg.data.phase].duration = msg.data.duration;
      }
      render();
      break;
    case 'response':
      if (state.phases[msg.data.phase]) {
        state.phases[msg.data.phase].responses[msg.data.provider] = msg.data.content;
      }
      if (state.selectedPhase === msg.data.phase) renderCards();
      break;
    case 'stream:start':
      state.streamBuffers[msg.data.provider + ':' + msg.data.phase] = '';
      break;
    case 'stream:delta':
      const key = msg.data.provider + ':' + msg.data.phase;
      state.streamBuffers[key] = (state.streamBuffers[key] || '') + msg.data.delta;
      if (state.phases[msg.data.phase]) {
        state.phases[msg.data.phase].responses[msg.data.provider] = state.streamBuffers[key];
      }
      if (state.selectedPhase === msg.data.phase) renderCards();
      break;
    case 'stream:end':
      delete state.streamBuffers[msg.data.provider + ':' + msg.data.phase];
      break;
    case 'votes':
      state.votes = msg.data;
      renderVotes();
      break;
    case 'synthesis':
      state.synthesis = msg.data;
      renderSynthesis();
      break;
    case 'consensus':
      renderHeatmap(msg.data);
      break;
    case 'complete':
      state.activePhase = null;
      render();
      break;
  }
}

function loadSession(data) {
  if (data.meta) state.meta = data.meta;
  if (data.phases) {
    for (const [name, phaseData] of Object.entries(data.phases)) {
      state.phases[name] = {
        status: 'complete',
        responses: phaseData.responses || phaseData.entries || {},
        duration: phaseData.duration,
      };
    }
  }
  if (data.synthesis) {
    state.synthesis = data.synthesis;
    if (data.synthesis.votes) state.votes = data.synthesis.votes;
  }
  // Auto-select last phase
  const loaded = PHASES.filter(p => state.phases[p]);
  if (loaded.length > 0) state.selectedPhase = loaded[loaded.length - 1];
  render();
  if (state.votes) renderVotes();
  if (state.synthesis) renderSynthesis();
}

function render() {
  renderPhaseList();
  renderCards();
  renderSessionInfo();

  const empty = document.getElementById('empty-state');
  const content = document.getElementById('phase-content');
  const hasData = Object.keys(state.phases).length > 0;
  empty.style.display = hasData ? 'none' : 'block';
  content.style.display = hasData ? 'block' : 'none';
}

function renderPhaseList() {
  const el = document.getElementById('phase-list');
  el.innerHTML = PHASES.map(p => {
    const pd = state.phases[p];
    let status = 'pending';
    if (pd) status = pd.status || 'complete';
    const active = p === state.selectedPhase ? ' active' : '';
    return '<div class="phase-item' + active + '" onclick="selectPhase(\\''+p+'\\')"><span class="phase-dot ' + status + '"></span>' + p + '</div>';
  }).join('');
}

function selectPhase(name) {
  state.selectedPhase = name;
  render();
}

function renderCards() {
  const phase = state.selectedPhase;
  if (!phase) return;

  document.getElementById('phase-title').textContent = phase;
  const pd = state.phases[phase];
  const dur = pd?.duration ? (pd.duration / 1000).toFixed(1) + 's' : '';
  document.getElementById('phase-subtitle').textContent = pd ? (pd.status === 'active' ? 'In progress...' : dur) : '';

  const container = document.getElementById('cards');
  if (!pd || !pd.responses) { container.innerHTML = ''; return; }

  const providers = Object.keys(pd.responses);
  container.innerHTML = providers.map((prov, i) => {
    const text = escapeHtml(pd.responses[prov] || '');
    const streaming = state.streamBuffers[prov + ':' + phase] !== undefined;
    const cursor = streaming ? '<span class="cursor"></span>' : '';
    const color = COLORS[i % COLORS.length];
    return '<div class="card"><div class="card-header"><span class="card-provider" style="color:'+color+'">'+escapeHtml(prov)+'</span></div><div class="card-body">'+text+cursor+'</div></div>';
  }).join('');
}

function renderSessionInfo() {
  const el = document.getElementById('session-info');
  if (!state.meta) { el.innerHTML = ''; return; }
  const q = (state.meta.input || state.meta.question || '').slice(0, 120);
  const provs = (state.meta.providers || []).map(p => p.name).join(', ');
  el.innerHTML = '<strong>Question:</strong> ' + escapeHtml(q) + '<br><strong>Providers:</strong> ' + escapeHtml(provs) + '<br><strong>Profile:</strong> ' + escapeHtml(state.meta.profile || 'default');
}

function renderVotes() {
  const el = document.getElementById('vote-results');
  if (!state.votes || !state.votes.rankings) { el.innerHTML = '<div style="font-size:12px;color:var(--text-dim)">No vote data yet</div>'; return; }

  const rankings = state.votes.rankings;
  const maxScore = rankings[0]?.score || 1;
  el.innerHTML = rankings.map((r, i) => {
    const pct = (r.score / maxScore * 100).toFixed(0);
    const color = COLORS[i % COLORS.length];
    const crown = r.provider === state.votes.winner ? ' 👑' : '';
    return '<div class="vote-bar"><div class="vote-bar-label"><span>'+escapeHtml(r.provider)+crown+'</span><span>'+r.score+'</span></div><div class="vote-bar-track"><div class="vote-bar-fill" style="width:'+pct+'%;background:'+color+'"></div></div></div>';
  }).join('');
}

function renderSynthesis() {
  const el = document.getElementById('synthesis-container');
  if (!state.synthesis) { el.innerHTML = ''; return; }
  const content = state.synthesis.content || '';
  el.innerHTML = '<h3 style="margin-top:20px">Synthesis</h3><div class="synthesis-box">'+escapeHtml(content)+'</div>';
}

function renderHeatmap(data) {
  const el = document.getElementById('heatmap-container');
  if (!data || !data.providers || !data.matrix) { return; }
  const n = data.providers.length;
  el.innerHTML = '<div class="heatmap" style="grid-template-columns:repeat('+n+',1fr)">' +
    data.matrix.map((row, ri) => row.map((val, ci) => {
      const colors = ['#d54f5b','#d5a04f','#4fd5a0'];
      const bg = val >= 0.66 ? colors[2] : val >= 0.33 ? colors[1] : colors[0];
      const label = ri === ci ? data.providers[ri].slice(0,3) : val.toFixed(1);
      return '<div class="heatmap-cell" style="background:'+bg+'">'+label+'</div>';
    }).join('')).join('') +
    '</div>';
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Interventions
function doChallenge() {
  fetch('/api/intervene', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ type: 'challenge', message: 'Human operator challenges the current deliberation direction.' })
  });
}

function doRedirect() {
  const input = document.getElementById('redirect-input');
  const msg = input.value.trim();
  if (!msg) return;
  fetch('/api/intervene', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ type: 'redirect', message: msg })
  });
  input.value = '';
}

function togglePause() {
  state.paused = !state.paused;
  const btn = document.getElementById('pause-btn');
  btn.classList.toggle('paused', state.paused);
  btn.textContent = state.paused ? '▶ Resume' : '⏸ Pause';
  fetch('/api/intervene', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ type: 'pause', message: state.paused ? 'pause' : 'resume' })
  });
}

// Load session from URL path if present
async function loadInitialSession() {
  const match = location.pathname.match(/\\/session\\/(.+)/);
  if (match) {
    const res = await fetch('/api/session/' + match[1]);
    if (res.ok) {
      const data = await res.json();
      loadSession(data);
    }
  }
}

loadInitialSession();
connect();
</script>
</body>
</html>`;
}

// ── Server ──

export interface WorkspaceServer {
  close: () => Promise<void>;
  broadcast: (event: WorkspaceEvent) => void;
  port: number;
  /** Queue an intervention from external source (e.g. council integration) */
  pendingInterventions: Array<{ type: string; message: string }>;
}

export function startWorkspaceServer(options: WorkspaceOptions): Promise<WorkspaceServer> {
  return new Promise((resolve, reject) => {
    const clients = new Set<WebSocket>();
    const pendingInterventions: Array<{ type: string; message: string }> = [];

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

      // REST: GET /api/session/:id
      if (req.method === 'GET' && url.pathname.startsWith('/api/session/')) {
        const id = url.pathname.slice('/api/session/'.length);
        const data = await loadSessionData(id);
        if (!data) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
        return;
      }

      // REST: POST /api/intervene
      if (req.method === 'POST' && url.pathname === '/api/intervene') {
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            const intervention = JSON.parse(body) as { type: string; message: string };
            pendingInterventions.push(intervention);
            // Broadcast to all WS clients
            broadcast({
              type: 'intervention',
              data: intervention,
              timestamp: Date.now(),
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
        return;
      }

      // Serve HTML for any other GET
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getHTML());
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    // WebSocket
    const wss = new WebSocketServer({ server, path: '/ws' });

    wss.on('connection', (ws) => {
      clients.add(ws);
      ws.on('close', () => clients.delete(ws));

      // If we have a session loaded, send it immediately
      if (options.sessionId) {
        loadSessionData(options.sessionId).then((data) => {
          if (data && ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'session', data, timestamp: Date.now() }));
          }
        });
      }
    });

    function broadcast(event: WorkspaceEvent) {
      const msg = JSON.stringify(event);
      for (const client of clients) {
        if (client.readyState === client.OPEN) {
          client.send(msg);
        }
      }
    }

    server.on('error', reject);

    server.listen(options.port, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : options.port;

      resolve({
        port: actualPort,
        broadcast,
        pendingInterventions,
        close: () =>
          new Promise<void>((resolveClose) => {
            wss.close();
            server.close(() => resolveClose());
          }),
      });
    });
  });
}
