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
// and every one of them has one home.
//
// **speaking is what the rule is about, and vocabulary is not speaking.** the production host is
// stated in packages/operator/src/console/quickbooks.ts, which the deployment and the operator
// console both read and which holds no `fetch` and makes no call of its own; the sandbox host and
// the three OAuth addresses are stated in ./quickbooks.ts. so a host is swept against the file that
// holds it rather than against one file for all five.
//
// **a name is guarded where the address would have been.** a host reachable by import is a host a
// route can `fetch` with nothing left in it for the sweep above to catch, so who may take
// `QUICKBOOKS_PRODUCTION_URL` out of that module is swept as well. two modules may: ./quickbooks.ts,
// which calls Intuit, and packages/console-ui/src/lib/quickbooks-section.tsx, which draws it as the
// example an empty box stands on. everything else in this app takes it from ./quickbooks.ts, which
// re-exports it.
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
// what is exempt: this file, which necessarily contains everything it searches for; each host's own
// home, for that host and no other; and every `*.spec.ts` from the hostname sweep.

const ROOT = resolve(import.meta.dirname, '../../../../../..');
const SELF = resolve(import.meta.filename);
const ADAPTER = resolve(import.meta.dirname, 'quickbooks.ts');

/** where the production host is stated, and the module it is imported from. */
const VOCABULARY = resolve(ROOT, 'packages/operator/src/console/quickbooks.ts');
const VOCABULARY_SPECIFIER = '@better-giving/operator/console/quickbooks';

/** the console section that draws the production address as a placeholder example. */
const SECTION = resolve(ROOT, 'packages/console-ui/src/lib/quickbooks-section.tsx');

/** the name {@link VOCABULARY} states that host under. */
const HOST_NAME = 'QUICKBOOKS_PRODUCTION_URL';

/** the two modules that may take {@link HOST_NAME} straight out of {@link VOCABULARY}. */
const HOST_NAME_READERS = [ADAPTER, SECTION];

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
 * every Intuit address this app may reach, each with the one file it is stated in.
 *
 * the Accounting API hosts are two because sandbox and production are separate hosts holding
 * separate companies, and a deployment is built against one of them. the three OAuth addresses are
 * where a browser is sent to authorise and where the two token calls go.
 *
 * `developer.intuit.com` is deliberately absent: it is Intuit's documentation, cited in comments,
 * and a rule that flagged a doc link would be a rule people delete.
 */
