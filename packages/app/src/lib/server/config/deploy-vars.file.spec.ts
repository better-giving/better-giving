import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// the guard on "the file `pnpm run deploy:vars` reads can never be committed".
//
// why this file exists. all seventeen of a deployment's configuration values are plain Worker vars
// (`@better-giving/operator/deploy-split`), and a var is set by a flag on the deploy — so there is
// no prompt anywhere in this project that takes a value straight off a terminal. the bulk path
// reads a file instead, and that file holds a deployment's real ADMIN_PASSWORD, its Stripe secret
// key and its SMTP password in plain text, side by side. one `git add -A` from a hurried operator
// publishes the lot, and this repo is public.
//
// so the file is ignored, and this is what holds it ignored. an ignore rule is one line that
// carries no evidence of what depends on it — deleting it breaks nothing, `pnpm check` stays
// green, `pnpm test` stays green, and the only signal is a credential in somebody's diff.
//
// how it works: the path is read out of the `deploy:vars` script in package.json rather than
// spelled again here, so the thing under test is the path the command actually uploads. a script
// pointed at a new file with no ignore rule for it fails here, which is the whole point — the two
// have to move together.

// packages/app, not the workspace root: `deploy:vars` and the `.dev.vars*` family it could be
// pointed at both live here, so this is the package.json whose script the path is read out of. the
// `.gitignore` holding the rules those paths are checked against sits at the workspace root
// instead, and `git check-ignore` reaches it by walking up from this cwd.
const ROOT = resolve(import.meta.dirname, '../../../..');

/** the local development secrets file, which is a different file holding different values. */
const DEV_VARS = '.dev.vars';

/** the one tracked file in this family: names and published dummy values, never a real secret. */
const DEV_VARS_EXAMPLE = '.dev.vars.example';

function packageScripts(): Record<string, string> {
	const parsed: unknown = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
	const scripts =
		typeof parsed === 'object' && parsed !== null && 'scripts' in parsed
			? (parsed as { scripts: unknown }).scripts
			: undefined;
	return typeof scripts === 'object' && scripts !== null ? (scripts as Record<string, string>) : {};
}

/**
 * the file `deploy:vars` reads, taken from the script's own arguments.
 *
 * the script is `node scripts/deploy-vars.js <file>`, and that script refuses to run without the
 * positional — so a script with no path uploads nothing rather than uploading something else, and
 * it is read here as the absence it is.
 */
function bulkVarsFile(): string | null {
	const script = packageScripts()['deploy:vars'];
	if (script === undefined) return null;
	const words = script.trim().split(/\s+/);
	const positional = words.slice(2).find((word) => !word.startsWith('-'));
	return words.slice(0, 2).join(' ') === 'node scripts/deploy-vars.js'
		? (positional ?? null)
		: null;
}

/**
 * whether git refuses to track a path.
 *
 * `git check-ignore` answers with its exit status — 0 ignored, 1 not ignored — so a non-zero
 * status is the answer here and not a failure to report. it reads the rules rather than the
 * working tree, which is what makes this answerable for a file that is absent on a fresh clone
 * and present on the machine of whoever deploys.
 */
function isIgnored(path: string): boolean {
	const result = spawnSync('git', ['check-ignore', '-q', '--', path], { cwd: ROOT });
	if (result.status !== 0 && result.status !== 1) {
		throw new Error(`git check-ignore could not answer for ${path}: ${result.stderr}`);
	}
	return result.status === 0;
}

/** whether a path is in the index — the question an ignore rule does not answer on its own. */
function isTracked(path: string): boolean {
	const result = spawnSync('git', ['ls-files', '--', path], { cwd: ROOT, encoding: 'utf8' });
	if (result.status !== 0) {
		throw new Error(`git ls-files could not answer for ${path}: ${result.stderr}`);
	}
	return result.stdout.trim() !== '';
}

describe('the file behind deploy:vars', () => {
	// both probes above answer by shelling out, and both have a shape of failure that reads as
	// success: a git that is not there, a working directory that is not this repository, an index
	// that was never populated. a file known to be tracked and a file known to be ignored are
	// asserted first, so the assertions that follow cannot pass by finding nothing.
	it('is asked about through git commands that work', () => {
		expect(isTracked(DEV_VARS_EXAMPLE)).toBe(true);
		expect(isIgnored(DEV_VARS_EXAMPLE)).toBe(false);
		expect(isTracked(DEV_VARS)).toBe(false);
		expect(isIgnored(DEV_VARS)).toBe(true);
	});

	it('is named by the script, so there is a path to guard', () => {
		expect(bulkVarsFile()).not.toBeNull();
	});

	it('is refused by git', () => {
		const file = bulkVarsFile() ?? '';
		expect(
			isIgnored(file),
			`${file} is what \`pnpm run deploy:vars\` reads, so it holds this deployment's ADMIN_PASSWORD, Stripe secret key and SMTP password in plain text. Add it to .gitignore.`
		).toBe(true);
		expect(
			isTracked(file),
			`${file} is committed and holds every deploy-time value in plain text. Remove it from the index and rotate every value in it.`
		).toBe(false);
	});

	// the deploy file and the development file are never the same file. `.dev.vars` is filled from
	// `.dev.vars.example`, whose mail and Turnstile values are placeholders that reach nothing real
	// and whose ADMIN_PASSWORD is whatever was convenient to type on a laptop. deploying it would
	// put Cloudflare's public Turnstile test keys — which pass every visitor — in front of a live
	// payment-initiating `/api/v1`, and make a local password the staff credential.
	it('is not the local development file', () => {
		const file = bulkVarsFile() ?? '';
		expect(
			file === DEV_VARS || file.startsWith(`${DEV_VARS}.`),
			`deploy:vars reads ${file}, which is a local development file. Point it at a file holding the values this deployment runs on.`
		).toBe(false);
	});
});
