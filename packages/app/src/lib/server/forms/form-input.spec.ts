import { describe, expect, it } from 'vitest';
import type { FormInputFieldErrors, FormInputValues } from '../../forms/fields';
import { postableId } from '../db/accounts';
import { redact } from '../../redact';
import { MAX_ALLOWED_ORIGINS, MAX_ORIGIN_LENGTH } from '@better-giving/operator/origins';
import { formatMinor } from '../../donations/money';
import { MAX_SUGGESTED_AMOUNTS } from '../../forms/amounts';
import { MAX_FORM_NAME, REQUIRED } from '../../forms/input-schema';
import {
	MIN_AMOUNT_MINOR,
	formInputValuesFrom,
	parseFormInput,
	type FormRecord
} from './form-input';

// node pool, no database — the same split `../org/org-input.spec.ts` makes, for the same
// reason: every rule asserted here is decidable from the submitted values alone.

/** a submission that parses, so every case below states only what it is about. */
function complete(over: Partial<FormInputValues> = {}): FormInputValues {
	return {
		name: 'General Fund',
		status: 'draft',
		suggested_amounts: ['25.00', '50.00', '100.00'],
		min_minor: '5.00',
		max_minor: '10000.00',
		allowed_origins: ['https://acme.org'],
		program_mode: 'none',
		program_id: '',
		...over
	};
}

/** unwraps a result that must have parsed, reporting the errors if it did not. */
function parsedForm(values: FormInputValues) {
	const result = parseFormInput(values);
	if (!result.ok) {
		throw new Error(`expected these values to parse, got ${JSON.stringify(result.errors)}`);
	}
	return result.value;
}

/** the mirror: unwraps the error map from a result that must have been rejected. */
function rejectedForm(values: FormInputValues): FormInputFieldErrors {
	const result = parseFormInput(values);
	if (result.ok) {
		throw new Error(`expected these values to be rejected, got ${JSON.stringify(result.value)}`);
	}
	return result.errors;
}

// ---------------------------------------------------------------------------
// the sites group, which is one box per origin.
//
// these cases run through `parseFormInput`, which is the parser a whole submitted form goes
// through. the rules they assert are `readOriginList`'s in `@better-giving/operator/origins`, and
// every one of them is about the same failure: an entry that is nearly right matches no `Origin`
// header at all, and the operator meets that months later as a form refusing to load on their own
// site.
//
// the rules live in that module because their message has to come out of the shared schema: the
// box is a repeating row editor, so the message is the group's rather than any row's, and the
// schema is what the browser runs too. the input here is a list of boxes rather than one string
// with newlines in it, so every case below states its rows.

/** every case in this section is about the sites boxes, so the rest of the form is fixed. */
function sites(rows: string[]): FormInputValues {
	return complete({ allowed_origins: rows });
}

/** the stored list a set of sites boxes parses to. */
function stored(...rows: string[]): readonly string[] {
	return parsedForm(sites(rows)).allowedOrigins;
}

/** the one message the sites group was refused with. */
function problem(...rows: string[]): string | undefined {
	return rejectedForm(sites(rows)).allowed_origins;
}

