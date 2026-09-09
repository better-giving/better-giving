import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readWranglerConfig } from '../wrangler-config.testing';

// the guard on "a rehearsal deploy is the real one, one environment over — and neither of them
// moves a step behind the door".
//
// what is under test is a string in package.json, which is the order of record for both chains
// (CLAUDE.md): build, then the preflight, then `wrangler d1 migrations apply DB --remote`, then
// the upload. the migration is irreversible, so everything able to fail runs in front of it —
// and a step moved behind it is a one-line edit to a JSON string in a file no type checker reads.
// nothing else in this repository looks at that string.
//
// the rehearsal chain is derived from the real one here rather than spelled out, because "step for
// step, in the same order, with nothing dropped" is the whole of what it is. a step added to
// `deploy` and forgotten in `deploy:test` is the drift this catches, and it is the one that matters
// in that direction: a rehearsal that skips the preflight is a rehearsal that teaches an operator
// the preflight is optional.
//
// why the flag cannot ride on the end of the real chain instead. anything an operator appends to a
// `pnpm run` script reaches the last command in it and no other — which is exactly the property
// DEPLOY.md documents for `pnpm run deploy --var …` and `--domains …`. so `pnpm run deploy --env
// test` would leave the preflight guarding the top-level config and `wrangler d1 migrations apply
// DB` resolving `DB` against it: the real database migrated on the way to uploading a rehearsal
// worker, with both commands reporting success. every step that resolves a config has to be told,
// and that is what the derivation below asserts.
//
// what this file cannot prove is what a real deploy does — that Cloudflare puts up a second worker,
// that it binds the second database, that the first one is untouched. what it proves is that the
// commands sent are the commands intended, which is the half that breaks from inside the repository.
// `test` runs in lefthook.yml's pre-commit hook, so it lands in front of whoever changed them.

/** the fields this file reads off the config. everything else in it is somebody else's concern. */
interface WranglerConfig {
	readonly d1_databases?: readonly Bound[];
	readonly env?: Readonly<Record<string, { readonly d1_databases?: readonly Bound[] } | undefined>>;
}

interface Bound {
	readonly binding?: unknown;
	readonly database_name?: unknown;
}

const config = readWranglerConfig() as WranglerConfig;

/** packages/app, whose package.json holds both chains, from packages/app/src/lib/server/config. */
const APP = resolve(import.meta.dirname, '../../../..');

/** the workspace root, which is where every operator command is forwarded from (CLAUDE.md). */
const ROOT = resolve(APP, '../..');

function scripts(dir: string): Record<string, string> {
	const parsed: unknown = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'));
	const found =
		typeof parsed === 'object' && parsed !== null && 'scripts' in parsed
			? (parsed as { scripts: unknown }).scripts
			: undefined;
	return typeof found === 'object' && found !== null ? (found as Record<string, string>) : {};
}

const app = scripts(APP);
const root = scripts(ROOT);

/** a chain as the commands it runs, in order — `&&`, which is what "step for step" is counted in. */
const steps = (script: string | undefined): string[] =>
	(script ?? '').split('&&').map((step) => step.trim());

/**
 * every environment a chain selects, deduplicated — taken off the chain rather than named here, so
 * that the name asserted below is the name the commands actually carry.
 *
 * only `--env test`, not `--env=test`: both reach wrangler and the preflight reads both, but a
 * chain in this repository is written by whoever edits this file and one spelling is enough for it.
 */
function environments(chain: readonly string[]): string[] {
	const named = chain.flatMap((step) => {
		const words = step.split(/\s+/);
		const at = words.indexOf('--env');
		return at === -1 ? [] : [words[at + 1] ?? ''];
	});
	return [...new Set(named)];
}

/** the database a block binds as `DB`, which is the binding every server module takes as `Db`. */
function database(block: { readonly d1_databases?: readonly Bound[] } | undefined): unknown {
	return block?.d1_databases?.find((entry) => entry.binding === 'DB')?.database_name;
}

describe('`pnpm run deploy`, and where the one-way door sits in it', () => {
	/**
	 * the order of record, asserted whole rather than by naming the door and its neighbours.
	 *
	 * each step earns its place from the one behind it: the build is the last thing that can fail on
	 * the operator's own machine, the preflight reads what that build actually left behind, and both
	 * stand in front of `--remote`, which applies SQL to a production database with no undo. the
	 * upload is last because a worker uploaded against a schema that did not land is a deployment
	 * answering 500s.
	 */
	it('builds, preflights, migrates, then uploads', () => {
		expect(steps(app.deploy)).toEqual([
			'pnpm run build',
			'node scripts/preflight-deploy.js',
			'wrangler d1 migrations apply DB --remote',
			'wrangler deploy'
		]);
	});
});

