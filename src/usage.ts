import type { PhaseOutput } from './session.js';
import type {
  ProviderGenerateResult,
  ProviderResponse,
  ProviderResponseMetadata,
  ProviderUsage,
} from './types.js';

export interface PhaseRunResult {
  responses: Record<string, string>;
  responseMetadata?: Record<string, ProviderResponseMetadata>;
}

export interface SessionUsageRecord {
  phase: string;
  name: string;
  provider?: string;
  model?: string;
  usage?: ProviderUsage;
}

export interface SessionUsageSummaryRow {
  name: string;
  provider?: string;
  model?: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
  calls: number;
  phases: string[];
}

export interface SessionUsageSummary {
  providers: SessionUsageSummaryRow[];
  totals: Omit<SessionUsageSummaryRow, 'name' | 'provider' | 'model' | 'phases'>;
}

export function normalizeProviderResponse(
  result: ProviderGenerateResult,
  defaults?: Omit<ProviderResponse, 'content'>,
): ProviderResponse {
  if (typeof result === 'string') {
    return {
      content: result,
      provider: defaults?.provider,
      model: defaults?.model,
      usage: defaults?.usage,
    };
  }
  return {
    content: result.content,
    provider: result.provider ?? defaults?.provider,
    model: result.model ?? defaults?.model,
    usage: result.usage ?? defaults?.usage,
  };
}

export function buildProviderMetadata(
  response: ProviderResponse,
): ProviderResponseMetadata | undefined {
  if (!response.provider && !response.model && !response.usage) return undefined;
  return {
    provider: response.provider,
    model: response.model,
    usage: response.usage,
  };
}

export function collectUsageRecordsFromPhase(phase: PhaseOutput): SessionUsageRecord[] {
  const metadata = phase.responseMetadata ?? {};
  return Object.entries(metadata).map(([name, entry]) => ({
    phase: phase.phase,
    name,
    provider: entry.provider,
    model: entry.model,
    usage: entry.usage,
  }));
}

export function summarizeUsageRecords(records: SessionUsageRecord[]): SessionUsageSummary {
  const rows = new Map<string, SessionUsageSummaryRow>();

  for (const record of records) {
    if (!record.usage) continue;

    const key = `${record.name}::${record.provider ?? ''}::${record.model ?? ''}`;
    const existing = rows.get(key) ?? {
      name: record.name,
      provider: record.provider,
      model: record.model,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      totalCost: 0,
      calls: 0,
      phases: [],
    };

    existing.input += record.usage.input;
    existing.output += record.usage.output;
    existing.cacheRead += record.usage.cacheRead;
    existing.cacheWrite += record.usage.cacheWrite;
    existing.totalTokens += record.usage.totalTokens;
    existing.totalCost += record.usage.cost.total;
    existing.calls += 1;
    if (!existing.phases.includes(record.phase)) existing.phases.push(record.phase);

    rows.set(key, existing);
  }

  const providers = [...rows.values()].sort((a, b) => {
    if (b.totalCost !== a.totalCost) return b.totalCost - a.totalCost;
    if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens;
    return a.name.localeCompare(b.name);
  });

  return {
    providers,
    totals: providers.reduce(
      (acc, row) => {
        acc.input += row.input;
        acc.output += row.output;
        acc.cacheRead += row.cacheRead;
        acc.cacheWrite += row.cacheWrite;
        acc.totalTokens += row.totalTokens;
        acc.totalCost += row.totalCost;
        acc.calls += row.calls;
        return acc;
      },
      {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        totalCost: 0,
        calls: 0,
      },
    ),
  };
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(6)}`;
}
