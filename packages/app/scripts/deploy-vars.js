/**
 * `pnpm run deploy:vars` — deploy, carrying every line of `.deploy.vars` as a Worker var.
 *
 * the bulk path for the seventeen values a deployment is configured with
 * (`@better-giving/operator/deploy-split`). every one of them is a plain var, and a var is set by a
 * flag on the deploy — so this is `pnpm run deploy` with one `--var NAME:value` appended per line,
 * and the whole file lands in one deploy rather than seventeen.
 *
 * why a script rather than a line an operator types. seventeen `--var` flags typed out put a live
 * Stripe key and the dashboard password in a shell history, and the file is where those values
 * already are. spawned with an argument list and no shell, a value never passes through one:
 * quoting, `#`, backslashes and spaces reach wrangler exactly as the file holds them. the file's own
 * outer quotes are stripped here, which is what DEPLOY.md tells an operator to write.
 *
 * the flags reach `wrangler deploy` because it is the last command in the `deploy` chain and pnpm
 * appends to the end — the same property DEPLOY.md states for a hand-typed `--var`. everything in
 * front of it still runs: the build, the preflight, then the migration that is the one-way door.
 *
 * it deploys the top-level environment and there is no `--env` of its own. the environment is
 * decided at build time by `CLOUDFLARE_ENV` (packages/app/wrangler.jsonc), which this script does
 * not set, so a rehearsal deployment is configured a value at a time with `pnpm run deploy:test
 * --var` — DEPLOY.md says so where it says how to make one.
 *
 * `.deploy.vars` is gitignored and holds this deployment's real credentials in plain text;
 * src/lib/server/config/deploy-vars.file.spec.ts reads the path out of this script's own arguments
 * in package.json and holds git to refusing it.
 *
 * no dependencies, on purpose: plain node.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `NAME=value`, with the value optionally wrapped in one pair of single or double quotes. */
const LINE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/**
 * the file, as pairs, in the order it holds them.
 *
 * a line that parses as nothing is an error and never a skip. a silent skip is the one failure this
 * errand cannot survive: the deploy succeeds, the operator reads no complaint, and one of the
 * values is simply not on the deployment — which reads at runtime exactly like a value that was
 * never meant to be set.
 */
export function pairs(text, file) {
	const found = [];
	for (const [index, raw] of text.split('\n').entries()) {
		const line = raw.trim();
		if (line === '' || line.startsWith('#')) continue;
		const match = LINE.exec(line);
		if (!match) throw new Error(`${file}:${index + 1} is not \`NAME=value\`: ${line}`);
		const [, name, rest] = match;
		const quoted = /^'(.*)'$/s.exec(rest) ?? /^"(.*)"$/s.exec(rest);
		found.push([name, quoted ? quoted[1] : rest.trim()]);
	}
	return found;
}

/**
 * `pnpm run deploy:vars <file>`, with anything after the file passed through to the deploy.
 *
 * `readFile` and `spawn` are injected so the spec beside this file can exercise the parse and read
 * the argument list without a deploy — which is the one thing a test of this script may never do.
 */
export function main(argv, { readFile = read, spawn = spawnSync, say = console.error } = {}) {
	const [file, ...rest] = argv;
	if (!file) {
		say('deploy-vars.js needs the path of the file to read, as its first argument.');
		return 1;
	}

	let text;
	try {
		text = readFile(file);
	} catch {
		say(`${file} is not there. DEPLOY.md, "Configuration values", has the lines it holds.`);
		return 1;
	}

	let values;
	try {
		values = pairs(text, file);
	} catch (error) {
		say(error instanceof Error ? error.message : String(error));
		return 1;
	}

	if (values.length === 0) {
		say(`${file} holds no values, so this deploy would carry none.`);
		return 1;
	}

	// names only. the values are what this script exists to keep off a terminal.
	say(`deploying with ${values.length} vars: ${values.map(([name]) => name).join(', ')}`);

	const flags = values.flatMap(([name, value]) => ['--var', `${name}:${value}`]);
	const result = spawn('pnpm', ['run', 'deploy', ...flags, ...rest], { stdio: 'inherit' });
	if (result.error) {
		say(`could not run \`pnpm run deploy\`: ${result.error.message}`);
		return 1;
	}
	return result.status ?? 1;
}

function read(file) {
	return readFileSync(resolve(process.cwd(), file), 'utf8');
}

// `pnpm run deploy:vars` runs this file and the spec beside it imports it, so the run is guarded: an
// unconditional one would fire on import and take the test process's exit code with it.
if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