describe('parseFormInput — the sites list', () => {
	it('accepts a bare origin and hands it back unchanged', () => {
		expect(stored('https://acme.org')).toEqual(['https://acme.org']);
	});

	it('keeps several boxes in the order they were drawn', () => {
		// the order is the operator's and it is the order the allowlist is stored in, so a list
		// that came back re-sorted would read as the form having eaten an edit.
		expect(stored('https://b.example', 'https://a.example')).toEqual([
			'https://b.example',
			'https://a.example'
		]);
	});

	it('drops the trailing slash a browser’s address bar carries', () => {
		// the failure this whole validation exists to prevent. `Origin` headers carry no trailing
		// slash, so a stored `https://acme.org/` matches nothing — the form is refused at /api/v1
		// with no clue why, weeks later, on a site we cannot reach. pasting the address bar is how
		// this list gets filled in, so what is stored is the origin inside what was pasted.
		expect(stored('https://acme.org/')).toEqual(['https://acme.org']);
	});

	it('drops a path, a query string and a fragment by the same rule', () => {
		// one repair covers all four — `url.origin` is scheme, host and port and nothing else.
		expect(stored('https://acme.org/donate')).toEqual(['https://acme.org']);
		expect(stored('https://acme.org?utm=x')).toEqual(['https://acme.org']);
		expect(stored('https://acme.org#give')).toEqual(['https://acme.org']);
	});

	it('adds the scheme a bare hostname has none of', () => {
		// the most likely thing to be typed into this box, and it is the site the operator meant:
		// the value is right and the scheme is absent, so the scheme is added.
		expect(stored('acme.org')).toEqual(['https://acme.org']);
	});

	it('refuses plain http on a real host', () => {
		// the one thing here that is not repaired, because it is about what works rather than about
		// spelling: writing `https://` over the top of it would store a site that answers nothing.
		expect(problem('http://acme.org')).toBe('https only');
	});

	it('accepts http on localhost and 127.0.0.1, on whatever port', () => {
		// the exception exists so a developer can point their own `vite dev` at a deployment
		// without editing this file. matched on hostname, so the port `vite` picked today does
		// not have to be the one it picks tomorrow.
		expect(stored('http://localhost:5173')).toEqual(['http://localhost:5173']);
		expect(stored('http://127.0.0.1:8788')).toEqual(['http://127.0.0.1:8788']);
	});

	it('accepts the IPv6 loopback, brackets and all', () => {
		// a dev server that binds v6-first sends exactly this as its `Origin`, so leaving it out of
		// the carve-out would refuse the loopback an operator is sitting at.
		//
		// `[::1]` with the brackets is what `url.hostname` returns for an IPv6 literal, so a
		// bare `'::1'` in the allow-list would never match.
		expect(stored('http://[::1]:5173')).toEqual(['http://[::1]:5173']);
	});

	it('refuses a wildcard, which the parse alone would let through', () => {
		// `new URL('https://*.acme.org')` parses — `*` is not a forbidden host code point — so this
		// needs its own check. `/api/v1` compares origins literally and always will, so a wildcard
		// here is a list entry that matches nothing, and which sites it stands for is not knowable
		// from the line.
		expect(problem('https://*.acme.org')).toBe('invalid url');
	});

	it('refuses hostname shapes no browser can send', () => {
		// every one of these parses, which is why the repair alone is not enough. an empty label, a
		// leading or trailing `-`, or port 0 is a host nothing resolves to and nothing sends — so
		// the entry is stored dead and the operator meets it as a form that will not load, months
		// later, on a site we cannot reach.
		//
		// the trailing dot is deliberately in the list. `https://acme.org.` is a legal
		// root-anchored name a browser can send — but only to a page loaded at the dotted form,
		// and it does not match the `https://acme.org` an ordinary visit sends. dropping the dot
		// would be a repair that changes which site was meant, so it is refused instead.
		for (const line of [
			'https://.acme.org',
			'https://acme..org',
			'https://-acme.org',
			'https://acme-.org',
			'https://acme.org.',
			'https://acme.org:0'
		]) {
			expect(problem(line)).toBe('invalid url');
		}
	});

	it('still accepts the ordinary hosts that check could overreach on', () => {
		// the guard above is the kind that quietly starts refusing real values, so the shapes it
		// must never touch are pinned beside it: a hyphen inside a label, an IPv4 literal, the
		// bracketed IPv6 loopback, and a single-label internal host.
		for (const line of [
			'https://my-org.example',
			'https://192.0.2.10',
			'http://[::1]:5173',
			'https://intranet:8443'
		]) {
			expect(stored(line)).toEqual([line]);
		}
	});

	it('refuses a line there is no address in, without throwing', () => {
		expect(problem('not a url at all')).toBe('invalid url');
		expect(problem('https:')).toBe('invalid url');
	});

	it('never repeats the row it is refusing', () => {
		// the box the sentence is drawn under is showing the operator what they typed.
		for (const line of ['https://*.acme.org', 'http://acme.org', 'https:']) {
			expect(problem(line)).not.toContain(line);
		}
	});

	it('skips blank and whitespace-only boxes rather than calling them errors', () => {
		// a row an operator added and never typed into is the state "Add another origin" leaves
		// the group in every time. rejecting one would mean pressing Add and immediately being
		// told off for it.
		expect(stored('', ' https://acme.org ', '\t', 'https://give.acme.org')).toEqual([
			'https://acme.org',
			'https://give.acme.org'
		]);
	});

	it('accepts no sites at all as an empty list', () => {
		// a valid state, not a missing value: no site may embed this form yet, which is
		// exactly what a form is born as. all three spellings of it — one blank box, which is
		// what a fresh create screen draws; no boxes; and no key in the body at all.
		expect(stored('')).toEqual([]);
		expect(stored()).toEqual([]);
		const { allowed_origins: _absent, ...withoutTheBox } = complete();
		expect(parsedForm(withoutTheBox).allowedOrigins).toEqual([]);
	});

	it('refuses a repeat rather than storing the list one site shorter', () => {
		// the tick boxes carry the sites this deployment lists, so a repeat here is a stale tab or
		// a hand-built body rather than an operator's own paste — and it is refused all the same,
		// because the rule is `readOriginList`'s and both surfaces read the one rule. what makes
		// that reach this parse is the clean stage above leaving the repeats in.
		expect(problem('https://b.example', 'https://a.example', 'https://b.example')).toBe(
			'duplicate site'
		);
	});

	it('refuses more sites than the cap, and says nothing about any row', () => {
		// generous rather than a product limit: this stops a pathological row reaching a
		// column /api/v1 parses on every request, and nothing else. the sentence is about the list
		// — a paste of two hundred is one problem, not two hundred.
		const many = Array.from(
			{ length: MAX_ALLOWED_ORIGINS + 1 },
			(_, i) => `https://site${i}.example`
		);
		expect(problem(...many)).toBe(`cannot exceed ${MAX_ALLOWED_ORIGINS} sites`);
	});

	it('counts the sites it would store, not the lines that were pasted', () => {
		// the same rule `readSuggestedAmounts` keeps about its own cap: the cap and the dedupe are
		// one paste read twice and they have to agree about it. a list that stores fifty sites is
		// refused for the repeat it holds and never for holding fifty-one lines.
		const distinct = Array.from(
			{ length: MAX_ALLOWED_ORIGINS },
			(_, i) => `https://site${i}.example`
		);

		expect(problem(...distinct, distinct[0]!, distinct[1]!)).toBe('duplicate site');
	});

	it('says each thing once, however many rows earned it', () => {
		// a paste of thirty rows that are all the same mistake is one thing to fix and says so
		// once; a repeat and an unreadable row are two different edits and say both.
		expect(problem('https:', 'https:/', 'http://acme.org')).toBe('invalid url, https only');
		expect(problem('https://acme.org', 'acme.org', 'https:')).toBe('duplicate site, invalid url');
	});

	it('refuses a single line longer than the cap', () => {
		const long = `https://${'a'.repeat(MAX_ORIGIN_LENGTH)}.example`;
		expect(problem(long)).toBe(`cannot exceed ${MAX_ORIGIN_LENGTH} characters`);
	});
});

