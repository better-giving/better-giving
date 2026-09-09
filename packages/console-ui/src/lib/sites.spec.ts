import { parseWithZod } from '@conform-to/zod/v4';
import { describe, expect, it } from 'vitest';
import { SITES_FORM, SITE_FIELD, siteEdits, siteSeed } from './sites';

// the two readings the site boxes get, both decidable from the submitted text and neither needing a
// document: the list the boxes are opened on, and which box each sentence of the pass in front of
// the press is keyed to.
//
// the rules themselves are asserted where they are written
// (`packages/operator/src/origins.spec.ts`) — what is asserted here is the shape conform reads them
// through, which is the half that can go wrong without either end changing its mind about a value:
// a sentence keyed to the group where a box was meant is a message the operator cannot act on, and
// one keyed to the wrong index is a mark on a box holding a perfectly good address.

/** the boxes as the form posts them: one entry per row, indexed by the row's position. */
function posted(rows: readonly string[]): FormData {
	const body = new FormData();
	rows.forEach((row, at) => {
		body.append(`${SITE_FIELD}[${at}]`, row);
	});
	return body;
}

/** every sentence the pass raised, by the name of the box it was keyed to. */
function refused(rows: readonly string[]): Record<string, string[]> {
	const submission = parseWithZod(posted(rows), { schema: SITES_FORM.schema });
	const replied = submission.reply();
	const error: Record<string, string[]> = {};
	for (const [name, said] of Object.entries(replied.error ?? {})) {
		if (said !== null && said !== undefined) error[name] = said;
	}
	return error;
}

describe('the pass the sites press runs first', () => {
	it('takes a list of stored addresses without a word about any of them', () => {
		expect(refused(['https://give.example.org', 'https://www.example.org'])).toEqual({});
	});

	it('refuses every box holding nothing, under that box and in one word', () => {
		// every box a form states must arrive (CLAUDE.md), and a blank means nothing else here: the
		// list is emptied by dropping the rows rather than by clearing them.
		expect(refused([''])).toEqual({ [`${SITE_FIELD}[0]`]: ['required'] });
		expect(refused(['https://give.example.org', '  '])).toEqual({
			[`${SITE_FIELD}[1]`]: ['required']
		});
	});

	it('says nothing at all about a list with no rows in it, which is the press that empties it', () => {
		expect(refused([])).toEqual({});
	});

	it('keys a row’s own sentence to that row’s own box and marks no other', () => {
		const error = refused(['https://give.example.org', 'https:']);

		expect(Object.keys(error)).toEqual([`${SITE_FIELD}[1]`]);
		expect(error[`${SITE_FIELD}[1]`]?.[0]).toBe('invalid url');
	});

	it('says nothing about a row the rules repair, which is most of what gets typed', () => {
		// a bare hostname and an address pasted out of a browser are both stored as the origin they
		// normalise to (`@better-giving/operator/origins`), so neither is a box to mark.
		expect(refused(['give.example.org', 'https://www.example.org/donate?from=email'])).toEqual({});
	});

	it('counts the blank rows in when it keys a sentence, so the mark lands on the right box', () => {
		// the boxes are posted at their own positions and a blank one is still a position: a reader
		// that dropped the blanks before counting would mark the box above the offending one.
		const error = refused(['', 'https:']);

		expect(Object.keys(error)).toEqual([`${SITE_FIELD}[0]`, `${SITE_FIELD}[1]`]);
		expect(error[`${SITE_FIELD}[1]`]?.[0]).toBe('invalid url');
	});

	it('marks the second spelling of one host, which is the same site typed twice', () => {
		// the rule is `@better-giving/operator/origins`'s and it is the host rather than the line;
		// what is asserted here is that its sentence lands under the box that has to go.
		const error = refused(['https://x.example', 'http://x.example']);

		expect(Object.keys(error)).toEqual([`${SITE_FIELD}[1]`]);
		expect(error[`${SITE_FIELD}[1]`]?.[0]).toBe('duplicate site');
	});

	it('marks the box holding a site the box above it normalises to', () => {
		// the two spellings are one site once the row is read, and the box that has to go is the
		// second one — the first is the address the deployment stores.
		const error = refused(['acme.org', 'https://acme.org']);

		expect(Object.keys(error)).toEqual([`${SITE_FIELD}[1]`]);
		expect(error[`${SITE_FIELD}[1]`]?.[0]).toBe('duplicate site');
	});

	it('marks every box holding an address already written above it, and not the first', () => {
		const error = refused([
			'https://give.example.org',
			'https://give.example.org',
			'https://give.example.org'
		]);

		expect(Object.keys(error)).toEqual([`${SITE_FIELD}[1]`, `${SITE_FIELD}[2]`]);
		expect(error[`${SITE_FIELD}[1]`]?.[0]).toBe('duplicate site');
	});

	it('keys the one sentence about the list to the group and to no row', () => {
		// the cap deliberately says nothing about any individual line, so a paste of two hundred rows
		// is one list to shorten rather than two hundred boxes to read.
		const rows = Array.from({ length: 60 }, (_, at) => `https://site-${at}.example.org`);
		const error = refused(rows);

		expect(Object.keys(error)).toEqual([SITE_FIELD]);
		expect(error[SITE_FIELD]?.[0]).toBe('cannot exceed 50 sites');
	});
});

describe('the boxes the fold opens on', () => {
	it('opens on the list the deployment holds and pads nothing', () => {
		// the seed is the one side of the reading the button is armed off (./use-console-form.ts), so
		// a blank row seeded over a deployment holding no site would be a row nobody added, offering a
		// Remove for nothing and arming the press on a fold nobody had touched.
		expect(siteSeed(['https://give.example.org'])).toEqual(['https://give.example.org']);
		expect(siteSeed([])).toEqual([]);
	});

	it('reads the empty row an Add leaves at the end as a row to refuse', () => {
		// the pair the required rule rests on: the row is refused under itself, and the press has to
		// be armed for the operator to be told so — which it is, because the row is one the seed has
		// no box for at all.
		expect(refused(['https://give.example.org', ''])).toEqual({
			[`${SITE_FIELD}[1]`]: ['required']
		});
	});

	it('refuses nothing over every row dropped, which is the press that empties the list', () => {
		// no box is left to refuse and nothing is confirmed: the deployment goes on serving its own
		// donation page, which the fold draws above these boxes and no press reaches.
		expect(refused([])).toEqual({});
	});
});

describe('what the boxes posted', () => {
	it('reads every row in the order the boxes stand in, blanks kept', () => {
		expect(siteEdits(posted(['https://give.example.org', '', ' spaced ']))).toEqual([
			'https://give.example.org',
			'',
			' spaced '
		]);
	});

	it('reads no control that is not one of the rows', () => {
		// the locked row carries no name at all and the press carries the intent, so neither is a row
		// — a reader that took either would store the deployment's own donation page as a site.
		const body = posted(['https://give.example.org']);
		body.append('intent', 'sites');
		body.append('__intent__', '{"type":"insert"}');

		expect(siteEdits(body)).toEqual(['https://give.example.org']);
	});
});
