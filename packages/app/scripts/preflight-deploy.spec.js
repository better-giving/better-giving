import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from './preflight-deploy.js';

/**
 * every case runs against a temp directory and never against this checkout.
 *
 * the state under test is `.wrangler/deploy/config.json` and the `build/` it names, which is what
 * `pnpm run deploy` uploads — a spec that read the real pair would pass or fail on whatever was
 * last built here, and a spec that wrote one would arm the defect this guard exists to catch.
 */
const roots = [];

afterEach(() => {
	while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

/** the three rate limiters a deployment of this app has to be bound to, in wrangler.jsonc's order. */
const LIMITERS = ['API_RATE_LIMITER', 'QUOTE_RATE_LIMITER', 'SIGN_IN_RATE_LIMITER'];

/**
 * the bindings block one environment declares, cut to the two fields the guard reads.
 *
 * a real block carries a `namespace_id` and a `simple` on every limiter and a `database_name` on
 * the database; none of them is this guard's business — what it answers is whether the binding is
 * declared at all, and `src/lib/server/api/rate-limit.config.spec.ts` is what holds the numbers.
 *
 * `limiters` names the three by default so that a case about something else reaches its own check,
 * and takes a shorter list so that a case about a missing one can drop exactly one.
 */
function bindings({ db = true, limiters = LIMITERS } = {}) {
	const databases = db ? '{ "binding": "DB", "database_name": "better-giving" }' : '';
	const declared = limiters.map((name) => `{ "name": "${name}" }`).join(', ');
	return `"d1_databases": [${databases}], "ratelimits": [${declared}]`;
}

/**
 * wrangler.jsonc as this repo's own is shaped, cut to the fields the guard reads.
 *
 * the comments are the point of the fixture rather than decoration: the real file is JSONC and is
 * commented heavily (CLAUDE.md keeps a rule at the site it governs), so a reader that only handled
 * strict JSON would refuse every deploy this repo makes.
 */
const CONFIG = `{
	// the worker entry the build compiles
	"main": "./src/worker.ts",
	"name": "better-giving",
	${bindings()}
}
`;

/**
 * the same config with a named environment beside it, which is the shape every case below about
 * `--env` is about: a top level that is wired, and an environment that has to be wired itself
 * because it inherits neither of these two blocks from it.
 */
function withEnvironment(name, block) {
	return `{
	"main": "./src/worker.ts",
	"name": "better-giving",
	${bindings()},
	"env": { "${name}": { ${block} } }
}
`;
}

/**
 * what `vite build` leaves behind, as the three files that decide what gets uploaded: the
 * generated config, the bundle it names, and the redirection naming the config.
 *
 * `targetEnvironment` is the field that carries `CLOUDFLARE_ENV` into the upload and is absent on a
 * build made without it, which is why it is left off by default — that is the shape a bare
 * `pnpm run build` writes.
 */
function build(
	root,
	{
		targetEnvironment,
		main = 'index.js',
		bundle = true,
		at = join('build', 'server', 'wrangler.json'),
		names = at
	} = {}
) {
	const generated = join(root, at);
	mkdirSync(dirname(generated), { recursive: true });
	writeFileSync(generated, JSON.stringify({ name: 'better-giving', main, targetEnvironment }));
	if (bundle) writeFileSync(join(dirname(generated), main), '// a worker bundle\n');

	const deploy = join(root, '.wrangler', 'deploy');
	mkdirSync(deploy, { recursive: true });
	const configPath = names.startsWith('/') ? names : relative(deploy, join(root, names));
	writeFileSync(join(deploy, 'config.json'), JSON.stringify({ configPath, auxiliaryWorkers: [] }));
}

/**
 * a checkout, as the three things the guard looks at: the config an operator's commands read, what
 * a build has actually left behind, and whether the embed reached the client build.
 *
 * `config: null` is a checkout with no config in it, and it is `null` rather than `undefined`
 * because a destructuring default fires on `undefined` — passing that would silently write the
 * default config and give a case about an absent one a fixture that has one.
 *
 * `built` and `embed` both default to a clean build, so every case reaches the check it is about
 * with a tree that already passes the ones in front of it.
 */
function workspace({
	config = CONFIG,
	built = {},
	embed = true,
	runtimeFiles = ['a1b2c3d4.js']
} = {}) {
	const root = mkdtempSync(join(tmpdir(), 'preflight-deploy-'));
	roots.push(root);

	if (config !== null) writeFileSync(join(root, 'wrangler.jsonc'), config);

	if (built !== null) build(root, built);

	if (embed) {
		mkdirSync(join(root, 'build', 'client', 'embed'), { recursive: true });
		writeFileSync(
			join(root, 'build', 'client', 'embed.js'),
			'// the loader half, as far as this guard is concerned\n'
		);
		for (const name of runtimeFiles) {
			writeFileSync(
				join(root, 'build', 'client', 'embed', name),
				'// the runtime half, as far as this guard is concerned\n'
			);
		}
	}

	return root;
}

/**
 * the run's exit code and both streams, with the real console silenced.
 *
 * `argv` is what `pnpm run deploy` passes after the script path, which today is nothing and for a
 * rehearsal deploy is `--env test` — the same flag wrangler is given by the steps behind this one,
 * because a guard reading a different environment than the deploy uses is a guard that passed for
 * the wrong config.
 */
function capture(root, argv = []) {
	const out = [];
	const err = [];
	const outSpy = vi.spyOn(console, 'log').mockImplementation((line) => out.push(String(line)));
	const errSpy = vi.spyOn(console, 'error').mockImplementation((line) => err.push(String(line)));
	try {
		const code = main(root, argv);
		return { code, out, err };
	} finally {
		outSpy.mockRestore();
		errSpy.mockRestore();
	}
}

describe('refusing a deploy that would upload the wrong build', () => {
	/**
	 * the deploy has no build to upload at all.
	 *
	 * `wrangler deploy` reads the redirection rather than wrangler.jsonc, so without one it would
	 * fall back to the config in the working directory — whose `main` names a TypeScript entry that
	 * imports a virtual module only the build produces. what an operator gets from that is a bundler
	 * error at the last step of the chain, behind the one-way door.
	 */
	it('refuses when no build has written a deploy configuration redirection', () => {
		const { code, err } = capture(workspace({ built: null }));

		expect(code).not.toBe(0);
		expect(err.join('\n')).toContain('.wrangler/deploy/config.json');
	});

	/**
	 * the defect the redirection check has always been about, in the shape it survives in.
	 *
	 * a redirection is honoured wherever it points, and neither `build/` nor `.wrangler/` is
	 * committed (.gitignore) — so one naming a config outside this package is another tree's output,
	 * uploaded to the only production address there is, with a clean `git status` the whole way.
	 */
	it('refuses a redirection naming a config outside this package', () => {
		const outside = mkdtempSync(join(tmpdir(), 'preflight-elsewhere-'));
		roots.push(outside);
		mkdirSync(join(outside, 'server'), { recursive: true });
		writeFileSync(join(outside, 'server', 'wrangler.json'), '{"main":"index.js"}');

		const root = workspace({ built: { names: join(outside, 'server', 'wrangler.json') } });

		const { code, err } = capture(root);

		expect(code).not.toBe(0);
		expect(err.join('\n')).toContain('outside this package');
	});

	/**
	 * a redirection naming a config that is not there — a half-cleaned tree, a `rm -rf build` after
	 * a build, a redirection left by a tool that writes somewhere this one does not.
	 */
	it('refuses when the config the redirection names is missing', () => {
		const root = workspace({ built: { names: join('build', 'elsewhere', 'wrangler.json') } });

		const { code, err } = capture(root);

		expect(code).not.toBe(0);
		expect(err.join('\n')).toContain('build/elsewhere/wrangler.json');
	});

	/**
	 * the entry comes off the generated config and is never assumed.
	 *
	 * that config is written by `@cloudflare/vite-plugin` and names the bundle beside it, so a guard
	 * holding a copy of the path would go on passing against a build whose output moved. what it
	 * checks is the one file every deploy needs, which is why this step runs behind `build`.
	 */
	it('follows the entry the generated config names, wherever it points', () => {
		const refused = capture(workspace({ built: { main: 'worker.js', bundle: false } }));
		const passed = capture(workspace({ built: { main: 'worker.js' } }));

		expect(refused.code).not.toBe(0);
		expect(refused.err.join('\n')).toContain('worker.js');
		expect(passed.code).toBe(0);
	});

	/**
	 * a config this cannot read an entry out of, which is refused rather than waved through.
	 *
	 * the direction is the whole point: this step stands in front of a one-way door, so the answer
	 * to "I could not check" is the same as the answer to "the check failed". an unreadable config
	 * that returned 0 would hand the deploy to the migration apply on the strength of a check that
	 * never ran.
	 *
	 * it is one branch over three shapes because an operator does the same thing about all of them,
	 * and because the alternative — letting the throw out — reports a stack trace where every other
	 * refusal in this repo reports a sentence.
	 */
	it.each([
		{ shape: 'no main in it', config: '{ "name": "better-giving" }' },
		{ shape: 'JSON it cannot parse', config: '{ "main": ' },
		{ shape: 'no config file at all', config: null }
	])('refuses a config with $shape rather than throwing', ({ config }) => {
		const { code, err } = capture(workspace({ config }));

		expect(code).not.toBe(0);
		expect(err.join('\n')).toContain('wrangler.jsonc');
	});

	/**
	 * the run every deploy makes, which says nothing.
	 *
	 * this step is one link in `pnpm run deploy`'s chain rather than something an operator invokes
	 * to read an answer, so a clean checkout gets no line at all — what an operator is owed here is
	 * the refusal, and a guard that narrated its successes would bury it.
	 */
	it('says nothing and passes when the build matches the config', () => {
		const { code, out, err } = capture(workspace());

		expect(code).toBe(0);
		expect(out).toEqual([]);
		expect(err).toEqual([]);
	});

	/**
	 * the JSONC the reader has to survive, since refusing to parse the config refuses the deploy.
	 *
	 * the two that a regular expression gets wrong are the reason this is a character scanner: a
	 * `//` inside a string opens no comment, and a comma before a closing brace is legal here and
	 * is not legal JSON. each fixture is otherwise unwired, so a case that parsed is one that
	 * reached the bindings check and named what the config does not declare.
	 */
	it.each([
		{ shape: 'a line comment', config: '{\n\t// the entry\n\t"main": "./src/worker.ts"\n}' },
		{ shape: 'a block comment', config: '{ /* the\n entry */ "main": "./src/worker.ts" }' },
		{ shape: 'a trailing comma', config: '{ "main": "./src/worker.ts", }' },
		{
			shape: 'a // inside a string',
			config: '{ "name": "https://x.example", "main": "./src/worker.ts" }'
		},
		{
			shape: 'an escaped quote in a string',
			config: '{ "name": "a \\" quote", "main": "./src/worker.ts" }'
		}
	])('reads the config out of one carrying $shape', ({ config }) => {
		const { code, err } = capture(workspace({ config }));

		expect(code).not.toBe(0);
		expect(err.join('\n')).toContain('DB');
	});
});

describe('refusing a deploy built for another environment', () => {
	/**
	 * the failure that costs most, and the reason this check exists at all.
	 *
	 * `@cloudflare/vite-plugin` resolves the environment while it builds, from `CLOUDFLARE_ENV`, and
	 * writes the answer into the generated config as `targetEnvironment`. `wrangler deploy --env
	 * test` selects it at upload time instead — and against a redirected config there is no `env`
	 * block for the flag to miss, so wrangler uploads the build it was given without a word. a
	 * rehearsal deploy whose build forgot the variable therefore deploys the top-level
	 * configuration: the real worker name, the real database, over the deployment donors are giving
	 * through.
	 */
	it('refuses --env test against a build made for no environment', () => {
		const root = workspace({ config: withEnvironment('test', bindings()) });

		const { code, err } = capture(root, ['--env', 'test']);

		expect(code).not.toBe(0);
		expect(err.join('\n')).toContain('test');
		expect(err.join('\n')).toContain('CLOUDFLARE_ENV');
	});

	/**
	 * the same disagreement the other way round, which is the likelier accident: a `deploy:test`
	 * built the tree for the rehearsal, and a plain `pnpm run deploy` afterwards would upload that
	 * build to the real address if the chain's own build did not run first.
	 */
	it('refuses a default deploy against a build made for an environment', () => {
		const root = workspace({ built: { targetEnvironment: 'test' } });

		const { code, err } = capture(root);

		expect(code).not.toBe(0);
		expect(err.join('\n')).toContain('test');
	});

	it('passes when the build and the deploy name the same environment', () => {
		const root = workspace({
			config: withEnvironment('test', bindings()),
			built: { targetEnvironment: 'test' }
		});

		const { code, err } = capture(root, ['--env', 'test']);

		expect(code).toBe(0);
		expect(err).toEqual([]);
	});
});

describe('refusing a deploy whose embed never reached the client build', () => {
	/**
	 * the defect this half of the guard exists for. `scripts/stage-embed.js` runs inside `build`,
	 * several steps in front of this one, and nothing enforces that ordering surviving forever — a
	 * reordered script, a hand-run build with a skipped step, a public directory pointed elsewhere.
	 * everything else in this file — the config, the redirection, the worker entry — is checked here
	 * too, so the embed is checked the same way rather than trusted because an earlier step usually
	 * produces it.
	 *
	 * counted in `build/client/` rather than in `static/`, which is the whole chain in one read: the
	 * staging script writes into `static/`, vite copies that directory into the client build, and
	 * the client build is what the generated config uploads as the worker's assets.
	 */
	it('refuses when embed.js never reached the client build', () => {
		const { code, err } = capture(workspace({ embed: false }));

		expect(code).not.toBe(0);
		expect(err.join('\n')).toContain(join('build', 'client', 'embed.js'));
	});

	it('refuses when the client build holds no runtime at all', () => {
		const { code, err } = capture(workspace({ runtimeFiles: [] }));

		expect(code).not.toBe(0);
		expect(err.join('\n')).toContain(join('build', 'client', 'embed'));
		expect(err.join('\n')).toContain('0 runtime scripts');
	});

	// the failure `scripts/stage-embed.js`'s own additive-copy bug left behind: a previous build's
	// runtime never cleared, sitting beside the current one.
	it('refuses when the client build holds more than one runtime', () => {
		const { code, err } = capture(workspace({ runtimeFiles: ['a1b2c3d4.js', 'e5f6a7b8.js'] }));

		expect(code).not.toBe(0);
		expect(err.join('\n')).toContain('2 runtime scripts');
	});
});

describe('refusing a deploy whose selected environment is not wired', () => {
	/**
	 * the defect this half of the guard exists for, and it is silent on both sides.
	 *
	 * a named environment inherits neither `d1_databases` nor `ratelimits` — it holds only what it
	 * declares itself — so an environment that forgot one deploys with a warning that scrolls past
	 * and answers every request without it. the top level in this fixture is fully wired, which is
	 * exactly what makes the failure invisible to a reader: the block is right there in the file,
	 * one level up from the deploy that will not get it.
	 *
	 * this is the one check read off wrangler.jsonc rather than off the build, because it is the
	 * file `wrangler d1 migrations apply` behind this step reads too.
	 */
	it('refuses when the selected environment declares no DB binding', () => {
		const root = workspace({
			config: withEnvironment('test', bindings({ db: false })),
			built: { targetEnvironment: 'test' }
		});

		const { code, err } = capture(root, ['--env', 'test']);

		expect(code).not.toBe(0);
		expect(err.join('\n')).toContain('DB');
		expect(err.join('\n')).toContain('test');
	});

	/**
	 * every limiter, one at a time, because what a missing one costs differs by which one it is and
	 * none of the three is loud: `/api/v1` goes dark by name without API_RATE_LIMITER, and the
	 * quote and the sign-in buckets fail open and silently meter nothing
	 * (src/lib/server/api/rate-limit.ts).
	 */
	it.each(LIMITERS)('refuses when the selected environment is missing %s', (missing) => {
		const config = withEnvironment(
			'test',
			bindings({ limiters: LIMITERS.filter((name) => name !== missing) })
		);
		const root = workspace({ config, built: { targetEnvironment: 'test' } });

		const { code, err } = capture(root, ['--env', 'test']);

		expect(code).not.toBe(0);
		expect(err.join('\n')).toContain(missing);
	});

	/**
	 * the same check on the deploy nobody selects an environment for, which is the one that serves
	 * donors. the top level is the selected environment when no flag names another.
	 */
	it.each([
		{ shape: 'no DB binding', wiring: bindings({ db: false }), named: 'DB' },
		{
			shape: 'no QUOTE_RATE_LIMITER',
			wiring: bindings({ limiters: LIMITERS.filter((name) => name !== 'QUOTE_RATE_LIMITER') }),
			named: 'QUOTE_RATE_LIMITER'
		}
	])('refuses a default deploy whose config has $shape', ({ wiring, named }) => {
		const config = `{ "main": "./src/worker.ts", ${wiring} }`;

		const { code, err } = capture(workspace({ config }));

		expect(code).not.toBe(0);
		expect(err.join('\n')).toContain(named);
	});

	/**
	 * a flag naming an environment the config does not declare, which is refused here rather than
	 * left to wrangler: the step behind this one is `wrangler d1 migrations apply`, so a
	 * misspelled environment that got past this guard would be answered by the migration apply —
	 * and it resolves `DB` from the top level, which is the real database.
	 *
	 * the names that are real are printed because a misspelling is what this is, and the fix is to
	 * read one.
	 */
	it('refuses an --env the config declares no block for, and lists the ones it does', () => {
		const root = workspace({ config: withEnvironment('test', bindings()) });

		const { code, err } = capture(root, ['--env', 'tets']);

		expect(code).not.toBe(0);
		expect(err.join('\n')).toContain('tets');
		expect(err.join('\n')).toContain('test');
	});

	/**
	 * `--env` with the name lost off the end of it. wrangler would read the flag as taking the next
	 * argument or none at all, and the guard cannot tell which environment it was asked about — the
	 * answer to "I could not check" is the answer to "the check failed", the same as it is for a
	 * config this cannot parse.
	 */
	it('refuses an --env given no name', () => {
		const root = workspace({ config: withEnvironment('test', bindings()) });

		const { code, err } = capture(root, ['--env']);

		expect(code).not.toBe(0);
		expect(err.join('\n')).toContain('--env');
	});

	/**
	 * both spellings wrangler accepts for the flag, since the guard is handed the same argument list
	 * the deploy script hands wrangler and either one of these selects the environment there.
	 */
	it.each([
		{ spelling: '--env test', argv: ['--env', 'test'] },
		{ spelling: '--env=test', argv: ['--env=test'] }
	])('passes a $spelling deploy whose environment declares everything', ({ argv }) => {
		const root = workspace({
			config: withEnvironment('test', bindings()),
			built: { targetEnvironment: 'test' }
		});

		const { code, out, err } = capture(root, argv);

		expect(code).toBe(0);
		expect(out).toEqual([]);
		expect(err).toEqual([]);
	});

	/**
	 * this repo's own config, selected both ways `pnpm run deploy` and `pnpm run deploy:test` select
	 * it — the case that would have caught the `env.test` block being written without one of its
	 * bindings, which is the whole reason this check exists before the flag that selects it does.
	 *
	 * it is copied into a temp checkout rather than run against packages/app: the state this guard
	 * reads beside it is `.wrangler/deploy/config.json` and the `build/` it names, and a spec that
	 * touched either would be arming the defect.
	 */
	it.each([
		{ deploy: 'pnpm run deploy', argv: [], built: {} },
		{
			deploy: 'pnpm run deploy:test',
			argv: ['--env', 'test'],
			built: { targetEnvironment: 'test' }
		}
	])('passes `$deploy` against this repo’s own wrangler.jsonc', ({ argv, built }) => {
		const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

		const { code, err } = capture(workspace({ config, built }), argv);

		expect(code).toBe(0);
		expect(err).toEqual([]);
	});
});
