/**
 * the preflight both `pnpm run deploy` and `pnpm run preview` run behind their build — is the
 * build about to be served the one this build produced, for the environment the command selected,
 * and is that environment bound to a database and its limiters?
 *
 * how a deploy finds the build. `vite build` runs `@cloudflare/vite-plugin`, which writes the
 * worker bundle and a *generated* wrangler config into `build/server/`, the client assets into
 * `build/client/`, and a *deploy configuration redirection* at `.wrangler/deploy/config.json` — a
 * file naming that generated config, which wrangler then loads in place of the one in the working
 * directory (https://developers.cloudflare.com/workers/wrangler/configuration/). so
 * `wrangler deploy` uploads what the generated config names and not what `wrangler.jsonc` does,
 * and the redirection is the only thing joining the two. it applies to `wrangler deploy`,
 * `wrangler dev` and `wrangler versions upload`, and to no other command — `d1 migrations apply`
 * in particular reads `wrangler.jsonc` directly.
 *
 * the first failure this refuses. neither `build/` nor `.wrangler/` is committed (.gitignore), so
 * a redirection left behind by another branch's build is invisible to `git status` and points at
 * that branch's output. `pnpm run deploy` builds first and every build rewrites both, which closes
 * that on its own — what is checked here is that the redirection actually names a config inside
 * this package's own build, with a bundle on disk. "the build did not run" and "the build wrote
 * somewhere else" answer the same way, and both are the reason this step sits behind `build`.
 *
 * the second failure, and it is the one that costs most. the environment is selected **at build
 * time**, by `CLOUDFLARE_ENV` — the plugin bakes it into the generated config as
 * `targetEnvironment` — while `wrangler deploy --env test` selects it at upload time. a build made
 * without `CLOUDFLARE_ENV=test` writes the top-level config: the worker named `better-giving`,
 * bound to the real database and the real limiters. wrangler does not refuse `--env test` against
 * it, because a redirected config carries no `env` block to miss — it falls back to what the
 * generated config holds, which is production. so a rehearsal deploy whose build forgot the
 * variable would deploy over the deployment donors are giving through, and report success. this
 * step compares the two and refuses when they disagree.
 *
 * the third failure. a named environment inherits `name` (suffixed), `main`, `assets`,
 * `compatibility_date`, `compatibility_flags` and `observability`, and inherits neither
 * `d1_databases` nor `ratelimits` nor `vars` — it holds only what it declares itself, and wrangler
 * answers a top-level block the environment does not repeat with a warning rather than an error.
 * so an environment missing one deploys, says so in a line that scrolls past, and then answers
 * every request without it: no `DB` is a worker whose every request 500s on the database, and a
 * missing limiter is quieter than that — `/api/v1` goes dark by name without API_RATE_LIMITER
 * while the quote and sign-in buckets fail open and meter nothing at all
 * (src/lib/server/api/rate-limit.ts). that block is read off `wrangler.jsonc`, which is the file
 * the migration step behind this one reads too. the same check reads the top level when no
 * environment is selected, because that is the environment a bare deploy selects.
 *
 * why the step sits here, between `build` and the migration apply, and must not move.
 *
 * behind `build`, because every check but the last reads a file only a finished build has written.
 *
 * in front of `wrangler d1 migrations apply DB --remote`, because that is the one-way door
 * (CLAUDE.md) and everything able to fail runs in front of it. the sharper reason is that the two
 * steps behind this one do not read the same config: the migration apply follows no redirection
 * and `wrangler deploy` does, so a mismatched pair migrates the database `wrangler.jsonc` names
 * and then uploads a worker built for another environment — a schema and a codebase from two
 * different deployments, with both commands reporting success. moved behind the migration step,
 * this guard would refuse only after that had already happened.
 *
 * `pnpm run preview` takes the same step for the first of those reasons and not the second.
 * `wrangler dev` follows the redirection exactly as `wrangler deploy` does, so a preview run off a
 * stale one serves another environment's build while the operator reads it as this branch's; there
 * is no one-way door behind it to get in front of, and nothing there is worth weakening a check
 * for. it selects no environment, so what it is held to is what a bare deploy is held to.
 *
 * what it does not do. it does not pass wrangler `--config`: the point is to stop a deploy nobody
 * has looked at, and a flag that quietly wins over a bad redirection leaves the bad file in place
 * to be honoured by the next `wrangler dev` or `versions upload` instead.
 *
 * no dependencies, on purpose: plain node — including for the embed check below, which counts
 * `build/client/embed/`'s files itself rather than importing `runtimeAssetPath` from
 * `@better-giving/form/embed/stamp`, which already states the same "exactly one" rule for
 * `scripts/stage-embed.js` to share. not reused here so that this file, sitting in front of the
 * one irreversible step `pnpm run deploy` takes, never depends on anything failing to install.
 *
 * the embed is counted in the client build rather than where it was staged, and that is the whole
 * chain in one check: `scripts/stage-embed.js` writes into `static/`, `vite build` copies that
 * directory into `build/client/` because ../vite.config.ts makes it the public directory, and
 * `build/client/` is what the generated config uploads as the worker's assets. `/embed.js` and the
 * runtime it points at are pasted into sites this project cannot reach, so a deploy that shipped
 * without them is not a bug anyone here would see — it is a 404 on every one of those sites,
 * silently, until someone reports a broken donation form.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** where wrangler looks for a deploy configuration redirection, relative to the config's own dir. */
