import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// the guard on "no module outside this directory reaches better-auth's router".
//
// why this test exists. this deployment serves no auth HTTP API (CLAUDE.md → product surface):
// better-auth registers `/sign-in/email`, `/request-password-reset`, `/reset-password`,
// `/get-session` and the rest whether or not the flow behind them is configured, and every one of
// them is a 404 here because the router they live in is never asked. ./index.ts argues what that
// costs — including for the mailed reset, which is a flow this deployment runs entirely through
// `auth.api.*` calls from a route's own action.
//
// ../../../routes.spec.ts already holds that nothing answers `/api/auth/*`, which is the same
// property read from the other end. this file is the half that rule cannot see: the router is
// reachable through `auth.handler` and through nothing else, so a module that never touches
// `auth.handler` cannot serve it — from any prefix, under any route file, with or without a base
// path. holding the reference is stricter than holding one prefix, and it is the property that
// actually matters.
//
// it is the same shape as the two guards beside it, ../ledger/sole-writer.spec.ts and
// ../payments/sole-importer.spec.ts, and it exists for the same reason all three do: until one is
// written, the rule is enforced by a code review somebody has to remember to do.
//
// the tempting shortcut this exists to catch is a route file added to serve one endpoint the
// server API does not expose — an email verification, an OAuth callback — by mounting the whole
// router to get it. that mounts the other eight as well, including the ones whose flows are not
// configured, and nothing reports them.
//
// how it works: a source scan, not a runtime hook. a runtime one would only see the paths a test
// happens to request, and the mounting that matters is exactly the one nobody wrote a test for. it
// reads text and can be fooled by an instance renamed through a value the scan cannot follow —
// accepted, because what it defends against is a shortcut taken in a hurry, not an adversary.
//
// what is exempt: this whole directory — the instance is built here, and ./auth.spec.ts calls the
// router directly to assert a setting that is still on the instance — and this file, which
// necessarily contains the patterns it searches for.

const SRC = resolve(import.meta.dirname, '../../..');
const AUTH_DIR = resolve(import.meta.dirname);

const EXTENSIONS = ['.ts', '.tsx', '.js'];

/** every source file under `src/`, minus this directory. */
function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (path === AUTH_DIR) continue;
			sourceFiles(path, out);
		} else if (EXTENSIONS.some((e) => entry.name.endsWith(e))) {
			out.push(path);
		}
	}
	return out;
}

/**
 * three ways to get hold of the router, because a rule that only knew the first would be worth
 * less than no rule at all:
 *
 *   - the property — `auth.handler`, under whatever name the instance was given locally.
 *   - the destructuring — `const { handler } = auth`, which is the shape a route module that
 *     re-exports it as its own `loader` and `action` reaches for.
 *   - straight off the factory — `createAuth(…).handler`, with no instance to name.
 */
const MOUNTINGS: { label: string; re: RegExp }[] = [
	{ label: 'auth.handler', re: /\b[\w$]*[Aa]uth\.handler\b/ },
	{ label: 'destructured handler', re: /\{[^{}]*\bhandler\b[^{}]*\}\s*=\s*[\w$]*[Aa]uth\b/ },
	{ label: 'createAuth().handler', re: /createAuth\s*\([^()]*\)\s*\.handler\b/ }
];

describe("better-auth's router is mounted by nothing", () => {
	const files = sourceFiles(SRC);

	it('finds source files to scan at all', () => {
		// a guard on the guard: an empty list would make the assertion below pass vacuously, and a
		// wrong `SRC` is exactly how that happens. the route tree and the worker entry are named
		// because they are where a mounting would go.
		const names = files.map((f) => relative(SRC, f));
		expect(names).toContain('routes.ts');
		expect(names).toContain('worker.ts');
		expect(names).toContain('routes/login.tsx');
		expect(names.length).toBeGreaterThan(10);
	});

	it('finds no reference to auth.handler outside src/lib/server/auth/', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const source = readFileSync(file, 'utf8');
			for (const { label, re } of MOUNTINGS) {
				if (re.test(source)) offenders.push(`${relative(SRC, file)} (${label})`);
			}
		}
		// the message is the whole value of this test: it is read by whoever just reached for the
		// router.
		expect(
			offenders,
			`these modules reach better-auth's router: ${offenders.join(', ')}. nothing may — this deployment serves no auth HTTP API, and mounting the router serves nine endpoints to get the one you wanted, including the ones whose flows this deployment has not configured. call the server API instead: \`auth.api.signInStaff\`, \`auth.api.getSession\`, \`auth.api.signOut\` from your own action or middleware, which passes through no router at all. if the endpoint you need has no server-API twin, that is a surface to add out loud (CLAUDE.md → product surface).`
		).toEqual([]);
	});

	it('matches the one call in this directory, so the property pattern is known to work', () => {
		// without this, a typo'd regex that matches nothing anywhere would report a clean tree
		// forever. ./auth.spec.ts is the only module in this repository that calls the router.
		const source = readFileSync(join(AUTH_DIR, 'auth.spec.ts'), 'utf8');
		expect(MOUNTINGS.find((m) => m.label === 'auth.handler')?.re.test(source)).toBe(true);
	});

	it('matches the two spellings no module in this repository currently uses', () => {
		// the other two patterns have nothing real to be checked against, and a rule nobody has
		// broken yet is exactly the one that rots into a regex matching nothing. asserted against
		// written-out shapes instead, one per pattern.
		const destructured = MOUNTINGS.find((m) => m.label === 'destructured handler')?.re;
		const factory = MOUNTINGS.find((m) => m.label === 'createAuth().handler')?.re;
		expect(destructured?.test('const { handler } = auth;')).toBe(true);
		expect(destructured?.test('const { handler } = createAuth(env, runtime);')).toBe(true);
		expect(destructured?.test('export const { handler: loader } = serverAuth;')).toBe(true);
		expect(factory?.test('export const loader = createAuth(env, runtime).handler;')).toBe(true);
	});

	it('does not flag a request handler that has nothing to do with auth', () => {
		// the patterns are read over every file in the tree, and `handler` is an ordinary word in a
		// worker: a rule that flagged `webhookHandler` or an exported `handler` would be turned off
		// rather than fixed.
		const innocent = [
			'export const handler = async (request: Request) => new Response();',
			'const { handler } = await import("./webhook");',
			'return env.ASSETS.fetch(request);'
		].join('\n');
		expect(MOUNTINGS.some(({ re }) => re.test(innocent))).toBe(false);
	});
});
