/**
 * @experimental
 */
// Cognitive Topology DSL — Core Topology Engine
// Feature #35: Defines how providers communicate across deliberation phases.

// ── Types ──────────────────────────────────────────────────────────────────────

export type TopologyName =
  | 'mesh'
  | 'star'
  | 'tournament'
  | 'map_reduce'
  | 'adversarial_tree'
  | 'pipeline'
  | 'panel';

export interface TopologyConfig {
  hub?: string;
  moderator?: string;
  bracketSeed?: 'random' | 'ranked';
  subQuestions?: number;
}

export interface PhaseContext {
  input: string;
  providerName: string;
  allProviders: string[];
  previousResponses: Record<string, string>;
  visibleResponses: Record<string, string>;
  phaseIndex: number;
  metadata?: Record<string, unknown>;
}

export interface TopologyPhase {
  name: string;
  participants: string[];
  visibility: Record<string, string[]>;
  systemPrompt: (ctx: PhaseContext) => string;
  userPrompt: (ctx: PhaseContext) => string;
  parallel: boolean;
}

export interface TopologyPlan {
  topology: TopologyName;
  phases: TopologyPhase[];
  synthesizer: string | 'auto';
  votingEnabled: boolean;
  description: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

export function listTopologies(): Array<{
  name: TopologyName;
  description: string;
  bestFor: string;
}> {
  return [
    { name: 'mesh', description: 'All-vs-all debate (default)', bestFor: 'general deliberation' },
    {
      name: 'star',
      description: 'Hub-and-spoke, fast synthesis',
      bestFor: 'quick polls, cost-sensitive',
    },
    {
      name: 'tournament',
      description: 'Bracket elimination',
      bestFor: 'competitive comparison, "which is best?"',
    },
    {
      name: 'map_reduce',
      description: 'Split into sub-questions, merge',
      bestFor: 'complex multi-part questions',
    },
    {
      name: 'adversarial_tree',
      description: 'Attack/defend binary tree',
      bestFor: 'stress-testing claims',
    },
    {
      name: 'pipeline',
      description: 'Sequential refinement chain',
      bestFor: 'iterative improvement',
    },
    {
      name: 'panel',
      description: 'Moderated discussion',
      bestFor: 'structured exploration, interviews',
    },
  ];
}

export function validateTopologyConfig(
  topology: TopologyName,
  providers: string[],
  config?: TopologyConfig,
): string | null {
  if (providers.length === 0) return 'At least one provider is required';

  switch (topology) {
    case 'tournament':
      if (providers.length < 3)
        return 'Tournament requires at least 3 providers (2 to debate, 1 to judge)';
      break;
    case 'adversarial_tree':
      if (providers.length < 2) return 'Adversarial tree requires at least 2 providers';
      break;
    case 'pipeline':
      if (providers.length < 2) return 'Pipeline requires at least 2 providers';
      break;
    case 'map_reduce':
      if (config?.subQuestions !== undefined && config.subQuestions > providers.length) {
        return `map_reduce subQuestions (${config.subQuestions}) should not exceed provider count (${providers.length})`;
      }
      break;
    case 'star':
      if (config?.hub && !providers.includes(config.hub)) {
        return `Hub provider "${config.hub}" is not in the provider list`;
      }
      break;
    case 'panel':
      if (config?.moderator && !providers.includes(config.moderator)) {
        return `Moderator "${config.moderator}" is not in the provider list`;
      }
      break;
  }
  return null;
}

// ── Plan Builder ───────────────────────────────────────────────────────────────

export function buildTopologyPlan(
  topology: TopologyName,
  providers: string[],
  input: string,
  config?: TopologyConfig,
  memoryContext?: string,
): TopologyPlan {
  const error = validateTopologyConfig(topology, providers, config);
  if (error) throw new Error(error);

  switch (topology) {
    case 'mesh':
      return buildMesh(providers, input, memoryContext);
    case 'star':
      return buildStar(providers, input, config, memoryContext);
    case 'tournament':
      return buildTournament(providers, input, config, memoryContext);
    case 'map_reduce':
      return buildMapReduce(providers, input, config, memoryContext);
    case 'adversarial_tree':
      return buildAdversarialTree(providers, input, memoryContext);
    case 'pipeline':
      return buildPipeline(providers, input, memoryContext);
    case 'panel':
      return buildPanel(providers, input, config, memoryContext);
  }
}

// ── Topology Builders ──────────────────────────────────────────────────────────

function noVisibility(participants: string[]): Record<string, string[]> {
  const v: Record<string, string[]> = {};
  for (const p of participants) v[p] = [];
  return v;
}

function fullVisibility(participants: string[], allProviders: string[]): Record<string, string[]> {
  const v: Record<string, string[]> = {};
  for (const p of participants) v[p] = allProviders.filter((o) => o !== p);
  return v;
}

// ── mesh ────────────────────────────────────────────────────────────────────────

function buildMesh(providers: string[], _input: string, memoryContext?: string): TopologyPlan {
  const baseSystemPrompt = memoryContext
    ? `You are an expert analyst. Provide your independent assessment.\n\n${memoryContext}`
    : 'You are an expert analyst. Provide your independent assessment.';

  return {
    topology: 'mesh',
    phases: [
      {
        name: 'Gather',
        participants: [...providers],
        visibility: noVisibility(providers),
        systemPrompt: () => baseSystemPrompt,
        userPrompt: (ctx) => ctx.input,
        parallel: true,
      },
      {
        name: 'Debate',
        participants: [...providers],
        visibility: fullVisibility(providers, providers),
        systemPrompt: (ctx) => {
          const others = Object.entries(ctx.visibleResponses)
            .map(([name, resp]) => `**${name}:** ${resp}`)
            .join('\n\n');
          return `You are debating other experts. Consider their perspectives and refine your position.\n\nOther responses:\n${others}`;
        },
        userPrompt: (ctx) =>
          `Given the other perspectives, provide your refined response to: ${ctx.input}`,
        parallel: true,
      },
      {
        name: 'Vote',
        participants: [...providers],
        visibility: fullVisibility(providers, providers),
        systemPrompt: (ctx) => {
          const others = Object.entries(ctx.visibleResponses)
            .map(([name, resp]) => `**${name}:** ${resp}`)
            .join('\n\n');
          return `Review all responses and vote for the best one (not your own). Explain your reasoning briefly.\n\n${others}`;
        },
        userPrompt: (ctx) =>
          `Which response best answers: ${ctx.input}\nRespond with the provider name and a brief justification.`,
        parallel: true,
      },
    ],
    synthesizer: 'auto',
    votingEnabled: true,
    description: 'All-vs-all debate: gather → debate → vote → synthesize',
  };
}

// ── star ────────────────────────────────────────────────────────────────────────

function buildStar(
  providers: string[],
  _input: string,
  config?: TopologyConfig,
  memoryContext?: string,
): TopologyPlan {
  const hub = config?.hub ?? providers[0];
  const spokes = providers.filter((p) => p !== hub);
  const baseSystemPrompt = memoryContext
    ? `You are an expert analyst. Provide your independent assessment.\n\n${memoryContext}`
    : 'You are an expert analyst. Provide your independent assessment.';

  return {
    topology: 'star',
    phases: [
      {
        name: 'Gather',
        participants: spokes.length > 0 ? spokes : [hub],
        visibility: noVisibility(spokes.length > 0 ? spokes : [hub]),
        systemPrompt: () => baseSystemPrompt,
        userPrompt: (ctx) => ctx.input,
        parallel: true,
      },
      {
        name: 'Hub Analysis',
        participants: [hub],
        visibility: { [hub]: spokes },
        systemPrompt: (ctx) => {
          const responses = Object.entries(ctx.visibleResponses)
            .map(([name, resp]) => `**${name}:** ${resp}`)
            .join('\n\n');
          return `You are the hub analyst. Synthesize the following expert responses into a comprehensive answer.\n\n${responses}`;
        },
        userPrompt: (ctx) => `Synthesize all perspectives to answer: ${ctx.input}`,
        parallel: false,
      },
    ],
    synthesizer: hub,
    votingEnabled: false,
    description: `Hub-and-spoke: spokes respond independently, ${hub} synthesizes`,
  };
}

// ── tournament ──────────────────────────────────────────────────────────────────

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildTournament(
  providers: string[],
  _input: string,
  config?: TopologyConfig,
  memoryContext?: string,
): TopologyPlan {
  const seed = config?.bracketSeed ?? 'random';
  const seeded = seed === 'random' ? shuffleArray(providers) : [...providers];
  const baseSystemPrompt = memoryContext
    ? `You are competing in a debate tournament. Present your strongest position.\n\n${memoryContext}`
    : 'You are competing in a debate tournament. Present your strongest position.';

  // Build pairs: ranked pairs 1st vs last, etc.
  const pairs: [string, string][] = [];
  const byes: string[] = [];
  const working = [...seeded];

  if (seed === 'ranked') {
    while (working.length > 1) {
      const a = working.shift()!;
      const b = working.pop()!;
      pairs.push([a, b]);
    }
    if (working.length === 1) byes.push(working[0]);
  } else {
    for (let i = 0; i < working.length - 1; i += 2) {
      pairs.push([working[i], working[i + 1]]);
    }
    if (working.length % 2 === 1) byes.push(working[working.length - 1]);
  }

  const phases: TopologyPhase[] = [];
  const allJudges = providers.filter(
    (p) => !pairs.some(([a, b]) => a === p || b === p) || byes.includes(p),
  );

  // Round 1: each pair debates
  for (const [a, b] of pairs) {
    // Position phase
    phases.push({
      name: `Round 1: ${a} vs ${b} — Position`,
      participants: [a, b],
      visibility: noVisibility([a, b]),
      systemPrompt: () => baseSystemPrompt,
      userPrompt: (ctx) => ctx.input,
      parallel: true,
    });

    // Critique phase
    phases.push({
      name: `Round 1: ${a} vs ${b} — Critique`,
      participants: [a, b],
      visibility: { [a]: [b], [b]: [a] },
      systemPrompt: (ctx) => {
        const opponentResponse = Object.entries(ctx.visibleResponses)
          .map(([name, resp]) => `**${name}:** ${resp}`)
          .join('\n\n');
        return `Your opponent has responded. Critique their position and strengthen yours.\n\n${opponentResponse}`;
      },
      userPrompt: (ctx) =>
        `Critique your opponent's response and defend your position on: ${ctx.input}`,
      parallel: true,
    });

    // Judging phase
    const judges = allJudges.length > 0 ? allJudges : providers.filter((p) => p !== a && p !== b);
    if (judges.length > 0) {
      const judgeVisibility: Record<string, string[]> = {};
      for (const j of judges) judgeVisibility[j] = [a, b];

      phases.push({
        name: `Round 1: ${a} vs ${b} — Judging`,
        participants: judges,
        visibility: judgeVisibility,
        systemPrompt: (ctx) => {
          const responses = Object.entries(ctx.visibleResponses)
            .map(([name, resp]) => `**${name}:** ${resp}`)
            .join('\n\n');
          return `You are a judge. Review both debaters and declare a winner.\n\n${responses}`;
        },
        userPrompt: () =>
          'Which debater presented a stronger argument? Respond with the provider name and brief justification.',
        parallel: true,
      });
    }
  }

  return {
    topology: 'tournament',
    phases,
    synthesizer: 'auto',
    votingEnabled: true,
    description: `Bracket elimination tournament with ${pairs.length} match(es)${byes.length > 0 ? ` (${byes.join(', ')} gets a bye)` : ''}`,
  };
}

// ── map_reduce ──────────────────────────────────────────────────────────────────

function buildMapReduce(
  providers: string[],
  _input: string,
  config?: TopologyConfig,
  memoryContext?: string,
): TopologyPlan {
  const numSubQuestions = config?.subQuestions ?? 3;
  const decomposer = providers[0];
  const decomposePrompt = memoryContext
    ? `You are a question decomposer. Break the given question into exactly ${numSubQuestions} independent sub-questions that, when answered together, fully address the original question. Output each sub-question on its own line, numbered 1-${numSubQuestions}.\n\n${memoryContext}`
    : `You are a question decomposer. Break the given question into exactly ${numSubQuestions} independent sub-questions that, when answered together, fully address the original question. Output each sub-question on its own line, numbered 1-${numSubQuestions}.`;

  return {
    topology: 'map_reduce',
    phases: [
      {
        name: 'Decompose',
        participants: [decomposer],
        visibility: noVisibility([decomposer]),
        systemPrompt: () => decomposePrompt,
        userPrompt: (ctx) => ctx.input,
        parallel: false,
      },
      {
        name: 'Map',
        participants: [...providers],
        visibility: noVisibility(providers),
        systemPrompt: (ctx) => {
          const subQ = ctx.metadata?.['assignedSubQuestion'] as string | undefined;
          return `You are an expert. Answer the following sub-question thoroughly.\n\nSub-question: ${subQ ?? 'Answer the question.'}`;
        },
        userPrompt: (ctx) => {
          const subQ = ctx.metadata?.['assignedSubQuestion'] as string | undefined;
          return subQ ?? ctx.input;
        },
        parallel: true,
      },
      {
        name: 'Reduce',
        participants: [...providers],
        visibility: fullVisibility(providers, providers),
        systemPrompt: (ctx) => {
          const answers = Object.entries(ctx.visibleResponses)
            .map(([name, resp]) => `**${name}:** ${resp}`)
            .join('\n\n');
          return `You have answers to all sub-questions. Synthesize them into a single, comprehensive response.\n\n${answers}`;
        },
        userPrompt: (ctx) => `Combine all sub-answers to fully address: ${ctx.input}`,
        parallel: true,
      },
    ],
    synthesizer: providers[0],
    votingEnabled: false,
    description: `Divide and conquer: decompose into ${numSubQuestions} sub-questions, map to providers, reduce`,
  };
}

// ── adversarial_tree ────────────────────────────────────────────────────────────

function buildAdversarialTree(
  providers: string[],
  _input: string,
  memoryContext?: string,
): TopologyPlan {
  const phases: TopologyPhase[] = [];
  const thesis = providers[0];
  const thesisPrompt = memoryContext
    ? `You are presenting a thesis. State your position clearly and comprehensively with supporting arguments.\n\n${memoryContext}`
    : 'You are presenting a thesis. State your position clearly and comprehensively with supporting arguments.';

  // Phase 1: Thesis
  phases.push({
    name: 'Thesis',
    participants: [thesis],
    visibility: noVisibility([thesis]),
    systemPrompt: () => thesisPrompt,
    userPrompt: (ctx) => ctx.input,
    parallel: false,
  });

  // Alternating challenge/defend phases
  const remaining = providers.slice(1);
  for (let i = 0; i < remaining.length; i++) {
    const participant = remaining[i];
    const isAttack = i % 2 === 0;
    const allPrevious = [thesis, ...remaining.slice(0, i)];
    const visibility: Record<string, string[]> = { [participant]: allPrevious };

    if (isAttack) {
      phases.push({
        name: `Challenge — ${participant}`,
        participants: [participant],
        visibility,
        systemPrompt: (ctx) => {
          const prev = Object.entries(ctx.visibleResponses)
            .map(([name, resp]) => `**${name}:** ${resp}`)
            .join('\n\n');
          return `You are the challenger. Attack the thesis and any defenses. Find weaknesses, contradictions, and flawed reasoning.\n\n${prev}`;
        },
        userPrompt: (ctx) => `Challenge the arguments presented regarding: ${ctx.input}`,
        parallel: false,
      });
    } else {
      phases.push({
        name: `Defend — ${participant}`,
        participants: [participant],
        visibility,
        systemPrompt: (ctx) => {
          const prev = Object.entries(ctx.visibleResponses)
            .map(([name, resp]) => `**${name}:** ${resp}`)
            .join('\n\n');
          return `You are the defender. Defend the thesis against the challenges raised. Address each critique and strengthen the argument.\n\n${prev}`;
        },
        userPrompt: (ctx) => `Defend the thesis against the challenges regarding: ${ctx.input}`,
        parallel: false,
      });
    }
  }

  return {
    topology: 'adversarial_tree',
    phases,
    synthesizer: 'auto',
    votingEnabled: true,
    description:
      'Attack/defend binary tree: thesis → challenge → defend → counter, with final vote',
  };
}

// ── pipeline ────────────────────────────────────────────────────────────────────

function buildPipeline(providers: string[], _input: string, memoryContext?: string): TopologyPlan {
  const phases: TopologyPhase[] = [];
  const firstPrompt = memoryContext
    ? `You are the first in a chain of experts. Provide your best, most thorough answer.\n\n${memoryContext}`
    : 'You are the first in a chain of experts. Provide your best, most thorough answer.';

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const previousProviders = providers.slice(0, i);
    const visibility: Record<string, string[]> = { [provider]: previousProviders };

    if (i === 0) {
      phases.push({
        name: `Step ${i + 1}: ${provider}`,
        participants: [provider],
        visibility: noVisibility([provider]),
        systemPrompt: () => firstPrompt,
        userPrompt: (ctx) => ctx.input,
        parallel: false,
      });
    } else {
      phases.push({
        name: `Step ${i + 1}: ${provider}`,
        participants: [provider],
        visibility,
        systemPrompt: (ctx) => {
          const prev = Object.entries(ctx.visibleResponses)
            .map(([name, resp]) => `**${name}:** ${resp}`)
            .join('\n\n');
          return `Build on and improve the previous response. Add what's missing, correct errors, enhance clarity.\n\nPrevious work:\n${prev}`;
        },
        userPrompt: (ctx) => `Improve and refine the response to: ${ctx.input}`,
        parallel: false,
      });
    }
  }

