import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// every press on this console is watched and then forgets every processor page kept between visits
// before it does anything else (`watchPress` in ./lib/console-reading.ts, `forgetReadings` in
// ./lib/processor-cache.ts).
//
// **watched first, on every press without exception**: a press the router drops is one the reading
// on screen may predate, and the mark that says so is made off the press's own request. a route
// whose action skips the call is a page that keeps drawing what it held before a write that landed.
//
// the re-read after a press is what draws the press's outcome, and a processor page answered from
// memory would draw what the deployment held before the write. nothing on the page that pressed
// says so — the page left is the one out of date — so a route whose action skips the call fails
// nowhere a reader would look.
//
// **first, and before the body is read**: a press that answers early — a refused box, a body naming
// nothing — has still been made, and the call after the branch that returned is the one it skipped.
//
// **except a press that changes nothing a processor page is drawn from, named below by the branch
// that answers it**: one that writes nothing. it reads the body to know itself, answers from that
// branch alone, and the forget is the next thing after it — a second way out ahead of the forget is
// a write answered from memory again.

const ROUTES = join(import.meta.dirname, 'routes');

const ACTION = 'export async function clientAction({ request }: Route.ClientActionArgs) {\n';

const WATCH = 'watchPress(request);';

const FORGET = 'await forgetReadings();';

/** each route whose action answers, before it forgets, a press that changes no processor page. */
const READ_FIRST: Record<string, string> = {
	// the start-date preview, which writes nothing
	'_sections.quickbooks.tsx': "if (intent === quickbooksIntent('start-date-preview')) {"
};

const actions = readdirSync(ROUTES)
	.filter((name) => name.endsWith('.tsx'))
	.map((name) => ({ name, source: readFileSync(join(ROUTES, name), 'utf8') }))
	// a route exporting an action in any shape, and not one naming another route's for a type.
	.filter(({ source }) => /^export\b.*\bclientAction\b/m.test(source));

describe('every clientAction in routes/', () => {
	it('finds the actions it is guarding', () => {
		expect(actions.length).toBeGreaterThan(0);
	});

	it.each(actions)('watches the press first, in $name', ({ source }) => {
		const at = source.indexOf(ACTION);
		expect(at).toBeGreaterThanOrEqual(0);
		expect(
			source
				.slice(at + ACTION.length)
				.split('\n')[0]
				?.trim()
		).toBe(WATCH);
	});

	it.each(actions)('forgets the kept processor pages next, in $name', ({ name, source }) => {
		const at = source.indexOf(ACTION);
		expect(at).toBeGreaterThanOrEqual(0);
		const watched = source.slice(at + ACTION.length);
		const body = watched.slice(watched.indexOf('\n') + 1);
		const read = READ_FIRST[name];
		if (read === undefined) {
			expect(body.split('\n')[0]?.trim()).toBe(FORGET);
			return;
		}
		const before = body.slice(0, body.indexOf(FORGET));
		expect(before).toContain(read);
		expect(before.match(/\breturn\b/g)).toHaveLength(1);
		expect(before.indexOf('return')).toBeGreaterThan(before.indexOf(read));
	});
});
