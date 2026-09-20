import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// the guard on "one module speaks to QuickBooks, and nothing else may".
//
// it is ../payments/sole-importer.spec.ts written for the accounting port, and that file's header
// argues the whole of why: an SDK's vocabulary stops at one file, a second importer is a second
// translation of it, and the two disagree where nobody looks. what is added here is the second half
// of the same rule, because this adapter imports no package at all:
//
// **an address is guarded like an import.** ./quickbooks.ts speaks Intuit's API over bare `fetch`,
// so a route that wanted one field in a hurry would reach Intuit with a `fetch` and import nothing
// — invisible to a guard that only reads import statements. the hostnames are therefore swept too,
// and every one of them lives in that one file.
//
// **a provider is guarded before its SDK exists.** neither package below is installed, and both are
// swept anyway: the shortcut is taken on the day somebody is standing something up, so the entry
// costs nothing while the tree holds no importer and is already standing when one arrives.
//
// the OAuth endpoints are in the sweep as much as the Accounting API is. the callback route is the
// likeliest second speaker — it holds a code and a redirect uri and a token exchange is four lines
// of `fetch` — which is exactly why `exchangeCode` is an arm of the port (./provider.ts).
//
// it scans the whole repository rather than `src/`, for the reason the payments guard does: the
// root and the other packages are ordinary TypeScript and could reach anything.
//
// what is exempt: ./quickbooks.ts, and this file, which necessarily contains everything it searches
// for.

const ROOT = resolve(import.meta.dirname, '../../../../../..');
const SELF = resolve(import.meta.filename);
const ADAPTER = resolve(import.meta.dirname, 'quickbooks.ts');

/**
 * the QuickBooks packages the tree is swept for.
 *
 * `intuit-oauth` is Intuit's own OAuth client and `node-quickbooks` is the community client for the
 * Accounting API; neither is installed and neither may be — `imported: false` says so, the same way
 * the NOWPayments entries do in the payments guard. Intuit ships no official Node client for the
 * Accounting API at all, so the entity calls are plain HTTPS against the reference either way.
 */
const GUARDED_PACKAGES = [
	{ specifier: 'intuit-oauth', imported: false },
	{ specifier: 'node-quickbooks', imported: false }
];

/**
 * every Intuit address this app may reach, each of which lives in the adapter and nowhere else.
 *
 * the Accounting API hosts are two because sandbox and production are separate hosts holding
 * separate companies, and a deployment is built against one of them. the three OAuth addresses are
 * where a browser is sent to authorise and where the two token calls go.
 *
 * `developer.intuit.com` is deliberately absent: it is Intuit's documentation, cited in comments,
 * and a rule that flagged a doc link would be a rule people delete.
 */
const GUARDED_HOSTS = [
	'quickbooks.api.intuit.com',
	'sandbox-quickbooks.api.intuit.com',
	'oauth.platform.intuit.com',
	'appcenter.intuit.com',
	'developer.api.intuit.com'
];

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsonc'];

/** directories with nothing authored in them — ../payments/sole-importer.spec.ts argues the list. */
const SKIP = new Set([
	'node_modules',
	'.claude',
	'.git',
	'.react-router',
	'.wrangler',
	'.vitest-attachments',
	'.vscode',
	'dist',
	'build'
]);

/** every authored source file in the repository, minus the adapter and this spec. */
function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (SKIP.has(entry.name)) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			sourceFiles(path, out);
		} else if (
			EXTENSIONS.some((e) => entry.name.endsWith(e)) &&
			path !== ADAPTER &&
			path !== SELF
		) {
			out.push(path);
		}
	}
	return out;
}

/** the three ways to reach a package, built from the specifier — the payments guard argues each. */
function importers(specifier: string): { label: string; re: RegExp }[] {
	const quoted = `['"]${specifier.replaceAll('/', '\\/')}['"]`;
	return [
		{ label: 'static import', re: new RegExp(`\\bfrom\\s*${quoted}|\\bimport\\s*${quoted}`) },
		{ label: 'dynamic import', re: new RegExp(`\\bimport\\s*\\(\\s*${quoted}\\s*\\)`) },
		{ label: 'require', re: new RegExp(`\\brequire\\s*\\(\\s*${quoted}\\s*\\)`) }
	];
}

/**
 * the hostname anywhere in a file, dots escaped.
 *
 * text and not a URL parse: what this catches is a hostname built into a template literal or a
 * constant, which is how a second speaker is written in the first place.
 */
