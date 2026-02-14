/**
 * Session file manager — persists phase outputs to disk.
 * Each phase reads from files, not growing in-memory context.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { computePhaseHash, type HashChainEntry } from './integrity.js';

export interface PhaseOutput {
  phase: string;
  timestamp: number;
  duration: number;
  responses: Record<string, string>;
}

export class SessionStore {
  private dir: string;
  private hashChain: HashChainEntry[] = [];

  constructor(sessionId: string, baseDir?: string) {
    const base = baseDir ?? join(homedir(), '.quorum', 'sessions');
    this.dir = join(base, sessionId);
  }

  get path(): string {
    return this.dir;
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async writePhase(phase: string, data: PhaseOutput): Promise<void> {
    await writeFile(join(this.dir, `${phase}.json`), JSON.stringify(data, null, 2), 'utf-8');
    // Compute and append hash chain entry
    const previousHash =
      this.hashChain.length > 0 ? this.hashChain[this.hashChain.length - 1].hash : null;
    const hash = computePhaseHash(data, previousHash);
    this.hashChain.push({ phase: data.phase, hash, previousHash, timestamp: data.timestamp });
    await this.writeIntegrity();
  }

  async readPhase(phase: string): Promise<PhaseOutput | null> {
    const p = join(this.dir, `${phase}.json`);
    if (!existsSync(p)) return null;
    return JSON.parse(await readFile(p, 'utf-8'));
  }

  async writeMeta(meta: Record<string, unknown>): Promise<void> {
    await writeFile(join(this.dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
  }

  async writeSynthesis(synthesis: Record<string, unknown>): Promise<void> {
    await writeFile(join(this.dir, 'synthesis.json'), JSON.stringify(synthesis, null, 2), 'utf-8');
  }

  /** Persist the current hash chain to disk. */
  async writeIntegrity(): Promise<void> {
    await writeFile(
      join(this.dir, 'integrity.json'),
      JSON.stringify(this.hashChain, null, 2),
      'utf-8',
    );
  }

  /** Get the current hash chain. */
  getHashChain(): HashChainEntry[] {
    return [...this.hashChain];
  }
}
