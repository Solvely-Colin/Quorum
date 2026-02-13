/**
 * Council V2 — 7-phase deliberation with context management and file-backed state.
 *
 * Phases: gather → plan → formulate → debate → adjust → rebuttal → vote → synthesize
 *
 * Debate model: "room" style — every member sees and critiques ALL other positions,
 * not round-robin pairs. This creates the swarm/aggregate dynamic of a real council.
 */

import { SessionStore, type PhaseOutput } from './session.js';
import { estimateTokens, availableInput, fitToBudget } from './context.js';
import type {
  AgentProfile,
  ProviderAdapter,
  ProviderConfig,
  Synthesis,
} from './types.js';
import { tallyWithMethod, type Ballot, type VotingResult } from './voting.js';
import { generateHeatmap } from './heatmap.js';
import { runHook, type HookEnv } from './hooks.js';
import { executeTools } from './tools.js';
import { generateEvidenceReport, EVIDENCE_INSTRUCTION, formatEvidenceSummary, crossValidateClaims, type EvidenceReport, type CrossReference, tierWeight } from './evidence.js';
import { AdaptiveController, recordOutcome, type AdaptivePreset, type AdaptiveDecision } from './adaptive.js';
import { loadAttackPack, buildRedTeamPrompt, parseRedTeamResponse, scoreResilience, formatRedTeamReport, type RedTeamResult, type AttackPack } from './redteam.js';
import { buildTopologyPlan, validateTopologyConfig, type TopologyName, type TopologyConfig, type TopologyPlan, type TopologyPhase, type PhaseContext } from './topology.js';
import { addMemoryNode, findRelevantMemories, detectContradictions, formatMemoryContext, extractTags } from './memory-graph.js';
import { appendToLedger, type LedgerConfig } from './ledger.js';
import { shouldPause, createInteractiveHandler, type HITLOptions, type HITLCheckpoint, type HITLResponse } from './hitl.js';
import { recordResult as arenaRecordResult, getReputationWeights } from './arena.js';
import { loadPolicies, evaluatePreDeliberation, evaluatePostDeliberation, shouldBlock as policyShouldBlock, shouldPause as policyShouldPause, formatViolations, type QuorumPolicy, type PolicyViolation } from './policy.js';

export interface CouncilV2Options {
  onEvent?: (event: string, data: unknown) => void;
  onStreamDelta?: (provider: string, phase: string, delta: string) => void;
  sessionDir?: string;
  streaming?: boolean;
  timeoutOverride?: number;
  rapid?: boolean;
  adaptive?: AdaptivePreset;
  devilsAdvocate?: boolean;
  priorContext?: string;
  weights?: Record<string, number>;
  noHooks?: boolean;
  noMemory?: boolean;
  policyName?: string;
  reputation?: boolean;
  redTeam?: boolean;
  attackPacks?: string[];
  customAttacks?: string[];
  topology?: TopologyName;
  topologyConfig?: TopologyConfig;
  hitl?: HITLOptions;
}

export interface V2Result {
  sessionId: string;
  sessionPath: string;
  synthesis: Synthesis;
  votes: VoteResult;
  duration: number;
}

export interface VoteResult {
  rankings: Array<{ provider: string; score: number }>;
  winner: string;
  controversial: boolean;
  details: Record<string, { ranks: number[]; rationale: string }>;
  votingDetails?: string;
}

const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 2000;

export class CouncilV2 {
  private adapters: ProviderAdapter[];
  private providerConfigs: ProviderConfig[];
  private profile: AgentProfile;
  private store: SessionStore;
  private emit: (event: string, data: unknown) => void;
  private onStreamDelta: (provider: string, phase: string, delta: string) => void;
  private streaming: boolean;
  private rapid: boolean;
  private phasePipeline: string[];
  private devilsAdvocate: boolean;
  private devilsAdvocateName: string | null = null;
  private priorContext: string | null = null;
  private weights: Record<string, number>;
  private hooks: Record<string, string>;
  private noHooks: boolean;
  private startedAt = 0;
  private currentPhase = '';
  private deliberationInput = '';
  private evidenceReports: EvidenceReport[] = [];
  private crossRefs: CrossReference[] = [];
  private adaptiveController: AdaptiveController | null = null;
  private redTeam: boolean = false;
  private attackPacks: string[] = [];
  private customAttacks: string[] = [];
  private redTeamResult: RedTeamResult | null = null;
  private topology: TopologyName = 'mesh';
  private topologyConfig: TopologyConfig = {};
  private topologyPlan: TopologyPlan | null = null;
  private noMemory: boolean = false;
  private reputation: boolean = false;
  private hitl: HITLOptions | undefined;
  private policyName: string | undefined;
  private collectedPhases: Array<{ name: string; duration: number; responses: Record<string, string> }> = [];

  constructor(
    adapters: ProviderAdapter[],
    providerConfigs: ProviderConfig[],
    profile: AgentProfile,
    options?: CouncilV2Options,
  ) {
    if (adapters.length !== providerConfigs.length) {
      throw new Error(`Adapter/config mismatch: ${adapters.length} adapters but ${providerConfigs.length} configs`);
    }
    this.adapters = adapters;
    this.providerConfigs = providerConfigs;
    this.profile = profile;
    this.store = new SessionStore(crypto.randomUUID(), options?.sessionDir);
    this.emit = options?.onEvent ?? (() => {});
    this.onStreamDelta = options?.onStreamDelta ?? (() => {});
    this.streaming = options?.streaming ?? false;
    this.rapid = options?.rapid ?? false;
    this.devilsAdvocate = options?.devilsAdvocate ?? false;
    this.weights = options?.weights ?? profile.weights ?? {};
    this.hooks = profile.hooks ?? {};
    this.noHooks = options?.noHooks ?? false;
    this.noMemory = options?.noMemory ?? false;
    this.reputation = options?.reputation ?? false;
    this.hitl = options?.hitl;
    this.policyName = options?.policyName;
    this.redTeam = options?.redTeam ?? profile.redTeam ?? false;
    this.attackPacks = options?.attackPacks ?? profile.attackPacks ?? [];
    this.customAttacks = options?.customAttacks ?? profile.customAttacks ?? [];
    this.topology = options?.topology ?? (profile as any).topology ?? 'mesh';
    this.topologyConfig = options?.topologyConfig ?? (profile as any).topologyConfig ?? {};

    // Resolve phase pipeline
    const ALL_PHASES = ['gather', 'plan', 'formulate', 'debate', 'adjust', 'rebuttal', 'vote', 'synthesize'];
    if (profile.phases && profile.phases.length > 0) {
      // Validate phase names
      for (const p of profile.phases) {
        if (!ALL_PHASES.includes(p)) {
          throw new Error(`Invalid phase "${p}". Valid phases: ${ALL_PHASES.join(', ')}`);
        }
      }
      // Enforce gather and synthesize
      const phases = [...profile.phases];
      if (!phases.includes('gather')) phases.unshift('gather');
      if (!phases.includes('synthesize')) phases.push('synthesize');
      this.phasePipeline = phases;
    } else if (this.rapid) {
      this.phasePipeline = ['gather', 'debate', 'synthesize'];
    } else {
      this.phasePipeline = ALL_PHASES;
    }
    this.priorContext = options?.priorContext ?? null;

    // Adaptive debate controller
    const adaptivePreset = options?.adaptive ?? (profile as any).adaptive ?? 'off';
    if (adaptivePreset !== 'off') {
      this.adaptiveController = new AdaptiveController(adaptivePreset as AdaptivePreset);
    }
  }