const DEPLOY_CONFIG = join('.wrangler', 'deploy', 'config.json');

/** the config wrangler resolves from the working directory, which is where every deploy runs. */
const CONFIG = 'wrangler.jsonc';

/** the two paths the staged embed reaches, in the client build the generated config uploads. */
const EMBED_LOADER = join('build', 'client', 'embed.js');
const EMBED_RUNTIME_DIR = join('build', 'client', 'embed');

/** the database binding every server module in this app takes as `Db`. */
const DATABASE = 'DB';

/**
 * the three rate limiters a deployment has to be bound to, spelled as the code reads them off the
 * platform env (`src/lib/server/api/rate-limit.ts`).
 *
 * a third copy of these names, and the only one that is plain node: this file imports nothing, so
 * that the step in front of `pnpm run deploy`'s one irreversible command never depends on anything
 * failing to install. `src/lib/server/api/rate-limit.config.spec.ts` holds the same names — and
 * every number under them — against the config file, and runs at commit.
 */
const LIMITERS = ['API_RATE_LIMITER', 'QUOTE_RATE_LIMITER', 'SIGN_IN_RATE_LIMITER'];

/**
 * the whole check, against a root so the spec beside this file can hold every branch in a temp
 * directory — and never against this checkout's own `.wrangler/`, which is the state under test.
 *
 * `process.cwd()` rather than this file's own directory, because the working directory is what
 * wrangler resolves its config from and the guard has to be looking at the same place it will.
 *
 * `argv` for the same reason: the deploy script hands this step the same `--env` it hands the two
 * wrangler commands behind it, so the environment checked here is the environment deployed there.
 */
