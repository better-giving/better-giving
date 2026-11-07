// `pnpm design:check`: fails when a file copied from the design registry was edited, is missing,
// or is behind the registry. bg-design.json at the repository root lists the copied items.
//
// the `bg-design` CLI is one file the registry serves itself (https://design.better.giving/registry/cli.mjs,
// Node 24, no dependencies), so it is fetched into a temporary directory for each run rather than
// copied into this repository, where it would drift from the registry it checks against.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REGISTRY = process.env.BG_DESIGN_REGISTRY ?? 'https://design.better.giving/registry';
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
	const result = spawnSync(process.execPath, [cli, 'diff', '--check'], { stdio: 'inherit' });
	if (result.status === null) {
		console.error(
			`design:check could not run the bg-design CLI (${result.error?.message ?? `killed by ${result.signal}`}).`
		);
	}
	process.exitCode = result.status ?? 1;
} finally {
	rmSync(dir, { recursive: true, force: true });
}