  async deliberate(input: string): Promise<V2Result> {
    this.startedAt = Date.now();
    this.deliberationInput = input;

    if (this.adapters.length < 2) {
      throw new Error(`Need 2+ providers for deliberation (${this.adapters.length} active after exclusions)`);
    }

    // Policy: pre-deliberation checks
    try {
      let policies = await loadPolicies();
      if (this.policyName) {
        policies = policies.filter(p => p.name === this.policyName);
      } else {
        // Only apply 'default' policy unless explicitly specified
        policies = policies.filter(p => p.name === 'default');
      }
      const providerNames = this.adapters.map(a => a.name);
      const allPreViolations: PolicyViolation[] = [];
      for (const policy of policies) {
        const violations = evaluatePreDeliberation(policy, input, providerNames, {
          evidence: this.profile.evidence,
        });
        allPreViolations.push(...violations);
      }
      if (allPreViolations.length > 0) {
        this.emit('policy:pre', { violations: allPreViolations });
        for (const v of allPreViolations) {
          this.emit('policy:violation', { ...v });
        }
        if (policyShouldPause(allPreViolations)) {
          this.emit('policy:pause', { violations: allPreViolations.filter(v => v.action === 'pause') });
        }
        if (policyShouldBlock(allPreViolations)) {
          throw new Error(`Policy violation (blocked): ${formatViolations(allPreViolations.filter(v => v.action === 'block'))}`);
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Policy violation')) throw err;
      // Non-fatal policy loading errors
    }

    await this.store.init();
    try {
      await this.store.writeMeta({
        input,
        profile: this.profile.name,
        providers: this.providerConfigs.map(c => ({ name: c.name, provider: c.provider, model: c.model })),
        startedAt: this.startedAt,
      });
    } catch (err) {
      this.emit('warn', { message: `Failed to write session meta: ${err instanceof Error ? err.message : err}` });
    }

    const names = this.adapters.map(a => a.name);
    this.emit('initialized', { providers: names, sessionPath: this.store.path });

    // Memory graph: retrieve relevant prior deliberations
    let memoryContext = '';
    if (!this.noMemory) {
      try {
        const memories = await findRelevantMemories(input, 5);
        if (memories.length > 0) {
          memoryContext = formatMemoryContext(memories);
          this.emit('memory', { count: memories.length, memories: memories.map(m => ({ input: m.input.slice(0, 80), date: new Date(m.timestamp).toISOString().slice(0, 10), consensus: m.consensusScore })) });
        }
      } catch { /* non-fatal */ }
    }

    // Topology-based deliberation (non-mesh)
    if (this.topology !== 'mesh') {
      const validationError = validateTopologyConfig(this.topology, names, this.topologyConfig);
      if (validationError) {
        throw new Error(`Topology validation failed: ${validationError}`);
      }
      return this.deliberateTopology(input);
    }

    // Phase 1: GATHER — independent responses (no fallback, first phase)
    const gather = await this.runPhase('01-gather', 'GATHER', async () => {
      return this.parallel(async (adapter) => {
        let gatherSys: string;
        if (this.profile.decisionMatrix) {
          gatherSys = `You are a member of a deliberation council evaluating a decision.\n` +
            `Identify all options/alternatives being compared. For each, score it 1-10 on these criteria: ${this.profile.focus.join(', ')}. ` +
            `Present as a structured table. Then explain your reasoning for each score.`;
        } else {
          gatherSys = `You are a member of a deliberation council. Generate your best, independent response.\nFocus on: ${this.profile.focus.join(', ')}.`;
        }
        if (this.priorContext) {
          gatherSys += `\n\nThe council previously deliberated and reached this conclusion:\n\n${this.priorContext}\n\nNow consider this follow-up:`;
        }
        if (memoryContext) {
          gatherSys += `\n\n${memoryContext}`;
        }
        if (this.profile.evidence && this.profile.evidence !== 'off') {
          gatherSys += `\n\n${EVIDENCE_INSTRUCTION}`;
        }
        if (this.profile.tools) {
          const toolList = ['web_search', 'read_file'];
          if (this.profile.allowShellTool) toolList.push('shell');
          gatherSys += `\n\nYou have access to tools. To use a tool, include it in your response:\n` +
            toolList.map(t => `  <tool:${t}>your input</tool:${t}>`).join('\n') +
            `\nAvailable tools: ${toolList.join(', ')}. Max 3 tool uses per response.`;
        }
        const sys = this.prompt('gather', gatherSys, adapter.name);
        let response = await adapter.generate(input, sys);

        // Tool execution in gather phase
        if (this.profile.tools) {
          const { cleanedResponse, toolResults } = await executeTools(response, {
            allowShell: this.profile.allowShellTool ?? false,
          });
          for (const tr of toolResults) {
            this.emit('tool', { provider: adapter.name, tool: tr.tool, input: tr.input, output: tr.output });
          }
          if (toolResults.length > 0) {
            // Send follow-up with tool results for the provider to incorporate
            const toolSummary = toolResults.map(tr =>
              `[${tr.tool}] Input: ${tr.input}\nOutput: ${tr.output}`
            ).join('\n\n');
            const followUp = `Your previous response invoked tools. Here are the results:\n\n${toolSummary}\n\nPlease incorporate these findings into a revised, comprehensive response.`;
            response = await adapter.generate(followUp, sys);
          }
        }

        return response;
      });
    });

    // Evidence processing after gather
    if (this.profile.evidence && this.profile.evidence !== 'off') {
      for (const [provider, response] of Object.entries(gather.responses)) {
        const report = generateEvidenceReport(provider, response);
        this.evidenceReports.push(report);
        this.emit('evidence', { provider, report });

        // Strict mode: warn on low evidence scores
        if (this.profile.evidence === 'strict' && report.evidenceScore < 0.3) {
          const pct = Math.round(report.evidenceScore * 100);
          gather.responses[provider] = `${response}\n\n⚠️ Low evidence score (${pct}%) — most claims unsupported`;
        }
      }
      // Store evidence reports
      try {
        const { writeFile: wf } = await import('node:fs/promises');
        const { join } = await import('node:path');
        await wf(join(this.store.path, 'evidence-report.json'), JSON.stringify(this.evidenceReports, null, 2), 'utf-8');
      } catch { /* non-fatal */ }
    }

    // HITL: after-gather checkpoint
    if (shouldPause('after-gather', this.hitl)) {
      const hitlResponse = await this.runHITLCheckpoint('after-gather', gather.responses);
      if (hitlResponse.action === 'abort') throw new Error('Deliberation aborted by human at after-gather checkpoint');
      if (hitlResponse.action === 'inject' && hitlResponse.input) {
        this.priorContext = (this.priorContext ?? '') + `\n\nHuman guidance (after gather): ${hitlResponse.input}`;
      }
    }

    // Devil's advocate: assign after gather
    if (this.devilsAdvocate) {
      this.devilsAdvocateName = this.adapters[this.adapters.length - 1].name;
      this.emit('devilsAdvocate', { provider: this.devilsAdvocateName });
    }

    // Adaptive phase skipping
    const adaptiveSkips = new Set<string>();
    let extraDebateRounds = 0;

    // Adaptive: evaluate after gather
    if (this.adaptiveController) {
      const remaining = this.phasePipeline.filter(p => p !== 'gather');
      const decision = this.adaptiveController.evaluate('gather', gather.responses, remaining);
      this.emit('adaptive', { phase: 'gather', decision });
      if (decision.skipPhases) {
        for (const sp of decision.skipPhases) adaptiveSkips.add(sp);
      }
    }

    // Helper: check if a phase is in the pipeline
    const shouldRun = (phase: string) => this.phasePipeline.includes(phase) && !adaptiveSkips.has(phase);

    // Phase 2: PLAN — see everyone else's takes, plan strategy
    const plan = !shouldRun('plan') ? { phase: 'PLAN', timestamp: Date.now(), duration: 0, responses: {} as Record<string, string> } : await this.runPhase('02-plan', 'PLAN', async () => {
      return this.parallel(async (adapter, i) => {
        const others = Object.entries(gather.responses)
          .filter(([k]) => k !== adapter.name)
          .map(([k, v]) => `[${k}]: ${v}`)
          .join('\n\n---\n\n');

        const budget = this.budgetFor(i);
        const fitted = fitToBudget([
          { key: 'others', text: others, priority: 'trimmable' },
        ], budget);

        const sys = this.prompt('plan',
          `You've seen other council members' initial takes. Now plan your argument strategy.\n` +
          `What will you emphasize? Where will you disagree? What's your angle?`,
          adapter.name
        );
        const prompt = `Other council members' initial responses:\n\n${fitted.others}\n\nOutline your argument strategy (bullet points, concise):`;
        return adapter.generate(prompt, sys);
      });
    });

    // Phase 3: FORMULATE — formal position statements (fallback: gather output)
    const gatherFallbacks = { ...gather.responses };
    const formulate = !shouldRun('formulate') ? { phase: 'FORMULATE', timestamp: Date.now(), duration: 0, responses: { ...gather.responses } } : await this.runPhase('03-formulate', 'FORMULATE', async () => {
      return this.parallel(async (adapter, i) => {
        const myGather = gather.responses[adapter.name];
        const myPlan = plan.responses[adapter.name];

        const otherGathers = Object.entries(gather.responses)
          .filter(([k]) => k !== adapter.name)
          .map(([k, v]) => `[${k}]: ${v.slice(0, 500)}`)
          .join('\n\n');

        const budget = this.budgetFor(i);
        const fitted = fitToBudget([
          { key: 'myGather', text: myGather, priority: 'full' },
          { key: 'myPlan', text: myPlan, priority: 'full' },
          { key: 'otherSummaries', text: otherGathers, priority: 'trimmable' },
        ], budget);

        let formulateSysText = `Write your full, formal position statement. Be thorough and persuasive.\n` +
          `You have your initial research, your argument plan, and awareness of others' positions.`;
        if (this.profile.evidence && this.profile.evidence !== 'off') {
          formulateSysText += `\n\n${EVIDENCE_INSTRUCTION}`;
        }
        const sys = this.prompt('formulate', formulateSysText, adapter.name);
        const prompt = [
          `Original question: ${input}`,
          `\n## Your initial research:\n${fitted.myGather}`,
          `\n## Your argument plan:\n${fitted.myPlan}`,
          `\n## Others' initial takes (summary):\n${fitted.otherSummaries}`,
          `\nNow write your formal position:`,
        ].join('\n');

        return adapter.generate(prompt, sys);
      }, gatherFallbacks);
    });

    // Phase 4: DEBATE — room style: everyone critiques ALL other positions
    const debate = !shouldRun('debate') ? { phase: 'DEBATE', timestamp: Date.now(), duration: 0, responses: {} as Record<string, string> } : await this.runPhase('04-debate', 'DEBATE', async () => {
      return this.parallel(async (adapter, i) => {
        // Show ALL other positions
        const otherPositions = Object.entries(formulate.responses)
          .filter(([k]) => k !== adapter.name)
          .map(([k, v]) => `### [${k}]'s Position:\n${v}`)
          .join('\n\n---\n\n');

        const budget = this.budgetFor(i);
        const fitted = fitToBudget([
          { key: 'positions', text: otherPositions, priority: 'trimmable' },
        ], budget);

        const isDevil = this.devilsAdvocateName === adapter.name;
        const debateDefault = isDevil
          ? `You are the devil's advocate. Your job is to find every flaw, weakness, and counterargument to the emerging consensus. Challenge assumptions ruthlessly.`
          : `You are in a council chamber with ${this.adapters.length - 1} other members. You've read ALL their positions.\n` +
            `Critique ALL of them. Address each member by name.\n` +
            `Challenge style: ${this.profile.challengeStyle}.\n` +
            `For each: attack the weakest link, question assumptions, offer counterexamples. Note genuine strengths.\n` +
            `No strawmen. No vague "I disagree." Be sharp, be fair, be memorable.`;
        const sys = this.prompt('debate', debateDefault, adapter.name);
        const prompt = [
          `Original question: ${input}`,
          `\n## Other council members' positions:\n${fitted.positions}`,
          `\nCritique each position. Address each member directly:`,
        ].join('\n');

        return adapter.generate(prompt, sys);
      });
    });

    // HITL: after-debate checkpoint
    if (shouldRun('debate') && shouldPause('after-debate', this.hitl)) {
      const hitlResponse = await this.runHITLCheckpoint('after-debate', debate.responses);
      if (hitlResponse.action === 'abort') throw new Error('Deliberation aborted by human at after-debate checkpoint');
      if (hitlResponse.action === 'inject' && hitlResponse.input) {
        this.priorContext = (this.priorContext ?? '') + `\n\nHuman guidance (after debate): ${hitlResponse.input}`;
      }
    }

    // Adaptive: evaluate after debate
    if (this.adaptiveController && shouldRun('debate')) {
      const remaining = this.phasePipeline.filter(p =>
        !['gather', 'plan', 'formulate', 'debate'].includes(p) && !adaptiveSkips.has(p)
      );
      const decision = this.adaptiveController.evaluate('debate', debate.responses, remaining);
      this.emit('adaptive', { phase: 'debate', decision });
      if (decision.skipPhases) {
        for (const sp of decision.skipPhases) adaptiveSkips.add(sp);
      }
      // Extra debate rounds
      if (decision.action === 'add-round') {
        const maxExtra = 2;
        while (extraDebateRounds < maxExtra) {
          extraDebateRounds++;
          const extraDebate = await this.runPhase(`04-debate-r${extraDebateRounds + 1}`, `DEBATE (Round ${extraDebateRounds + 1})`, async () => {
            return this.parallel(async (adapter, i) => {
              const otherPositions = Object.entries(debate.responses)
                .filter(([k]) => k !== adapter.name)
                .map(([k, v]) => `### [${k}]'s Position:\n${v}`)
                .join('\n\n---\n\n');

              const budget = this.budgetFor(i);
              const fitted = fitToBudget([
                { key: 'positions', text: otherPositions, priority: 'trimmable' },
              ], budget);

              const sys = this.prompt('debate',
                `This is round ${extraDebateRounds + 1} of debate. Positions have not converged. Sharpen your critiques.`,
                adapter.name
              );
              const prompt = [
                `Original question: ${input}`,
                `\n## Other council members' positions:\n${fitted.positions}`,
                `\nCritique each position. Address each member directly:`,
              ].join('\n');

              return adapter.generate(prompt, sys);
            });
          });
          // Update debate responses with latest round
          Object.assign(debate.responses, extraDebate.responses);

          // Re-evaluate
          const reRemaining = this.phasePipeline.filter(p =>
            !['gather', 'plan', 'formulate', 'debate'].includes(p) && !adaptiveSkips.has(p)
          );
          const reDecision = this.adaptiveController.evaluate(`debate-r${extraDebateRounds + 1}`, debate.responses, reRemaining);
          this.emit('adaptive', { phase: `debate-r${extraDebateRounds + 1}`, decision: reDecision });
          if (reDecision.skipPhases) {
            for (const sp of reDecision.skipPhases) adaptiveSkips.add(sp);
          }
          if (reDecision.action !== 'add-round') break;
        }
      }
    }

    // Phase 5: ADJUST — each member sees ALL critiques, revises (fallback: formulate output)
    const formulateFallbacks = { ...formulate.responses };
    const adjust = !shouldRun('adjust') ? { phase: 'ADJUST', timestamp: Date.now(), duration: 0, responses: { ...formulate.responses } } : await this.runPhase('05-adjust', 'ADJUST', async () => {
      return this.parallel(async (adapter, i) => {
        const myPosition = formulate.responses[adapter.name];

        // Collect critiques from ALL other members that mention this adapter
        const critiquesReceived = Object.entries(debate.responses)
          .filter(([k]) => k !== adapter.name)
          .map(([k, v]) => `[${k}]:\n${v}`)
          .join('\n\n---\n\n');

        if (!critiquesReceived) return myPosition;

        const budget = this.budgetFor(i);
        const fitted = fitToBudget([
          { key: 'position', text: myPosition, priority: 'full' },
          { key: 'critiques', text: critiquesReceived, priority: 'trimmable' },
        ], budget);

        let adjustSysText = `The entire council has critiqued your position. Multiple members have weighed in.\n` +
          `Read all their critiques carefully. Revise where valid, defend where you're right.\n` +
          `Be honest — drop weak points, strengthen good ones. Show you've listened.`;
        if (this.profile.evidence && this.profile.evidence !== 'off') {
          adjustSysText += `\n\n${EVIDENCE_INSTRUCTION}`;
        }
        const sys = this.prompt('adjust', adjustSysText, adapter.name);
        const prompt = [
          `Your original position:\n${fitted.position}`,
          `\n## Critiques from the council:\n${fitted.critiques}`,
          `\nYour revised position:`,
        ].join('\n');

        return adapter.generate(prompt, sys);
      }, formulateFallbacks);
    });

    // Adaptive: evaluate after adjust
    if (this.adaptiveController && shouldRun('adjust')) {
      const remaining = this.phasePipeline.filter(p =>
        !['gather', 'plan', 'formulate', 'debate', 'adjust'].includes(p) && !adaptiveSkips.has(p)
      );
      const decision = this.adaptiveController.evaluate('adjust', adjust.responses, remaining);
      this.emit('adaptive', { phase: 'adjust', decision });
      if (decision.skipPhases) {
        for (const sp of decision.skipPhases) adaptiveSkips.add(sp);
      }
    }

    // Evidence processing after formulate/adjust
    if (this.profile.evidence && this.profile.evidence !== 'off') {
      const latestResponses = shouldRun('adjust') ? adjust.responses : formulate.responses;
      for (const [provider, response] of Object.entries(latestResponses)) {
        const report = generateEvidenceReport(provider, response);
        // Update existing report or add new one
        const existingIdx = this.evidenceReports.findIndex(r => r.provider === provider);
        if (existingIdx >= 0) {
          this.evidenceReports[existingIdx] = report;
        } else {
          this.evidenceReports.push(report);
        }
        this.emit('evidence', { provider, report });
      }
      // Update stored reports
      try {
        const { writeFile: wf } = await import('node:fs/promises');
        const { join } = await import('node:path');
        await wf(join(this.store.path, 'evidence-report.json'), JSON.stringify(this.evidenceReports, null, 2), 'utf-8');
      } catch { /* non-fatal */ }
    }

    // Cross-validate claims across providers
    if (this.profile.evidence && this.profile.evidence !== 'off' && this.evidenceReports.length >= 2) {
      this.crossRefs = crossValidateClaims(this.evidenceReports);
      this.emit('crossValidation', { crossRefs: this.crossRefs });
      // Save cross-references
      try {
        const { writeFile: wf } = await import('node:fs/promises');
        const { join } = await import('node:path');
        await wf(join(this.store.path, 'cross-references.json'), JSON.stringify(this.crossRefs, null, 2), 'utf-8');
      } catch { /* non-fatal */ }
    }

    // Consensus check — skip rebuttal if positions converged or not in pipeline
    const convergence = this.measureConvergence(adjust.responses);
    const threshold = this.profile.convergenceThreshold ?? 0.85;
    const skipRebuttal = !shouldRun('rebuttal') || convergence >= threshold;

    if (skipRebuttal) {
      this.emit('phase', { phase: 'REBUTTAL (SKIPPED — consensus reached)', convergence });
    }

    // Phase 6: REBUTTAL — room style: everyone sees all revised positions and gives final takes
    const rebuttal = skipRebuttal
      ? { phase: 'REBUTTAL', timestamp: Date.now(), duration: 0, responses: {} as Record<string, string> }
      : await this.runPhase('06-rebuttal', 'REBUTTAL', async () => {
        return this.parallel(async (adapter, i) => {
          // Show all OTHER revised positions + what this adapter originally critiqued
          const myCritique = debate.responses[adapter.name];
          const otherRevisions = Object.entries(adjust.responses)
            .filter(([k]) => k !== adapter.name)
            .map(([k, v]) => `### [${k}]'s Revised Position:\n${v}`)
            .join('\n\n---\n\n');

          const budget = this.budgetFor(i);
          const fitted = fitToBudget([
            { key: 'myCritique', text: myCritique || '', priority: 'trimmable' },
            { key: 'revisions', text: otherRevisions, priority: 'full' },
          ], budget);

          const sys = this.prompt('rebuttal',
            `The council members have revised their positions after hearing critiques.\n` +
            `Review their revisions. For each: did they address your concerns? What still stands?\n` +
            `Brief rebuttals or concessions. Be concise — this is the final round before voting.`,
            adapter.name
          );
          const prompt = [
            `Your original critiques:\n${fitted.myCritique}`,
            `\n## Revised positions:\n${fitted.revisions}`,
            `\nYour final rebuttals/concessions (address each member):`,
          ].join('\n');

          return adapter.generate(prompt, sys);
        });
      });

    // RED TEAM PHASE — non-voting adversarial analysis
    if (this.redTeam) {
      this.emit('phase', { phase: 'RED_TEAM' });
      const rtStart = Date.now();

      // Load attack packs
      const packs: AttackPack[] = [];
      const packNames = this.attackPacks.length > 0 ? this.attackPacks : ['general'];
      for (const packName of packNames) {
        try {
          const pack = await loadAttackPack(packName);
          packs.push(pack);
        } catch (err) {
          this.emit('warn', { message: `Failed to load attack pack "${packName}": ${err instanceof Error ? err.message : String(err)}` });
        }
      }

      // Build red team prompt
      const rtPrompt = buildRedTeamPrompt(packs, this.customAttacks.length > 0 ? this.customAttacks : undefined);

      // Collect all current positions (use adjust if available, else formulate, else gather)
      const currentPositions = shouldRun('adjust') && !adaptiveSkips.has('adjust')
        ? adjust.responses
        : shouldRun('formulate') && !adaptiveSkips.has('formulate')
        ? formulate.responses
        : gather.responses;

      const positionsSummary = Object.entries(currentPositions)
        .map(([name, pos]) => `### [${name}]'s Position:\n${pos}`)
        .join('\n\n---\n\n');

      // Use the FIRST available adapter for red team (it doesn't vote anyway)
      const rtAdapter = this.adapters[0];
      const rtInput = [
        `Original question: ${input}`,
        `\n## Council Positions:\n${positionsSummary}`,
        `\nAttack ALL positions. Find every flaw, risk, and blind spot:`,
      ].join('\n');

      try {
        const rtResponse = await this.generateWithRetry(rtAdapter, rtInput, rtPrompt);
        this.emit('response', { provider: `${rtAdapter.name} (red-team)`, phase: 'red_team' });

        // Parse and score
        const attacks = parseRedTeamResponse(rtResponse, currentPositions);
        this.redTeamResult = scoreResilience(attacks, currentPositions);
        this.redTeamResult.rawResponse = rtResponse;
        this.redTeamResult.attackPacks = packNames;

        this.emit('redTeam', { result: this.redTeamResult });

        // Save to session
        try {
          const { writeFile: wf } = await import('node:fs/promises');
          const { join } = await import('node:path');
          await wf(join(this.store.path, 'redteam-result.json'), JSON.stringify(this.redTeamResult, null, 2), 'utf-8');
        } catch { /* non-fatal */ }
      } catch (err) {
        this.emit('warn', { message: `Red team failed: ${err instanceof Error ? err.message : String(err)}` });
      }

      this.emit('phase:done', { phase: 'RED_TEAM', duration: Date.now() - rtStart });
    }

    // Phase 7: VOTE
    const vote = !shouldRun('vote') ? { phase: 'VOTE', timestamp: Date.now(), duration: 0, responses: {} as Record<string, string> } : await this.runPhase('07-vote', 'VOTE', async () => {
      const labels = this.adapters.map((_, idx) => String.fromCharCode(65 + idx));

      return this.parallel(async (adapter, i) => {
        const positionSummaries = this.adapters
          .map((a, idx) => {
            const pos = adjust.responses[a.name];
            return `## Position ${labels[idx]}\n${pos}`;
          })
          .join('\n\n---\n\n');

        const budget = this.budgetFor(i);
        const fitted = fitToBudget([
          { key: 'positions', text: positionSummaries, priority: 'trimmable' },
        ], budget);

        let voteSysText = `Vote on the best position. Rank ALL positions from best to worst.\n` +
          `Explain your ranking. Be fair — you CAN rank your own position #1 if it's genuinely best, but justify it.`;
        if (this.profile.evidence && this.profile.evidence !== 'off' && this.evidenceReports.length > 0) {
          const evidenceSummary = this.evidenceReports
            .map(r => {
              const tiers = Object.entries(r.tierBreakdown)
                .filter(([_, count]) => count > 0)
                .map(([tier, count]) => `${count}×tier-${tier}`)
                .join(', ');
              return `${r.provider}: ${Math.round(r.weightedScore * 100)}% weighted evidence (${tiers})`;
            })
            .join('\n');
          voteSysText += `\n\nEvidence scores (consider these in your ranking — providers who backed up claims with sources should be weighted higher):\n${evidenceSummary}`;
        }
        const sys = this.prompt('vote', voteSysText, adapter.name);
        const prompt = [
          `Original question: ${input}`,
          `\nThere are ${this.adapters.length} positions to rank (${labels.join(', ')}):`,
          `\n${fitted.positions}`,
          `\nYou MUST rank all positions. Provide your rankings as a JSON block AND as numbered lines.`,
          `\nJSON format:`,
          '```json',
          JSON.stringify({ rankings: labels.map((l, idx) => ({ position: l, rank: idx + 1, reason: "..." })) }, null, 2),
          '```',
          `\nAlso write as numbered lines:`,
          `1. ${labels[0]} — reason`,
          labels.length > 1 ? `2. ${labels[1]} — reason` : '',
          labels.length > 2 ? `3. ${labels[2]} — reason` : '',
          `\nDo not ask clarifying questions. Do not skip any position. Rank them now.`,
        ].filter(Boolean).join('\n');

        return adapter.generate(prompt, sys);
      });
    });

    // Apply reputation weights if enabled
    if (this.reputation) {
      try {
        const repWeights = await getReputationWeights(this.adapters.map(a => a.name));
        for (const [provider, w] of Object.entries(repWeights)) {
          this.weights[provider] = (this.weights[provider] ?? 1) * w;
        }
        this.emit('reputation', { weights: repWeights });
      } catch { /* non-fatal */ }
    }

    // Tally votes (or create synthetic results if vote was skipped)
    const votes = shouldRun('vote')
      ? this.tallyVotes(vote.responses)
      : {
          rankings: this.adapters.map((a, i) => ({ provider: a.name, score: this.adapters.length - i })),
          winner: this.adapters[0].name,
          controversial: false,
          details: Object.fromEntries(this.adapters.map(a => [a.name, { ranks: [], rationale: 'vote phase skipped' }])),
        };
    this.emit('votes', votes);

    // HITL: after-vote and on-controversy checkpoints
    {
      const voteConsensus = votes.rankings.length >= 2
        ? Math.abs(votes.rankings[0].score - votes.rankings[1].score) / (votes.rankings[0].score || 1)
        : 1;
      const shouldCheckAfterVote = shouldPause('after-vote', this.hitl);
      const shouldCheckControversy = shouldPause('on-controversy', this.hitl, voteConsensus);
      if (shouldCheckAfterVote || shouldCheckControversy) {
        const phase = shouldCheckControversy ? 'on-controversy' as const : 'after-vote' as const;
        const hitlResponse = await this.runHITLCheckpoint(phase, adjust.responses, votes, voteConsensus);
        if (hitlResponse.action === 'abort') throw new Error(`Deliberation aborted by human at ${phase} checkpoint`);
        if (hitlResponse.overrideWinner) {
          votes.winner = hitlResponse.overrideWinner;
          this.emit('hitl:override', { winner: hitlResponse.overrideWinner });
        }
        if (hitlResponse.action === 'inject' && hitlResponse.input) {
          this.priorContext = (this.priorContext ?? '') + `\n\nHuman guidance (${phase}): ${hitlResponse.input}`;
        }
      }
    }

    // Generate consensus heatmap if we have enough voters
    if (shouldRun('vote') && this.adapters.length >= 3) {
      const labels = this.adapters.map((_, idx) => String.fromCharCode(65 + idx));
      const letterToProvider: Record<string, string> = {};
      for (let idx = 0; idx < this.adapters.length; idx++) {
        letterToProvider[labels[idx]] = this.adapters[idx].name;
      }
      const heatmapBallots = this.extractBallots(vote.responses, labels, letterToProvider);
      if (heatmapBallots.length >= 2) {
        const heatmapText = generateHeatmap(heatmapBallots, names);
        if (heatmapText) {
          this.emit('heatmap', { heatmap: heatmapText });
        }
      }
    }

    // Synthesize — use a NON-winner to reduce confirmation bias
    this.emit('phase', { phase: 'SYNTHESIZE' });
    const synthAdapter = this.pickSynthesizer(votes);

    const allPositions = this.adapters
      .map(a => `[${a.name}]:\n${adjust.responses[a.name]}`)
      .join('\n\n---\n\n');

    const rebuttalsText = Object.entries(rebuttal.responses)
      .map(([k, v]) => `[${k}]: ${v}`)
      .join('\n\n');

    const voteText = Object.entries(vote.responses)
      .map(([k, v]) => `[${k}]:\n${v}`)
      .join('\n\n');

    const voteRankingsText = votes.rankings.length > 0
      ? `\n\nVote rankings: ${votes.rankings.map(r => `${r.provider} (score: ${r.score})`).join(', ')}` +
        `\nWeight contributions by vote score. The winner's arguments should receive more emphasis. ` +
        `Last-place provider's unique contributions should be flagged as lower-confidence minority positions.`
      : '';
    const synthSysDefault = this.profile.decisionMatrix
      ? `You are the neutral synthesizer. The council evaluated options using a decision matrix.\n` +
        `Merge the individual scoring matrices into a composite grid. Highlight where providers agree and disagree on scores.\n` +
        `Produce a final recommendation based on aggregate scores across all criteria: ${this.profile.focus.join(', ')}.` +
        voteRankingsText
      : `You are the neutral synthesizer — you did NOT win this debate. Your job is impartial integration.\n` +
        `The council debated, critiqued, revised, and voted. Merge the best thinking into a definitive answer.\n` +
        `Start with the winning position, integrate valuable insights from others (cite who), resolve conflicts.\n` +
        `The synthesis must be BETTER than any individual response.` +
        voteRankingsText;
    const synthSys = this.prompt('synthesize', synthSysDefault, synthAdapter.name);

    // Build evidence cross-reference context for synthesis
    let evidenceCrossRefContext = '';
    if (this.profile.evidence && this.profile.evidence !== 'off' && this.crossRefs.length > 0) {
      const corroborated = this.crossRefs.filter(cr => cr.corroborated);
      const contradicted = this.crossRefs.filter(cr => cr.contradicted);
      evidenceCrossRefContext = '\n\n## Evidence Cross-References\n';
      if (corroborated.length > 0) {
        evidenceCrossRefContext += '### Corroborated Claims (multiple providers agree):\n';
        for (const cr of corroborated.slice(0, 10)) {
          evidenceCrossRefContext += `- "${cr.claimText}" — supported by: ${cr.providers.join(', ')} (best source: tier ${cr.bestSourceTier})\n`;
        }
      }
      if (contradicted.length > 0) {
        evidenceCrossRefContext += '### Contradicted Claims (providers disagree):\n';
        for (const cr of contradicted.slice(0, 10)) {
          evidenceCrossRefContext += `- "${cr.claimText}" — providers: ${cr.providers.join(', ')}`;
          if (cr.contradictions) evidenceCrossRefContext += ` — conflicts: ${cr.contradictions.join('; ')}`;
          evidenceCrossRefContext += '\n';
        }
      }
    }

    // Red team context for synthesis
    let redTeamSynthContext = '';
    if (this.redTeamResult && this.redTeamResult.unresolvedRisks.length > 0) {
      redTeamSynthContext = `\n## 🔴 Red Team Findings (unresolved risks — you MUST address these)\n` +
        this.redTeamResult.unresolvedRisks.map(r => `- ${r}`).join('\n') +
        `\n\nResilience score: ${Math.round(this.redTeamResult.resilienceScore * 100)}%`;
    }

    let produceInstruction = `\nProduce:\n## Synthesis\n[Best answer]\n\n## Minority Report\n[Dissenting views worth preserving]`;
    if (this.redTeamResult?.blindSpots?.length) {
      produceInstruction += `\n\n## Red Team Blind Spots\n[Address these blind spots identified by adversarial analysis:\n${this.redTeamResult.blindSpots.map(b => `- ${b}`).join('\n')}]`;
    }
    produceInstruction += `\n\n## Scores\nConsensus: [0.0-1.0]\nConfidence: [0.0-1.0]`;

    const synthPrompt = [
      `Original question: ${input}`,
      `\n## Final Positions:\n${allPositions}`,
      `\n## Rebuttals:\n${rebuttalsText}`,
      `\n## Council Votes:\n${voteText}`,
      evidenceCrossRefContext,
      redTeamSynthContext,
      produceInstruction,
    ].join('\n');

    this.currentPhase = 'SYNTHESIZE';
    let synthContent: string;
    if (this.streaming) {
      try {
        synthContent = await this.generateStreaming(synthAdapter, synthPrompt, synthSys);
      } catch {
        synthContent = await this.generateWithRetry(synthAdapter, synthPrompt, synthSys);
      }
    } else {
      synthContent = await this.generateWithRetry(synthAdapter, synthPrompt, synthSys);
    }
    this.emit('response', { provider: synthAdapter.name, phase: 'synthesize' });

    // Parse scores — flexible regex
    const consensusMatch = synthContent.match(/Consensus[:\s]*\*?\*?([\d.]+)/i);
    const confidenceMatch = synthContent.match(/Confidence[:\s]*\*?\*?([\d.]+)/i);
    const minorityMatch = synthContent.match(/##\s*Minority Report\n([\s\S]*?)(?=\n##\s|$)/i);

    // Memory graph: contradiction detection after synthesis
    if (!this.noMemory && memoryContext) {
      try {
        const memories = await findRelevantMemories(input, 5);
        const contradictions = detectContradictions(input, synthContent, memories);
        if (contradictions.length > 0) {
          this.emit('contradictions', { contradictions });
        }
      } catch { /* non-fatal */ }
    }

    // "What Would Change My Mind" — one additional call (skip in rapid mode)
    let whatWouldChange: string | undefined;
    if (!this.rapid) {
    this.emit('phase', { phase: 'WHAT_WOULD_CHANGE' });
    const wwcmStart = Date.now();
    const wwcmPrompt = [
      `The council reached the following conclusion:\n\n${synthContent}`,
      `\nGiven the council's conclusion above, what specific evidence, arguments, or scenarios would cause you to overturn or significantly revise this conclusion? Be concrete and specific.`,
    ].join('\n');
    const wwcmSys = `You are a critical thinker examining a council's conclusion for potential weaknesses and conditions under which it should be revised.`;
    try {
      whatWouldChange = await this.generateWithRetry(synthAdapter, wwcmPrompt, wwcmSys);
      this.emit('response', { provider: synthAdapter.name, phase: 'what_would_change' });
    } catch (err) {
      this.emit('warn', { message: `What-would-change failed: ${err instanceof Error ? err.message : String(err)}` });
    }
    this.emit('phase:done', { phase: 'WHAT_WOULD_CHANGE', duration: Date.now() - wwcmStart });
    } // end !this.rapid

    const synthesis: Synthesis = {
      content: synthContent,
      synthesizer: synthAdapter.name,
      consensusScore: consensusMatch ? parseFloat(consensusMatch[1]) : 0.5,
      confidenceScore: confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5,
      controversial: votes.controversial,
      minorityReport: minorityMatch?.[1]?.trim(),
      contributions: Object.fromEntries(
        this.adapters.map(a => [a.name, [adjust.responses[a.name].slice(0, 200)]]),
      ),
      whatWouldChange,
    };

    try {
      await this.store.writeSynthesis({ ...synthesis, votes });
    } catch (err) {
      this.emit('warn', { message: `Failed to write synthesis: ${err instanceof Error ? err.message : err}` });
    }

    // Write session index
    try {
      await this.writeSessionIndex(input, votes.winner, Date.now() - this.startedAt);
    } catch {
      // Non-fatal
    }

    // Record adaptive outcome for learning
    if (this.adaptiveController) {
      try {
        await recordOutcome(
          this.adaptiveController.getDecisions(),
          synthesis.confidenceScore,
          this.adapters.map(a => a.name),
        );
      } catch { /* non-fatal */ }

      // Save adaptive decisions to session
      try {
        const { writeFile: wf } = await import('node:fs/promises');
        const { join } = await import('node:path');
        await wf(
          join(this.store.path, 'adaptive-decisions.json'),
          JSON.stringify({
            decisions: this.adaptiveController.getDecisions(),
            entropyHistory: this.adaptiveController.getEntropyHistory(),
          }, null, 2),
          'utf-8',
        );
      } catch { /* non-fatal */ }
    }

    const duration = Date.now() - this.startedAt;

    // Policy: post-deliberation checks
    try {
      let policies = await loadPolicies();
      if (this.policyName) { policies = policies.filter(p => p.name === this.policyName); } else { policies = policies.filter(p => p.name === "default"); }
      const postTags = extractTags(synthesis.content);
      const allPostViolations: PolicyViolation[] = [];
      for (const policy of policies) {
        allPostViolations.push(...evaluatePostDeliberation(policy, {
          consensusScore: synthesis.consensusScore,
          confidenceScore: synthesis.confidenceScore,
          controversial: synthesis.controversial,
          content: synthesis.content,
        }, postTags, { evidence: this.profile.evidence, redTeam: this.redTeam, duration: duration / 1000 }));
      }
      if (allPostViolations.length > 0) {
        this.emit('policy:post', { violations: allPostViolations });
        for (const v of allPostViolations) this.emit('policy:violation', { ...v });
        if (policyShouldPause(allPostViolations)) {
          this.emit('policy:pause', { violations: allPostViolations.filter(v => v.action === 'pause') });
        }
      }
    } catch { /* non-fatal */ }

    this.emit('complete', { duration, winner: votes.winner, synthesizer: synthAdapter.name, synthesis });

    // Memory graph: store this deliberation
    if (!this.noMemory) {
      try {
        await addMemoryNode({ sessionId: this.store.path.split('/').pop()!, synthesis, votes, duration, input } as any);
      } catch { /* non-fatal */ }
    }

    const v2Result: V2Result = {
      sessionId: this.store.path.split('/').pop()!,
      sessionPath: this.store.path,
      synthesis,
      votes,
      duration,
    };

    // Arena: record results for reputation tracking
    try {
      const tags = extractTags(synthesis.content);
      const dominantCategory = tags.length > 0 ? tags[0] : undefined;
      const winnerName = votes.winner;
      for (const adapter of this.adapters) {
        await arenaRecordResult(
          adapter.name,
          v2Result.sessionId,
          adapter.name === winnerName,
          votes.rankings.find(r => r.provider === adapter.name)?.score ?? 0,
          synthesis.consensusScore,
          dominantCategory,
        );
      }
    } catch { /* non-fatal */ }

    // Ledger: append entry
    try {
      await appendToLedger(v2Result, {
        input,
        profile: this.profile,
        providerConfigs: this.providerConfigs,
        phases: this.collectedPhases,
        topology: this.topology,
        evidence: this.profile.evidence !== 'off' && this.profile.evidence !== undefined,
        redTeam: this.redTeam,
        adaptive: this.adaptiveController ? 'enabled' : 'off',
      });
    } catch { /* non-fatal */ }

    return v2Result;
  }

  // --- Topology Mode ---

  private async deliberateTopology(input: string): Promise<V2Result> {
    const names = this.adapters.map(a => a.name);

    // Policy: pre-deliberation checks (topology)
    try {
      let policies = await loadPolicies();
      if (this.policyName) { policies = policies.filter(p => p.name === this.policyName); } else { policies = policies.filter(p => p.name === "default"); }
      const allPreViolations: PolicyViolation[] = [];
      for (const policy of policies) {
        allPreViolations.push(...evaluatePreDeliberation(policy, input, names, { evidence: this.profile.evidence }));
      }
      if (allPreViolations.length > 0) {
        this.emit('policy:pre', { violations: allPreViolations });
        for (const v of allPreViolations) this.emit('policy:violation', { ...v });
        if (policyShouldPause(allPreViolations)) {
          this.emit('policy:pause', { violations: allPreViolations.filter(v => v.action === 'pause') });
        }
        if (policyShouldBlock(allPreViolations)) {
          throw new Error(`Policy violation (blocked): ${formatViolations(allPreViolations.filter(v => v.action === 'block'))}`);
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Policy violation')) throw err;
    }

    // Memory graph: retrieve relevant prior deliberations
    let memoryContext = '';
    if (!this.noMemory) {
      try {
        const memories = await findRelevantMemories(input, 5);
        if (memories.length > 0) {
          memoryContext = formatMemoryContext(memories);
          this.emit('memory', { count: memories.length, memories: memories.map(m => ({ input: m.input.slice(0, 80), date: new Date(m.timestamp).toISOString().slice(0, 10), consensus: m.consensusScore })) });
        }
      } catch { /* non-fatal */ }
    }

    const plan = buildTopologyPlan(this.topology, names, input, this.topologyConfig, memoryContext);
    this.topologyPlan = plan;

    this.emit('topology', { topology: plan.topology, description: plan.description, phases: plan.phases.length });

    // Execute each topology phase
    const allResponses: Record<string, Record<string, string>> = {}; // phaseName → provider → response
    let lastResponses: Record<string, string> = {};

    for (let i = 0; i < plan.phases.length; i++) {
      const phase = plan.phases[i];

      const phaseOutput = await this.runPhase(
        `${String(i + 1).padStart(2, '0')}-${phase.name.toLowerCase().replace(/\s+/g, '-')}`,
        phase.name.toUpperCase(),
        async () => {
          if (phase.parallel) {
            // Run all participants in parallel
            const results = await Promise.all(
              phase.participants.map(async (providerName) => {
                const adapter = this.adapters.find(a => a.name === providerName);
                if (!adapter) return [providerName, `[${providerName} not found]`] as const;

                // Build visible responses for this provider
                const visibleProviders = phase.visibility[providerName] ?? [];
                const visibleResponses: Record<string, string> = {};
                for (const vp of visibleProviders) {
                  // Search all previous phase responses for this provider
                  for (const phaseResps of Object.values(allResponses)) {
                    if (phaseResps[vp]) visibleResponses[vp] = phaseResps[vp];
                  }
                }

                const ctx: PhaseContext = {
                  input,
                  providerName,
                  allProviders: names,
                  previousResponses: lastResponses,
                  visibleResponses,
                  phaseIndex: i,
                  metadata: {},
                };

                const sys = phase.systemPrompt(ctx);
                const prompt = phase.userPrompt(ctx);

                try {
                  const response = await adapter.generate(prompt, sys);
                  this.emit('response', { provider: providerName, phase: phase.name });
                  return [providerName, response] as const;
                } catch (err) {
                  this.emit('warn', { message: `${providerName} failed in ${phase.name}: ${err instanceof Error ? err.message : String(err)}` });
                  return [providerName, `[${providerName} failed]`] as const;
                }
              })
            );
            return Object.fromEntries(results);
          } else {
            // Sequential execution
            const results: Record<string, string> = {};
            for (const providerName of phase.participants) {
              const adapter = this.adapters.find(a => a.name === providerName);
              if (!adapter) { results[providerName] = `[${providerName} not found]`; continue; }

              const visibleProviders = phase.visibility[providerName] ?? [];
              const visibleResponses: Record<string, string> = {};
              for (const vp of visibleProviders) {
                for (const phaseResps of Object.values(allResponses)) {
                  if (phaseResps[vp]) visibleResponses[vp] = phaseResps[vp];
                }
                // Also check results from THIS phase (sequential means earlier participants are visible)
                if (results[vp]) visibleResponses[vp] = results[vp];
              }

              const ctx: PhaseContext = {
                input,
                providerName,
                allProviders: names,
                previousResponses: { ...lastResponses, ...results },
                visibleResponses,
                phaseIndex: i,
                metadata: {},
              };

              const sys = phase.systemPrompt(ctx);
              const prompt = phase.userPrompt(ctx);

              try {
                const response = await adapter.generate(prompt, sys);
                this.emit('response', { provider: providerName, phase: phase.name });
                results[providerName] = response;
              } catch (err) {
                this.emit('warn', { message: `${providerName} failed in ${phase.name}: ${err instanceof Error ? err.message : String(err)}` });
                results[providerName] = `[${providerName} failed]`;
              }
            }
            return results;
          }
        }
      );

      allResponses[phase.name] = phaseOutput.responses;
      lastResponses = { ...lastResponses, ...phaseOutput.responses };
    }

    // Voting (if enabled by topology)
    let votes: VoteResult;
    if (plan.votingEnabled) {
      // Run standard vote phase using lastResponses as positions
      const voteOutput = await this.runPhase('vote', 'VOTE', async () => {
        return this.parallel(async (adapter, i) => {
          const labels = this.adapters.map((_, idx) => String.fromCharCode(65 + idx));
          const positionSummaries = this.adapters
            .map((a, idx) => `## Position ${labels[idx]}\n${lastResponses[a.name] ?? '[no response]'}`)
            .join('\n\n---\n\n');

          const sys = `Vote on the best position. Rank ALL positions from best to worst. Explain your ranking.`;
          const prompt = `Original question: ${input}\n\n${positionSummaries}\n\nRank all positions. Provide JSON rankings and numbered lines.`;
          return adapter.generate(prompt, sys);
        });
      });
      votes = this.tallyVotes(voteOutput.responses);
    } else {
      votes = {
        rankings: this.adapters.map((a, i) => ({ provider: a.name, score: this.adapters.length - i })),
        winner: this.adapters[0].name,
        controversial: false,
        details: {},
      };
    }
    this.emit('votes', votes);

    // Synthesis
    this.emit('phase', { phase: 'SYNTHESIZE' });
    const synthProvider = plan.synthesizer === 'auto'
      ? this.pickSynthesizer(votes)
      : this.adapters.find(a => a.name === plan.synthesizer) ?? this.adapters[0];

    const allPositionText = Object.entries(lastResponses)
      .map(([k, v]) => `[${k}]:\n${v}`)
      .join('\n\n---\n\n');

    const synthSys = `You are the synthesizer for a ${plan.description}. Merge the best thinking into a definitive answer.`;
    const synthPrompt = `Original question: ${input}\n\n## Responses:\n${allPositionText}\n\nProduce:\n## Synthesis\n[Best answer]\n\n## Minority Report\n[Dissenting views]\n\n## Scores\nConsensus: [0.0-1.0]\nConfidence: [0.0-1.0]`;

    this.currentPhase = 'SYNTHESIZE';
    let synthContent: string;
    if (this.streaming) {
      try { synthContent = await this.generateStreaming(synthProvider, synthPrompt, synthSys); }
      catch { synthContent = await this.generateWithRetry(synthProvider, synthPrompt, synthSys); }
    } else {
      synthContent = await this.generateWithRetry(synthProvider, synthPrompt, synthSys);
    }

    const consensusMatch = synthContent.match(/Consensus[:\s]*\*?\*?([\d.]+)/i);
    const confidenceMatch = synthContent.match(/Confidence[:\s]*\*?\*?([\d.]+)/i);
    const minorityMatch = synthContent.match(/##\s*Minority Report\n([\s\S]*?)(?=\n##\s|$)/i);

    const synthesis = {
      content: synthContent,
      synthesizer: synthProvider.name,
      consensusScore: consensusMatch ? parseFloat(consensusMatch[1]) : 0.5,
      confidenceScore: confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5,
      controversial: votes.controversial,
      minorityReport: minorityMatch?.[1]?.trim(),
      contributions: Object.fromEntries(
        this.adapters.map(a => [a.name, [(lastResponses[a.name] ?? '').slice(0, 200)]]),
      ),
    };

    try { await this.store.writeSynthesis({ ...synthesis, votes }); } catch { /* non-fatal */ }

    // Memory graph: contradiction detection after synthesis
    if (!this.noMemory && memoryContext) {
      try {
        const memories = await findRelevantMemories(input, 5);
        const contradictions = detectContradictions(input, synthContent, memories);
        if (contradictions.length > 0) {
          this.emit('contradictions', { contradictions });
        }
      } catch { /* non-fatal */ }
    }

    // Save topology plan to session
    try {
      const { writeFile: wf } = await import('node:fs/promises');
      const { join } = await import('node:path');
      await wf(join(this.store.path, 'topology-plan.json'), JSON.stringify({
        topology: plan.topology,
        description: plan.description,
        phases: plan.phases.map(p => ({ name: p.name, participants: p.participants, parallel: p.parallel })),
        votingEnabled: plan.votingEnabled,
        synthesizer: plan.synthesizer,
      }, null, 2), 'utf-8');
    } catch { /* non-fatal */ }

    try { await this.writeSessionIndex(input, votes.winner, Date.now() - this.startedAt); } catch { /* non-fatal */ }

    const duration = Date.now() - this.startedAt;

    // Policy: post-deliberation checks (topology)
    try {
      let policies = await loadPolicies();
      if (this.policyName) { policies = policies.filter(p => p.name === this.policyName); } else { policies = policies.filter(p => p.name === "default"); }
      const postTags = extractTags(synthesis.content);
      const allPostViolations: PolicyViolation[] = [];
      for (const policy of policies) {
        allPostViolations.push(...evaluatePostDeliberation(policy, {
          consensusScore: synthesis.consensusScore,
          confidenceScore: synthesis.confidenceScore,
          controversial: synthesis.controversial,
          content: synthesis.content,
        }, postTags, { evidence: this.profile.evidence, redTeam: this.redTeam, duration: duration / 1000 }));
      }
      if (allPostViolations.length > 0) {
        this.emit('policy:post', { violations: allPostViolations });
        for (const v of allPostViolations) this.emit('policy:violation', { ...v });
        if (policyShouldPause(allPostViolations)) {
          this.emit('policy:pause', { violations: allPostViolations.filter(v => v.action === 'pause') });
        }
      }
    } catch { /* non-fatal */ }

    this.emit('complete', { duration, winner: votes.winner, synthesizer: synthProvider.name, synthesis });

    // Memory graph: store this deliberation
    if (!this.noMemory) {
      try {
        await addMemoryNode({ sessionId: this.store.path.split('/').pop()!, synthesis, votes, duration, input } as any);
      } catch { /* non-fatal */ }
    }

    const v2Result: V2Result = {
      sessionId: this.store.path.split('/').pop()!,
      sessionPath: this.store.path,
      synthesis,
      votes,
      duration,
    };

    // Ledger: append entry
    try {
      await appendToLedger(v2Result, {
        input,
        profile: this.profile,
        providerConfigs: this.providerConfigs,
        phases: this.collectedPhases,
        topology: this.topology,
        evidence: this.profile.evidence !== 'off' && this.profile.evidence !== undefined,
        redTeam: this.redTeam,
        adaptive: this.adaptiveController ? 'enabled' : 'off',
      });
    } catch { /* non-fatal */ }

    return v2Result;
  }

  // --- Rapid Mode ---

  private async deliberateRapid(input: string, gather: PhaseOutput): Promise<V2Result> {
    // Adaptive: evaluate after gather in rapid mode
    let skipDebateRapid = false;
    if (this.adaptiveController) {
      const remaining = this.phasePipeline.filter(p => p !== 'gather');
      const decision = this.adaptiveController.evaluate('gather', gather.responses, remaining);
      this.emit('adaptive', { phase: 'gather', decision });
      if (decision.action === 'skip-to-synthesize') {
        skipDebateRapid = true;
      }
    }

    // Debate: use gather responses directly (instead of formulate)
    const debate = skipDebateRapid
      ? { phase: 'DEBATE', timestamp: Date.now(), duration: 0, responses: {} as Record<string, string> }
      : await this.runPhase('04-debate', 'DEBATE', async () => {
      return this.parallel(async (adapter, i) => {
        const otherPositions = Object.entries(gather.responses)
          .filter(([k]) => k !== adapter.name)
          .map(([k, v]) => `### [${k}]'s Position:\n${v}`)
          .join('\n\n---\n\n');

        const budget = this.budgetFor(i);
        const fitted = fitToBudget([
          { key: 'positions', text: otherPositions, priority: 'trimmable' },
        ], budget);

        const isDevil = this.devilsAdvocateName === adapter.name;
        const debateDefault = isDevil
          ? `You are the devil's advocate. Your job is to find every flaw, weakness, and counterargument to the emerging consensus. Challenge assumptions ruthlessly.`
          : `You are in a council chamber with ${this.adapters.length - 1} other members. You've read ALL their positions.\n` +
            `Critique ALL of them. Address each member by name.\n` +
            `Challenge style: ${this.profile.challengeStyle}.\n` +
            `For each: attack the weakest link, question assumptions, offer counterexamples. Note genuine strengths.\n` +
            `No strawmen. No vague "I disagree." Be sharp, be fair, be memorable.`;
        const sys = this.prompt('debate', debateDefault, adapter.name);
        const prompt = [
          `Original question: ${input}`,
          `\n## Other council members' positions:\n${fitted.positions}`,
          `\nCritique each position. Address each member directly:`,
        ].join('\n');

        return adapter.generate(prompt, sys);
      });
    });

    // Synthesize — pick first adapter (no vote)
    this.emit('phase', { phase: 'SYNTHESIZE' });
    const synthAdapter = this.adapters[0];
    this.emit('synthesizer', { provider: synthAdapter.name, reason: 'rapid mode (first adapter)' });

    const allPositions = this.adapters
      .map(a => `[${a.name}]:\n${gather.responses[a.name]}`)
      .join('\n\n---\n\n');

    const debateText = Object.entries(debate.responses)
      .map(([k, v]) => `[${k}]:\n${v}`)
      .join('\n\n');

    const rapidRankings = this.adapters.map((a, i) => ({ provider: a.name, score: this.adapters.length - i }));
    const rapidVoteRankingsText = rapidRankings.length > 0
      ? `\n\nVote rankings: ${rapidRankings.map(r => `${r.provider} (score: ${r.score})`).join(', ')}` +
        `\nWeight contributions by vote score. The winner's arguments should receive more emphasis. ` +
        `Last-place provider's unique contributions should be flagged as lower-confidence minority positions.`
      : '';
    const synthSys = this.prompt('synthesize',
      `You are the synthesizer. Merge the best thinking from all council members into a definitive answer.\n` +
      `The council gathered initial positions and debated. Integrate the strongest arguments.\n` +
      `The synthesis must be BETTER than any individual response.` +
      rapidVoteRankingsText,
      synthAdapter.name
    );

    const synthPrompt = [
      `Original question: ${input}`,
      `\n## Initial Positions:\n${allPositions}`,
      `\n## Debate:\n${debateText}`,
      `\nProduce:\n## Synthesis\n[Best answer]\n\n## Minority Report\n[Dissenting views worth preserving]\n\n## Scores\nConsensus: [0.0-1.0]\nConfidence: [0.0-1.0]`,
    ].join('\n');

    this.currentPhase = 'SYNTHESIZE';
    let synthContent: string;
    if (this.streaming) {
      try {
        synthContent = await this.generateStreaming(synthAdapter, synthPrompt, synthSys);
      } catch {
        synthContent = await this.generateWithRetry(synthAdapter, synthPrompt, synthSys);
      }
    } else {
      synthContent = await this.generateWithRetry(synthAdapter, synthPrompt, synthSys);
    }
    this.emit('response', { provider: synthAdapter.name, phase: 'synthesize' });

    const consensusMatch = synthContent.match(/Consensus[:\s]*\*?\*?([\d.]+)/i);
    const confidenceMatch = synthContent.match(/Confidence[:\s]*\*?\*?([\d.]+)/i);
    const minorityMatch = synthContent.match(/##\s*Minority Report\n([\s\S]*?)(?=\n##\s|$)/i);

    const synthesis: Synthesis = {
      content: synthContent,
      synthesizer: synthAdapter.name,
      consensusScore: consensusMatch ? parseFloat(consensusMatch[1]) : 0.5,
      confidenceScore: confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5,
      controversial: false,
      minorityReport: minorityMatch?.[1]?.trim(),
      contributions: Object.fromEntries(
        this.adapters.map(a => [a.name, [gather.responses[a.name].slice(0, 200)]]),
      ),
    };

    const votes: VoteResult = {
      rankings: this.adapters.map((a, i) => ({ provider: a.name, score: this.adapters.length - i })),
      winner: this.adapters[0].name,
      controversial: false,
      details: {},
    };

    try {
      await this.store.writeSynthesis({ ...synthesis, votes });
    } catch (err) {
      this.emit('warn', { message: `Failed to write synthesis: ${err instanceof Error ? err.message : err}` });
    }

    try {
      await this.writeSessionIndex(input, votes.winner, Date.now() - this.startedAt);
    } catch {
      // Non-fatal
    }

    // Record adaptive outcome for learning (rapid mode)
    if (this.adaptiveController) {
      try {
        await recordOutcome(
          this.adaptiveController.getDecisions(),
          synthesis.confidenceScore,
          this.adapters.map(a => a.name),
        );
      } catch { /* non-fatal */ }

      try {
        const { writeFile: wf } = await import('node:fs/promises');
        const { join } = await import('node:path');
        await wf(
          join(this.store.path, 'adaptive-decisions.json'),
          JSON.stringify({
            decisions: this.adaptiveController.getDecisions(),
            entropyHistory: this.adaptiveController.getEntropyHistory(),
          }, null, 2),
          'utf-8',
        );
      } catch { /* non-fatal */ }
    }

    const duration = Date.now() - this.startedAt;
    this.emit('complete', { duration, winner: votes.winner, synthesizer: synthAdapter.name, synthesis });

    // Memory graph: store this deliberation
    if (!this.noMemory) {
      try {
        await addMemoryNode({ sessionId: this.store.path.split('/').pop()!, synthesis, votes, duration, input } as any);
      } catch { /* non-fatal */ }
    }

    const v2Result: V2Result = {
      sessionId: this.store.path.split('/').pop()!,
      sessionPath: this.store.path,
      synthesis,
      votes,
      duration,
    };

    // Ledger: append entry
    try {
      await appendToLedger(v2Result, {
        input,
        profile: this.profile,
        providerConfigs: this.providerConfigs,
        phases: this.collectedPhases,
        topology: this.topology,
        evidence: this.profile.evidence !== 'off' && this.profile.evidence !== undefined,
        redTeam: this.redTeam,
        adaptive: this.adaptiveController ? 'enabled' : 'off',
      });
    } catch { /* non-fatal */ }

    return v2Result;
  }

  // --- HITL ---

  private async runHITLCheckpoint(
    phase: HITLCheckpoint['phase'],
    responses: Record<string, string>,
    votes?: { winner: string; rankings: Array<{ provider: string; score: number }> },
    consensusScore?: number,
  ): Promise<HITLResponse> {
    const checkpoint: HITLCheckpoint = {
      phase,
      responses,
      votes,
      consensusScore,
      message: phase === 'on-controversy'
        ? `Low consensus detected (${consensusScore?.toFixed(2)})`
        : undefined,
    };

    this.emit('hitl:pause', { phase, checkpoint });

    const handler = this.hitl?.handler ?? createInteractiveHandler();
    const response = await handler(checkpoint);

    this.emit('hitl:resume', { phase, action: response.action });

    return response;
  }

  // --- Helpers ---

  /**
   * Generate with retry + fallback on empty response.
   */
  private async generateWithRetry(
    adapter: ProviderAdapter,
    prompt: string,
    system: string,
    fallback?: string,
  ): Promise<string> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await adapter.generate(prompt, system);
        if (result && result.trim().length > 0) return result;

        this.emit('warn', {
          message: `${adapter.name} returned empty response (attempt ${attempt + 1}/${MAX_RETRIES + 1})`,
          phase: 'generate',
        });

        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        }
      } catch (err) {
        this.emit('warn', {
          message: `${adapter.name} error: ${err instanceof Error ? err.message : String(err)} (attempt ${attempt + 1}/${MAX_RETRIES + 1})`,
          phase: 'generate',
        });

        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }

    const fallbackText = fallback ?? `[${adapter.name} failed to respond after ${MAX_RETRIES + 1} attempts]`;
    this.emit('warn', {
      message: `${adapter.name} exhausted retries, using fallback`,
      phase: 'generate',
    });
    return fallbackText;
  }

  /**
   * Pick synthesizer: prefer the runner-up (2nd place) to reduce bias.
   */
  private pickSynthesizer(votes: VoteResult): ProviderAdapter {
    const ranked = votes.rankings;
    const runnerUp = ranked.length >= 2 ? ranked[1].provider : ranked[0]?.provider;
    const adapter = this.adapters.find(a => a.name === runnerUp);
    if (adapter) {
      this.emit('synthesizer', { provider: adapter.name, reason: 'runner-up (bias reduction)' });
      return adapter;
    }
    return this.adapters[0];
  }

  private makeHookEnv(phaseName: string, extra?: Record<string, string>): HookEnv {
    return {
      QUORUM_PHASE: phaseName.toLowerCase(),
      QUORUM_SESSION: this.store.path,
      QUORUM_PROVIDERS: this.adapters.map(a => a.name).join(','),
      QUORUM_INPUT: this.deliberationInput.slice(0, 1000),
      ...extra,
    };
  }

  private async executeHook(hookName: string, extraEnv?: Record<string, string>): Promise<string> {
    if (this.noHooks) return '';
    const command = this.hooks[hookName];
    if (!command) return '';
    const phaseName = hookName.replace(/^(pre|post)-/, '');
    const env = this.makeHookEnv(phaseName, extraEnv);
    try {
      const output = await runHook(hookName, command, env);
      this.emit('hook', { name: hookName, command, output: output.trim() });
      return output;
    } catch (err) {
      this.emit('warn', { message: `Hook ${hookName} failed: ${err instanceof Error ? err.message : String(err)}` });
      return '';
    }
  }

  private async runPhase(
    fileKey: string,
    phaseName: string,
    fn: () => Promise<Record<string, string>>,
  ): Promise<PhaseOutput> {
    this.currentPhase = phaseName;

    // Pre-hook
    const phaseKey = phaseName.toLowerCase();
    await this.executeHook(`pre-${phaseKey}`);

    this.emit('phase', { phase: phaseName });
    const start = Date.now();
    const responses = await fn();
    const output: PhaseOutput = {
      phase: phaseName,
      timestamp: start,
      duration: Date.now() - start,
      responses,
    };
    try {
      await this.store.writePhase(fileKey, output);
    } catch (err) {
      this.emit('warn', { message: `Failed to write phase ${phaseName}: ${err instanceof Error ? err.message : err}` });
    }
    this.emit('phase:done', { phase: phaseName, duration: output.duration });

    // Collect phase for ledger
    this.collectedPhases.push({ name: phaseName, duration: output.duration, responses: output.responses });

    // Post-hook — write phase output to temp file for QUORUM_PHASE_OUTPUT
    const { writeFileSync, unlinkSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const tmpFile = join(tmpdir(), `quorum-phase-${phaseKey}-${Date.now()}.json`);
    try {
      writeFileSync(tmpFile, JSON.stringify(responses, null, 2), 'utf-8');
      await this.executeHook(`post-${phaseKey}`, { QUORUM_PHASE_OUTPUT: tmpFile });
    } finally {
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
    }

    return output;
  }

  /**
   * Run fn for all adapters in parallel, with retry/fallback per adapter.
   */
  private async parallel(
    fn: (adapter: ProviderAdapter, index: number) => Promise<string>,
    fallbacks?: Record<string, string>,
  ): Promise<Record<string, string>> {
    const results = await Promise.all(
      this.adapters.map(async (adapter, i) => {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            const result = await fn(adapter, i);
            if (result && result.trim().length > 0) {
              this.emit('response', { provider: adapter.name });
              return [adapter.name, result] as const;
            }

            this.emit('warn', {
              message: `${adapter.name} returned empty (attempt ${attempt + 1}/${MAX_RETRIES + 1})`,
            });

            if (attempt < MAX_RETRIES) {
              await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
            }
          } catch (err) {
            this.emit('warn', {
              message: `${adapter.name} error: ${err instanceof Error ? err.message : String(err)} (attempt ${attempt + 1}/${MAX_RETRIES + 1})`,
            });

            if (attempt < MAX_RETRIES) {
              await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
            }
          }
        }

        const fallback = fallbacks?.[adapter.name]
          ?? `[${adapter.name} failed to respond after ${MAX_RETRIES + 1} attempts]`;
        this.emit('warn', {
          message: `${adapter.name} exhausted retries, using fallback`,
        });
        this.emit('response', { provider: adapter.name, fallback: true });
        return [adapter.name, fallback] as const;
      }),
    );
    return Object.fromEntries(results);
  }

  /**
   * Generate with streaming if available, falling back to non-streaming.
   */
  private async generateStreaming(
    adapter: ProviderAdapter,
    prompt: string,
    system: string,
  ): Promise<string> {
    if (this.streaming && adapter.generateStream) {
      return adapter.generateStream(prompt, system, (delta) => {
        this.onStreamDelta(adapter.name, this.currentPhase, delta);
      });
    }
    return adapter.generate(prompt, system);
  }

  private budgetFor(adapterIndex: number): number {
    const config = this.providerConfigs[adapterIndex];
    const sysTokens = 500;
    return availableInput(config.provider, sysTokens);
  }

  private tallyVotes(voteEntries: Record<string, string>): VoteResult {
    const n = this.adapters.length;
    const labels = this.adapters.map((_, idx) => String.fromCharCode(65 + idx));
    const scores: Record<string, number> = {};
    const details: Record<string, { ranks: number[]; rationale: string }> = {};

    // Build a map from position letter to provider name for self-vote detection
    const letterToProvider: Record<string, string> = {};
    for (let idx = 0; idx < this.adapters.length; idx++) {
      letterToProvider[labels[idx]] = this.adapters[idx].name;
    }

    for (const adapter of this.adapters) {
      scores[adapter.name] = 0;
      details[adapter.name] = { ranks: [], rationale: '' };
    }

    /**
     * Try to identify which position a line refers to.
     */
    const identifyPosition = (line: string): string | undefined => {
      const lower = line.toLowerCase();

      for (let li = 0; li < labels.length; li++) {
        const label = labels[li];
        const patterns = [
          new RegExp(`(?:Position\\s+)?(?:\\*\\*|"|')?${label}(?:\\*\\*|"|')?(?:\\s|\\.|—|-|:|,|\\))`, 'i'),
          new RegExp(`\\bposition\\s+${label}\\b`, 'i'),
        ];
        for (const pat of patterns) {
          if (pat.test(line)) return this.adapters[li].name;
        }
      }

      const posNum = line.match(/Position\s+#?(\d+)/i);
      if (posNum) {
        const idx = parseInt(posNum[1]) - 1;
        if (idx >= 0 && idx < n) return this.adapters[idx].name;
      }

      for (const adapter of this.adapters) {
        const name = adapter.name.toLowerCase();
        if (lower.includes(`[${name}]`) || lower.includes(`(${name})`) ||
            new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)) {
          return adapter.name;
        }
      }

      return undefined;
    };

    for (const [voter, voteText] of Object.entries(voteEntries)) {
      const text = voteText;
      const assigned = new Set<string>();

      // Try JSON parsing first
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*"rankings"[\s\S]*\})/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1].trim());
          const rankings: Array<{ position: string; rank: number }> = parsed.rankings ?? parsed;
          if (Array.isArray(rankings) && rankings.length > 0) {
            for (const entry of rankings) {
              const letter = String(entry.position).toUpperCase();
              const targetName = letterToProvider[letter];
              if (targetName && !assigned.has(targetName)) {
                const rank = entry.rank;
                let scoreContribution = n - rank + 1;
                // Evidence weight in strict mode
                if (this.profile.evidence === 'strict') {
                  const evReport = this.evidenceReports.find(r => r.provider === targetName);
                  if (evReport) {
                    scoreContribution *= (0.5 + 0.5 * evReport.weightedScore);
                  }
                }
                // Self-vote bias: 0.5x weight when voting for own position, stacks with provider weight
                const selfDiscount = (voter === targetName) ? 0.5 : 1;
                const providerWeight = this.weights[targetName] ?? 1;
                const weight = selfDiscount * providerWeight;
                scores[targetName] += scoreContribution * weight;
                details[targetName].ranks.push(rank);
                assigned.add(targetName);
              }
            }
          }
        } catch {
          // JSON parse failed, fall through to regex
        }
      }

      // Fallback: regex-based parsing
      if (assigned.size === 0) {
        const lines = text.split('\n');
        let rank = 1;

        for (const line of lines) {
          const rankMatch = line.match(/^\s*(?:#?\s*)?(\d+)[\.\)\-:\s]\s*/);
          if (!rankMatch) continue;

          const lineRank = parseInt(rankMatch[1]);
          const effectiveRank = (lineRank >= 1 && lineRank <= n) ? lineRank : rank;
          if (effectiveRank > n) continue;

          const targetName = identifyPosition(line.slice(rankMatch[0].length));
          if (targetName && !assigned.has(targetName)) {
            let scoreContribution = n - effectiveRank + 1;
            // Evidence weight in strict mode
            if (this.profile.evidence === 'strict') {
              const evReport = this.evidenceReports.find(r => r.provider === targetName);
              if (evReport) {
                scoreContribution *= (0.5 + 0.5 * evReport.weightedScore);
              }
            }
            // Self-vote bias: 0.5x weight when voting for own position, stacks with provider weight
            const selfDiscount = (voter === targetName) ? 0.5 : 1;
            const providerWeight = this.weights[targetName] ?? 1;
            const weight = selfDiscount * providerWeight;
            scores[targetName] += scoreContribution * weight;
            details[targetName].ranks.push(effectiveRank);
            assigned.add(targetName);
            rank++;
          }
        }
      }

      // Pass 2: Fallback heuristic — look for "best"/"worst"/"winner" keywords
      if (assigned.size === 0) {
        const bestPatterns = [/\bbest\b.*?\b(position\s+)?([A-Z])\b/i, /\bwinner\b.*?\b(position\s+)?([A-Z])\b/i, /\brecommend\b.*?\b(position\s+)?([A-Z])\b/i, /\bprefer\b.*?\b(position\s+)?([A-Z])\b/i];
        for (const pat of bestPatterns) {
          const m = text.match(pat);
          if (m) {
            const letter = (m[2] || '').toUpperCase();
            const idx = letter.charCodeAt(0) - 65;
            if (idx >= 0 && idx < n) {
              const name = this.adapters[idx].name;
              let heuristicScore = n;
              if (this.profile.evidence === 'strict') {
                const evReport = this.evidenceReports.find(r => r.provider === name);
                if (evReport) heuristicScore *= (0.5 + 0.5 * evReport.weightedScore);
              }
              const selfDiscount = (voter === name) ? 0.5 : 1;
              const providerWeight = this.weights[name] ?? 1;
              const weight = selfDiscount * providerWeight;
              scores[name] += heuristicScore * weight;
              details[name].ranks.push(1);
              assigned.add(name);
              break;
            }
          }
        }

        if (assigned.size === 0) {
          for (const adapter of this.adapters) {
            const nameRegex = new RegExp(`\\b${adapter.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b.*\\b(?:best|winner|top|first)\\b|\\b(?:best|winner|top|first)\\b.*\\b${adapter.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            if (nameRegex.test(text)) {
              let heuristicScore2 = n;
              if (this.profile.evidence === 'strict') {
                const evReport = this.evidenceReports.find(r => r.provider === adapter.name);
                if (evReport) heuristicScore2 *= (0.5 + 0.5 * evReport.weightedScore);
              }
              const selfDiscount = (voter === adapter.name) ? 0.5 : 1;
              const providerWeight = this.weights[adapter.name] ?? 1;
              const weight = selfDiscount * providerWeight;
              scores[adapter.name] += heuristicScore2 * weight;
              details[adapter.name].ranks.push(1);
              assigned.add(adapter.name);
              break;
            }
          }
        }
      }

      if (assigned.size === 0) {
        this.emit('warn', { message: `${voter} failed to produce parseable rankings`, phase: 'VOTE' });
      }

      details[voter] = { ...details[voter], rationale: text.slice(0, 500) };
    }

    // Build Ballot[] from parsed data for pluggable voting methods
    const ballots: Ballot[] = [];
    for (const [voter, voteText] of Object.entries(voteEntries)) {
      const voterDetails = details[voter];
      if (!voterDetails) continue;
      // Reconstruct rankings from what we parsed into details
      // We need per-voter ranking data — rebuild from the assigned data
      const voterRankings: Array<{ provider: string; rank: number }> = [];
      // Use the details ranks we collected — but we need per-provider per-voter ranks
      // Re-parse from assigned sets per voter (stored above in the scoring loop)
      // For simplicity with the existing code, build ballots from scores directly
    }

    // Build ballots from the parsed vote data by re-extracting per-voter rankings
    const parsedBallots = this.extractBallots(voteEntries, labels, letterToProvider);

    const votingMethod = this.profile.votingMethod ?? 'borda';

    if (votingMethod === 'borda') {
      // Use original weighted Borda logic (preserves self-vote discount and provider weights)
      const rankings = Object.entries(scores)
        .map(([provider, score]) => ({ provider, score }))
        .sort((a, b) => b.score - a.score);

      const controversial = rankings.length >= 2 &&
        Math.abs(rankings[0].score - rankings[1].score) <= 1;

      return {
        rankings,
        winner: rankings[0]?.provider ?? this.adapters[0].name,
        controversial,
        details,
        votingDetails: `Borda count (weighted). ${rankings.map(r => `${r.provider}: ${r.score.toFixed(1)} pts`).join(', ')}.`,
      };
    }

    // Use pluggable voting method
    const votingResult = tallyWithMethod(parsedBallots, votingMethod);

    const controversial = votingResult.rankings.length >= 2 &&
      Math.abs(votingResult.rankings[0].score - votingResult.rankings[1].score) <= 1;

    return {
      rankings: votingResult.rankings,
      winner: votingResult.winner || this.adapters[0].name,
      controversial,
      details,
      votingDetails: votingResult.details,
    };
  }

  /**
   * Extract structured Ballot[] from raw vote text responses.
   */
  private extractBallots(
    voteEntries: Record<string, string>,
    labels: string[],
    letterToProvider: Record<string, string>,
  ): Ballot[] {
    const n = this.adapters.length;
    const ballots: Ballot[] = [];

    for (const [voter, voteText] of Object.entries(voteEntries)) {
      const rankings: Array<{ provider: string; rank: number }> = [];
      const assigned = new Set<string>();

      // Try JSON parsing first
      const jsonMatch = voteText.match(/```(?:json)?\s*([\s\S]*?)```/) || voteText.match(/(\{[\s\S]*"rankings"[\s\S]*\})/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1].trim());
          const entries: Array<{ position: string; rank: number }> = parsed.rankings ?? parsed;
          if (Array.isArray(entries) && entries.length > 0) {
            for (const entry of entries) {
              const letter = String(entry.position).toUpperCase();
              const targetName = letterToProvider[letter];
              if (targetName && !assigned.has(targetName)) {
                rankings.push({ provider: targetName, rank: entry.rank });
                assigned.add(targetName);
              }
            }
          }
        } catch { /* fall through */ }
      }

      // Fallback: regex-based parsing
      if (assigned.size === 0) {
        const lines = voteText.split('\n');
        let rank = 1;
        for (const line of lines) {
          const rankMatch = line.match(/^\s*(?:#?\s*)?(\d+)[\.\)\-:\s]\s*/);
          if (!rankMatch) continue;
          const lineRank = parseInt(rankMatch[1]);
          const effectiveRank = (lineRank >= 1 && lineRank <= n) ? lineRank : rank;
          if (effectiveRank > n) continue;

          // Identify position from line
          const rest = line.slice(rankMatch[0].length);
          let targetName: string | undefined;
          for (let li = 0; li < labels.length; li++) {
            const pat = new RegExp(`(?:Position\\s+)?(?:\\*\\*|"|')?${labels[li]}(?:\\*\\*|"|')?(?:\\s|\\.|—|-|:|,|\\))`, 'i');
            if (pat.test(rest)) { targetName = this.adapters[li].name; break; }
          }
          if (!targetName) {
            for (const adapter of this.adapters) {
              if (rest.toLowerCase().includes(adapter.name.toLowerCase())) {
                targetName = adapter.name;
                break;
              }
            }
          }

          if (targetName && !assigned.has(targetName)) {
            rankings.push({ provider: targetName, rank: effectiveRank });
            assigned.add(targetName);
            rank++;
          }
        }
      }

      if (rankings.length > 0) {
        ballots.push({ voter, rankings });
      }
    }

    return ballots;
  }

  /**
   * Measure convergence between positions using Jaccard similarity of key terms.
   */
  private measureConvergence(entries: Record<string, string>): number {
    const positions = Object.values(entries)
      .map(v => v.toLowerCase())
      .filter(v => v.length > 0);
    if (positions.length < 2) return 1;

    const extractTerms = (text: string): Set<string> => {
      const words = text.match(/\b[a-z]{5,}\b/g) ?? [];
      return new Set(words);
    };

    const termSets = positions.map(extractTerms);
    let totalSimilarity = 0;
    let pairs = 0;

    for (let i = 0; i < termSets.length; i++) {
      for (let j = i + 1; j < termSets.length; j++) {
        const intersection = new Set([...termSets[i]].filter(t => termSets[j].has(t)));
        const union = new Set([...termSets[i], ...termSets[j]]);
        totalSimilarity += union.size > 0 ? intersection.size / union.size : 0;
        pairs++;
      }
    }

    return pairs > 0 ? totalSimilarity / pairs : 0;
  }

  private prompt(phase: string, fallback: string, adapterName?: string): string {
    const custom = this.profile.prompts?.[phase as keyof typeof this.profile.prompts];
    let base: string;
    if (custom && 'system' in custom) {
      base = this.interpolate(custom.system);
    } else {
      base = fallback;
    }
    if (adapterName && this.profile.roles?.[adapterName]) {
      return `You are acting as a ${this.profile.roles[adapterName]}. Bring this perspective to all your responses.\n\n${base}`;
    }
    return base;
  }

  private interpolate(template: string): string {
    return template
      .replace(/\{\{focus\}\}/g, this.profile.focus.join(', '))
      .replace(/\{\{challengeStyle\}\}/g, this.profile.challengeStyle)
      .replace(/\{\{rounds\}\}/g, String(this.profile.rounds))
      .replace(/\{\{name\}\}/g, this.profile.name);
  }

  /**
   * Head-to-head debate between two providers with an optional judge.
   * Phase 1: Both generate independently
   * Phase 2: Each critiques the other
   * Phase 3: Judge produces structured comparison
   */
  static async versus(
    input: string,
    adapter1: ProviderAdapter,
    adapter2: ProviderAdapter,
    judge?: ProviderAdapter,
    onEvent?: (event: string, data: unknown) => void,
  ): Promise<string> {
    const emit = onEvent ?? (() => {});
    const judgeAdapter = judge ?? adapter1;

    // Phase 1: Independent answers
    emit('phase', { phase: 'INDEPENDENT ANSWERS' });
    const [answer1, answer2] = await Promise.all([
      adapter1.generate(input, 'Give your best, thorough answer to the following question.'),
      adapter2.generate(input, 'Give your best, thorough answer to the following question.'),
    ]);
    emit('response', { provider: adapter1.name });
    emit('response', { provider: adapter2.name });
    emit('phase:done', { phase: 'INDEPENDENT ANSWERS', duration: 0 });

    // Phase 2: Cross-critiques
    emit('phase', { phase: 'CROSS-CRITIQUE' });
    const [critique1, critique2] = await Promise.all([
      adapter1.generate(
        `Original question: ${input}\n\nHere is another expert's answer:\n\n${answer2}\n\nCritique this answer. What are its strengths and weaknesses? What did it miss or get wrong?`,
        `You are a critical reviewer. Be specific and fair in your critique.`,
      ),
      adapter2.generate(
        `Original question: ${input}\n\nHere is another expert's answer:\n\n${answer1}\n\nCritique this answer. What are its strengths and weaknesses? What did it miss or get wrong?`,
        `You are a critical reviewer. Be specific and fair in your critique.`,
      ),
    ]);
    emit('response', { provider: adapter1.name });
    emit('response', { provider: adapter2.name });
    emit('phase:done', { phase: 'CROSS-CRITIQUE', duration: 0 });

    // Phase 3: Judge comparison
    emit('phase', { phase: 'JUDGMENT' });
    const comparison = await judgeAdapter.generate(
      [
        `Original question: ${input}`,
        `\n## ${adapter1.name}'s Answer:\n${answer1}`,
        `\n## ${adapter2.name}'s Answer:\n${answer2}`,
        `\n## ${adapter1.name}'s Critique of ${adapter2.name}:\n${critique1}`,
        `\n## ${adapter2.name}'s Critique of ${adapter1.name}:\n${critique2}`,
        `\nProduce a structured comparison with these sections:`,
        `## Where They Agree`,
        `## Where They Differ`,
        `## Stronger Arguments`,
        `(For each difference, note which argument is stronger and why)`,
        `## Overall Assessment`,
        `(Which answer is better overall, and why)`,
      ].join('\n'),
      `You are an impartial judge comparing two expert answers. Be specific, fair, and decisive.`,
    );
    emit('response', { provider: judgeAdapter.name });
    emit('phase:done', { phase: 'JUDGMENT', duration: 0 });

    return comparison;
  }

  /**
   * Write to session index manifest for fast history lookups.
   */
  private async writeSessionIndex(question: string, winner: string, duration: number): Promise<void> {
    const { readFile, writeFile, rename, mkdir } = await import('node:fs/promises');
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { homedir } = await import('node:os');

    const dir = join(homedir(), '.quorum', 'sessions');
    const indexPath = join(dir, 'index.json');
    const tmpPath = join(dir, `index.json.${process.pid}.tmp`);
    await mkdir(dir, { recursive: true });

    let entries: Array<{ sessionId: string; timestamp: number; question: string; winner: string; duration: number }> = [];
    if (existsSync(indexPath)) {
      try {
        entries = JSON.parse(await readFile(indexPath, 'utf-8'));
      } catch {
        entries = [];
      }
    }

    entries.push({
      sessionId: this.store.path.split('/').pop()!,
      timestamp: this.startedAt,
      question: question.slice(0, 100),
      winner,
      duration,
    });

    await writeFile(tmpPath, JSON.stringify(entries, null, 2), 'utf-8');
    await rename(tmpPath, indexPath);
  }
}