// ---------------------------------------------------------------------------
// the rest of the form.

describe('parseFormInput', () => {
	it('hands back every field a form is configured by', () => {
		// one shape, and it is what both the create and the edit path write — the id is not in
		// it, because a create has none yet and an edit takes it from the route rather than from
		// a body an operator's browser posted.
		expect({ ...parsedForm(complete()) }).toEqual({
			name: 'General Fund',
			status: 'draft',
			suggestedAmounts: [2500, 5000, 10000],
			minMinor: 500,
			maxMinor: 1000000,
			allowedOrigins: ['https://acme.org'],
			programMode: 'none',
			programId: null
		});
	});

	it('refuses a blank name and one over the cap', () => {
		expect(rejectedForm(complete({ name: '   ' })).name).toBeTypeOf('string');
		expect(rejectedForm(complete({ name: 'x'.repeat(MAX_FORM_NAME + 1) })).name).toContain(
			String(MAX_FORM_NAME)
		);
	});

	it('accepts draft and live, and refuses archived', () => {
		// `FORM_STATUSES` and `archived_at` are two representations of one fact. a dropdown
		// writing `archived` without the timestamp leaves a form that reads archived on a screen
		// and live to `readForms`, so archiving is its own path and never this one.
		expect(parsedForm(complete({ status: 'live' })).status).toBe('live');
		expect(rejectedForm(complete({ status: 'archived' })).status).toBeTypeOf('string');
		expect(rejectedForm(complete({ status: 'retired' })).status).toBeTypeOf('string');
		expect(rejectedForm(complete({ status: '' })).status).toBeTypeOf('string');
	});

	it('stores the minor units of what was typed in major ones', () => {
		// the whole of it in one case: an operator writes dollars and the row holds cents.
		// the conversion is string-based (`$lib/forms/amounts.ts`), so the fractions here are ones a
		// `* 100` would spoil: `8.11` is 810.9999999999999 as a float and `0.57` is 56.99999999999999,
		// so both would store a tile a cent under the one that was typed.
		// the tiles are cleared in the two cases that move a bound past them, so what each case is
		// about is the only thing it can fail on.
		expect(
			parsedForm(complete({ min_minor: '0.50', max_minor: '25', suggested_amounts: [] }))
		).toMatchObject({
			minMinor: 50,
			maxMinor: 2500
		});
		expect(
			parsedForm(complete({ min_minor: '0.50', suggested_amounts: ['8.11', '0.57'] }))
				.suggestedAmounts
		).toEqual([811, 57]);
	});

	it('refuses more decimal places than the currency has rather than rounding them', () => {
		// these two boxes gate every gift the form will take, so a bound quietly rounded up is one
		// nobody set and nobody can account for later. the sentence names the finest unit and shows
		// the shape; the value is in the box it sits under.
		const message = rejectedForm(complete({ min_minor: '25.005' })).min_minor;
		expect(message).toContain('must not be finer than $0.01');
		expect(message).toContain('write 25.00 for $25.00');
		// a suggested amount is the one message that leaves its box — the map is keyed by field and
		// the routes drop this key — so that one names the row it is about.
		expect(rejectedForm(complete({ suggested_amounts: ['25.005'] })).suggested_amounts).toBe(
			'`25.005` must not be finer than $0.01, write 25.00 for $25.00'
		);
	});

	it('requires both amount bounds rather than storing a blank as no bound', () => {
		// the columns are nullable for rows nothing in v0 can create, and this is why the parse
		// is stricter than they are: `readFormConfig` in packages/form/src/config.ts returns null when
		// either bound is missing, so a form saved with a blank amount is one that renders
		// nothing and says nothing about why.
		expect(rejectedForm(complete({ min_minor: '' })).min_minor).toBeTypeOf('string');
		expect(rejectedForm(complete({ max_minor: '  ' })).max_minor).toBeTypeOf('string');
	});

	it('refuses a minimum below what a payment can actually take', () => {
		// under the floor every gift is refused by the processor, and the operator meets that as
		// a form that takes nothing rather than as a message about this field.
		//
		// the floor is minor units and the sentence is not: the operator reads the floor the way
		// they typed their own figure, so it is refused against `$0.50` rather than against 50 —
		// which is not a number on their screen. their own figure is in the box and is not repeated.
		const message = rejectedForm(complete({ min_minor: '0.49' })).min_minor;
		expect(message).toBe(`must be at least ${formatMinor(MIN_AMOUNT_MINOR, 'USD')}`);
		expect(parsedForm(complete({ min_minor: '0.50' })).minMinor).toBe(MIN_AMOUNT_MINOR);
	});

	it('refuses anything that is not a plain figure', () => {
		// a decimal point is the one non-digit this box takes: `25.50` is a gift, and everything
		// else that is not digits and at most one point is refused.
		expect(parsedForm(complete({ min_minor: '25.50', suggested_amounts: [] })).minMinor).toBe(2550);
		expect(rejectedForm(complete({ max_minor: '1e6' })).max_minor).toBeTypeOf('string');
		expect(rejectedForm(complete({ max_minor: 'lots' })).max_minor).toBeTypeOf('string');
		expect(rejectedForm(complete({ min_minor: '-500' })).min_minor).toBeTypeOf('string');
		// a thousands separator is not a group of three digits in any of these boxes.
		expect(rejectedForm(complete({ max_minor: '1,000' })).max_minor).toBeTypeOf('string');
	});

	it('refuses an inverted pair, under the largest gift', () => {
		// `form_min_max_minor_check` refuses this too, and that check is the floor rather than
		// the message: an inverted pair silently rejects every gift. both figures are in their boxes
		// beside each other, so the sentence names neither.
		const message = rejectedForm(complete({ min_minor: '50.00', max_minor: '10.00' })).max_minor;
		expect(message).toBe('must be larger than smallest gift');
	});

	/**
	 * neither the rails nor the cadences are boxes on this form, and no submission carries either.
	 *
	 * the whole of the claim is that a submission with nothing to say about them parses — the
	 * fixture above names neither, so this asserts what comes *out*: a value carrying either field
	 * would be one this parser had invented, and `createForm` in ./queries.ts would carry it
	 * towards a column nothing reads. what a donor is offered is whatever `offeredRails` in
	 * ./offered-rails.ts and `offeredCadences` in ./offered-cadences.ts read off the processor's
	 * account, and no screen chooses either.
	 */
	it('takes no rails and no cadences from a submission, and hands neither back', () => {
		expect(parsedForm(complete())).not.toHaveProperty('paymentMethods');
		expect(parsedForm(complete())).not.toHaveProperty('frequencies');
	});

	it('takes each box as one amount, in the order they were written', () => {
		// one `<input name="suggested_amounts">` per amount, read with `getAll`. the order is the
		// operator's — it is the order the buttons appear in on the card — and a separator is not a
		// thing: a box holding `1,000` is one amount that cannot be read rather than two.
		expect(
			parsedForm(complete({ suggested_amounts: ['25', '50.00', '100'] })).suggestedAmounts
		).toEqual([2500, 5000, 10000]);
		expect(rejectedForm(complete({ suggested_amounts: ['1,000'] })).suggested_amounts).toContain(
			'`1,000`'
		);
	});

	it('accepts an empty suggestion list', () => {
		// a form with no preset tiles is a legitimate form: the donor types an amount.
		expect(parsedForm(complete({ suggested_amounts: [] })).suggestedAmounts).toEqual([]);
		// and a group whose only box was never typed into is the same form: a blank row is what
		// "Add another amount" leaves behind, not a value.
		expect(parsedForm(complete({ suggested_amounts: [''] })).suggestedAmounts).toEqual([]);
	});

	it('refuses a suggested amount outside the bounds, naming the box and the bound', () => {
		// `readFormConfig` filters these out silently, so a form saved with a $5 tile under a $10
		// minimum renders without it and the operator is never told which one went missing. the box
		// is named as the text that was typed rather than as the figure it parsed to: this sentence
		// is not drawn under the row, so nothing else on the screen says which row it is.
		const under = rejectedForm(
			complete({ suggested_amounts: ['1.00', '25.00'], min_minor: '5.00', max_minor: '10000.00' })
		).suggested_amounts;
		expect(under).toBe('`1.00` must be more than smallest gift of $5');

		const over = rejectedForm(
			complete({
				suggested_amounts: ['25.00', '999999.99'],
				min_minor: '5.00',
				max_minor: '10000.00'
			})
		).suggested_amounts;
		expect(over).toBe('`999999.99` must be less than largest gift of $10,000');
	});

	it('names every offending box at once, so a filled-in group takes one round trip', () => {
		// one sentence per refused row, joined — this parser answers with a map keyed by field, so
		// every row's message has to reach the operator through the group's one key.
		const message = rejectedForm(
			complete({ suggested_amounts: ['25.00', 'lots', '1.00'], min_minor: '5.00' })
		).suggested_amounts;
		expect(message).toBe(
			'`lots` must be an amount, write 25.00 for $25.00; `1.00` must be more than smallest gift of $5'
		);
	});

	it('refuses a suggested amount that is not a figure, naming it', () => {
		expect(rejectedForm(complete({ suggested_amounts: ['lots'] })).suggested_amounts).toContain(
			'`lots`'
		);
	});

	it('refuses more suggestions than the cap', () => {
		const many = Array.from({ length: MAX_SUGGESTED_AMOUNTS + 1 }, (_, i) => String(10 + i));
		const message = rejectedForm(complete({ suggested_amounts: many })).suggested_amounts;
		expect(message).toContain(String(MAX_SUGGESTED_AMOUNTS));
	});

	it('counts the tiles it would store, not the boxes that were drawn', () => {
		// the cap and the dedupe are the same paste read twice, and they have to agree about it:
		// a repeat is "a paste rather than a mistake" one line down, so a group that stores twelve
		// tiles cannot be refused for holding fifteen boxes.
		const typed = Array.from({ length: MAX_SUGGESTED_AMOUNTS }, (_, i) => 10 + i);
		const drawn = [...typed.map(String), '10', '11', '12'];
		expect(parsedForm(complete({ suggested_amounts: drawn })).suggestedAmounts).toEqual(
			typed.map((major) => major * 100)
		);
	});

	it('does not echo an operator’s whole paste back at them', () => {
		// the one message here that names a value is the suggested amounts', which has left its box
		// and has to say which row it is about — and these boxes have no cap in front of them, so a
		// message repeating an unreadable paste is the thing nobody can read. `../../redact.ts` is
		// the app's one echo policy. a bound box names no value at all: its sentence is drawn under
		// the box already showing it.
		const long = 'x'.repeat(400);
		expect(rejectedForm(complete({ min_minor: long })).min_minor).not.toContain(long);

		const suggestion = rejectedForm(complete({ suggested_amounts: [long] })).suggested_amounts;
		expect(suggestion).toContain(redact(long));
		expect(suggestion).not.toContain(long);
	});

	it('drops a repeated suggestion rather than rejecting it', () => {
		// two identical tiles is what storing it would render, and the order is the operator's.
		// two spellings of one amount count as the repeat they are: `50` and `50.00` are one tile.
		expect(
			parsedForm(complete({ suggested_amounts: ['50', '25.00', '50.00'] })).suggestedAmounts
		).toEqual([5000, 2500]);
	});

	it('reports every offending field at once', () => {
		// the reason `../org/org-input.ts` gives about its nine fields, and this form has seven:
		// one problem per round trip is how a save takes seven submissions.
		const errors = rejectedForm({ status: 'archived' });
		expect(Object.keys(errors).sort()).toEqual([
			'max_minor',
			'min_minor',
			'name',
			'program_mode',
			'status'
		]);
	});
});

