import { describe, expect, it } from 'vitest';
import { PAYMENT_METHODS, TRIBUTE_KINDS, type FormConfig } from '@better-giving/form/v1';
import { OFFERED_PAYMENT_METHODS } from '../../forms/offered-rails';
import { PAYPAL_US_FEE_RULES_STANDARD, servedFeeRules } from '../payments/fees';
import { parseQuoteRequest } from './quote-input';

// the posted body, checked against a form record. no database, no network — every rule here is
// decidable from two values, which is why this runs in the node pool.
//
// the amount cases are the ones that matter most: this is the only thing standing between a public
// endpoint and a donor who edited `amountMinor` in devtools.

const CONFIG: FormConfig = {
	formId: 'frm_quoteinput00001',
	providers: [{ name: 'stripe', publishableKey: 'pk_test_x' }],
	currency: 'USD',
	suggestedAmountsMinor: [2_500, 5_000],
	minAmountMinor: 500,
	maxAmountMinor: 1_000_000,
	frequencies: ['one_time', 'monthly'],
	paymentMethods: ['card', 'ach'],
	feeCoverage: 'optional',
	feeRules: servedFeeRules(PAYPAL_US_FEE_RULES_STANDARD),
	locale: 'en-US',
	orgLegalName: 'Hope Foundation',
	ein: '12-3456789',
	deductibilityStatement: 'No goods or services were provided in exchange for this gift.'
};

/** a body a donor's browser would send, with whatever this case needs replaced. */
const body = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
	formId: CONFIG.formId,
	amountMinor: 10_000,
	frequency: 'one_time',
	method: 'card',
	coversFee: true,
	email: 'ada@example.org',
	firstName: 'Ada',
	lastName: 'Okafor',
	consentedToContact: false,
	...over
});

/** the parse, required to have been refused — hands back the sentence and the fix. */
function refusal(over: Record<string, unknown> = {}) {
	const result = parseQuoteRequest(body(over), CONFIG);
	if (result.ok) throw new Error('expected this body to be refused, but it parsed');
	return result;
}

describe('parseQuoteRequest() — a submission that is fine', () => {
	it('parses every field and derives the donor', () => {
		const result = parseQuoteRequest(body(), CONFIG);

		expect(result.ok).toBe(true);
		expect(result.ok && result.value).toMatchObject({
			amountMinor: 10_000,
			frequency: 'one_time',
			method: 'card',
			coversFee: true
		});
		expect(result.ok && result.value.donor.displayName).toBe('Ada Okafor');
		expect(result.ok && result.value.donor.primaryEmail).toBe('ada@example.org');
	});

	it('carries the challenge token through untouched', () => {
		const result = parseQuoteRequest(body({ turnstileToken: '  tok  ' }), CONFIG);

		// unmodified: trimming is the challenge module's own business, and a token altered on the
		// way through is a token Cloudflare will not recognise.
		expect(result.ok && result.value.turnstileToken).toBe('  tok  ');
	});

	it('accepts a body with no token, so the challenge is what refuses it', () => {
		const result = parseQuoteRequest(body(), CONFIG);

		expect(result.ok && result.value.turnstileToken).toBeUndefined();
	});
});

describe('parseQuoteRequest() — the amount', () => {
	it.each([
		['below the form’s smallest gift', 499],
		['above the form’s largest', 1_000_001]
	] as const)('refuses an amount %s', (_label, amountMinor) => {
		const result = refusal({ amountMinor });

		expect(result.message).toContain('amountMinor');
		expect(result.message).toContain('500');
		expect(result.message).toContain('1000000');
	});

	it.each([
		['fractional', 100.5],
		['a string', '10000'],
		['missing', undefined],
		['null', null],
		['not a number', Number.NaN]
	] as const)('refuses an amount that is %s', (_label, amountMinor) => {
		expect(refusal({ amountMinor }).message).toContain('amountMinor');
	});

	it('accepts both ends of the range', () => {
		expect(parseQuoteRequest(body({ amountMinor: 500 }), CONFIG).ok).toBe(true);
		expect(parseQuoteRequest(body({ amountMinor: 1_000_000 }), CONFIG).ok).toBe(true);
	});
});