  return {
    topology: 'pipeline',
    phases,
    synthesizer: providers[providers.length - 1],
    votingEnabled: false,
    description: `Sequential refinement chain: ${providers.join(' → ')}`,
  };
}

// ── panel ───────────────────────────────────────────────────────────────────────

function buildPanel(
  providers: string[],
  _input: string,
  config?: TopologyConfig,
  memoryContext?: string,
): TopologyPlan {
  const moderator = config?.moderator ?? providers[0];
  const panelists = providers.filter((p) => p !== moderator);
  const panelistPrompt = memoryContext
    ? `You are a panelist in an expert discussion. Provide your opening statement with your perspective and key arguments.\n\n${memoryContext}`
    : 'You are a panelist in an expert discussion. Provide your opening statement with your perspective and key arguments.';

  return {
    topology: 'panel',
    phases: [
      {
        name: 'Opening Statements',
        participants: [...panelists],
        visibility: noVisibility(panelists),
        systemPrompt: () => panelistPrompt,
        userPrompt: (ctx) => ctx.input,
        parallel: true,
      },
      {
        name: 'Moderator Questions',
        participants: [moderator],
        visibility: { [moderator]: panelists },
        systemPrompt: (ctx) => {
          const statements = Object.entries(ctx.visibleResponses)
            .map(([name, resp]) => `**${name}:** ${resp}`)
            .join('\n\n');
          return `You are the moderator. You have read all panelist opening statements. Generate a targeted follow-up question for each panelist to deepen the discussion. Format: one question per panelist, labeled with their name.\n\n${statements}`;
        },
        userPrompt: (ctx) =>
          `Based on the opening statements, generate follow-up questions for each panelist regarding: ${ctx.input}`,
        parallel: false,
      },
      {
        name: 'Panelist Responses',
        participants: [...panelists],
        visibility: (() => {
          const v: Record<string, string[]> = {};
          for (const p of panelists) v[p] = [moderator];
          return v;
        })(),
        systemPrompt: (ctx) => {
          const modQ = ctx.visibleResponses[moderator] ?? '';
          return `The moderator has posed follow-up questions. Find and answer the question directed at you.\n\nModerator's questions:\n${modQ}`;
        },
        userPrompt: (ctx) => `Answer the moderator's follow-up question about: ${ctx.input}`,
        parallel: true,
      },
      {
        name: 'Moderator Synthesis',
        participants: [moderator],
        visibility: { [moderator]: panelists },
        systemPrompt: (ctx) => {
          const all = Object.entries(ctx.visibleResponses)
            .map(([name, resp]) => `**${name}:** ${resp}`)
            .join('\n\n');
          return `You are the moderator. You have seen all opening statements and follow-up responses. Produce a comprehensive synthesis that captures the key insights, areas of agreement, and remaining tensions.\n\n${all}`;
        },
        userPrompt: (ctx) => `Synthesize the full panel discussion on: ${ctx.input}`,
        parallel: false,
      },
    ],
    synthesizer: moderator,
    votingEnabled: false,
    description: `Moderated panel: ${moderator} moderates ${panelists.join(', ')}`,
  };
}