function mentions(host: string): RegExp {
	return new RegExp(host.replaceAll('.', '\\.'));
}

describe('one module speaks to QuickBooks and nothing else does', () => {
	const files = sourceFiles(ROOT);

	it('finds source files to scan at all, across the whole repository', () => {
		// a guard on the guard: an empty list would make every assertion below pass vacuously, and a
		// wrong `ROOT` is exactly how that happens.
		const names = files.map((f) => relative(ROOT, f));
		expect(names).toContain('packages/app/src/root.tsx');
		expect(names).toContain('packages/app/src/lib/server/accounting/provider.ts');
		expect(names).toContain('packages/form/src/element.ts');
		expect(names).toContain('biome.jsonc');
		expect(names.length).toBeGreaterThan(10);
	});

	it('does not descend into .claude/, where a second checkout of this repository can sit', () => {
		// an agent working in an isolated git worktree leaves the checkout under
		// `.claude/worktrees/`, and a checkout is a whole copy of this repository: its own
		// `quickbooks.ts` reads as a second speaker and so does its copy of this file. asserted
		// against a fixture, because `.claude/` is absent from a clean checkout and a claim about a
		// directory that is not there passes without reading anything.
		const root = mkdtempSync(join(tmpdir(), 'accounting-sole-importer-'));
		try {
			const checkout = join(root, '.claude', 'worktrees', 'agent-1', 'src');
			mkdirSync(checkout, { recursive: true });
			writeFileSync(join(checkout, 'quickbooks.ts'), "fetch('https://appcenter.intuit.com');\n");
			mkdirSync(join(root, 'src'), { recursive: true });
			writeFileSync(join(root, 'src', 'kept.ts'), 'export const kept = true;\n');

			expect(sourceFiles(root).map((f) => relative(root, f))).toEqual([join('src', 'kept.ts')]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it.each(GUARDED_PACKAGES)('finds no import of `$specifier` anywhere', ({ specifier }) => {
		const offenders: string[] = [];
		for (const file of files) {
			const source = readFileSync(file, 'utf8');
			for (const { label, re } of importers(specifier)) {
				if (re.test(source)) offenders.push(`${relative(ROOT, file)} (${label})`);
			}
		}
		expect(
			offenders,
			`these modules import \`${specifier}\`: ${offenders.join(', ')}. no Intuit package is installed and none is to be added — take \`AccountingProvider\` from src/lib/server/accounting/provider.ts, which src/lib/server/accounting/quickbooks.ts implements over \`fetch\`. if the port does not expose what you need, widen the port.`
		).toEqual([]);
	});

	it.each(GUARDED_PACKAGES)('matches every way of importing `$specifier`', ({ specifier }) => {
		// without this, a typo'd pattern that matches nothing anywhere would report a clean tree
		// forever — and nothing in the repository imports either package, so there is no real source
		// to catch it.
		const written = [
			`import Sdk from '${specifier}';`,
			`import "${specifier}";`,
			`const sdk = await import('${specifier}');`,
			`const sdk = require('${specifier}');`
		];
		for (const line of written) {
			expect(
				importers(specifier).some(({ re }) => re.test(line)),
				`no pattern matched: ${line}`
			).toBe(true);
		}
	});

	it.each(GUARDED_HOSTS)('finds no mention of %s outside the adapter', (host) => {
		const offenders = files
			.filter((file) => mentions(host).test(readFileSync(file, 'utf8')))
			.map((file) => relative(ROOT, file));
		expect(
			offenders,
			`these modules name \`${host}\` themselves: ${offenders.join(', ')}. only src/lib/server/accounting/quickbooks.ts may reach Intuit — a route that needs the connect url, the code exchange or a company's books takes them from the accounting port. an address written a second time is a second translation of Intuit's API, with no minor version pinned, no token refreshed and no failure classified.`
		).toEqual([]);
	});

	it.each(GUARDED_HOSTS)(
		'matches %s in the adapter, so the pattern works on real source',
		(host) => {
			// the case above is written from the same idea as the pattern, so it cannot catch a rule that
			// is wrong about how the address is actually spelled. this one reads a file nobody wrote for
			// it — which is also what holds the adapter to being where every Intuit address lives.
			expect(mentions(host).test(readFileSync(ADAPTER, 'utf8'))).toBe(true);
		}
	);
});