describe('parseQuoteRequest() — the choices the form offers', () => {
	/**
	 * the cadence gate is `FREQUENCIES` in packages/form/src/v1.ts and never the list the served
	 * config carries, which only a config narrowed past it can show.
	 *
	 * the narrowing is real and reachable: `offeredCadences` in `../forms/offered-cadences.ts`
	 * answers one-time alone on every arm of the payment port that is not ready, so this is the
	 * config a deployment serves the morning after its recurring standing lapsed. the served config
	 * is cached and reaches pages this deployment cannot recall (CLAUDE.md), so the donor holding
	 * yesterday's page is charged rather than turned away.
	 */
	it.each(['monthly', 'yearly'] as const)(
		'accepts %s over a config narrowed to one-off',
		(frequency) => {
			const narrowed: FormConfig = { ...CONFIG, frequencies: ['one_time'] };
			const result = parseQuoteRequest(body({ frequency }), narrowed);

			expect(result.ok).toBe(true);
			expect(result.ok && result.value.frequency).toBe(frequency);
		}
	);

	it('refuses a cadence the vocabulary does not name, and says which list to send from', () => {
		const result = refusal({ frequency: 'weekly' });

		expect(result.message).toContain('frequency');
		expect(result.fix).toContain('one_time');
		expect(result.fix).toContain('monthly');
		expect(result.fix).toContain('yearly');
	});

	it('refuses a rail that is not in the vocabulary at all', () => {
		expect(refusal({ method: 'bank_transfer' }).message).toContain('method');
	});

	/**
	 * every rail the vocabulary holds is one this deployment offers, which is why the case above is
	 * the only refusal a rail can draw here.
	 *
	 * asserted rather than assumed, because the gate reads `OFFERED_PAYMENT_METHODS` in
	 * `$lib/forms/offered-rails.ts` and that list is free to shrink. the day it does, this turns red
	 * beside a parser that would otherwise go on accepting a rail nothing offers — with the case
	 * that would have caught it deleted for want of a value to write in it.
	 */
	it('offers every rail the vocabulary holds', () => {
		expect([...OFFERED_PAYMENT_METHODS].sort()).toEqual([...PAYMENT_METHODS].sort());
	});

	/**
	 * the gate is the deployment's list and never the config it was handed, which only a config
	 * that disagrees with that list can show.
	 *
	 * both directions, because either one alone would pass on a gate reading the wrong source: a
	 * config naming a wallet must not open one, and a config naming one rail must not close the
	 * other. a served config cannot say either of these — `readPublishedConfig` in
	 * `../forms/published-config.ts` fills the field from the same constant — so what is being
	 * pinned is that this parser does not take the field's word for it.
	 */
	it.each(OFFERED_PAYMENT_METHODS)('accepts %s over a config naming neither', (method) => {
		const disagreeing: FormConfig = { ...CONFIG, paymentMethods: ['apple_pay'] };
		expect(parseQuoteRequest(body({ method }), disagreeing).ok).toBe(true);
	});

	it('refuses a rail no list names, whatever the config it was handed says', () => {
		const disagreeing = { ...CONFIG, paymentMethods: ['apple_pay'] } as FormConfig;
		const result = parseQuoteRequest(body({ method: 'bank_transfer' }), disagreeing);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain('method');
	});

	it.each(['coversFee', 'consentedToContact'] as const)('refuses a non-boolean %s', (field) => {
		expect(refusal({ [field]: 'yes' }).message).toContain(field);
	});
});

describe('parseQuoteRequest() — the donor', () => {
	it('refuses a submission with no email, which a receipt cannot do without', () => {
		// `parseContact` treats an address as optional, because staff entering a cheque may have
		// none. a gift through a form is not that case.
		expect(refusal({ email: '' }).message).toContain('email');
	});

	it('refuses an address that is not one, under the name the wire spells it', () => {
		const result = refusal({ email: 'ada at example dot org' });

		// the contact parser reports `primary_email`; what an integrator has in front of them is
		// `email`.
		expect(result.message).toContain('`email`');
		expect(result.message).not.toContain('primary_email');
	});

	it('refuses a submission with neither name', () => {
		const result = refusal({ firstName: '', lastName: '' });

		expect(result.message).toContain('`firstName`');
	});

	it('accepts one name alone', () => {
		expect(parseQuoteRequest(body({ lastName: '' }), CONFIG).ok).toBe(true);
	});
});

