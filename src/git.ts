import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFile = promisify(execFileCb);

export async function getGitDiff(options: { staged?: boolean; ref?: string }): Promise<string> {
  const args = ['diff'];
  if (options.staged) {
    args.push('--cached');
  } else if (options.ref) {
    args.push(options.ref);
  }

  try {
    const { stdout } = await execFile('git', args);
    return stdout;
  } catch (err: unknown) {
    const msg = err instanceof Error ? (err as Error & { stderr?: string }).stderr || err.message : String(err);
    if (msg.includes('not a git repository')) {
      throw new Error('Not in a git repository.');
    }
    throw new Error(`git diff failed: ${msg}`);
  }
}

export async function getPrDiff(prNumber: string): Promise<{ diff: string; title: string; body: string; changedFiles: number }> {
  try {
    const [viewResult, diffResult] = await Promise.all([
      execFile('gh', ['pr', 'view', prNumber, '--json', 'title,body,changedFiles']),
      execFile('gh', ['pr', 'diff', prNumber]),
    ]);

    const meta = JSON.parse(viewResult.stdout) as { title: string; body: string; changedFiles: number };
    return {
      title: meta.title,
      body: meta.body ?? '',
      diff: diffResult.stdout,
      changedFiles: meta.changedFiles ?? 0,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? (err as Error & { stderr?: string }).stderr || err.message : String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      throw new Error('GitHub CLI (gh) not found. Install it from https://cli.github.com/');
    }
    throw new Error(`gh pr failed: ${msg}`);
  }
}

export async function getGitContext(): Promise<{ branch: string; repoName: string } | null> {
  try {
    const [branchResult, repoResult] = await Promise.all([
      execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
      execFile('git', ['rev-parse', '--show-toplevel']),
    ]);

    const branch = branchResult.stdout.trim();
    const repoPath = repoResult.stdout.trim();
    const repoName = repoPath.split('/').pop() ?? repoPath;

    return { branch, repoName };
  } catch {
    return null;
  }
}

// --- PR Integration Functions ---

export interface PrMetadata {
  title: string;
  body: string;
  author: string;
  branch: string;
  baseBranch: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  labels: string[];
  reviewers: string[];
  isDraft: boolean;
}

export async function ensureGhCli(): Promise<boolean> {
  try {
    await execFile('gh', ['auth', 'status']);
    return true;
  } catch {
    return false;
  }
}

export async function postPrComment(prNumber: string, body: string): Promise<void> {
  try {
    if (body.length > 4000) {
      const tmpFile = join(tmpdir(), `quorum-comment-${Date.now()}.md`);
      try {
        await writeFile(tmpFile, body, 'utf-8');
        await execFile('gh', ['pr', 'comment', prNumber, '--body-file', tmpFile]);
      } finally {
        await unlink(tmpFile).catch(() => {});
      }
    } else {
      await execFile('gh', ['pr', 'comment', prNumber, '--body', body]);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? (err as Error & { stderr?: string }).stderr || err.message : String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      throw new Error('GitHub CLI (gh) not found. Install it from https://cli.github.com/');
    }
    if (msg.includes('auth')) {
      throw new Error('GitHub CLI authentication failed. Run `gh auth login`.');
    }
    throw new Error(`Failed to post PR comment: ${msg}`);
  }
}

const QUORUM_LABEL_COLORS: Record<string, string> = {
  'quorum:approved': '0e8a16',
  'quorum:needs-discussion': 'fbca04',
  'quorum:concerning': 'e11d48',
};

export async function addPrLabels(prNumber: string, labels: string[]): Promise<void> {
  try {
    // Ensure labels exist
    await Promise.all(
      labels.map(async (label) => {
        const color = QUORUM_LABEL_COLORS[label] ?? 'ededed';
        try {
          await execFile('gh', ['label', 'create', label, '--color', color, '--force']);
        } catch {
          // ignore label creation failures
        }
      }),
    );

    const args = ['pr', 'edit', prNumber];
    for (const label of labels) {
      args.push('--add-label', label);
    }
    await execFile('gh', args);
  } catch (err: unknown) {
    const msg = err instanceof Error ? (err as Error & { stderr?: string }).stderr || err.message : String(err);
    throw new Error(`Failed to add PR labels: ${msg}`);
  }
}

export async function removePrLabels(prNumber: string, labels: string[]): Promise<void> {
  for (const label of labels) {
    try {
      await execFile('gh', ['pr', 'edit', prNumber, '--remove-label', label]);
    } catch {
      // Ignore errors if label doesn't exist on PR
    }
  }
}

export async function getPrMetadata(prNumber: string): Promise<PrMetadata> {
  try {
    const { stdout } = await execFile('gh', [
      'pr', 'view', prNumber, '--json',
      'title,body,author,headRefName,baseRefName,changedFiles,additions,deletions,labels,reviewRequests,isDraft',
    ]);

    const data = JSON.parse(stdout) as {
      title: string;
      body: string;
      author: { login: string };
      headRefName: string;
      baseRefName: string;
      changedFiles: number;
      additions: number;
      deletions: number;
      labels: Array<{ name: string }>;
      reviewRequests: Array<{ login?: string; name?: string }>;
      isDraft: boolean;
    };

    return {
      title: data.title,
      body: data.body ?? '',
      author: data.author?.login ?? '',
      branch: data.headRefName,
      baseBranch: data.baseRefName,
      changedFiles: data.changedFiles ?? 0,
      additions: data.additions ?? 0,
      deletions: data.deletions ?? 0,
      labels: (data.labels ?? []).map((l) => l.name),
      reviewers: (data.reviewRequests ?? []).map((r) => r.login ?? r.name ?? ''),
      isDraft: data.isDraft ?? false,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? (err as Error & { stderr?: string }).stderr || err.message : String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      throw new Error('GitHub CLI (gh) not found. Install it from https://cli.github.com/');
    }
    throw new Error(`Failed to get PR metadata: ${msg}`);
  }
}

export async function getPrChangedFiles(prNumber: string): Promise<string[]> {
  try {
    const { stdout } = await execFile('gh', ['pr', 'diff', prNumber, '--name-only']);
    return stdout.trim().split('\n').filter(Boolean);
  } catch (err: unknown) {
    const msg = err instanceof Error ? (err as Error & { stderr?: string }).stderr || err.message : String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      throw new Error('GitHub CLI (gh) not found. Install it from https://cli.github.com/');
    }
    throw new Error(`Failed to get PR changed files: ${msg}`);
  }
}
