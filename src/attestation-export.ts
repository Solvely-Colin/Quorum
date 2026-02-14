/**
 * Attestation Export — export attestation chains as PDF, HTML, or JSON certificates.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AttestationChain } from './attestation.js';
import type { Intervention } from './intervention.js';
import type { UncertaintyMetrics } from './uncertainty.js';

export interface ExportData {
  chain: AttestationChain;
  meta: {
    input: string;
    profile: string;
    providers: Array<{ name: string; model?: string }>;
    startedAt: number;
  };
  votes?: {
    winner: string;
    rankings: Array<{ provider: string; score: number }>;
    controversial: boolean;
  };
  interventions: Intervention[];
  uncertainty: UncertaintyMetrics | null;
}

/**
 * Load all export data from a session directory.
 */
export async function loadExportData(
  sessionPath: string,
  chain: AttestationChain,
): Promise<ExportData> {
  const meta = JSON.parse(await readFile(join(sessionPath, 'meta.json'), 'utf-8'));

  let votes: ExportData['votes'] | undefined;
  const synthPath = join(sessionPath, 'synthesis.json');
  if (existsSync(synthPath)) {
    const synth = JSON.parse(await readFile(synthPath, 'utf-8'));
    if (synth.votes) votes = synth.votes;
  }

  // Load interventions
  const interventions: Intervention[] = [];
  try {
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(sessionPath);
    for (const f of files.sort()) {
      if (f.startsWith('intervention-') && f.endsWith('.json')) {
        interventions.push(JSON.parse(await readFile(join(sessionPath, f), 'utf-8')));
      }
    }
  } catch {
    /* ok */
  }

  // Load uncertainty
  let uncertainty: UncertaintyMetrics | null = null;
  const uncPath = join(sessionPath, 'uncertainty.json');
  if (existsSync(uncPath)) {
    uncertainty = JSON.parse(await readFile(uncPath, 'utf-8'));
  }

  return { chain, meta, votes, interventions, uncertainty };
}

/**
 * Export as HTML certificate.
 */
