/**
 * `pnpm run turnstile:keys` — this deployment's Turnstile pair, printed back.
 *
 * the keys are minted once, on somebody else's account, and the widget itself is the copy that
 * outlives the deployment: deleting a Worker takes every value it was configured with (DEPLOY.md).
 * so this is how an operator or a contributor gets the pair back — the alternative is creating a
 * second widget, which mints a second pair and puts the deployment on a widget carrying none of the
 * hostnames that were added to the first one by hand.
 *
 * two calls, because wrangler prints the pair in no single command: the secret is redacted from
 * `list` and `update` and is only ever returned by `get`, which takes the sitekey `list` is where
 * to read. so this lists, matches the widget by name, and gets that one.
 *
 * it reads and it may never do anything else. no create, no update, no rotate, no delete — a
 * script an operator runs to recover a key must not be one that can change what they are
 * recovering.
 *
 * stdout carries the two `.deploy.vars` lines and nothing else, so it can be appended to that file
 * or piped (DEPLOY.md states the file's shape). both belong in it: the pair is minted together and
 * both halves are stored the same way, as plain vars. everything conversational — which widget
 * matched, what to do when none did — goes to stderr, so a run being read on a terminal ends on the
 * two lines rather than on the sentence about them.
 *
 * no dependencies, on purpose: plain node.
 */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** a call that has to reach Cloudflare and back; longer than a page load and shorter than a wait. */
const TIMEOUT_MS = 30_000;

/** where an operator whose wrangler cannot do this any more finishes the errand by hand. */
const DASHBOARD = 'https://dash.cloudflare.com > Turnstile';

/**
 * the module the widget's name is stated in, read as text rather than imported.
 *
 * it is TypeScript and it imports through the `$lib` alias, which only the bundler resolves — so a
 * plain node script cannot load it, and the name is lifted out of its source instead. that keeps
 * one statement of the name across the app and this script: `scripts/turnstile-keys.spec.js` runs
 * against the exported constant, so a rename that this reader cannot follow is a failing test
 * rather than a script that quietly looks for a widget nobody has.
 */
const WIDGET_NAME_SOURCE = new URL('../src/lib/config/turnstile-widget.ts', import.meta.url);

/** the name of the widget this deployment's keys come from, as that module exports it. */
function widgetName() {
	const source = readFileSync(WIDGET_NAME_SOURCE, 'utf8');
	const match = source.match(/TURNSTILE_WIDGET_NAME\s*=\s*'([^']+)'/);
	return match?.[1];
}

/**
 * one wrangler call, as its exit code and both streams.
 *
 * `pnpm wrangler` and never a global or a bare `npx` (CLAUDE.md), so the version answering here is
 * the version `pnpm run deploy` uses. a non-zero exit is a value rather than a throw, because every
 * branch below reads what wrangler said about it.
 */
async function runWrangler(args) {
	try {
		const { stdout, stderr } = await execFileAsync('pnpm', ['wrangler', ...args], {
			timeout: TIMEOUT_MS
		});
		return { code: 0, stdout, stderr };
	} catch (err) {
		// `||` and not `??` on the stream: a wrangler that could not be spawned at all rejects with
		// both streams present and empty, and its message is then the only account of what happened.
		return {
			code: typeof err?.code === 'number' ? err.code : 1,
			stdout: err?.stdout ?? '',
			stderr: err?.stderr || String(err?.message ?? err)
		};
	}
}

/**
 * what a wrangler that refused says to do about it, printed and answered.
 *
 * three readings of one non-zero exit, because the three have nothing to do with each other: an
 * unauthenticated wrangler is a sign-in, a wrangler with no `turnstile` command is an errand that
 * has to finish on Cloudflare's own screen, and anything else is wrangler's own words plus both
 * ways on. the signals are read off wrangler's text, so a rewording lands in the third arm rather
 * than in the wrong one.
 */
function reportRefusal(what, result) {
	const said = `${result.stderr}\n${result.stdout}`.trim();
	console.error(`FAILED: \`pnpm wrangler turnstile widget ${what}\` came back refused.`);
	if (said) console.error(`  ${oneLine(said)}`);

	if (/unknown argument|unknown command/i.test(said)) {
		// `turnstile` is alpha in wrangler's own help, so the command going away is a case rather
		// than a fault, and the keys are still on the account either way.
		console.error(`  this wrangler has no \`turnstile\` command. read the pair at ${DASHBOARD},`);
		console.error('  on the widget’s own page.');
		return 1;
	}

	if (/credential|auth token|wrangler login|authenticat/i.test(said)) {
		console.error('  sign in first: `pnpm run login`. `pnpm run whoami` says which account.');
		return 1;
	}

	console.error('  `pnpm run whoami` says whether wrangler is signed in and to which account.');
	console.error(`  the pair is readable by hand at ${DASHBOARD}, on the widget’s own page.`);
	return 1;
}

/**
 * what wrangler printed, parsed, or `undefined` where it is not what this reads.
 *
 * `--json` suppresses wrangler's banner, so stdout is the value alone — and anything else is a
 * version printing a shape this script was not written against. `expected` decides one from the
 * other, since `list` returns an array and `get` returns one widget.
 */
