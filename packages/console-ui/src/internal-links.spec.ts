import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// every destination inside the console is reached through react router, and never through a bare
// anchor.
//
// **what a bare anchor to an internal address costs is the console's whole state.** the console is
// one page whose faces are how far set-up has got, and every one of those faces is loader data —
// the connection, the account, the readings each fold draws. a full document load throws all of it
// away and pays for it again, which reads to an operator as the console forgetting what it just
// told them.
//
// **the type system cannot say it.** `as="a"` and a plain `<a href>` are both legitimate — the
// console links out to the cloudflare dashboard, to stripe, to five smtp providers — and what
// separates a correct one from a defect is whether the address is this app's, which is a fact about
// the string rather than about the element. so it is a source sweep, in the idiom of
// ./raw-values.spec.ts: the surface that owns the screens writes the glob, and the case below says
// the glob still reaches them.
//
// **an internal address is one written as a literal beginning with `/`.** an address held in a
// variable is not read here and cannot be — `href={DASHBOARD}` is external and `href={dashboard}` is
// a value the loader computed — so what this catches is the shape somebody types by hand.

/** the line-level bargain, for a case this rule is genuinely wrong about. */
const EXEMPT = 'full-load-ok:';

const INTERNAL_ANCHOR = /<a\b[^>]*\bhref="\/[^"]*"/;
const TAG_NAME_ANCHOR = /\bas="a"/;

/** one entry per offending line: the file, the line number, and the line as written. */
function violations(files: string[]) {
	const found: string[] = [];
	for (const file of files) {
		const lines = readFileSync(file, 'utf8').split('\n');
		lines.forEach((line, index) => {
			if (line.includes(EXEMPT)) return;
			if (!INTERNAL_ANCHOR.test(line) && !TAG_NAME_ANCHOR.test(line)) return;
			found.push(`${file}:${index + 1} ${line.trim()}`);
		});
	}
	return found;
}

describe('no internal destination outside the router', () => {
	const screens = globSync('src/**/*.tsx').filter((file) => !file.includes('.spec.'));

	it('finds the files it is meant to be guarding', () => {
		// without this the suite passes loudest when the glob is wrong and nothing is read, which is
		// the failure the whole file exists to refuse — ./raw-values.spec.ts states the same case for
		// the same reason.
		expect(screens.length).toBeGreaterThan(0);
	});

	it('reaches no internal address through a bare anchor', () => {
		// `<Link to="/…">` is the shape, and `<Button as={Link} to="/…">` where the destination is
		// drawn as a press. packages/operator declares no router and cannot, which is why `as` takes
		// an element type and the surface hands its own `Link` in.
		expect(violations(screens)).toEqual([]);
	});

	it('sees an internal anchor when one is written', () => {
		// the rule is a regular expression over source text, so it is worth one case proving it says
		// something — a gate that matches nothing passes exactly like a gate that has nothing to say.
		expect(INTERNAL_ANCHOR.test('on <a href="/">the console page</a>')).toBe(true);
		expect(INTERNAL_ANCHOR.test('<a href="https://dash.cloudflare.com" target="_blank">')).toBe(
			false
		);
		expect(TAG_NAME_ANCHOR.test('<Button as="a" href="/setup">')).toBe(true);
		expect(TAG_NAME_ANCHOR.test('<Button as={Link} to="/setup">')).toBe(false);
	});
});