export function main(root = process.cwd(), argv = process.argv.slice(2)) {
	const config = readConfig(join(root, CONFIG));

	if (typeof config?.main !== 'string' || config.main === '') {
		// refused rather than skipped, because this step stands in front of a one-way door: "I could
		// not check" has to answer the same as "the check failed".
		//
		// read before the flag is answered below, because an unreadable config is not an unknown
		// environment and telling an operator it is sends them to fix the wrong thing.
		console.error(`FAILED: ${CONFIG} does not name a worker entry this can read.`);
		console.error('  a missing file, JSON that will not parse, or no `main` in it.');
		console.error(`  the build reads the same \`main\`, so fix ${CONFIG} before deploying.`);
		return 1;
	}

	const selected = selectedEnvironment(argv);
	const environments = Object.keys(config.env ?? {});

	if (selected === '') {
		console.error('FAILED: `--env` was given no environment name.');
		console.error(`  ${CONFIG} declares: ${environments.join(', ') || 'no environments'}.`);
		console.error('  drop the flag to deploy the top-level config, or name one it declares.');
		return 1;
	}

	if (selected !== null && !environments.includes(selected)) {
		console.error(`FAILED: ${CONFIG} declares no \`${selected}\` environment.`);
		console.error(`  it declares: ${environments.join(', ') || 'none'}.`);
		console.error('  the step behind this one migrates `DB`, and an unresolved environment');
		console.error('  leaves that binding pointing at the top-level database — the real one.');
		return 1;
	}

	const built = readBuild(root);

	if (built.error !== undefined) {
		console.error(`FAILED: ${built.error}`);
		console.error('  `wrangler deploy` uploads whatever the redirection at');
		console.error(`  ${DEPLOY_CONFIG} names, and the build is what writes both it and the`);
		console.error('  worker beside it. re-run `pnpm run deploy` from a clean tree, and read');
		console.error('  what `pnpm run build` says rather than what this step says.');
		return 1;
	}

	if ((built.config.targetEnvironment ?? null) !== selected) {
		const forDeploy = selected === null ? 'no environment' : `\`${selected}\``;
		const fromBuild =
			built.config.targetEnvironment === undefined
				? 'no environment'
				: `\`${built.config.targetEnvironment}\``;
		console.error(`FAILED: this deploy selects ${forDeploy} and the build was made for`);
		console.error(`  ${fromBuild}.`);
		console.error('  the environment is chosen at build time by `CLOUDFLARE_ENV`, and wrangler');
		console.error('  has no `env` block to resolve `--env` against once a redirection is in the');
		console.error('  way — so it would upload the build it was given and say nothing.');
		console.error('  fix: run the whole chain again through `pnpm run deploy` or');
		console.error('  `pnpm run deploy:test`, which set the variable and the flag together.');
		return 1;
	}

	if (!existsSync(join(root, EMBED_LOADER))) {
		console.error(`FAILED: ${EMBED_LOADER} does not exist.`);
		console.error('  `pnpm run build` stages the embed into static/ and copies that directory');
		console.error('  into the client build, and it did not land. re-run `pnpm run build` from a');
		console.error('  clean tree, and read what scripts/stage-embed.js says rather than what this');
		console.error('  step says.');
		return 1;
	}

	const runtimeFiles = existsSync(join(root, EMBED_RUNTIME_DIR))
		? readdirSync(join(root, EMBED_RUNTIME_DIR)).filter((name) => name.endsWith('.js'))
		: [];
	if (runtimeFiles.length !== 1) {
		console.error(
			`FAILED: ${EMBED_RUNTIME_DIR} holds ${runtimeFiles.length} runtime scripts, and every site`
		);
		console.error(`  that has pasted the embed snippet loads whichever one it is served — there`);
		console.error(
			'  must be exactly one. re-run `pnpm run build` from a clean tree; if this keeps'
		);
		console.error('  happening, scripts/stage-embed.js is what enforces the count and is where to');
		console.error('  look.');
		return 1;
	}

	const missing = missingBindings(selected === null ? config : (config.env[selected] ?? {}));
	if (missing.length > 0) {
		const site = selected === null ? CONFIG : `\`env.${selected}\` in ${CONFIG}`;
		console.error(`FAILED: ${site} declares no ${missing.join(', ')}.`);
		if (selected !== null) {
			// only a named environment can be missing a binding the file plainly holds, so this is
			// said only where it is true — the top level inherits from nothing.
			console.error(
				`  \`env.${selected}\` inherits neither \`d1_databases\` nor \`ratelimits\`, so`
			);
			console.error('  the block one level up in this same file is not this deployment’s, and');
			console.error(
				'  wrangler answers one it did not repeat with a warning rather than an error.'
			);
		}
		console.error(
			'  a worker deployed without one serves anyway: no DB is a 500 on every request,'
		);
		console.error('  and a missing limiter meters nothing (src/lib/server/api/rate-limit.ts).');
		console.error(`  fix: add each of them to ${site}, giving every limiter`);
		console.error('  a `namespace_id` no other binding in the file uses.');
		return 1;
	}

	// nothing on a clean run. this is a link in `pnpm run deploy`'s chain rather than something an
	// operator invokes to read an answer, and a line here would only be one above the refusal.
	return 0;
}

/**
 * the generated config this deploy would upload, or the one sentence saying why there is none.
 *
 * every way the build and the upload can come apart lands here — no redirection, a redirection
 * naming a config outside this package, a config that is gone or will not parse, a bundle that was
 * never written — and each is reported with the path it read, because that is what tells an
 * operator whether the build ran at all or ran somewhere else.
 */
