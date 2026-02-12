import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

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

export async function getPrDiff(prNumber: string): Promise<{ diff: string; title: string; body: string }> {
  try {
    const [viewResult, diffResult] = await Promise.all([
      execFile('gh', ['pr', 'view', prNumber, '--json', 'title,body']),
      execFile('gh', ['pr', 'diff', prNumber]),
    ]);

    const meta = JSON.parse(viewResult.stdout) as { title: string; body: string };
    return {
      title: meta.title,
      body: meta.body ?? '',
      diff: diffResult.stdout,
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
