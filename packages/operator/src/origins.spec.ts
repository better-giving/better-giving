import { describe, expect, it } from 'vitest';
import {
	MAX_ALLOWED_ORIGINS,
	MAX_ORIGIN_LENGTH,
	hostOf,
	hostsOf,
	readOriginList,
	readOriginRows
} from './origins';

// node pool, no database and no browser: every rule here is decidable from the submitted text, and
// the whole module reads a string with the platform's own `URL`.
//
// it is asserted here rather than only through a caller because both surfaces call it. the app's
// own specs put these rules through the parsers that wrap them
// (`packages/app/src/lib/server/forms/form-input.spec.ts`,
// `packages/app/src/lib/server/sites/site-input.spec.ts`) and the console's put them through the
// press that stops in front of them (`packages/console-ui/src/lib/sites.spec.ts`) — so a
// rule that changed shape would be answerable in either package and stated in neither.

describe('a list of typed rows, read', () => {
	it('takes a whole origin as it was written', () => {
		expect(readOriginList(['https://give.example.org'])).toEqual({
			origins: ['https://give.example.org'],
			problem: null
		});
	});

	it('trims a row and drops the ones an operator never typed into', () => {
		expect(readOriginList(['  https://give.example.org ', '', '   '])).toEqual({
			origins: ['https://give.example.org'],
			problem: null
		});
	});

	it('stores what the row normalised to rather than the line that was typed', () => {
		// the two ways an address arrives at a box: typed off the top of the operator's head, and
		// pasted out of a browser's address bar. neither is a mistake and neither is stored as it
		// stands — what is stored is the origin, which is what the browser will send.
		expect(readOriginList(['acme.org', 'https://give.acme.org/donate?from=email#top'])).toEqual({
			origins: ['https://acme.org', 'https://give.acme.org'],
			problem: null
		});
	});

	it('names a site written into two boxes, and still hands the list back deduped', () => {
		// the sentence and the list are for two different callers: one gates on the sentence and
		// refuses the whole list, one reads `origins` for what would be stored and never asks. and
		// first-seen order is the operator’s — a list that came back re-sorted reads as the form
		// having eaten an edit.
		const { origins, problem } = readOriginList([
			'https://b.example.org',
			'https://a.example.org',
			'https://b.example.org'
		]);

		expect(origins).toEqual(['https://b.example.org', 'https://a.example.org']);
		expect(problem).toBe('duplicate site');
	});

	it('reads two spellings of one host as one site, and stores the first', () => {
		// the scheme and the port are what `/api/v1` compares literally and what a fundraiser does
		// not distinguish, so the list is deduped on the host and the origin is stored whole.
		const { origins, problem } = readOriginList(['https://x.example', 'https://x.example:8443']);

		expect(origins).toEqual(['https://x.example']);
		expect(problem).toBe('duplicate site');
	});

	it('reads a bare hostname and the address it normalises to as one site', () => {
		// the repair is what makes them one: both boxes hold `https://acme.org` by the time the list
		// is read, so the second is a box to delete rather than a second entry.
		const { origins, problem } = readOriginList(['acme.org', 'https://acme.org']);

		expect(origins).toEqual(['https://acme.org']);
		expect(problem).toBe('duplicate site');
	});

	it('says the same thing once however many rows earned it', () => {
		const { problem } = readOriginList([
			'https://a.example.org',
			'https://b.example.org',
			'https://a.example.org',
			'https://b.example.org'
		]);

		expect(problem).toBe('duplicate site');
	});

	it('counts the sites it would store, so a repeat is never refused as an extra row', () => {
		// the cap and the dedupe are one list read twice and they have to agree about it: a list
		// that would store fifty sites is refused for the repeat and never for holding fifty-one
		// rows.
		const rows = Array.from(
			{ length: MAX_ALLOWED_ORIGINS },
			(_, index) => `https://site-${index}.example.org`
		);
		const { problem } = readOriginList([...rows, rows[0]!]);

		expect(problem).toBe('duplicate site');
	});

	it('owes a repeated bad row both sentences, because they are two different edits', () => {
		const { problem } = readOriginList(['https:', 'https:']);

		expect(problem).toBe('duplicate site, invalid url');
	});

	it('says each thing that is wrong with the list and nothing twice', () => {
		const { problem } = readOriginList(['https:', 'https:/', 'http://a.example']);

		expect(problem).toBe('invalid url, https only');
	});

	it('keeps the rows it can read out of a list that holds one it cannot', () => {
		expect(readOriginList(['https://good.example.org', 'https:']).origins).toEqual([
			'https://good.example.org'
		]);
	});

	it('says one thing about a list over the count cap and nothing about its rows', () => {
		const rows = Array.from(
			{ length: MAX_ALLOWED_ORIGINS + 1 },
			(_, index) => `https://site-${index}.example.org`
		);
		const { origins, problem } = readOriginList(rows);

		expect(origins).toEqual([]);
		expect(problem).toBe(`cannot exceed ${MAX_ALLOWED_ORIGINS} sites`);
	});
});

