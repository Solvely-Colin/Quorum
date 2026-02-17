import type { Command } from 'commander';
import chalk from 'chalk';
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
        console.log(chalk.bold('🔐 OAuth Login'));
        console.log(`  Open: ${chalk.cyan(flow.verificationUrl)}`);
        console.log(`  Code: ${chalk.bold.yellow(flow.userCode)}`);
        console.log('');
        console.log('Waiting for authorization...');
        const token = await flow.poll();
        if (token) {
          console.log(chalk.green(`✅ Authenticated with ${provider}`));
        } else {
          console.log(chalk.red('❌ Authorization expired or denied'));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
      }
    });

  authCmd
    .command('list')
    .description('List stored OAuth tokens')
    .action(async () => {
      const tokens = await listOAuthProfiles();
      const entries = Object.entries(tokens);
      if (entries.length === 0) {
        console.log(chalk.dim('No OAuth tokens. Use: quorum auth login <provider>'));
        return;
      }
      for (const [name, token] of entries) {
        const expired = token.expiresAt && Date.now() > token.expiresAt;
        console.log(
          `  ${chalk.bold(name)} — ${expired ? chalk.red('expired') : chalk.green('active')}`,
        );
      }
    });

  authCmd
    .command('logout <provider>')
    .description('Remove OAuth token')
    .action(async (provider: string) => {
      await removeOAuthProfile(provider);
      console.log(chalk.green(`✅ Removed ${provider}`));
    });
}
