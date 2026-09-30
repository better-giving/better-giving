import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// every press on this console forgets every processor page kept between visits before it does
// anything else (`forgetReadings` in ./lib/processor-cache.ts).
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
// that answers it**: one that writes nothing, and one whose write is no processor's input. it reads
// the body to know itself, answers from that branch alone, and the forget is the next thing after
// it — a second way out ahead of the forget is a write answered from memory again.

const ROUTES = join(import.meta.dirname, 'routes');

const ACTION = 'export async function clientAction({ request }: Route.ClientActionArgs) {\n';

const FORGET = 'await forgetReadings();';

/** each route whose action answers, before it forgets, a press that changes no processor page. */
const READ_FIRST: Record<string, string> = {
	// the start-date preview, which writes nothing
	'_sections.quickbooks.tsx': "if (intent === quickbooksIntent('start-date-preview')) {",
	// the paid-plan switch, whose value is an answer about the cloudflare account
	'_index.tsx': 'if (intent === PLAN_INTENT) return'
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

	it.each(actions)('forgets the kept processor pages first, in $name', ({ name, source }) => {
		const at = source.indexOf(ACTION);
		expect(at).toBeGreaterThanOrEqual(0);
		const body = source.slice(at + ACTION.length);
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