describe('parseQuoteRequest() — the donor’s message', () => {
	it('carries a note through', () => {
		const result = parseQuoteRequest(body({ note: 'in memory of Grace' }), CONFIG);

		expect(result.ok && result.value.note).toBe('in memory of Grace');
	});

	it('carries no note where the donor wrote none', () => {
		const result = parseQuoteRequest(body(), CONFIG);

		expect(result.ok && result.value.note).toBeUndefined();
	});

	it.each([
		['empty', ''],
		['spaces', '   '],
		['a tab and a newline', '\t\n'],
		// the one a paste out of a word processor produces; JS `.trim()` is unicode-aware.
		['a non-breaking space', ' ']
	] as const)('carries a %s note as none at all', (_label, note) => {
		const result = parseQuoteRequest(body({ note }), CONFIG);

		// what reaches the column is null rather than a blank string, and this is the layer that
		// decides it — `donation.note` carries no check of its own.
		expect(result.ok && result.value.note).toBeUndefined();
	});

	it('trims the message it does carry', () => {
		const result = parseQuoteRequest(body({ note: '  for the roof fund  ' }), CONFIG);

		expect(result.ok && result.value.note).toBe('for the roof fund');
	});

	it('refuses a note that is not a string', () => {
		expect(refusal({ note: { text: 'hi' } }).message).toContain('note');
	});

	it('refuses a note past the maximum', () => {
		expect(refusal({ note: 'x'.repeat(2_001) }).message).toContain('note');
	});
});