describe('`pnpm run deploy:test`, the same chain one environment over', () => {
	/**
	 * the whole of what a rehearsal chain is: the same steps in the same order, each told which
	 * environment it is for.
	 *
	 * the build is told differently from the three behind it, and that asymmetry is the whole reason
	 * this assertion spells the first step out rather than deriving it like the rest.
	 * `@cloudflare/vite-plugin` resolves the environment while it builds and writes the answer into
	 * the config `wrangler deploy` uploads — `CLOUDFLARE_ENV` is the only thing it reads that from,
	 * and a `--env` flag on `vite build` means nothing. the three behind it resolve a config of their
	 * own and take the flag.
	 *
	 * a build that missed the variable is the failure that costs most: the generated config is then
	 * the top level — the real worker, the real database — and `wrangler deploy --env test` uploads
	 * it without complaint, because a redirected config carries no `env` block for the flag to miss.
	 * scripts/preflight-deploy.js compares the two and refuses the pair, and this is what keeps the
	 * pair from being wrong in the first place.
	 */
	it('runs `deploy` step for step, with the environment named on every step', () => {
		const [build = '', ...rest] = steps(app.deploy);

		expect(steps(app['deploy:test'])).toEqual([
			`CLOUDFLARE_ENV=test ${build}`,
			...rest.map((step) => `${step} --env test`)
		]);
	});

	/**
	 * the flag names something, and what it names is a database that is not the real one.
	 *
	 * both halves are load-bearing and neither is checked by the other. an environment wrangler.jsonc
	 * does not declare is refused by scripts/preflight-deploy.js before the door — but only because
	 * the file declares at least one, since wrangler downgrades an unknown environment to a warning
	 * when there are none to list. and an environment that declared no `d1_databases` of its own
	 * would be refused there too, without anything saying it must be a *different* database: an
	 * environment repeating `better-giving` would deploy a second worker onto the real books, which
	 * is the one outcome this whole chain exists to avoid.
	 */
	it('selects an environment the config declares, bound to a database of its own', () => {
		const selected = environments(steps(app['deploy:test']));

		expect(selected).toHaveLength(1);
		const [name = ''] = selected;
		expect(Object.keys(config.env ?? {})).toContain(name);
		expect(database(config.env?.[name])).not.toBe(database(config));
		// and the build was made for that same one, which is the half no flag can state.
		expect(app['deploy:test']).toContain(`CLOUDFLARE_ENV=${name} `);
	});

	/**
	 * forwarded like every other operator command, and derived from `deploy`'s forwarder so that the
	 * two cannot come apart.
	 *
	 * `--filter` is what makes the command independent of the directory it is typed in: pnpm runs the
	 * script with packages/app as its working directory, which is where wrangler resolves
	 * wrangler.jsonc from. from inside a package directory the spelling is `pnpm -w run deploy:test`,
	 * which pnpm itself says when it lists the root's commands.
	 */
	it('is forwarded from the repo root the way `deploy` is', () => {
		expect(root['deploy:test']).toBe(root.deploy?.replace(/ deploy$/, ' deploy:test'));
	});
});

describe('the database a rehearsal deployment is deployed onto', () => {
	/**
	 * the operator never types `wrangler` themselves (DEPLOY.md), and a rehearsal deployment's first
	 * `deploy:test` stops at the migration asking for a database that does not exist yet. so there is
	 * a command for it, and it creates the name `env.test` binds rather than a name spelled twice.
	 *
	 * `--no-update-config` is the half that is easy to lose: wrangler offers to write the new
	 * database's id back into wrangler.jsonc and defaults to yes, and an id in this repository is a
	 * deployment artifact a fork inherits and cannot reach (CLAUDE.md).
	 */
	it('is created by name, with the id left out of the repository', () => {
		expect(app['db:create:test']).toBe(
			`wrangler d1 create ${String(database(config.env?.test))} --no-update-config`
		);
	});

	it('is created by a command forwarded from the repo root', () => {
		expect(root['db:create:test']).toBe(
			root['db:create']?.replace(/ db:create$/, ' db:create:test')
		);
	});
});