describe('formInputValuesFrom', () => {
	/**
	 * a stored form, as `readForm` hands one back.
	 *
	 * the fund is minted through `postableId` rather than written as a literal: `form`'s column
	 * is branded, and a seeded key is the one door into the brand that needs no row and no cast.
	 */
	const record: FormRecord = {
		id: 'frm_examplefortests',
		name: 'General Fund',
		status: 'live',
		revenueAccountId: postableId('donationsDeductible'),
		suggestedAmounts: [2500, 5000, 10000],
		minMinor: 500,
		maxMinor: 1000000,
		currency: 'USD',
		allowedOrigins: ['https://acme.org', 'https://give.acme.org'],
		programMode: 'none',
		programId: null
	};

	it('renders every value back into the box it was typed in', () => {
		expect(formInputValuesFrom(record)).toEqual({
			name: 'General Fund',
			status: 'live',
			suggested_amounts: ['25', '50', '100'],
			min_minor: '5',
			max_minor: '10000',
			allowed_origins: ['https://acme.org', 'https://give.acme.org'],
			program_mode: 'none',
			program_id: ''
		});
	});

	it('re-parses to the values it was rendered from', () => {
		// the round trip is the whole claim: an edit page that renders a stored form and saves it
		// untouched must store the same form. it holds because both directions read how an amount is
		// written out of this module — a route that rendered one with a thousands separator would
		// draw a box its own parser refuses, and nothing else in the repo would notice.
		const reparsed = parsedForm(formInputValuesFrom(record));
		expect({ ...reparsed }).toEqual({
			name: record.name,
			status: record.status,
			suggestedAmounts: record.suggestedAmounts,
			minMinor: record.minMinor,
			maxMinor: record.maxMinor,
			allowedOrigins: record.allowedOrigins,
			programMode: record.programMode,
			programId: record.programId
		});
	});

	it('writes a stored integer as the major units the box takes', () => {
		// the direction that has to be the parse's exact inverse, and the padding is where it would
		// go wrong: 50 is fifty cents rather than fifty dollars, and a bound of zero is one somebody
		// set rather than a blank.
		const values = formInputValuesFrom({
			...record,
			minMinor: 50,
			maxMinor: 0,
			suggestedAmounts: [7, 811]
		});
		expect(values.min_minor).toBe('0.50');
		expect(values.max_minor).toBe('0');
		expect(values.suggested_amounts).toEqual(['0.07', '8.11']);
	});

	it('seeds a box with the cents an operator typed and no others', () => {
		// what an operator reads back after saving a round figure. `majorEntry` in
		// `../../forms/amounts.ts` is the rendering these boxes take, and it is that function rather
		// than the padded one for exactly this: a $50 tile typed as `50` must come back as `50`.
		const values = formInputValuesFrom({
			...record,
			minMinor: 1000,
			maxMinor: 1250,
			suggestedAmounts: [5000, 500]
		});
		expect(values.min_minor).toBe('10');
		expect(values.max_minor).toBe('12.50');
		expect(values.suggested_amounts).toEqual(['50', '5']);
	});

	it('renders a bound the column allows to be missing as an empty box', () => {
		// the columns are nullable for rows nothing in v0 can create, and an edit page for one has
		// to render something: a blank box the parser then refuses is the honest answer, and
		// `0` — which is what a `String(null ?? 0)` would write — is a bound somebody set.
		const values = formInputValuesFrom({ ...record, minMinor: null, maxMinor: null });
		expect(values.min_minor).toBe('');
		expect(values.max_minor).toBe('');
		expect(rejectedForm(values).min_minor).toBeTypeOf('string');
	});

	it('renders an archived form as it is stored, rather than as one that could be saved', () => {
		// `status` is the column's full union here and only the editable pair in `ParsedForm`, so
		// the retired form an edit page loads renders `archived` and is refused on save. the
		// alternative is a page that quietly offers `draft`, which is the write ./queries.ts
		// refuses at the `where`.
		expect(formInputValuesFrom({ ...record, status: 'archived' }).status).toBe('archived');
	});
});

