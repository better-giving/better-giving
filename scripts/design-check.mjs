// `pnpm design:check`: fails when a file copied from the design registry was edited, is missing,
// or is behind the registry. bg-design.json at the repository root lists the copied items.
//
// two locks are checked. bg-design.json holds what packages/operator copied, and
// packages/form/bg-design.json holds what packages/form copied: the form may import nothing from
// packages/operator (AGENTS.md → Workspace), so it keeps its own copies beside its own source, and
// the CLI takes one `dir` per lock.
//
// the `bg-design` CLI is one file the registry serves itself (https://design.better.giving/registry/cli.mjs,
// Node 24, no dependencies), so it is fetched into a temporary directory for each run rather than
// copied into this repository, where it would drift from the registry it checks against.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY = process.env.BG_DESIGN_REGISTRY ?? 'https://design.better.giving/registry';
// the CLI resolves a lock's `dir` against the working directory, so every run starts at the root.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
// every package that copies from the registry keeps its own bg-design.json, found here rather than
// listed, so a new package's lock is checked without anyone remembering to add it.
const LOCKS = ['.', ...readdirSync(join(ROOT, 'packages'))]
	.map((name) => join(name === '.' ? '' : join('packages', name), 'bg-design.json'))
	.filter((lock) => existsSync(join(ROOT, lock)));
if (LOCKS.length === 0) {
	console.error('design:check found no bg-design.json at the root or under packages/.');
	process.exit(1);
}
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 24) {
	console.error(
		`design:check needs Node 24 or newer for the bg-design CLI; this is Node ${process.versions.node}. Switch with nvm or fnm and run it again.`
	);
	process.exit(1);
}
// one deadline covers the connect, the headers and the body read below, so a stalled connection
// fails here rather than hanging CI until its job timeout.
const FETCH_TIMEOUT_MS = 30_000;
const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
const unreachable = (error) => {
	console.error(
		`design:check could not reach ${REGISTRY}/cli.mjs (${error.cause?.code ?? error.message}). It needs the network: reconnect and run it again.`
	);
	process.exit(1);
};
let response;
try {
	response = await fetch(`${REGISTRY}/cli.mjs`, { signal });
} catch (error) {
	unreachable(error);
}
if (!response.ok) {
	console.error(
		`design:check could not fetch the bg-design CLI: ${response.status} ${REGISTRY}/cli.mjs`
	);
	process.exit(1);
}
let source;
try {
	source = await response.text();
} catch (error) {
	unreachable(error);
}
const dir = mkdtempSync(join(tmpdir(), 'bg-design-'));
try {
	const cli = join(dir, 'cli.mjs');
	writeFileSync(cli, source);
	for (const lock of LOCKS) {
		const result = spawnSync(process.execPath, [cli, 'diff', '--check', '--lock', lock], {
			stdio: 'inherit',
			cwd: ROOT,
			// each lock's own `dir` is the truth; the CLI would let BG_DESIGN_DIR override it.
			env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'BG_DESIGN_DIR'))
		});
		if (result.status === null) {
			console.error(
				`design:check could not run the bg-design CLI (${result.error?.message ?? `killed by ${result.signal}`}).`
			);
		}
		// a failed lock does not stop the next one: one run reports every item that needs attention.
		process.exitCode = Math.max(process.exitCode ?? 0, result.status ?? 1);
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}