function readBuild(root) {
	const redirectPath = join(root, DEPLOY_CONFIG);
	if (!existsSync(redirectPath)) {
		return { error: `${DEPLOY_CONFIG} does not exist, so no build has named a worker to upload.` };
	}

	let redirect;
	try {
		redirect = JSON.parse(readFileSync(redirectPath, 'utf8'));
	} catch {
		return { error: `${DEPLOY_CONFIG} is not JSON this can read.` };
	}

	if (typeof redirect?.configPath !== 'string' || redirect.configPath === '') {
		return { error: `${DEPLOY_CONFIG} names no generated config.` };
	}

	const configPath = resolve(dirname(redirectPath), redirect.configPath);
	const inside = relative(root, configPath);
	if (inside.startsWith('..') || isAbsolute(inside)) {
		// the redirection is honoured wherever it points, so a path outside this package is another
		// tree's build — which is the upload nobody would see coming.
		return { error: `${DEPLOY_CONFIG} names \`${redirect.configPath}\`, outside this package.` };
	}
	if (!existsSync(configPath)) {
		return { error: `${DEPLOY_CONFIG} names \`${inside}\`, and it is not there.` };
	}

	let config;
	try {
		config = JSON.parse(readFileSync(configPath, 'utf8'));
	} catch {
		return { error: `${inside} is not JSON this can read.` };
	}

	if (typeof config?.main !== 'string' || config.main === '') {
		return { error: `${inside} names no worker entry.` };
	}
	const entry = resolve(dirname(configPath), config.main);
	if (!existsSync(entry)) {
		return {
			error: `${inside} names \`${config.main}\` as the worker entry, and it is not there.`
		};
	}

	return { config };
}

/**
 * wrangler.jsonc parsed, or `undefined` where there is no reading it.
 *
 * JSONC, so the comments come out before JSON.parse sees it. every way this can fail answers the
 * same — an unreadable file, unparseable JSON, a config with no `main` — so they collapse into one
 * absent value and one sentence at the call site.
 */
function readConfig(path) {
	try {
		return JSON.parse(stripComments(readFileSync(path, 'utf8')));
	} catch {
		return undefined;
	}
}

/**
 * the environment this deploy selects, `null` where it selects none, and `''` where `--env` was
 * given with its name lost off the end.
 *
 * both spellings, because both select the environment at the wrangler commands behind this step
 * and a guard that read only one would pass on a config nobody is deploying.
 */
function selectedEnvironment(argv) {
	const inline = argv.find((arg) => arg.startsWith('--env='));
	if (inline !== undefined) return inline.slice('--env='.length);
	const at = argv.indexOf('--env');
	if (at === -1) return null;
	return argv[at + 1] ?? '';
}

/**
 * the bindings the selected environment does not declare, database first.
 *
 * declared is the whole question here. whether a rate limiter's numbers are the ones this app
 * promises a refused caller, and whether the probe's bucket is narrower than the burst that reads
 * it, are `src/lib/server/api/rate-limit.config.spec.ts`'s — that spec reads both blocks and runs
 * at commit, in front of every deploy rather than only in front of this one.
 */
function missingBindings(environment) {
	const databases = Array.isArray(environment.d1_databases) ? environment.d1_databases : [];
	const limiters = Array.isArray(environment.ratelimits) ? environment.ratelimits : [];
	const missing = databases.some((entry) => entry?.binding === DATABASE) ? [] : [DATABASE];
	return [
		...missing,
		...LIMITERS.filter((name) => !limiters.some((entry) => entry?.name === name))
	];
}

/**
 * JSONC reduced to JSON: comments removed and trailing commas dropped, both string-aware.
 *
 * character by character rather than by regular expression, because the only thing that decides
 * whether `//` opens a comment is whether a string is open around it — and `wrangler.jsonc` holds
 * URLs. a reader that got this wrong would refuse a deploy there is nothing wrong with.
 */
function stripComments(source) {
	let out = '';
	let i = 0;
	let inString = false;

	while (i < source.length) {
		const char = source[i];

		if (inString) {
			// an escape carries its next character whatever it is, so a `\"` does not close the string.
			if (char === '\\') {
				out += char + (source[i + 1] ?? '');
				i += 2;
				continue;
			}
			if (char === '"') inString = false;
			out += char;
			i++;
			continue;
		}

		if (char === '"') {
			inString = true;
			out += char;
			i++;
			continue;
		}

		if (char === '/' && source[i + 1] === '/') {
			while (i < source.length && source[i] !== '\n') i++;
			continue;
		}

		if (char === '/' && source[i + 1] === '*') {
			i += 2;
			while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
			i += 2;
			continue;
		}

		// a comma before a closing brace is legal JSONC and is not legal JSON. comments are already
		// gone from `out`, so trailing whitespace back to a comma is exactly that case — and the
		// closing quote of a string ending in one stands between it and this.
		if (char === '}' || char === ']') out = out.replace(/,\s*$/, '');

		out += char;
		i++;
	}

	return out;
}

// `pnpm run deploy` runs this file and the spec beside it imports it, so the run is guarded: an
// unconditional one would fire on import and take the test process's exit code with it.
if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