// ---------------------------------------------------------------------------
// the program group: which cause a form's gifts are recorded against.
// ---------------------------------------------------------------------------

describe('the program group', () => {
	/** a stored form with no cause, which every case below states its own answer against. */
	const RECORD: FormRecord = {
		id: 'frm_examplefortests',
		name: 'General Fund',
		status: 'live',
		revenueAccountId: postableId('donationsDeductible'),
		suggestedAmounts: [2500],
		minMinor: 500,
		maxMinor: 1000000,
		currency: 'USD',
		allowedOrigins: ['https://acme.org'],
		programMode: 'none',
		programId: null
	};

	it('stores the mode a form asks nothing with, and no cause under it', () => {
		expect(parsedForm(complete())).toMatchObject({ programMode: 'none', programId: null });
	});

	it('stores the cause a pinned form names', () => {
		const value = parsedForm(
			complete({ program_mode: 'pinned', program_id: '019fb100-0000-7000-8000-0000000000aa' })
		);
		expect(value).toMatchObject({
			programMode: 'pinned',
			programId: '019fb100-0000-7000-8000-0000000000aa'
		});
	});

	it('refuses a pinned form that names none, under the program box', () => {
		// the two columns are one decision — `form_program_pinned_check` in
		// `$lib/server/db/schema.ts` — so a half-made pair is a constraint error and a 500 rather
		// than a sentence, unless it is refused here. keyed to the box that has to be filled in.
		expect(rejectedForm(complete({ program_mode: 'pinned', program_id: '' }))).toEqual({
			program_id: REQUIRED
		});
	});

	it('drops a cause the other two modes carry rather than refusing it', () => {
		// the box is hidden in those modes and submits whatever it was drawn with, so a stale id is
		// an ordinary thing for a body to carry — and stored, it would credit every gift to a cause
		// the form has stopped offering. `null` is the column's answer for both of them.
		for (const mode of ['none', 'choice'] as const) {
			const value = parsedForm(
				complete({ program_mode: mode, program_id: '019fb100-0000-7000-8000-0000000000aa' })
			);
			expect(value, mode).toMatchObject({ programMode: mode, programId: null });
		}
	});

	it('refuses a mode that is not one of the three', () => {
		expect(rejectedForm(complete({ program_mode: 'everything' }))).toEqual({
			program_mode: REQUIRED
		});
	});

	it('refuses a body carrying no mode at all, rather than standing one in', () => {
		// an enum absent is otherwise its first member, which here is `none` — a form quietly
		// unpinned from the cause it was recording against.
		const values = complete();
		delete (values as Record<string, unknown>).program_mode;
		expect(rejectedForm(values)).toEqual({ program_mode: REQUIRED });
	});

	it('writes the two boxes back the way the editor renders them', () => {
		expect(
			formInputValuesFrom({
				...RECORD,
				programMode: 'pinned',
				programId: '019fb100-0000-7000-8000-0000000000aa'
			})
		).toMatchObject({
			program_mode: 'pinned',
			program_id: '019fb100-0000-7000-8000-0000000000aa'
		});
	});

	it('renders a form with no cause as a blank box, which is what the select opens on', () => {
		// `null` is the column and `''` is the box: the select's first line is a word rather than a
		// value, and a record rendered as `null` would put the string `null` in it.
		expect(formInputValuesFrom(RECORD)).toMatchObject({ program_mode: 'none', program_id: '' });
	});
});