const GUARDED_HOSTS = [
	{ host: 'quickbooks.api.intuit.com', home: VOCABULARY },
	{ host: 'sandbox-quickbooks.api.intuit.com', home: ADAPTER },
	{ host: 'oauth.platform.intuit.com', home: ADAPTER },
	{ host: 'appcenter.intuit.com', home: ADAPTER },
	{ host: 'developer.api.intuit.com', home: ADAPTER }
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

/**
 * every authored source file in the repository, minus this spec.
 *
 * an exemption belongs to the rule that grants it rather than to this list: each host has one home
 * and is swept through every other file, the other hosts' homes included — a list with both homes
 * already dropped would exempt each of them from the four rules it is not the home of.
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (SKIP.has(entry.name)) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			sourceFiles(path, out);
		} else if (EXTENSIONS.some((e) => entry.name.endsWith(e)) && path !== SELF) {
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
 *
 * it begins at a hostname boundary and ends nowhere, because one guarded host ends with another:
 * `sandbox-quickbooks.api.intuit.com` holds `quickbooks.api.intuit.com`, and the two have different
 * homes. left open at the front, the production rule would name the file that states the sandbox
 * one. the end stays open so that a host spelled inside a longer url is still caught, which is how
 * a real offender writes one.
 */
function mentions(host: string): RegExp {
	return new RegExp(`(?<![\\w.-])${host.replaceAll('.', '\\.')}`);
}

/**
 * whether a file takes {@link HOST_NAME} out of {@link VOCABULARY}.
 *
 * the clause is what is read, because the name is legal to import from ./quickbooks.ts and the
 * whole of what this sweep asks is which module it was taken from — a name matched loose would
 * flag every reader of the port.
 *
 * a namespace binding counts: it puts every name the module states behind one identifier, which is
 * the same reach written in a way the clause pattern cannot see.
 */
function takesHostName(source: string): boolean {
	const quoted = `['"]${VOCABULARY_SPECIFIER.replaceAll('/', '\\/')}['"]`;
	const clauses = new RegExp(
		`\\b(?:import|export)\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*${quoted}`,
		'g'
	);
	for (const match of source.matchAll(clauses)) {
		if (new RegExp(`\\b${HOST_NAME}\\b`).test(match[1] ?? '')) return true;
	}
	return new RegExp(`\\bimport\\s+(?:type\\s+)?\\*\\s+as\\s+\\w+\\s+from\\s*${quoted}`).test(
		source
	);
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

	it.each(GUARDED_HOSTS)(
		'finds no mention of $host outside the file that states it',
		({ host, home }) => {
			const offenders = files
				// a spec's fixture is a string being asserted on and never a second speaker to Intuit, so
				// the file is exempt rather than the pattern narrowed: an anchored pattern would go on
				// passing over the host spelled inside a longer url, which is how a real offender is
				// written.
				.filter((file) => file !== home && !file.endsWith('.spec.ts'))
				.filter((file) => mentions(host).test(readFileSync(file, 'utf8')))
				.map((file) => relative(ROOT, file));
			expect(
				offenders,
				`these modules name \`${host}\` themselves: ${offenders.join(', ')}. it is stated in ${relative(ROOT, home)} and nowhere else — a module that needs the connect url, the code exchange or a company's books takes them from the accounting port (src/lib/server/accounting/provider.ts). an address written a second time is a second translation of Intuit's API, with no minor version pinned, no token refreshed and no failure classified.`
			).toEqual([]);
		}
	);

	it.each(GUARDED_HOSTS)(
		'matches $host where it is stated, so the pattern works on real source',
		({ host, home }) => {
			// the case above is written from the same idea as the pattern, so it cannot catch a rule that
			// is wrong about how the address is actually spelled. this one reads a file nobody wrote for
			// it — which is also what holds each host to having a home at all.
			expect(mentions(host).test(readFileSync(home, 'utf8'))).toBe(true);
		}
	);

	it('does not read one guarded host inside another', () => {
		// the two Accounting hosts have different homes and one ends with the other, so a production
		// rule that matched the sandbox spelling would name the adapter every run — and a host in the
		// middle of a url has to go on being caught.
		const production = mentions('quickbooks.api.intuit.com');
		expect(production.test('https://sandbox-quickbooks.api.intuit.com')).toBe(false);
		expect(production.test('https://quickbooks.api.intuit.com/v3/company/1/query')).toBe(true);
	});

	it(`finds no module but those two taking \`${HOST_NAME}\` out of the vocabulary`, () => {
		const offenders = files
			.filter((file) => !HOST_NAME_READERS.includes(file))
			.filter((file) => takesHostName(readFileSync(file, 'utf8')))
			.map((file) => relative(ROOT, file));
		expect(
			offenders,
			`these modules import \`${HOST_NAME}\` from ${VOCABULARY_SPECIFIER}: ${offenders.join(', ')}. a host held as a name is a host that can be reached with no address written anywhere for the sweep above to catch — take what the books need from the accounting port (src/lib/server/accounting/provider.ts), and take the name itself from src/lib/server/accounting/quickbooks.ts, which re-exports it for everything in this app.`
		).toEqual([]);
	});

	it.each(HOST_NAME_READERS.map((file) => ({ reader: relative(ROOT, file), file })))(
		'sees $reader take it, so the pattern works on real source',
		({ file }) => {
			// the same guard the host patterns get: a specifier spelled wrong, or a clause pattern that
			// cannot see a multi-line import, would report a clean tree forever.
			expect(takesHostName(readFileSync(file, 'utf8'))).toBe(true);
		}
	);

	it('matches every way of taking that name, and no way of taking another', () => {
		const taken = [
			`import { ${HOST_NAME} } from '${VOCABULARY_SPECIFIER}';`,
			`import {\n\t${HOST_NAME}\n} from "${VOCABULARY_SPECIFIER}";`,
			`export { ${HOST_NAME} } from '${VOCABULARY_SPECIFIER}';`,
			`import * as quickbooks from '${VOCABULARY_SPECIFIER}';`
		];
		for (const line of taken) {
			expect(takesHostName(line), `no pattern matched: ${line}`).toBe(true);
		}
		// the module states more than that one name, and a reader of the rest is not a second
		// speaker: packages/console-ui/src/lib/quickbooks-standing.ts takes its types and
		// `QUICKBOOKS_RECOURSES` from it and reaches no host by doing so.
		expect(takesHostName(`import { QUICKBOOKS_RECOURSES } from '${VOCABULARY_SPECIFIER}';`)).toBe(
			false
		);
	});
});
