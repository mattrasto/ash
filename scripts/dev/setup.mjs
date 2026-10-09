import { spawnSync } from 'node:child_process';
const install = spawnSync('pnpm', ['install', '--frozen-lockfile', '--prod=false'], { stdio: 'inherit' });
if (install.status !== 0) process.exit(install.status ?? 1);
const setup = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/dev/cli.ts', 'setup', ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(setup.status ?? 1);