describe('parseQuoteRequest() — a gift given in honor or memory of someone', () => {
	// this is the whole of what holds `donation.tribute_kind` to its two members and every tribute
	// string to a length. the columns carry no CHECK and cannot be given one without a rebuild of a
	// table that has children (`$lib/server/db/schema.ts`), so a case missing here is a case the
	// database accepts.

	it('carries no tribute where the donor marked none', () => {
		const result = parseQuoteRequest(body(), CONFIG);

		expect(result.ok && result.value.tribute).toBeNull();
	});

	it.each(TRIBUTE_KINDS)('carries a gift given in %s, with nobody to tell', (kind) => {
		const result = parseQuoteRequest(body({ tributeKind: kind, tributeHonoree: 'Ada' }), CONFIG);

		expect(result.ok && result.value.tribute).toEqual({ kind, honoree: 'Ada', notify: null });
	});

	it('carries the person to tell, trimmed', () => {
		const result = parseQuoteRequest(
			body({
				tributeKind: 'memory',
				tributeHonoree: '  Grace Hopper  ',
				tributeNotifyName: '  Mary Hopper  ',
				tributeNotifyEmail: '  mary@example.org  '
			}),
			CONFIG
		);

		expect(result.ok && result.value.tribute).toEqual({
			kind: 'memory',
			honoree: 'Grace Hopper',
			notify: { name: 'Mary Hopper', email: 'mary@example.org' }
		});
	});

	it('refuses a kind that is not one of the two', () => {
		// `honour` and not some arbitrary word: the near miss is what a caller writing this by hand
		// actually sends, and the stored token is US-spelled.
		expect(refusal({ tributeKind: 'honour', tributeHonoree: 'Ada' }).message).toContain(
			'tributeKind'
		);
	});

	it('refuses a kind with no honoree', () => {
		// the pair travel together. a kind alone names nobody, and the column that would hold the
		// name accepts the null it is left with.
		expect(refusal({ tributeKind: 'honor' }).message).toContain('tributeHonoree');
	});

	it.each([
		['empty', ''],
		['spaces', '   '],
		['a non-breaking space', ' ']
	] as const)('refuses an honoree that is %s', (_label, tributeHonoree) => {
		expect(refusal({ tributeKind: 'honor', tributeHonoree }).message).toContain('tributeHonoree');
	});

	it('refuses an honoree with no kind', () => {
		// the other direction of the same pair: a name with no kind is a gift the dashboard cannot
		// put a sentence to.
		expect(refusal({ tributeHonoree: 'Ada' }).message).toContain('tributeKind');
	});

	it('refuses a person to tell with no honoree', () => {
		expect(
			refusal({ tributeNotifyName: 'Mary', tributeNotifyEmail: 'mary@example.org' }).message
		).toContain('tributeKind');
	});

	it('refuses a name to tell with no address to tell it at', () => {
		expect(
			refusal({ tributeKind: 'memory', tributeHonoree: 'Grace', tributeNotifyName: 'Mary' }).message
		).toContain('tributeNotifyEmail');
	});

	it('refuses an address to tell with no name', () => {
		expect(
			refusal({
				tributeKind: 'memory',
				tributeHonoree: 'Grace',
				tributeNotifyEmail: 'mary@example.org'
			}).message
		).toContain('tributeNotifyName');
	});

	it('refuses an address that is not one', () => {
		// the notification is sent to a stranger who never gave us this address, so a value that is
		// plainly not an address is caught here rather than becoming a bounce against the domain
		// every receipt also goes out on.
		expect(
			refusal({
				tributeKind: 'memory',
				tributeHonoree: 'Grace',
				tributeNotifyName: 'Mary',
				tributeNotifyEmail: 'not an address'
			}).message
		).toContain('tributeNotifyEmail');
	});

	it.each([
		['tributeHonoree', 'x'.repeat(201)],
		['tributeNotifyName', 'x'.repeat(201)],
		['tributeNotifyEmail', `${'x'.repeat(321)}@example.org`]
	] as const)('refuses a %s past its maximum', (field, value) => {
		const result = refusal({
			tributeKind: 'memory',
			tributeHonoree: 'Grace',
			tributeNotifyName: 'Mary',
			tributeNotifyEmail: 'mary@example.org',
			[field]: value
		});

		expect(result.message).toContain(field);
	});

	it.each(['tributeHonoree', 'tributeNotifyName', 'tributeNotifyEmail'] as const)(
		'refuses a %s that is not a string',
		(field) => {
			expect(refusal({ tributeKind: 'memory', [field]: { name: 'Grace' } }).message).toContain(
				field
			);
		}
	);

	it('never echoes a submitted honoree back into the message', () => {
		const result = refusal({ tributeHonoree: 'a-very-distinctive-attacker-string' });

		expect(result.message).not.toContain('a-very-distinctive-attacker-string');
	});
});

describe('parseQuoteRequest() — the donor’s consent answer', () => {
	it.each([true, false] as const)('carries %s through as the donor gave it', (consented) => {
		const result = parseQuoteRequest(body({ consentedToContact: consented }), CONFIG);

		// both answers are answers. a `false` that arrived here is a donor who was asked and
		// declined, which is not the same fact as a contact nobody ever asked.
		expect(result.ok && result.value.consentedToContact).toBe(consented);
	});

	it('carries null through, for an integrator who never asked', () => {
		const result = parseQuoteRequest(body({ consentedToContact: null }), CONFIG);

		// the third state, and the reason the field is not a boolean: a headless integrator who does
		// not put the question has no true answer to send, and `false` would file a refusal nobody
		// gave. see `consentedToContact` in packages/form/src/v1.ts.
		expect(result.ok).toBe(true);
		expect(result.ok && result.value.consentedToContact).toBeNull();
	});

	it('still refuses a body that left the field out', () => {
		const result = refusal({ consentedToContact: undefined });

		// `null` is a statement and an absent field is not one. this refusal is why the field was
		// required in the first place, and widening it to three values must not spend it: an
		// integrator who forgot the question is told so rather than silently filed as not-asked.
		expect(result.message).toContain('consentedToContact');
		expect(result.message).toContain('missing');
	});

	it('tells an integrator what to send instead of `false`', () => {
		// the fix is the whole reason the field takes three values: a sentence instructing a
		// caller who never asked to send `false` is the write this refusal exists to stop.
		expect(refusal({ consentedToContact: 'yes' }).fix).toContain('`null`');
	});
});