describe('what one row is repaired into, or turned down for', () => {
	const problem = (line: string) => readOriginList([line]).problem;
	const stored = (line: string) => readOriginList([line]).origins;

	it('drops the trailing slash a browser’s address bar shows', () => {
		// the defect this rule exists to stop: `/api/v1` compares an `Origin` header literally, so a
		// stored `https://example.org/` matches nothing a browser ever sends.
		expect(stored('https://example.org/')).toEqual(['https://example.org']);
		expect(problem('https://example.org/')).toBeNull();
	});

	it('drops a page, a query and a fragment off the end of it', () => {
		expect(stored('https://example.org/donate?amount=25#form')).toEqual(['https://example.org']);
		expect(problem('https://example.org/donate?amount=25#form')).toBeNull();
	});

	it('adds the scheme a bare hostname has none of', () => {
		expect(stored('example.org')).toEqual(['https://example.org']);
		expect(problem('example.org')).toBeNull();
	});

	it('drops a default port and lowercases the host, which the browser does too', () => {
		expect(stored('HTTPS://Example.org:443')).toEqual(['https://example.org']);
	});

	it('refuses a scheme with no address after it rather than inventing one', () => {
		// `https://https:` parses and holds the host `https`, so a scheme concatenated in front of
		// every line is a repair that stores an address nobody typed.
		expect(problem('https:')).toBe('invalid url');
		expect(stored('https:')).toEqual([]);
	});

	it('refuses a wildcard, which `new URL` would take', () => {
		expect(problem('https://*.example.org')).toBe('invalid url');
		expect(problem('*')).toBe('invalid url');
	});

	it('refuses a host no browser resolves, however well it parses', () => {
		for (const line of [
			'https://.example.org',
			'https://acme..org',
			'https://-acme.org',
			'https://acme.org:0',
			'https://acme.org.'
		]) {
			expect(problem(line)).toBe('invalid url');
		}
	});

	it('refuses plain http anywhere but the machine a developer is sitting at', () => {
		// about what works rather than about spelling, which is why it is the one thing here that is
		// not repaired: a form loaded over plain http is a form no browser will let take a card.
		expect(problem('http://example.org')).toBe('https only');
		expect(readOriginList(['http://localhost:5173']).origins).toEqual(['http://localhost:5173']);
		expect(readOriginList(['http://127.0.0.1:8788']).origins).toEqual(['http://127.0.0.1:8788']);
		expect(readOriginList(['http://[::1]:5173']).origins).toEqual(['http://[::1]:5173']);
	});

	it('refuses a row over the length cap without echoing it', () => {
		const long = `https://${'a'.repeat(MAX_ORIGIN_LENGTH)}.example`;

		expect(problem(long)).toBe(`cannot exceed ${MAX_ORIGIN_LENGTH} characters`);
		expect(problem(long)).not.toContain(long);
	});

	it('takes a port, which is one of the two things a dev server has', () => {
		expect(stored('https://give.example.org:8443')).toEqual(['https://give.example.org:8443']);
		// a colon and digits is a port and not a scheme, so a bare host keeps it through the repair.
		expect(stored('give.example.org:8443')).toEqual(['https://give.example.org:8443']);
	});

	it('never says a word about the row it is refusing', () => {
		// the box the sentence stands under is showing the operator what they typed, and an invented
		// correction is a second thing to be wrong about.
		for (const line of ['https:', 'https://*.example.org', 'http://example.org']) {
			expect(problem(line)).not.toContain(line);
		}
	});
});

