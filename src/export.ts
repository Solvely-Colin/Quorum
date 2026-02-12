import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

interface MetaJson {
  input: string;
  profile: string;
  providers: Array<{ name: string; provider: string; model: string }>;
  startedAt: number;
}

interface PhaseJson {
  phase: string;
  timestamp: number;
  duration: number;
  responses: Record<string, string>;
}

interface SynthesisJson {
  content: string;
  synthesizer: string;
  consensusScore: number;
  confidenceScore: number;
  controversial: boolean;
  minorityReport?: string;
  contributions: unknown;
  whatWouldChange?: string;
}

const PHASE_FILES = [
  { file: '01-gather.json', label: 'Gather' },
  { file: '02-plan.json', label: 'Plan' },
  { file: '03-formulate.json', label: 'Formulate' },
  { file: '04-debate.json', label: 'Debate' },
  { file: '05-adjust.json', label: 'Adjust' },
  { file: '06-rebuttal.json', label: 'Rebuttal' },
];

function readJSON<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

export function exportMarkdown(sessionPath: string): string {
  const meta = readJSON<MetaJson>(join(sessionPath, 'meta.json'));
  const lines: string[] = [];

  // Title & metadata
  if (meta) {
    lines.push(`# Deliberation Report`);
    lines.push('');
    lines.push(`**Question:** ${meta.input}`);
    lines.push('');
    lines.push(`**Profile:** ${meta.profile}`);
    lines.push('');
    lines.push(`**Date:** ${new Date(meta.startedAt).toLocaleString()}`);
    lines.push('');
    lines.push(`**Providers:** ${meta.providers.map(p => `${p.name} (${p.model})`).join(', ')}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Phase sections
  for (const { file, label } of PHASE_FILES) {
    const phase = readJSON<PhaseJson>(join(sessionPath, file));
    if (!phase) continue;
    const secs = (phase.duration / 1000).toFixed(1);
    lines.push(`## ${label} (${secs}s)`);
    lines.push('');
    const responses = phase.responses ?? {};
    for (const [provider, content] of Object.entries(responses)) {
      lines.push(`### ${provider}`);
      lines.push('');
      lines.push(String(content));
      lines.push('');
    }
  }

  // Vote
  const vote = readJSON<PhaseJson>(join(sessionPath, '07-vote.json'));
  if (vote) {
    const secs = (vote.duration / 1000).toFixed(1);
    lines.push(`## Vote (${secs}s)`);
    lines.push('');
    const responses = vote.responses ?? {};
    lines.push('| Provider | Vote |');
    lines.push('|----------|------|');
    for (const [provider, content] of Object.entries(responses)) {
      const oneLine = String(content).replace(/\n/g, ' ').slice(0, 200);
      lines.push(`| ${provider} | ${oneLine} |`);
    }
    lines.push('');
  }

  // Synthesis
  const synth = readJSON<SynthesisJson>(join(sessionPath, 'synthesis.json'));
  if (synth) {
    lines.push(`## Synthesis`);
    lines.push('');
    lines.push(`**Synthesizer:** ${synth.synthesizer}`);
    lines.push('');
    lines.push(`**Consensus Score:** ${synth.consensusScore}`);
    lines.push('');
    lines.push(`**Confidence Score:** ${synth.confidenceScore}`);
    lines.push('');
    if (synth.controversial) {
      lines.push(`> ⚠️ **Controversial** — positions were nearly tied`);
      lines.push('');
    }
    lines.push(synth.content);
    lines.push('');

    if (synth.minorityReport && synth.minorityReport.trim() && synth.minorityReport !== 'None') {
      lines.push(`### Minority Report`);
      lines.push('');
      lines.push(synth.minorityReport);
      lines.push('');
    }

    if (synth.whatWouldChange && synth.whatWouldChange.trim()) {
      lines.push(`### What Would Change My Mind`);
      lines.push('');
      lines.push(synth.whatWouldChange);
      lines.push('');
    }
  }

  return lines.join('\n');
}

export function exportHtml(sessionPath: string): string {
  const meta = readJSON<MetaJson>(join(sessionPath, 'meta.json'));
  const title = meta ? `Deliberation: ${meta.input.slice(0, 80)}` : 'Deliberation Report';

  // Build TOC entries and body sections
  const toc: Array<{ id: string; label: string }> = [];
  const sections: string[] = [];

  // Meta section
  if (meta) {
    toc.push({ id: 'meta', label: 'Overview' });
    sections.push(`
    <section id="meta">
      <h2>Overview</h2>
      <dl>
        <dt>Question</dt><dd>${esc(meta.input)}</dd>
        <dt>Profile</dt><dd>${esc(meta.profile)}</dd>
        <dt>Date</dt><dd>${esc(new Date(meta.startedAt).toLocaleString())}</dd>
        <dt>Providers</dt><dd>${meta.providers.map(p => `${esc(p.name)} <span class="dim">(${esc(p.model)})</span>`).join(', ')}</dd>
      </dl>
    </section>`);
  }

  // Phase sections
  for (const { file, label } of PHASE_FILES) {
    const phase = readJSON<PhaseJson>(join(sessionPath, file));
    if (!phase) continue;
    const id = label.toLowerCase();
    const secs = (phase.duration / 1000).toFixed(1);
    toc.push({ id, label });
    const responses = phase.responses ?? {};
    const providerHtml = Object.entries(responses).map(([provider, content]) =>
      `<h4>${esc(provider)}</h4>\n<div class="response">${esc(String(content))}</div>`
    ).join('\n');
    sections.push(`
    <section id="${id}">
      <details>
        <summary><h2 style="display:inline">${esc(label)}</h2> <span class="dim">(${secs}s)</span></summary>
        ${providerHtml}
      </details>
    </section>`);
  }

  // Vote
  const vote = readJSON<PhaseJson>(join(sessionPath, '07-vote.json'));
  if (vote) {
    const secs = (vote.duration / 1000).toFixed(1);
    toc.push({ id: 'vote', label: 'Vote' });
    const responses = vote.responses ?? {};
    const rows = Object.entries(responses).map(([provider, content]) =>
      `<tr><td>${esc(provider)}</td><td>${esc(String(content).slice(0, 300))}</td></tr>`
    ).join('\n');
    sections.push(`
    <section id="vote">
      <details>
        <summary><h2 style="display:inline">Vote</h2> <span class="dim">(${secs}s)</span></summary>
        <table>
          <thead><tr><th>Provider</th><th>Vote</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </details>
    </section>`);
  }

  // Synthesis
  const synth = readJSON<SynthesisJson>(join(sessionPath, 'synthesis.json'));
  if (synth) {
    toc.push({ id: 'synthesis', label: 'Synthesis' });
    let extra = '';
    if (synth.minorityReport && synth.minorityReport.trim() && synth.minorityReport !== 'None') {
      extra += `<h3>Minority Report</h3>\n<div class="response">${esc(synth.minorityReport)}</div>`;
    }
    if (synth.whatWouldChange && synth.whatWouldChange.trim()) {
      extra += `<h3>What Would Change My Mind</h3>\n<div class="response">${esc(synth.whatWouldChange)}</div>`;
    }
    sections.push(`
    <section id="synthesis">
      <h2>Synthesis</h2>
      <dl>
        <dt>Synthesizer</dt><dd>${esc(synth.synthesizer)}</dd>
        <dt>Consensus Score</dt><dd>${synth.consensusScore}</dd>
        <dt>Confidence Score</dt><dd>${synth.confidenceScore}</dd>
        ${synth.controversial ? '<dt>Status</dt><dd>⚠️ Controversial — positions nearly tied</dd>' : ''}
      </dl>
      <div class="response">${esc(synth.content)}</div>
      ${extra}
    </section>`);
  }

  const tocHtml = toc.map(t => `<li><a href="#${t.id}">${esc(t.label)}</a></li>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { --bg: #fff; --fg: #1a1a1a; --dim: #666; --accent: #2563eb; --border: #e5e7eb; --code-bg: #f5f5f5; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #1a1a2e; --fg: #e5e5e5; --dim: #999; --accent: #60a5fa; --border: #333; --code-bg: #2a2a3e; }
  }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 2rem 1rem; background: var(--bg); color: var(--fg); line-height: 1.6; }
  h1 { border-bottom: 2px solid var(--accent); padding-bottom: 0.5rem; }
  h2 { color: var(--accent); margin-top: 2rem; }
  h3, h4 { margin-top: 1.5rem; }
  a { color: var(--accent); }
  .dim { color: var(--dim); font-size: 0.9em; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 1rem; }
  dt { font-weight: 600; }
  dd { margin: 0; }
  .response { white-space: pre-wrap; background: var(--code-bg); padding: 1rem; border-radius: 6px; margin: 0.5rem 0 1rem; overflow-x: auto; font-size: 0.95em; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid var(--border); padding: 0.5rem 0.75rem; text-align: left; }
  th { background: var(--code-bg); font-weight: 600; }
  details { margin: 0.5rem 0; }
  summary { cursor: pointer; padding: 0.25rem 0; }
  summary:hover { opacity: 0.8; }
  nav { background: var(--code-bg); padding: 1rem 1.5rem; border-radius: 6px; margin-bottom: 2rem; }
  nav h2 { margin: 0 0 0.5rem; font-size: 1rem; }
  nav ul { margin: 0; padding-left: 1.5rem; }
  nav li { margin: 0.2rem 0; }
</style>
</head>
<body>
  <h1>${esc(title)}</h1>
  <nav>
    <h2>Table of Contents</h2>
    <ul>${tocHtml}</ul>
  </nav>
  ${sections.join('\n')}
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
