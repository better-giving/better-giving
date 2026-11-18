// `pnpm design:check`: fails when a file copied from the design registry was edited, is missing,
// or is behind the registry. bg-design.json at the repository root lists the copied items.
//
// two locks are checked. bg-design.json holds what packages/operator copied, and
// packages/form/bg-design.json holds what packages/form copied: the form may import nothing from
// packages/operator (AGENTS.md → Workspace), so it keeps its own copies beside its own source, and
// the CLI takes one `dir` per lock.
//
// `--strict` is what makes an item that is only behind the registry fail: without it `diff --check`
// warns and exits 0 for that case and fails only for an edited or missing file.
//
// the `bg-design` CLI is one file the registry serves itself (https://design.better.giving/registry/cli.mjs,
// Node 24, no dependencies), so it is fetched into a temporary directory for each run rather than
// copied into this repository, where it would drift from the registry it checks against.
//
// CI hands over its own copy in BG_DESIGN_CLI instead: a pinned version whose sha-256 it checked first
// (.github/workflows/ci.yml, the lines marked bg-design-cli-pin). a run without it fetches the newest CLI.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY = process.env.BG_DESIGN_REGISTRY ?? 'https://design.better.giving/registry';
// the CLI also takes a directory here; this wrapper takes a URL only, since it fetches the CLI from
// it over http whenever BG_DESIGN_CLI is unset.
if (!/^https?:\/\//.test(REGISTRY)) {
	console.error(
		`design:check needs BG_DESIGN_REGISTRY to be an http(s) URL; got ${JSON.stringify(REGISTRY)}.`
	);
	process.exit(1);
}
// the CLI resolves a lock's `dir` against the working directory, so every run starts at the root.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
// these two must exist: a deleted lock would otherwise drop out of the scan below and pass silently.
const REQUIRED_LOCKS = ['bg-design.json', join('packages', 'form', 'bg-design.json')];
const missing = REQUIRED_LOCKS.filter((lock) => !existsSync(join(ROOT, lock)));
if (missing.length > 0) {
	console.error(
		`design:check requires ${missing.join(' and ')}, which ${missing.length > 1 ? 'are' : 'is'} missing.`
	);
	process.exit(1);
}
// every other package that copies from the registry keeps its own bg-design.json, found here rather
// than listed, so a new package's lock is checked without anyone remembering to add it.
const LOCKS = ['.', ...readdirSync(join(ROOT, 'packages'))]
	.map((name) => join(name === '.' ? '' : join('packages', name), 'bg-design.json'))
	.filter((lock) => existsSync(join(ROOT, lock)));
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 24) {
	console.error(
		`design:check needs Node 24 or newer for the bg-design CLI; this is Node ${process.versions.node}. Switch with nvm or fnm and run it again.`
	);
	process.exit(1);
}
const CLI_URL = `${REGISTRY}/cli.mjs`;
// one deadline per attempt covers the connect, the headers and the body read, so a stalled connection
// fails here rather than hanging CI until its job timeout.
const FETCH_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 2_000;
const fail = (message) => {
	console.error(`design:check ${message}`);
	process.exit(1);
};
let source;
const PINNED_CLI = process.env.BG_DESIGN_CLI;
if (PINNED_CLI) {
	try {
		source = readFileSync(PINNED_CLI, 'utf8');
	} catch (error) {
		fail(`could not read the bg-design CLI at ${PINNED_CLI} (${error.code ?? error.message}).`);
	}
}
// one retry for a network error or a 5xx; a 4xx or a wrong body is not transient and fails at once.
// with a pinned CLI read above, source is already set and nothing is fetched.
for (let attempt = 1; source === undefined; attempt++) {
	let problem;
	try {
		const response = await fetch(CLI_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
		if (response.ok) {
			const body = await response.text();
			const type = response.headers.get('content-type') ?? '';
			// a captive portal or CDN error page answers 200 with html; it would run as the CLI.
			if (/html/i.test(type) || /^\s*</.test(body)) {
				fail(`got an HTML page, not the bg-design CLI script, from ${CLI_URL}.`);
			}
			source = body;
			break;
		}
		if (response.status < 500) {
			fail(`could not fetch the bg-design CLI: ${response.status} ${CLI_URL}`);
		}
		problem = `${response.status} ${CLI_URL}`;
	} catch (error) {
		problem = error.cause?.code ?? error.message;
	}
	if (attempt >= 2) {
		fail(
			`could not reach ${CLI_URL} (${problem}). It needs the network: reconnect and run it again.`
		);
	}
	await new Promise((done) => setTimeout(done, RETRY_DELAY_MS));
}
const dir = mkdtempSync(join(tmpdir(), 'bg-design-'));
try {
	const cli = join(dir, 'cli.mjs');
	writeFileSync(cli, source);
	for (const lock of LOCKS) {
		const result = spawnSync(
			process.execPath,
			[cli, 'diff', '--check', '--strict', '--lock', lock],
			{
				stdio: 'inherit',
				cwd: ROOT,
				// each lock's own `dir` is the truth; the CLI would let BG_DESIGN_DIR override it.
				env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'BG_DESIGN_DIR'))
			}
		);
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