describe('the same list read one row at a time', () => {
	it('hands back a sentence per row at the position the row was in', () => {
		const { problem, rows } = readOriginRows(['https://good.example', 'https:']);

		expect(problem).toBeNull();
		expect(rows[0]).toBeNull();
		expect(rows[1]).toBe('invalid url');
	});

	it('leaves a row nobody has typed into unmarked, wherever it stands', () => {
		// the fold opens on one empty box over a deployment holding no site, and the Add leaves
		// another behind it — marking either would refuse a form nobody has filled in.
		expect(readOriginRows(['', '  ', 'https://good.example']).rows).toEqual([null, null, null]);
	});

	it('leaves a row it can repair unmarked', () => {
		expect(readOriginRows(['acme.org', 'https://give.acme.org/donate']).rows).toEqual([null, null]);
	});

	it('marks every box holding an address written above it, and not the first of them', () => {
		const { rows } = readOriginRows([
			'https://a.example',
			'https://b.example',
			'https://a.example',
			'https://a.example'
		]);

		expect(rows[0]).toBeNull();
		expect(rows[1]).toBeNull();
		expect(rows[2]).toBe('duplicate site');
		expect(rows[3]).toBe('duplicate site');
	});

	it('marks the second spelling of one host at its own box, before the shape is read', () => {
		// the pair a console operator meets: `http://` is refused everywhere but the loopback, and
		// the repeat is the sentence that stands, because deleting the box is the whole of the fix.
		const { rows } = readOriginRows(['https://x.example', 'http://x.example']);

		expect(rows[0]).toBeNull();
		expect(rows[1]).toBe('duplicate site');
	});

	it('marks the second of a bare hostname and the address it normalises to', () => {
		// the box that has to go is the second one, whichever spelling it holds: the first is a site
		// the deployment can store.
		expect(readOriginRows(['acme.org', 'https://acme.org']).rows).toEqual([null, 'duplicate site']);
		expect(readOriginRows(['https://acme.org', 'acme.org']).rows).toEqual([null, 'duplicate site']);
	});

	it('never echoes the address a repeated box is already showing', () => {
		const { rows } = readOriginRows(['https://a.example', 'https://a.example']);

		expect(rows[1]).not.toContain('a.example');
	});

	it('tells the second box of a bad address to go and marks the first for what it is', () => {
		const { rows } = readOriginRows(['https:', 'https:']);

		expect(rows[0]).toBe('invalid url');
		expect(rows[1]).toBe('duplicate site');
	});

	it('says one thing about a list over the count cap and nothing about any row', () => {
		const rows = Array.from(
			{ length: MAX_ALLOWED_ORIGINS + 1 },
			(_, index) => `https://site-${index}.example.org`
		);
		const read = readOriginRows(rows);

		expect(read.problem).toBe(`cannot exceed ${MAX_ALLOWED_ORIGINS} sites`);
		expect(read.rows.filter((row) => row !== null)).toEqual([]);
	});

	it('counts what would be stored, so a repeat is never refused as an extra row', () => {
		// the same agreement `readOriginList` keeps: fifty sites and one repeat is a repeat to
		// delete, named at the box holding it, rather than a list one row too long.
		const rows = Array.from(
			{ length: MAX_ALLOWED_ORIGINS },
			(_, index) => `https://site-${index}.example.org`
		);
		const read = readOriginRows([...rows, rows[0]!]);

		expect(read.problem).toBeNull();
		expect(read.rows[MAX_ALLOWED_ORIGINS]).toBe('duplicate site');
	});

	it('words the cap exactly as the list reading does', () => {
		// one sentence and two readers: a cap raised in one is never a cap left standing in the
		// other's words.
		const rows = Array.from(
			{ length: MAX_ALLOWED_ORIGINS + 1 },
			(_, index) => `https://site-${index}.example.org`
		);

		expect(readOriginRows(rows).problem).toBe(readOriginList(rows).problem);
	});

	it('turns a row down for everything one row is turned down for', () => {
		expect(readOriginRows(['https://*.example.org']).rows[0]).toBe('invalid url');
		expect(readOriginRows(['https://-acme.org']).rows[0]).toBe('invalid url');
		expect(readOriginRows(['http://example.org']).rows[0]).toBe('https only');
		expect(readOriginRows([`https://${'a'.repeat(MAX_ORIGIN_LENGTH)}.example`]).rows[0]).toBe(
			`cannot exceed ${MAX_ORIGIN_LENGTH} characters`
		);
	});
});

describe('the host inside an origin', () => {
	it('leaves the port with the scheme', () => {
		expect(hostOf('https://give.example.org:8443')).toBe('give.example.org');
	});

	it('reads a value with no address in it as no host rather than as an error', () => {
		expect(hostOf('https://g')).toBe('g');
		expect(hostOf('https:/')).toBeNull();
		expect(hostOf('mailto:someone')).toBeNull();
	});

	it('drops a row with no host in it and never repeats a host', () => {
		expect(hostsOf(['https://example.org', '', 'https://example.org:8443'])).toEqual([
			'example.org'
		]);
	});
});
