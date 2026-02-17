import type { Command } from 'commander';
import pc from 'picocolors';
import { listOAuthProfiles, removeOAuthProfile, startDeviceFlow } from '../auth.js';

export function registerAuthCommand(program: Command): void {
  const authCmd = program.command('auth').description('Manage OAuth authentication');

  authCmd
    .command('login <provider>')
    .description('OAuth device flow login')
    .option('--client-id <id>', 'Custom OAuth client ID')
    .action(async (provider: string, opts) => {
      try {
        const flow = await startDeviceFlow(provider, opts.clientId as string | undefined);
        console.log('');
        console.log(pc.bold('🔐 OAuth Login'));
        console.log(`  Open: ${pc.cyan(flow.verificationUrl)}`);
        console.log(`  Code: ${pc.bold(pc.yellow(flow.userCode))}`);
        console.log('');
        console.log('Waiting for authorization...');
        const token = await flow.poll();
        if (token) {
          console.log(pc.green(`✅ Authenticated with ${provider}`));
        } else {
          console.log(pc.red('❌ Authorization expired or denied'));
        }
      } catch (err) {
        console.error(pc.red(`Error: ${err instanceof Error ? err.message : err}`));
      }
    });

  authCmd
    .command('list')
    .description('List stored OAuth tokens')
    .action(async () => {
      const tokens = await listOAuthProfiles();
      const entries = Object.entries(tokens);
      if (entries.length === 0) {
        console.log(pc.dim('No OAuth tokens. Use: quorum auth login <provider>'));
        return;
      }
      for (const [name, token] of entries) {
        const expired = token.expiresAt && Date.now() > token.expiresAt;
        console.log(`  ${pc.bold(name)} — ${expired ? pc.red('expired') : pc.green('active')}`);
      }
    });

  authCmd
    .command('logout <provider>')
    .description('Remove OAuth token')
    .action(async (provider: string) => {
      await removeOAuthProfile(provider);
      console.log(pc.green(`✅ Removed ${provider}`));
    });
}