describe('parseQuoteRequest() — the cause the donor chose', () => {
	const CLEAN = '019fb300-0000-7000-8000-0000000000e1';
	const MEALS = '019fb300-0000-7000-8000-0000000000e2';

	/** the config a form offering a donor the choice serves. */
	const choosing: FormConfig = {
		...CONFIG,
		program: {
			mode: 'choice',
			options: [
				{ id: CLEAN, name: 'Clean water' },
				{ id: MEALS, name: 'School meals' }
			]
		}
	};

	/** a form for one cause, which sends the donor no id and takes none back. */
	const pinned: FormConfig = { ...CONFIG, program: { mode: 'pinned', name: 'Clean water' } };

	it('accepts an id the form offers', () => {
		const result = parseQuoteRequest(body({ programId: MEALS }), choosing);
		expect(result.ok).toBe(true);
		expect(result.ok && result.value.programId).toBe(MEALS);
	});

	/**
	 * a form is not what decides which causes it offers — the request is checked against the list
	 * the server served, exactly as the amount is checked against the bounds it served.
	 */
	it('refuses an id the form does not offer', () => {
		const result = parseQuoteRequest(
			body({ programId: '019fb300-0000-7000-8000-0000000000ff' }),
			choosing
		);
		expect(result.ok).toBe(false);
		expect(result.ok || result.message).toContain('programId');
		expect(result.ok || result.fix).toContain('program.options');
	});

	/**
	 * a pinned form sends nothing on this field and the server writes the pin from the row, so an
	 * id arriving on one is a client offering to overwrite a decision it was only told about.
	 */
	it.each([
		{ label: 'a form pinned to one cause', config: pinned },
		{ label: 'a form that asks about no cause', config: CONFIG }
	])('refuses an id sent to $label', ({ config }) => {
		const result = parseQuoteRequest(body({ programId: CLEAN }), config);
		expect(result.ok).toBe(false);
		expect(result.ok || result.message).toContain('programId');
	});

	/**
	 * a choice form whose every cause has been archived serves no `program` key at all
	 * (`packages/form/src/v1.ts`: an empty `options` is read as no program), so the id arriving here
	 * came off a page cached before the archive. the refusal has to say the form offers none now
	 * rather than claim a pin, which is the only thing that tells the caller reloading the config is
	 * the fix.
	 */
	it('tells a caller the form offers no cause now rather than claiming a pin', () => {
		const result = parseQuoteRequest(body({ programId: CLEAN }), CONFIG);
		expect(result.ok).toBe(false);
		expect(result.ok || result.message).not.toContain('pinned');
		expect(result.ok || result.fix).toContain('archived');
	});

	it.each([
		{ label: 'a form offering the choice', config: choosing },
		{ label: 'a form pinned to one cause', config: pinned },
		{ label: 'a form that asks about no cause', config: CONFIG }
	])('accepts a body with no `programId` at all on $label', ({ config }) => {
		const result = parseQuoteRequest(body(), config);
		expect(result.ok).toBe(true);
		expect(result.ok && result.value.programId).toBeUndefined();
	});

	it.each([
		['null', null],
		['a number', 12],
		['an array', ['a']]
	] as const)('refuses a `programId` that is %s', (_label, programId) => {
		const result = parseQuoteRequest(body({ programId }), choosing);
		expect(result.ok).toBe(false);
		expect(result.ok || result.message).toContain('programId');
	});
});

describe('parseQuoteRequest() — a body that is not one', () => {
	it.each([
		['undefined, which is what an unparseable request becomes', undefined],
		['null', null],
		['an array', [1, 2]],
		['a string', 'amountMinor=10000']
	] as const)('refuses %s', (_label, value) => {
		const result = parseQuoteRequest(value, CONFIG);

		expect(result.ok).toBe(false);
		expect(result.ok || result.message).toContain('JSON object');
	});

	it('never echoes a submitted string back into the message', () => {
		const result = refusal({ method: 'a-very-distinctive-attacker-string' });

		// every one of these fields is a stranger's, on an unauthenticated path, and the length
		// check that would bound it is the one that just failed.
		expect(result.message).not.toContain('a-very-distinctive-attacker-string');
	});
});
