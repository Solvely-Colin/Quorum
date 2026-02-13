import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';

// ── Types ──────────────────────────────────────────────────────────────────

export interface AttackVector {
  category: string;
  prompt: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface AttackPack {
  name: string;
  description: string;
  vectors: AttackVector[];
}

export interface RedTeamAttack {
  category: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  targetProvider?: string;
  addressed: boolean;
  addressedBy?: string[];
}

export interface RedTeamResult {
  attacks: RedTeamAttack[];
  resilienceScore: number;
  unresolvedRisks: string[];
  mitigatedRisks: string[];
  blindSpots: string[];
  rawResponse: string;
  attackPacks: string[];
}

// ── Attack Pack Loading ────────────────────────────────────────────────────

const PACK_SEARCH_PATHS = [
  join(process.cwd(), 'agents', 'attacks'),
  join(homedir(), '.quorum', 'agents', 'attacks'),
  join(dirname(new URL(import.meta.url).pathname), '..', '..', 'agents', 'attacks'),
];

async function findPackFile(name: string): Promise<string | null> {
  const filename = name.endsWith('.yaml') ? name : `${name}.yaml`;
  for (const dir of PACK_SEARCH_PATHS) {
    const filepath = join(dir, filename);
    try {
      await readFile(filepath);
      return filepath;
    } catch {
      // not found, try next
    }
  }
  return null;
}

export async function loadAttackPack(name: string): Promise<AttackPack> {
  const filepath = await findPackFile(name);
  if (!filepath) {
    throw new Error(`Attack pack "${name}" not found in any search path`);
  }
  const raw = await readFile(filepath, 'utf-8');
  const parsed = parseYaml(raw) as AttackPack;
  if (!parsed.name || !parsed.vectors) {
    throw new Error(`Invalid attack pack format in "${filepath}"`);
  }
  return parsed;
}

export async function listAttackPacks(): Promise<string[]> {
  const seen = new Set<string>();
  for (const dir of PACK_SEARCH_PATHS) {
    try {
      const files = await readdir(dir);
      for (const f of files) {
        if (f.endsWith('.yaml')) {
          seen.add(f.replace(/\.yaml$/, ''));
        }
      }
    } catch {
      // directory doesn't exist
    }
  }
  return [...seen].sort();
}

// ── Red Team Prompt Building ───────────────────────────────────────────────

export function buildRedTeamPrompt(packs: AttackPack[], customAttacks?: string[]): string {
  const vectorLines: string[] = [];
  for (const pack of packs) {
    vectorLines.push(`\n[${pack.name}] ${pack.description}`);
    for (const v of pack.vectors) {
      vectorLines.push(`- [${v.severity.toUpperCase()}] ${v.category}: ${v.prompt}`);
    }
  }

  const customSection =
    customAttacks && customAttacks.length > 0
      ? `\nAdditional attack vectors:\n${customAttacks.map((a) => `- ${a}`).join('\n')}`
      : '';

  return `You are a RED TEAM agent. Your ONLY job is to find flaws, risks, blind spots, and vulnerabilities.

Rules:
- Do NOT be constructive. Do NOT suggest fixes.
- Find every weakness, no matter how small.
- Be specific: cite which provider's position has which flaw.
- Categorize each finding by severity: CRITICAL, HIGH, MEDIUM, LOW.
- Format each attack as: [SEVERITY] Category: Description (targeting: provider_name)

Attack vectors to explore:
${vectorLines.join('\n')}
${customSection}

Examine ALL positions. Miss nothing.`;
}

// ── Response Parsing ───────────────────────────────────────────────────────

type Severity = 'low' | 'medium' | 'high' | 'critical';

// Pattern 1: [SEVERITY] Category: Description (original)
const SEVERITY_PATTERN = /\[?(CRITICAL|HIGH|MEDIUM|LOW)\]?[\s:*]*([^:\n]+?):\s*(.+)/i;

// Pattern 2: **SEVERITY** Category: Description (bold)
const BOLD_SEVERITY_PATTERN = /\*\*(CRITICAL|HIGH|MEDIUM|LOW)\*\*[\s:]*([^:\n]+?):\s*(.+)/i;

// Pattern 3: ### SEVERITY: Category — Description (markdown header)
const HEADER_SEVERITY_PATTERN =
  /#{1,6}\s*(CRITICAL|HIGH|MEDIUM|LOW)[\s:]*[-—:]\s*([^\n—-]+?)[\s—-]+(.+)/i;

// Pattern 4: - **SEVERITY** — Category: Description (list item with bold, em dash)
const LIST_BOLD_DASH_PATTERN =
  /[-*]\s*\*?\*?(CRITICAL|HIGH|MEDIUM|LOW)\*?\*?\s*[—\-–|]+\s*([^:\n]+?):\s*(.+)/i;

// Pattern 5: ** [SEVERITY] ** Category: Description (bold brackets)
const BOLD_BRACKET_PATTERN =
  /\*?\*?\[?(CRITICAL|HIGH|MEDIUM|LOW)\]?\*?\*?\s*[-—:]\s*([^:\n]+?):\s*(.+)/i;

// Pattern 6: 🔴 SEVERITY | Category: Description (emoji prefixed)
const EMOJI_SEVERITY_PATTERN =
  /(?:🔴|🟠|🟡|🟢|⚠️|❗|‼️)?\s*(CRITICAL|HIGH|MEDIUM|LOW)\s*[|—\-–:]\s*([^:\n]+?):\s*(.+)/i;

// Pattern 7: Category (SEVERITY): Description (severity in parentheses)
const PAREN_SEVERITY_PATTERN = /([^:\n]+?)\s*\(?\*?\*?(CRITICAL|HIGH|MEDIUM|LOW)\*?\*?\)?:\s*(.+)/i;

function parseSeverity(raw: string): Severity {
  switch (raw.toUpperCase()) {
    case 'CRITICAL':
      return 'critical';
    case 'HIGH':
      return 'high';
    case 'MEDIUM':
      return 'medium';
    default:
      return 'low';
  }
}

function detectProvider(text: string, providers: string[]): string | undefined {
  const lower = text.toLowerCase();
  // Check for explicit "(targeting: provider)" pattern first
  const targetMatch = lower.match(/\(targeting:\s*(\w+)\)/);
  if (targetMatch) {
    const matched = providers.find((p) => p.toLowerCase() === targetMatch[1].toLowerCase());
    if (matched) return matched;
  }
  // Fall back to mention detection
  for (const p of providers) {
    if (lower.includes(p.toLowerCase())) return p;
  }
  return undefined;
}

function stripMarkdown(line: string): string {
  // Remove bold/italic markdown
  return line.replace(/\*\*+/g, '').replace(/__+/g, '').replace(/##+/g, '').trim();
}

export function parseRedTeamResponse(
  response: string,
  providerPositions: Record<string, string>,
): RedTeamAttack[] {
  const providers = Object.keys(providerPositions);
  const attacks: RedTeamAttack[] = [];
  const seen = new Set<string>(); // For deduplication
  const lines = response.split('\n');

  for (const line of lines) {
    // Skip empty/whitespace-only lines
    const trimmed = line.replace(/^\s*[-*]?\s*\d+[.)]?\s*/, '').trim();
    if (!trimmed) continue;

    // Strip markdown for cleaner matching
    const cleanLine = stripMarkdown(trimmed);

    let match: RegExpExecArray | null = null;
    let severityRaw: string | undefined;
    let category: string | undefined;
    let description: string | undefined;

    // Try all patterns in order of specificity
    const patterns = [
      HEADER_SEVERITY_PATTERN,
      LIST_BOLD_DASH_PATTERN,
      BOLD_BRACKET_PATTERN,
      EMOJI_SEVERITY_PATTERN,
      BOLD_SEVERITY_PATTERN,
      SEVERITY_PATTERN,
      PAREN_SEVERITY_PATTERN,
    ];

    for (const pattern of patterns) {
      match = pattern.exec(cleanLine) ?? pattern.exec(trimmed);
      if (match) {
        // PAREN_SEVERITY_PATTERN has category first, then severity
        if (pattern === PAREN_SEVERITY_PATTERN) {
          [, category, severityRaw, description] = match;
        } else {
          [, severityRaw, category, description] = match;
        }
        break;
      }
    }

    // If no pattern matched but line contains severity, use whole line as description
    if (!match) {
      const severityAnywhere = /(CRITICAL|HIGH|MEDIUM|LOW)/i.exec(cleanLine);
      if (severityAnywhere) {
        severityRaw = severityAnywhere[1];
        category = 'general';
        description = cleanLine;
      } else {
        continue;
      }
    }

    if (!severityRaw || !category || !description) continue;

    const catTrimmed = category.trim();
    const descTrimmed = description.trim();
    const fullText = `${catTrimmed} ${descTrimmed}`;

    // Deduplicate by category + description
    const dedupeKey = `${catTrimmed.toLowerCase()}|${descTrimmed.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    attacks.push({
      category: catTrimmed,
      description: descTrimmed,
      severity: parseSeverity(severityRaw),
      targetProvider: detectProvider(fullText, providers),
      addressed: false,
    });
  }

  return attacks;
}

// ── Resilience Scoring ─────────────────────────────────────────────────────

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

function mentionsSubstantively(position: string, attack: RedTeamAttack): boolean {
  const posLower = position.toLowerCase();
  const keywords = extractKeywords(`${attack.category} ${attack.description}`);
  // Require at least 2 keyword matches or 40% of keywords for substantive mention
  const threshold = Math.max(2, Math.ceil(keywords.length * 0.4));
  const matches = keywords.filter((kw) => posLower.includes(kw)).length;
  return matches >= threshold;
}

export function scoreResilience(
  attacks: RedTeamAttack[],
  positions: Record<string, string>,
): RedTeamResult {
  const providers = Object.keys(positions);
  const scoredAttacks: RedTeamAttack[] = [];
  const unresolvedRisks: string[] = [];
  const mitigatedRisks: string[] = [];
  const blindSpots: string[] = [];

  for (const attack of attacks) {
    const addressedBy: string[] = [];
    for (const provider of providers) {
      if (mentionsSubstantively(positions[provider], attack)) {
        addressedBy.push(provider);
      }
    }
    const addressed = addressedBy.length > 0;
    const scored: RedTeamAttack = { ...attack, addressed, addressedBy };
    scoredAttacks.push(scored);

    const label = `[${attack.severity.toUpperCase()}] ${attack.category}: ${attack.description}`;
    if (addressed) {
      mitigatedRisks.push(label);
    } else {
      unresolvedRisks.push(label);
      if (attack.severity === 'critical' || attack.severity === 'high') {
        blindSpots.push(`${attack.category}: ${attack.description}`);
      }
    }
  }

  const resilienceScore =
    scoredAttacks.length > 0
      ? scoredAttacks.filter((a) => a.addressed).length / scoredAttacks.length
      : 1;

  return {
    attacks: scoredAttacks,
    resilienceScore,
    unresolvedRisks,
    mitigatedRisks,
    blindSpots,
    rawResponse: '',
    attackPacks: [],
  };
}

// ── Report Formatting ──────────────────────────────────────────────────────

function severityEmoji(severity: Severity): string {
  switch (severity) {
    case 'critical':
    case 'high':
      return '🔴';
    case 'medium':
      return '🟡';
    case 'low':
      return '🟢';
  }
}

export function formatRedTeamReport(result: RedTeamResult): string {
  const pct = Math.round(result.resilienceScore * 100);
  const total = result.attacks.length;
  const unresolved = result.attacks.filter((a) => !a.addressed).length;

  const lines: string[] = [
    '🔴 RED TEAM REPORT',
    `Resilience: ${pct}% | Attacks: ${total} | Unresolved: ${unresolved}`,
    '',
  ];

  // Unresolved risks
  const unresolvedAttacks = result.attacks.filter((a) => !a.addressed);
  if (unresolvedAttacks.length > 0) {
    lines.push('Unresolved Risks:');
    for (const a of unresolvedAttacks) {
      const emoji = severityEmoji(a.severity);
      const by = a.addressedBy?.length
        ? ` — partially addressed by ${a.addressedBy.join(', ')}`
        : ' — nobody addressed';
      lines.push(`  ${emoji} [${a.severity.toUpperCase()}] ${a.category}: ${a.description}${by}`);
    }
    lines.push('');
  }

  // Mitigated
  const mitigatedAttacks = result.attacks.filter((a) => a.addressed);
  if (mitigatedAttacks.length > 0) {
    lines.push('Mitigated (already covered):');
    for (const a of mitigatedAttacks) {
      const by = a.addressedBy?.join(', ') ?? 'unknown';
      lines.push(`  ✅ ${a.category}: ${a.description} — addressed by ${by}`);
    }
    lines.push('');
  }

  // Blind spots
  if (result.blindSpots.length > 0) {
    lines.push('Blind Spots (not even considered):');
    for (const bs of result.blindSpots) {
      lines.push(`  ⚫ ${bs}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
