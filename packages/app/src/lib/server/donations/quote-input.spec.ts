import { describe, expect, it } from 'vitest';
import { isPledgeRail } from '@better-giving/form/embed/rails';
import { PAYMENT_METHODS, TRIBUTE_KINDS, type FormConfig } from '@better-giving/form/v1';
import { OFFERED_PAYMENT_METHODS } from '../../forms/offered-rails';
import { PAYPAL_US_FEE_RULES_STANDARD, servedFeeRules } from '../payments/fees';
import { parsePledgeRequest, parseQuoteRequest } from './quote-input';

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

/** what the fund's window hands back on a donor-advised fund gift. */
const AUTHORIZED = {
	authorizationId: 'cfe09e64-6a74-4dab-a565-361185a6f248',
	authorizedMinor: 10_300
};

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

	it('carries the proof of work through untouched', () => {
		const result = parseQuoteRequest(body({ altchaPayload: 'eyJ9' }), CONFIG);

		expect(result.ok && result.value.altchaPayload).toBe('eyJ9');
	});
});

describe('parseQuoteRequest() — the proof of work', () => {
	it('refuses an `altchaPayload` that is not a string', () => {
		expect(refusal({ altchaPayload: { challenge: {} } }).message).toContain('`altchaPayload`');
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
	 * every processor rail the vocabulary holds is one this deployment offers, which is why the case
	 * above, and a pledge rail sent here, are the only refusals a rail can draw.
	 *
	 * asserted rather than assumed, because the gate reads `OFFERED_PAYMENT_METHODS` in
	 * `$lib/forms/offered-rails.ts` and that list is free to shrink. the day it does, this turns red
	 * beside a parser that would otherwise go on accepting a rail nothing offers — with the case
	 * that would have caught it deleted for want of a value to write in it.
	 *
	 * the pledge rails are the one part of the vocabulary it leaves out: no processor settles them,
	 * and `parsePledgeRequest` below is where a body on either is read.
	 */
	it('offers every processor rail the vocabulary holds', () => {
		const processorRails = PAYMENT_METHODS.filter((method) => !isPledgeRail(method));
		expect([...OFFERED_PAYMENT_METHODS].sort()).toEqual([...processorRails].sort());
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
		const rail =
			method === 'daf'
				? { method, ...AUTHORIZED }
				: method === 'crypto'
					? { method, coin: 'btc' }
					: { method };
		expect(parseQuoteRequest(body(rail), disagreeing).ok).toBe(true);
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

describe('parseQuoteRequest() — a donor-advised fund gift', () => {
	it('carries the fund window’s session and the total the donor authorized in it', () => {
		const result = parseQuoteRequest(body({ method: 'daf', ...AUTHORIZED }), CONFIG);

		expect(result.ok && result.value.authorization).toEqual({
			id: AUTHORIZED.authorizationId,
			authorizedMinor: 10_300
		});
	});

	it('carries no authorization on any other rail', () => {
		const result = parseQuoteRequest(body(), CONFIG);

		expect(result.ok && result.value.authorization).toBeNull();
	});

	// the grant is created from the session and recorded at the authorized total, so a gift missing
	// either has nothing to create or nothing to record.
	it.each(['authorizationId', 'authorizedMinor'] as const)(
		'refuses a donor-advised fund gift without %s, naming it',
		(missing) => {
			const { [missing]: _, ...rest } = AUTHORIZED;

			expect(refusal({ method: 'daf', ...rest }).message).toContain(missing);
		}
	);

	it.each(['authorizationId', 'authorizedMinor'] as const)(
		'refuses %s sent on a rail that is not a donor-advised fund',
		(field) => {
			const result = refusal({ method: 'card', [field]: AUTHORIZED[field] });

			expect(result.message).toContain(field);
			expect(result.message).toContain('card');
		}
	);

	it('refuses a blank session', () => {
		expect(refusal({ method: 'daf', ...AUTHORIZED, authorizationId: '  ' }).message).toContain(
			'authorizationId'
		);
	});

	// a fund grants whole dollars, so a total with cents on it is not one the fund's window produced.
	it.each([10_350, 0, -100, 100.5])('refuses an authorized total of %s', (authorizedMinor) => {
		expect(refusal({ method: 'daf', ...AUTHORIZED, authorizedMinor }).message).toContain(
			'authorizedMinor'
		);
	});

	it.each(['monthly', 'yearly'] as const)(
		'refuses a %s donor-advised fund gift, saying such gifts are one-time',
		(frequency) => {
			const result = refusal({ method: 'daf', frequency, ...AUTHORIZED });

			expect(result.message).toContain('one-time');
			expect(result.fix).not.toContain('Give once instead');
		}
	);
});

describe('parseQuoteRequest() — a gift sent in crypto', () => {
	it('carries the coin, spelled the way the account names it', () => {
		const result = parseQuoteRequest(body({ method: 'crypto', coin: ' USDTTRC20 ' }), CONFIG);

		expect(result.ok && result.value.coin).toBe('usdttrc20');
	});

	it('refuses a crypto gift naming no coin', () => {
		expect(refusal({ method: 'crypto' }).message).toContain('`coin` is missing');
	});

	it('refuses a coin sent on another rail', () => {
		expect(refusal({ method: 'card', coin: 'btc' }).message).toContain('only a crypto gift');
	});

	it.each(['monthly', 'yearly'] as const)('refuses a %s crypto gift as one-time', (frequency) => {
		expect(refusal({ method: 'crypto', coin: 'btc', frequency }).message).toContain(
			'a crypto gift is one-time'
		);
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

	it('folds a line break in a name onto one line', () => {
		// a direct `/api/v1` caller can send what no box in the element can type, and every surface
		// that carries the stored name — receipt, webhooks, Zapier, the integrations API — would carry
		// the break as sent.
		const result = parseQuoteRequest(
			body({
				tributeKind: 'memory',
				tributeHonoree: 'Ann\r\nBcc: x@y',
				tributeNotifyName: 'Mary\t\u0085\u2028\u2029Hopper',
				tributeNotifyEmail: 'mary@example.org'
			}),
			CONFIG
		);

		expect(result.ok && result.value.tribute).toEqual({
			kind: 'memory',
			honoree: 'Ann Bcc: x@y',
			notify: { name: 'Mary Hopper', email: 'mary@example.org' }
		});
	});

	it.each(['tributeHonoree', 'tributeNotifyName'] as const)(
		'bounds a %s by its folded length',
		(field) => {
			// 203 characters as sent, 200 once the breaks are one space: the stored value is in bounds.
			const atMaximum = `${'a'.repeat(100)}\r\n\r\n${'b'.repeat(99)}`;
			const pastMaximum = `${'a'.repeat(100)}\r\n${'b'.repeat(100)}`;
			const tribute = {
				tributeKind: 'memory',
				tributeHonoree: 'Grace',
				tributeNotifyName: 'Mary',
				tributeNotifyEmail: 'mary@example.org'
			};

			const accepted = parseQuoteRequest(body({ ...tribute, [field]: atMaximum }), CONFIG);
			expect(accepted.ok).toBe(true);
			expect(refusal({ ...tribute, [field]: pastMaximum }).message).toContain(field);
		}
	);

	it('refuses an honoree that is only line breaks, as it does an empty one', () => {
		expect(
			refusal({ tributeKind: 'honor', tributeHonoree: '\r\n\t\u0085\u2028' }).message
		).toContain('tributeHonoree');
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

	it.each([
		['null', null],
		['a number', 12],
		['an array', ['a']]
	] as const)('refuses a `pageProgramId` that is %s', (_label, pageProgramId) => {
		const result = parseQuoteRequest(body({ pageProgramId }), choosing);
		expect(result.ok).toBe(false);
		expect(result.ok || result.message).toContain('`pageProgramId` is');
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

/** a stock pledge's body, as the form sends it once the pending screen is first shown. */
const stockBody = (over: Record<string, unknown> = {}): Record<string, unknown> => {
	const {
		amountMinor: _none,
		coversFee: _fee,
		...rest
	} = body({
		method: 'stock',
		pledgeId: PLEDGE_ID,
		ticker: 'AAPL',
		shares: '50',
		...over
	});
	return rest;
};

/** an IRA (QCD) pledge's body. */
const iraBody = (over: Record<string, unknown> = {}): Record<string, unknown> =>
	body({ method: 'ira_qcd', pledgeId: PLEDGE_ID, custodian: 'Fidelity Investments', ...over });

const PLEDGE_ID = '0b5f7a52-3d1e-4c8a-9f2b-6e4d1c0a7b93';

/** the pledge parse, required to have been refused. */
function pledgeRefusal(posted: Record<string, unknown>) {
	const result = parsePledgeRequest(posted, CONFIG);
	if (result.ok) throw new Error('expected this body to be refused, but it parsed');
	return result;
}

describe('parsePledgeRequest() — a stock pledge', () => {
	it('parses the ticker and the shares, and the donor every gift carries', () => {
		const result = parsePledgeRequest(stockBody({ ticker: ' aapl ', shares: '12.5' }), CONFIG);

		expect(result.ok && result.value).toMatchObject({
			pledgeId: PLEDGE_ID,
			pledged: { method: 'stock', ticker: 'AAPL', sharesMillionths: 12_500_000 }
		});
		expect(result.ok && result.value.giver.donor.primaryEmail).toBe('ada@example.org');
	});

	it.each(['brk.b', 'BRK/B'])(
		'stores a class share posted as %s in the SEC’s dash form',
		(ticker) => {
			const result = parsePledgeRequest(stockBody({ ticker }), CONFIG);

			expect(result.ok && result.value.pledged).toMatchObject({ method: 'stock', ticker: 'BRK-B' });
		}
	);

	it.each([
		['ticker', { ticker: undefined }],
		['shares', { shares: undefined }],
		['ticker', { ticker: '   ' }]
	] as const)('names `%s` when it is missing', (field, over) => {
		expect(pledgeRefusal(stockBody(over))).toMatchObject({ field });
	});

	it.each(['1.0000001', '0', '-1', '1e3', 7])(
		'refuses shares of %s, naming the field',
		(shares) => {
			const refused = pledgeRefusal(stockBody({ shares }));
			expect(refused.field).toBe('shares');
			expect(refused.message).toContain('`shares`');
		}
	);

	it('refuses an amount, which a stock gift has none of', () => {
		const refused = pledgeRefusal({ ...stockBody(), amountMinor: 10_000 });
		expect(refused.field).toBeUndefined();
		expect(refused.message).toContain('`amountMinor`');
	});
});

describe('parsePledgeRequest() — an IRA (QCD) pledge', () => {
	it('parses the amount and the custodian', () => {
		const result = parsePledgeRequest(iraBody({ custodian: '  Fidelity   Investments ' }), CONFIG);

		expect(result.ok && result.value.pledged).toEqual({
			method: 'ira_qcd',
			amountMinor: 10_000,
			custodian: 'Fidelity Investments'
		});
	});

	it.each([undefined, '', '   '])('names `custodian` when it is %j', (custodian) => {
		expect(pledgeRefusal(iraBody({ custodian }))).toMatchObject({ field: 'custodian' });
	});

	it('refuses a custodian past its length, naming the field', () => {
		expect(pledgeRefusal(iraBody({ custodian: 'x'.repeat(201) }))).toMatchObject({
			field: 'custodian'
		});
	});

	it('holds the amount to the form’s own bounds, as every other rail is held', () => {
		const refused = pledgeRefusal(iraBody({ amountMinor: 499 }));
		expect(refused.field).toBeUndefined();
		expect(refused.message).toContain('outside this form');
	});
});

describe('parsePledgeRequest() — what both rails refuse', () => {
	it.each([stockBody, iraBody])('refuses a gift that repeats', (make) => {
		const refused = pledgeRefusal(make({ frequency: 'monthly' }));
		expect(refused.message).toContain('one-time');
	});

	it.each([undefined, 'not-a-uuid'])('refuses a pledge id of %j', (pledgeId) => {
		expect(pledgeRefusal(stockBody({ pledgeId })).message).toContain('`pledgeId`');
	});

	it('refuses a coin, which only a crypto gift carries', () => {
		expect(pledgeRefusal(iraBody({ coin: 'btc' })).message).toContain('`coin`');
	});

	it('reads the donor through the same parser every gift does', () => {
		expect(pledgeRefusal(iraBody({ email: '' })).message).toContain('`email`');
	});
});

describe('parseQuoteRequest() — a contribution, which this deployment cannot take yet', () => {
	it('parses a body sending `contributionMinor` 0 exactly as one leaving it out', () => {
		expect(parseQuoteRequest(body({ contributionMinor: 0 }), CONFIG)).toStrictEqual(
			parseQuoteRequest(body(), CONFIG)
		);
	});

	// nothing here can price one, so a contribution taken would be one silently dropped.
	it.each([500, -100, 2.5, '500', null])('refuses `contributionMinor` %j', (contributionMinor) => {
		const refused = refusal({ contributionMinor });
		expect(refused.ok).toBe(false);
		expect(refused.message).toContain('`contributionMinor`');
	});
});

/** a config serving a sponsor and a contribution offer, which does not make one takeable here. */
const OFFERING: FormConfig = {
	...CONFIG,
	sponsor: { legalName: 'Better Giving Fiscal Sponsorship Inc.', ein: CONFIG.ein },
	contribution: { options: [0.1, 0.15, 0.2], startsAt: 0.15 }
};

describe('a contribution beside a served config that offers one', () => {
	it('is still refused on a quote', () => {
		const result = parseQuoteRequest(body({ contributionMinor: 1500 }), OFFERING);

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.message).toContain('`contributionMinor`');
	});

	it.each([stockBody, iraBody])('is still refused on a pledge', (make) => {
		const result = parsePledgeRequest(make({ contributionMinor: 1500 }), OFFERING);

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.message).toContain('`contributionMinor`');
	});

	it('leaves a body without one parsing as it does on a config that offers none', () => {
		expect(parseQuoteRequest(body(), OFFERING)).toStrictEqual(parseQuoteRequest(body(), CONFIG));
	});
});

describe('parsePledgeRequest() — a contribution, which a pledge cannot take either', () => {
	it.each([stockBody, iraBody])(
		'parses a body sending `contributionMinor` 0 exactly as one leaving it out',
		(make) => {
			expect(parsePledgeRequest(make({ contributionMinor: 0 }), CONFIG)).toStrictEqual(
				parsePledgeRequest(make(), CONFIG)
			);
		}
	);

	it.each(
		(
			[
				['stock', stockBody],
				['ira_qcd', iraBody]
			] as const
		).flatMap(([rail, make]) =>
			[500, -100, 2.5, '500', null].map((value) => [rail, make, value] as const)
		)
	)('refuses on `%s` a `contributionMinor` of %j', (_rail, make, contributionMinor) => {
		const refused = pledgeRefusal(make({ contributionMinor }));
		expect(refused.ok).toBe(false);
		expect(refused.message).toContain('`contributionMinor`');
		// a pledge states shares or a custodian's amount and carries no contribution, which is the
		// reason the answer gives rather than the payment path's.
		expect(refused.message).toContain('a pledge takes none');
		expect(refused.fix).toContain('pledge');
	});
});
