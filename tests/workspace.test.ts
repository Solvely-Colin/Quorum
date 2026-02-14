import { describe, it, expect, afterEach } from 'vitest';
import { startWorkspaceServer, type WorkspaceServer } from '../src/workspace-server.js';

let server: WorkspaceServer | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

describe('workspace server', () => {
  it('starts and serves HTML on GET /', async () => {
    server = await startWorkspaceServer({ port: 0, live: true });
    expect(server.port).toBeGreaterThan(0);

    const res = await fetch(`http://localhost:${server.port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Quorum Workspace');
    expect(html).toContain('<script>');
  });

  it('GET /api/session/:id returns 404 for missing session', async () => {
    server = await startWorkspaceServer({ port: 0, live: true });
    const res = await fetch(`http://localhost:${server.port}/api/session/nonexistent-id`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Session not found');
  });

  it('POST /api/intervene accepts valid intervention', async () => {
    server = await startWorkspaceServer({ port: 0, live: true });

    const res = await fetch(`http://localhost:${server.port}/api/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'challenge', message: 'test challenge' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(server.pendingInterventions).toHaveLength(1);
    expect(server.pendingInterventions[0].type).toBe('challenge');
  });

  it('POST /api/intervene rejects invalid JSON', async () => {
    server = await startWorkspaceServer({ port: 0, live: true });

    const res = await fetch(`http://localhost:${server.port}/api/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });

    expect(res.status).toBe(400);
  });

  it('WebSocket connects and receives messages', async () => {
    server = await startWorkspaceServer({ port: 0, live: true });

    const { WebSocket } = await import('ws');
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
      setTimeout(() => reject(new Error('WS connect timeout')), 3000);
    });

    // Broadcast an event and verify client receives it
    const received = new Promise<string>((resolve) => {
      ws.on('message', (data) => resolve(data.toString()));
    });

    server.broadcast({ type: 'phase', data: { phase: 'GATHER' }, timestamp: Date.now() });

    const msg = JSON.parse(await received);
    expect(msg.type).toBe('phase');
    expect(msg.data.phase).toBe('GATHER');

    ws.close();
  });

  it('broadcast sends to multiple clients', async () => {
    server = await startWorkspaceServer({ port: 0, live: true });
    const { WebSocket } = await import('ws');

    const ws1 = new WebSocket(`ws://localhost:${server.port}/ws`);
    const ws2 = new WebSocket(`ws://localhost:${server.port}/ws`);

    await Promise.all([
      new Promise<void>((r) => ws1.on('open', r)),
      new Promise<void>((r) => ws2.on('open', r)),
    ]);

    const p1 = new Promise<string>((r) => ws1.on('message', (d) => r(d.toString())));
    const p2 = new Promise<string>((r) => ws2.on('message', (d) => r(d.toString())));

    server.broadcast({ type: 'votes', data: { winner: 'claude' }, timestamp: Date.now() });

    const [m1, m2] = await Promise.all([p1, p2]);
    expect(JSON.parse(m1).type).toBe('votes');
    expect(JSON.parse(m2).type).toBe('votes');

    ws1.close();
    ws2.close();
  });
});
