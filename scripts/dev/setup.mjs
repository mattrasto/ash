import { spawnSync } from 'node:child_process';
if (!process.argv.includes('--json')) console.log('Installing dependencies…');
const install = spawnSync('pnpm', ['install', '--frozen-lockfile', '--prod=false', '--reporter=append-only', '--loglevel=warn'], { stdio: ['inherit', 'pipe', 'inherit'] });
// Hide routine install output, but retain warning context and all failure diagnostics on stderr.
if (install.stdout?.length && (install.status !== 0 || /\bWARN\b/.test(install.stdout.toString()))) process.stderr.write(install.stdout);
if (install.error) console.error(install.error.message);
if (install.status !== 0) process.exit(install.status ?? 1);
const setup = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/dev/cli.ts', 'setup', ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(setup.status ?? 1);