function parsed(stdout, expected) {
	let value;
	try {
		value = JSON.parse(stdout);
	} catch {
		return undefined;
	}
	if (expected === 'list') return Array.isArray(value) ? value : undefined;
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

/** what an alpha command printing an unfamiliar shape leaves an operator to do. */
function reportShape(what) {
	console.error(`FAILED: wrangler’s \`turnstile widget ${what}\` printed something this script`);
	console.error('  cannot read. every turnstile subcommand is alpha and may change shape.');
	console.error(`  read the pair on the widget’s own page at ${DASHBOARD}.`);
	return 1;
}

/**
 * a key exactly as it can be written between single quotes, or `undefined`.
 *
 * `.deploy.vars` is parsed before upload and single quotes are what keep a value out of the
 * parser's way (DEPLOY.md), so a value carrying one is a line that would upload as something other
 * than the key. Cloudflare issues neither key with a character outside this set.
 */
function printable(value) {
	return typeof value === 'string' && /^[\w-]+$/.test(value) ? value : undefined;
}

/**
 * the whole run, against an injected wrangler so the spec beside this file can hold every branch
 * without an account, a login or a network.
 */
export async function main(run = runWrangler) {
	const name = widgetName();

	const list = await run(['turnstile', 'widget', 'list', '--json']);
	if (list.code !== 0) return reportRefusal('list', list);

	const widgets = parsed(list.stdout, 'list');
	if (!widgets) return reportShape('list');

	if (widgets.length === 0) {
		// nothing to recover, so this is the other errand entirely. the command that mints the pair
		// is built from the sites this deployment's forms may be used on, which live in its database
		// and not here — the console is where it is written out, filled in.
		console.error('FAILED: this Cloudflare account has no Turnstile widgets.');
		console.error('  there is no pair to print back; one has to be created.');
		console.error('  the console (`pnpm run console`), under Sites, writes out the command');
		console.error(`  that creates it against your listed sites — or create it at ${DASHBOARD}.`);
		return 1;
	}

	const matches = widgets.filter((widget) => widget?.name === name);

	if (matches.length === 0) {
		// the name is the whole of the match, so say which name and what is actually there. a widget
		// made by hand carries whatever name was typed into the dashboard, and renaming it there is
		// what this script is then able to find.
		const named = widgets.map((widget) => widget?.name).filter((each) => typeof each === 'string');
		console.error(`FAILED: no Turnstile widget on this account is named \`${name}\`.`);
		if (named.length > 0) console.error(`  what is there: ${named.join(', ')}.`);
		console.error(`  rename the deployment's widget to \`${name}\` at ${DASHBOARD}, or read its`);
		console.error('  keys off that screen. creating a second widget mints a second pair, and');
		console.error('  this deployment stores one.');
		return 1;
	}

	if (matches.length > 1) {
		// Cloudflare takes the same name twice and this deployment holds one pair, so the choice is
		// between two widgets that differ in the hostnames each authorises — which is a list only the
		// operator can see. picking one here would print keys for a widget their sites may not be on.
		console.error(`FAILED: this account has ${matches.length} widgets named \`${name}\`.`);
		console.error('  this deployment stores one pair, and which of them is right is the one');
		console.error(`  whose hostname list holds your sites — check them at ${DASHBOARD}.`);
		for (const match of matches) console.error(`    ${match.sitekey}`);
		console.error('  then read that one: `pnpm wrangler turnstile widget get <sitekey> --json`.');
		return 1;
	}

	// the sitekey is checked before it is passed rather than after: `get` takes it as a required
	// positional, so a listing that carries none is a call this script must not build at all.
	const listed = printable(matches[0].sitekey);
	if (!listed) return reportShape('list');

	const found = await run(['turnstile', 'widget', 'get', listed, '--json']);
	if (found.code !== 0) return reportRefusal('get', found);

	const widget = parsed(found.stdout, 'widget');
	const sitekey = printable(widget?.sitekey);
	const secret = printable(widget?.secret);
	// both or neither. a run that printed one line would be one an operator appends to
	// `.deploy.vars` without reading, leaving the deployment with half a pair — which is the state
	// where every donation is refused (`verifyTurnstile` in src/lib/server/api/turnstile.ts).
	if (!sitekey || !secret) return reportShape('get');

	// stderr first and stdout last, so a run whose output is being read on a terminal ends on the
	// two lines rather than on the sentence about them.
	console.error(`the widget named \`${name}\`, as this account holds it.`);
	console.error('  add both lines below to .deploy.vars, then `pnpm run deploy:vars`.');
	console.log(`TURNSTILE_SITE_KEY='${sitekey}'`);
	console.log(`TURNSTILE_SECRET_KEY='${secret}'`);
	return 0;
}

/** wrangler's own words, for a terminal: one short line, however many it printed. */
function oneLine(text) {
	const flat = text.replace(/\s+/g, ' ').trim();
	return flat.length > 160 ? `${flat.slice(0, 160)}…` : flat;
}

// `pnpm run turnstile:keys` runs this file and the spec beside it imports it, so the run is
// guarded: an unconditional one would fire on import and take the test process's exit code with it.
if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(await main());
