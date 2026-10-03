import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// the guard on "only the settle path may call `readSettlement`".
//
// why this test exists. `readSettlement` on `PaymentProvider` (./provider.ts) is not a pure read: on
// PayPal it may capture an approved order, so calling it from a page's loader moves money on a GET.
// the callers are the modules that reconcile a delivery or a collection into the books, and the set
// is held here rather than named in the port's doc, where a list of callers drifts the day a fourth
// appears.
//
// a new caller is a decision: add it to `CALLERS` in the same change that argues why it may capture.
//
// a source scan, written the way ./sole-importer.spec.ts is. it reads text, so a computed property
// name or a destructured method fools it; what it defends against is a shortcut, not an adversary.
// exempt: specs and `.testing.ts` modules (a fixture calls the arm to assert on it), and ./provider.ts,
// whose `sealed` wrapper forwards the arm to the adapter it wraps. an adapter defines the arm
// (`async readSettlement(`) and never calls it through a dot.

const SRC = resolve(import.meta.dirname, '../../..');
const PORT = resolve(import.meta.dirname, 'provider.ts');

const CALLERS = [
	'lib/server/donations/collect.ts',
	'lib/server/donations/settle.ts',
	'lib/server/donations/tracking-ids.ts'
];

const EXTENSIONS = ['.ts', '.tsx'];

/** a call through a receiver, `?.` and a line break after the dot included. */
const CALL = /\.\s*readSettlement\s*\(|\?\.\s*readSettlement\s*\(/;

function isTest(name: string): boolean {
	return /\.(?:spec|test|testing)\.[jt]sx?$/.test(name);
}

/** every non-test source file under `dir`, minus the port. */
function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			sourceFiles(path, out);
		} else if (
			EXTENSIONS.some((e) => entry.name.endsWith(e)) &&
			!isTest(entry.name) &&
			path !== PORT
		) {
			out.push(path);
		}
	}
	return out;
}

function callers(files: string[]): string[] {
	return files
		.filter((file) => CALL.test(readFileSync(file, 'utf8')))
		.map((file) => relative(SRC, file))
		.sort();
}

describe('readSettlement is called only by the settle path', () => {
	const files = sourceFiles(SRC);

	it('finds source files to scan at all, and no spec among them', () => {
		const names = files.map((f) => relative(SRC, f));
		expect(names).toContain('lib/server/donations/settle.ts');
		expect(names).toContain('lib/server/payments/paypal.ts');
		expect(names).not.toContain('lib/server/payments/provider.ts');
		expect(names.some((n) => /\.(?:spec|test)\./.test(n))).toBe(false);
		expect(names.length).toBeGreaterThan(10);
	});

	it('is called by exactly donations/settle.ts, donations/collect.ts and donations/tracking-ids.ts', () => {
		const found = callers(files);
		expect(
			found,
			`the modules calling \`readSettlement\` are ${found.join(', ')}, and only ${CALLERS.join(', ')} may. the arm may capture an approved PayPal order (see ./provider.ts), so a page read or any path that is not reconciling a delivery or a collection must not call it. if the new caller does reconcile one, add it to CALLERS in ${relative(SRC, resolve(import.meta.filename))} and say why.`
		).toEqual(CALLERS);
	});

	it('matches each real caller, so the pattern is known to work on source', () => {
		for (const caller of CALLERS) {
			expect(CALL.test(readFileSync(join(SRC, caller), 'utf8')), caller).toBe(true);
		}
	});

	it('matches a call however it is spelled and passes the arm’s definition and prose', () => {
		for (const call of [
			'await provider.readSettlement(id)',
			'await provider?.readSettlement(id)',
			'await providers\n\t.for(rail)\n\t.readSettlement(id)'
		]) {
			expect(CALL.test(call), call).toBe(true);
		}
		for (const other of [
			'async readSettlement(providerTxnId: string) {',
			'readSettlement: unused()',
			'// `readSettlement` in $lib/server/payments/paypal.ts'
		]) {
			expect(CALL.test(other), other).toBe(false);
		}
	});
});