export function exportAttestationHTML(data: ExportData): string {
  const date = new Date(data.meta.startedAt).toISOString();
  const providers = data.meta.providers.map((p) => p.name).join(', ');

  let html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Quorum Attestation Certificate</title>
<style>
body { font-family: Georgia, serif; max-width: 800px; margin: 40px auto; padding: 20px; color: #333; }
h1 { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; }
h2 { color: #555; margin-top: 30px; }
.meta { background: #f5f5f5; padding: 15px; border-radius: 4px; margin: 20px 0; }
.record { border-left: 3px solid #4CAF50; padding: 10px 15px; margin: 10px 0; }
.hash { font-family: monospace; font-size: 0.85em; color: #666; word-break: break-all; }
.intervention { border-left: 3px solid #FF9800; padding: 10px 15px; margin: 10px 0; }
.uncertainty { border-left: 3px solid #2196F3; padding: 10px 15px; margin: 10px 0; }
table { width: 100%; border-collapse: collapse; margin: 10px 0; }
th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
th { background: #f5f5f5; }
</style></head><body>
<h1>🔏 Quorum Attestation Certificate</h1>
<div class="meta">
<strong>Session:</strong> ${data.chain.sessionId}<br>
<strong>Date:</strong> ${date}<br>
<strong>Question:</strong> ${escapeHtml(data.meta.input.slice(0, 500))}<br>
<strong>Profile:</strong> ${data.meta.profile}<br>
<strong>Providers:</strong> ${providers}
</div>

<h2>Attestation Chain (${data.chain.records.length} records)</h2>
`;

  for (const rec of data.chain.records) {
    html += `<div class="record">
<strong>${rec.phase}</strong> — ${rec.providerId}<br>
<span class="hash">Hash: ${rec.hash}</span><br>
<span class="hash">Inputs: ${rec.inputsHash}</span><br>
<span class="hash">Outputs: ${rec.outputsHash}</span><br>
<small>${new Date(rec.timestamp).toISOString()}</small>
</div>\n`;
  }

  if (data.votes) {
    html += `<h2>Vote Results</h2>
<table><tr><th>Provider</th><th>Score</th><th></th></tr>`;
    for (const r of data.votes.rankings) {
      const crown = r.provider === data.votes.winner ? ' 👑' : '';
      html += `<tr><td>${r.provider}${crown}</td><td>${r.score}</td><td>${crown ? 'Winner' : ''}</td></tr>`;
    }
    html += `</table>`;
    if (data.votes.controversial) {
      html += `<p>⚠️ <strong>Controversial vote</strong> — positions were closely matched.</p>`;
    }
  }

  if (data.interventions.length > 0) {
    html += `<h2>Interventions (${data.interventions.length})</h2>`;
    for (const i of data.interventions) {
      html += `<div class="intervention">
<strong>${i.type}</strong> at ${i.phase}<br>
${escapeHtml(i.content)}<br>
<span class="hash">Hash: ${i.hash}</span>
</div>\n`;
    }
  }

  if (data.uncertainty) {
    const u = data.uncertainty;
    html += `<h2>Uncertainty Metrics</h2>
<div class="uncertainty">
<strong>Overall: ${u.overallUncertainty.toUpperCase()}</strong><br>
Disagreement: ${(u.disagreementScore * 100).toFixed(0)}%<br>
Position Drift: ${(u.positionDrift * 100).toFixed(0)}%<br>
Evidence Conflicts: ${u.evidenceConflictCount}<br>
Novel Question: ${u.noveltyFlag ? 'Yes' : 'No'}<br>
${u.summary}
</div>`;
  }

  html += `\n<hr><p style="text-align:center;color:#999;font-size:0.85em">Generated by Quorum v0.7.0</p>\n</body></html>`;
  return html;
}

/**
 * Export as PDF certificate using pdf-lib.
 */
export async function exportAttestationPDF(data: ExportData): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await doc.embedFont(StandardFonts.Courier);

  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 50;
  const maxWidth = pageWidth - 2 * margin;

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  function addPage() {
    page = doc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  }

  function checkSpace(needed: number) {
    if (y - needed < margin) addPage();
  }

  function drawText(
    text: string,
    opts: { font?: typeof font; size?: number; color?: ReturnType<typeof rgb> } = {},
  ) {
    const f = opts.font ?? font;
    const size = opts.size ?? 10;
    const color = opts.color ?? rgb(0, 0, 0);

    // Word-wrap
    const words = text.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      const width = f.widthOfTextAtSize(test, size);
      if (width > maxWidth && line) {
        checkSpace(size + 4);
        page.drawText(line, { x: margin, y, size, font: f, color });
        y -= size + 4;
        line = word;
      } else {
        line = test;
      }
    }
    if (line) {
      checkSpace(size + 4);
      page.drawText(line, { x: margin, y, size, font: f, color });
      y -= size + 4;
    }
  }

  // Title
  drawText('Quorum Attestation Certificate', { font: fontBold, size: 18 });
  y -= 10;

  // Metadata
  drawText(`Session: ${data.chain.sessionId}`, { size: 9, color: rgb(0.4, 0.4, 0.4) });
  drawText(`Date: ${new Date(data.meta.startedAt).toISOString()}`, {
    size: 9,
    color: rgb(0.4, 0.4, 0.4),
  });
  drawText(`Profile: ${data.meta.profile}`, { size: 9, color: rgb(0.4, 0.4, 0.4) });
  drawText(`Providers: ${data.meta.providers.map((p) => p.name).join(', ')}`, {
    size: 9,
    color: rgb(0.4, 0.4, 0.4),
  });
  y -= 5;

  // Question
  drawText('Question:', { font: fontBold, size: 11 });
  drawText(data.meta.input.slice(0, 500), { size: 10 });
  y -= 10;

  // Attestation records
  drawText(`Attestation Chain (${data.chain.records.length} records)`, {
    font: fontBold,
    size: 12,
  });
  y -= 5;

  for (const rec of data.chain.records) {
    checkSpace(60);
    drawText(`${rec.phase} — ${rec.providerId}`, { font: fontBold, size: 10 });
    drawText(`Hash: ${rec.hash}`, { font: fontMono, size: 7, color: rgb(0.4, 0.4, 0.4) });
    drawText(`Inputs: ${rec.inputsHash}  Outputs: ${rec.outputsHash}`, {
      font: fontMono,
      size: 7,
      color: rgb(0.4, 0.4, 0.4),
    });
    y -= 5;
  }

  // Votes
  if (data.votes) {
    y -= 5;
    drawText('Vote Results', { font: fontBold, size: 12 });
    y -= 3;
    for (const r of data.votes.rankings) {
      const crown = r.provider === data.votes.winner ? ' (Winner)' : '';
      drawText(`  ${r.provider}: ${r.score} pts${crown}`, { size: 10 });
    }
    if (data.votes.controversial) {
      drawText('  Warning: Controversial vote — positions closely matched', {
        size: 9,
        color: rgb(0.8, 0.4, 0),
      });
    }
  }

  // Interventions
  if (data.interventions.length > 0) {
    y -= 5;
    drawText(`Interventions (${data.interventions.length})`, { font: fontBold, size: 12 });
    y -= 3;
    for (const i of data.interventions) {
      checkSpace(30);
      drawText(`${i.type} at ${i.phase}: ${i.content}`, { size: 9 });
      drawText(`Hash: ${i.hash}`, { font: fontMono, size: 7, color: rgb(0.4, 0.4, 0.4) });
    }
  }

  // Uncertainty
  if (data.uncertainty) {
    y -= 5;
    drawText('Uncertainty Metrics', { font: fontBold, size: 12 });
    y -= 3;
    drawText(`Overall: ${data.uncertainty.overallUncertainty.toUpperCase()}`, { size: 10 });
    drawText(
      `Disagreement: ${(data.uncertainty.disagreementScore * 100).toFixed(0)}% | Drift: ${(data.uncertainty.positionDrift * 100).toFixed(0)}% | Conflicts: ${data.uncertainty.evidenceConflictCount}`,
      { size: 9 },
    );
    drawText(data.uncertainty.summary, { size: 9, color: rgb(0.4, 0.4, 0.4) });
  }

  // Footer
  y -= 20;
  drawText('Generated by Quorum v0.7.0', { size: 8, color: rgb(0.6, 0.6, 0.6) });

  return doc.save();
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
