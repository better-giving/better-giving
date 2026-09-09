import { describe, expect, it } from 'vitest';
import { SUGGESTED_DEDUCTIBILITY_STATEMENT } from '@better-giving/operator/deductibility';
import { readFormConfig } from '@better-giving/form/config';
import { OFFERED_PAYMENT_METHODS } from '../../forms/offered-rails';
import { postableFromAccount, type PostableAccountId } from '../db/postable';
import type { OrgProfile } from '../db/schema';
import { STRIPE_US_FEE_RULES } from '../payments/fees';
import type { FormRecord } from './form-input';
import { publishedConfig, renderableConfig, type PublishedConfigSources } from './published-config';
import type { PaymentMethod } from '@better-giving/form/v1';

// the refusals, every one of them decidable without a database. the composer that reads the two
// rows is in `published-config.workers.spec.ts`; everything here is the judgement it wraps.
//
// each case asserts its own `reason`, not merely that something was refused. `/api/v1` writes a
// different 4xx body per reason and CLAUDE.md requires each to name the offending value and
// where to fix it — so a spec that could not tell two refusals apart is a spec that would let
// the endpoint answer a draft form with a message about Stripe.

const FORM_ID = 'frm_publishedcfg001';

/**
 * how often a gift may repeat, as this deployment answers it.
 *
 * an argument rather than a column: `offeredCadences` in ./offered-cadences.ts reads it off the
 * processor's account, and every case here that is not about the cadences takes the answer a
 * deployment that has set up recurring gifts gives.
 */
const SERVED_CADENCES = ['one_time', 'monthly', 'yearly'] as const;

/**
 * the fund a stored form points at, minted through the door `../db/postable.ts` documents
 * rather than cast: a `form` row carries the brand on that column, so a fixture standing in for
 * one has to arrive at it the same way. nothing below reads the value — it is here because
 * `FormRecord` is the shape the composer hands over, and a fixture that is not one would be
 * testing a shape this function never sees.
 */
const REVENUE_ACCOUNT_ID = postableId('acc-revenue');

function postableId(id: string): PostableAccountId {
	const branded = postableFromAccount({ id, isPostable: true });
	if (branded === null) throw new Error(`a postable row did not mint a postable id for ${id}`);
	return branded;
}

function formRecord(overrides: Partial<FormRecord> = {}): FormRecord {
	return {
		id: FORM_ID,
		name: 'General Fund',
		status: 'live',
		revenueAccountId: REVENUE_ACCOUNT_ID,
		minMinor: 500,
		maxMinor: 1000000,
		currency: 'USD',
		suggestedAmounts: [2500, 5000, 10000],
		allowedOrigins: ['https://acme.org'],
		// on the record because the editor's program group saves them. nothing served reads either
		// yet — what a form does about causes reaches a donor in a later slice.
		programMode: 'none',
		programId: null,
		...overrides
	};
}

function orgProfile(overrides: Partial<OrgProfile> = {}): OrgProfile {
	return {
		id: 'default',
		legalName: 'Hope Foundation',
		taxId: '12-3456789',
		addressLine1: '1 Hope Street',
		addressLine2: null,
		city: 'Springfield',
		region: 'IL',
		postalCode: '62701',
		country: 'US',
		notificationEmail: 'ops@acme.org',
		deductibilityStatement: 'No goods or services were provided in exchange for this gift.',
		createdAt: new Date(0),
		updatedAt: new Date(0),
		...overrides
	};
}

/** a deployment whose Stripe pair is set, each key in its own slot. */
const STRIPE = {
	STRIPE_SECRET_KEY: 'sk_test_abc',
	STRIPE_PUBLISHABLE_KEY: 'pk_test_abc',
	STRIPE_WEBHOOK_SECRET: 'whsec_abc'
};

describe('publishedConfig — refusals', () => {
	/**
	 * an id nothing matches, which is what a mistyped `form` attribute looks like from here.
	 *
	 * the id is echoed whole — it sits in the org's own public HTML and is quoted back by
	 * unauthenticated requests, so there is nobody a truncated one withholds it from, and the
	 * whole point of the message is letting someone compare it against what they pasted.
	 */
	it('refuses an id no form carries, naming the id', () => {
		const result = publishedConfig({
			id: FORM_ID,
			cadences: SERVED_CADENCES,
			program: null,
			rails: OFFERED_PAYMENT_METHODS,
			form: null,
			profile: orgProfile(),
			env: STRIPE
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('form_not_found');
		expect(result.error.message).toContain(FORM_ID);
	});

	/**
	 * a draft form serves nothing, which is what makes `status` mean something at all.
	 *
	 * the accepted cost is that a snippet pasted ahead of publication renders nothing until the
	 * form is flipped live — the create and edit screens hand out the snippet in draft on
	 * purpose, so this is the sentence that explains an empty space on a site.
	 */
	it('refuses a draft form, naming the status and the screen that publishes it', () => {
		const result = publishedConfig({
			id: FORM_ID,
			cadences: SERVED_CADENCES,
			program: null,
			rails: OFFERED_PAYMENT_METHODS,
			form: formRecord({ status: 'draft' }),
			profile: orgProfile(),
			env: STRIPE
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('form_not_published');
		expect(result.error.message).toContain('draft');
		expect(result.error.fix).toContain('Forms');
	});

	/**
	 * a retired form is a different answer from a draft one, and the difference is the fix.
	 *
	 * a draft is published from the screen that edits it; a retired form cannot be — the three
	 * `updateForm*` group writes and `archiveForm` in ./queries.ts all refuse a row with
	 * `archived_at` set, and this repo
	 * has no write that clears it. so the only way forward is a new form and a new snippet, and a
	 * refusal that collapsed the two would send someone to a page with no box that helps.
	 */
	it('refuses a retired form with its own reason, not the draft one', () => {
		const result = publishedConfig({
			id: FORM_ID,
			cadences: SERVED_CADENCES,
			program: null,
			rails: OFFERED_PAYMENT_METHODS,
			form: formRecord({ status: 'archived' }),
			profile: orgProfile(),
			env: STRIPE
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('form_retired');
		expect(result.error.fix).not.toContain('Live');
	});

	/**
	 * both bounds or nothing. the columns are nullable — `parseFormInput` refuses a blank on
	 * either, so no /admin save produces one, but a row written by `wrangler d1 execute` or an
	 * importer can — and `readFormConfig` in packages/form/src/config.ts refuses the same shape at the
	 * far end. served, it would be a form that renders and then refuses every amount a donor
	 * types, with nothing on the screen saying why.
	 *
	 * the inverted pair is here for the same reason even though `form_min_max_minor_check` in
	 * ../db/schema.ts makes it unstorable: this function's input is a `FormRecord`, not a row, so
	 * the constraint is not on this path.
	 */
	it.each([
		{ label: 'no smallest gift', bounds: { minMinor: null }, names: 'min_minor' },
		{ label: 'no largest gift', bounds: { maxMinor: null }, names: 'max_minor' },
		{
			label: 'neither bound',
			bounds: { minMinor: null, maxMinor: null },
			names: 'min_minor'
		},
		{
			label: 'a smallest gift above the largest',
			bounds: { minMinor: 20000, maxMinor: 5000 },
			names: '20000'
		}
	])('refuses a form with $label, naming $names', ({ bounds, names }) => {
		const result = publishedConfig({
			id: FORM_ID,
			cadences: SERVED_CADENCES,
			program: null,
			rails: OFFERED_PAYMENT_METHODS,
			form: formRecord(bounds),
			profile: orgProfile(),
			env: STRIPE
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('form_unservable');
		expect(result.error.message).toContain(names);
	});

	/**
	 * a bound of zero, which the table stores and the donation form will not read.
	 *
	 * `form_min_minor_check` in ../db/schema.ts is `is null or >= 0`, so a 0 is a value that
	 * reaches this function — while `readFormConfig` in packages/form/src/config.ts reads both bounds
	 * through `wholeAtLeast(value, 1)` and returns `null` for the entire config when either falls
	 * below it. served, that is exactly the silently blank donation form this module exists to
	 * prevent, on a page nobody here can see.
	 *
	 * refused at 1 and not at `MIN_AMOUNT_MINOR` in ./form-input.ts, which is 50. the contract
	 * here is to refuse what the client refuses and nothing more: refusing at the larger figure
	 * would turn away a config the donation form would have rendered perfectly well.
	 */
	it.each([
		{ label: 'a smallest gift of zero', bounds: { minMinor: 0 }, names: 'min_minor' },
		{ label: 'a largest gift of zero', bounds: { maxMinor: 0 }, names: 'max_minor' }
	])('refuses a form with $label, naming the column and the value', ({ bounds, names }) => {
		const result = publishedConfig({
			id: FORM_ID,
			cadences: SERVED_CADENCES,
			program: null,
			rails: OFFERED_PAYMENT_METHODS,
			form: formRecord(bounds),
			profile: orgProfile(),
			env: STRIPE
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('form_unservable');
		expect(result.error.message).toContain(`${names} is 0`);
	});

	/**
	 * the identity a gift is solicited under, which the form is not allowed to omit from a screen
	 * asking for a tax-deductible donation. `readFormConfig` in packages/form/src/config.ts drops the
	 * whole config over any one of these, so serving one short is serving a form that will not
	 * render — and two of the three are legitimately absent on a fresh deployment, which is what
	 * makes this the likeliest refusal of the six rather than an exotic one.
	 *
	 * a blank string counts as absent, not just `null`. `org_profile`'s per-column `not_blank`
	 * checks make one unstorable, so these two rows are not a hole in the table — they are the
	 * claim that this function's answer does not depend on a constraint declared in another file,
	 * since its input is an `OrgProfile` value and nothing in that type records that the
	 * constraint ran.
	 */
	it.each([
		{ label: 'no profile saved at all', profile: null, names: 'legal_name' },
		{
			label: 'a blank registered name',
			profile: orgProfile({ legalName: '  ' }),
			names: 'legal_name'
		},
		{ label: 'no EIN', profile: orgProfile({ taxId: null }), names: 'tax_id' },
		{ label: 'a blank EIN', profile: orgProfile({ taxId: '' }), names: 'tax_id' }
	])('refuses a deployment with $label, naming $names', ({ profile, names }) => {
		const result = publishedConfig({
			id: FORM_ID,
			cadences: SERVED_CADENCES,
			program: null,
			rails: OFFERED_PAYMENT_METHODS,
			form: formRecord(),
			profile,
			env: STRIPE
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('org_profile_incomplete');
		expect(result.error.message).toContain(names);
		expect(result.error.fix).toContain('better-giving open');
	});

	/**
	 * no publishable key, no card field: it is the value the form's payment SDK is initialised
	 * with, and `readFormConfig` drops a config whose `provider` has no key. the secret key is
	 * checked here too because the next request the form makes is the one that charges, and a
	 * config served for a deployment that cannot charge is a form that fails at the last step.
	 */
	it.each([
		{
			label: 'no publishable key',
			env: { STRIPE_SECRET_KEY: 'sk_test_a' },
			names: 'STRIPE_PUBLISHABLE_KEY'
		},
		{
			label: 'no secret key',
			env: { STRIPE_PUBLISHABLE_KEY: 'pk_test_a' },
			names: 'STRIPE_SECRET_KEY'
		},
		{ label: 'no Stripe keys at all', env: {}, names: 'STRIPE_PUBLISHABLE_KEY' }
	])('refuses a deployment with $label, naming $names', ({ env, names }) => {
		const result = publishedConfig({
			id: FORM_ID,
			cadences: SERVED_CADENCES,
			program: null,
			rails: OFFERED_PAYMENT_METHODS,
			form: formRecord(),
			profile: orgProfile(),
			env
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('payments_not_configured');
		expect(result.error.message).toContain(names);
	});

	/**
	 * an account approved for no rail is served by this ladder, not refused by it.
	 *
	 * the guard for that list is `renderableConfig` below, and it is deliberately not here:
	 * `mintQuote` in ../donations/quote.ts shares this function, so a refusal minted at this level
	 * lands on a donor's POST and turns away a gift already in flight. this case is the half of that
	 * pin living where the decision would have to be reintroduced.
	 */
	it('serves a deployment whose account can charge no rail, leaving the refusal to the route', () => {
		const result = publishedConfig({
			id: FORM_ID,
			cadences: SERVED_CADENCES,
			program: null,
			rails: [],
			form: formRecord(),
			profile: orgProfile(),
			env: STRIPE
		});
		expect(result.ok).toBe(true);
		expect(result.ok && result.config.paymentMethods).toEqual([]);
	});
});

/**
 * the row on the way back out, which is what keeps the endpoint to one read.
 *
 * `allowed_origins` decides the CORS headers on every answer, and a browser cannot read a 4xx
 * body without `Access-Control-Allow-Origin` — so a refusal handed back without its row is a
 * refusal the page that asked for it never sees, and re-reading the row to get the origins is a
 * second query on a public, unauthenticated endpoint.
 */
describe('publishedConfig — the row it carries out', () => {
	it.each([
		{ label: 'a draft form', form: formRecord({ status: 'draft' }) },
		{ label: 'a retired form', form: formRecord({ status: 'archived' }) },
		{ label: 'a form with no amount bounds', form: formRecord({ minMinor: null }) }
	])('carries the row back with the refusal of $label', ({ form }) => {
		const result = publishedConfig({
			id: FORM_ID,
			cadences: SERVED_CADENCES,
			program: null,
			rails: OFFERED_PAYMENT_METHODS,
			form,
			profile: orgProfile(),
			env: STRIPE
		});
		expect(result.ok).toBe(false);
		expect(result.form?.allowedOrigins).toEqual(['https://acme.org']);
	});

	// the refusals that are about the deployment rather than the form still carry it: the request
	// named a real form, so the page that asked has origins to be answered against.
	it.each([
		{ label: 'an incomplete organisation profile', sources: { profile: null } },
		{ label: 'unset Stripe keys', sources: { env: {} } }
	])('carries the row back when $label is what refused', ({ sources }) => {
		const result = publishedConfig({
			id: FORM_ID,
			cadences: SERVED_CADENCES,
			program: null,
			rails: OFFERED_PAYMENT_METHODS,
			form: formRecord(),
			profile: orgProfile(),
			env: STRIPE,
			...sources
		});
		expect(result.ok).toBe(false);
		expect(result.form?.allowedOrigins).toEqual(['https://acme.org']);
	});

	/**
	 * the one refusal with no row, and no origins is the correct answer to it: there is nothing to
	 * read `allowed_origins` from, so nobody is authorised to read the body cross-origin.
	 */
	it('carries no row when no form matched the id', () => {
		const result = publishedConfig({
			id: FORM_ID,
			cadences: SERVED_CADENCES,
			program: null,
			rails: OFFERED_PAYMENT_METHODS,
			form: null,
			profile: orgProfile(),
			env: STRIPE
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('form_not_found');
		expect(result.form).toBeNull();
	});

	it('carries the row alongside a config it agrees to serve', () => {
		const result = publishedConfig({
			id: FORM_ID,
			cadences: SERVED_CADENCES,
			program: null,
			rails: OFFERED_PAYMENT_METHODS,
			form: formRecord(),
			profile: orgProfile(),
			env: STRIPE
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.form.allowedOrigins).toEqual(['https://acme.org']);
		expect(result.form.id).toBe(result.config.formId);
	});
});

/**
 * the one rule the config route adds on top of the ladder, and the one it must not share.
 *
 * every case here is about the same question asked from the other side: `readFormConfig` in
 * packages/form/src/config.ts drops a config offering no rail, so the route that hands a body to it refuses
 * rather than serving one — while the donation path, which shares `publishedConfig` above, goes on
 * charging. the donor half of that pin is `mintQuote() — a rail the account has stopped offering` in
 * ../donations/quote.workers.spec.ts.
 */
describe('renderableConfig', () => {
	/** the served config as the ladder answers it, before this rule is applied. */
	const ladder = (rails: readonly PaymentMethod[]) =>
		publishedConfig({
			id: FORM_ID,
			cadences: SERVED_CADENCES,
			program: null,
			rails,
			form: formRecord(),
			profile: orgProfile(),
			env: STRIPE
		});

	it('refuses a config offering no rail, naming the rails and the screen', () => {
		const result = renderableConfig(ladder([]));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('payments_not_configured');
		expect(result.error.fix).toContain('better-giving open');
		// the row still comes back: the endpoint answers this 4xx with CORS headers taken from
		// `allowed_origins`, and a body a browser cannot read is a refusal that reaches nobody.
		expect(result.form?.allowedOrigins).toEqual(['https://acme.org']);
	});

	it.each([
		{ label: 'both rails', rails: OFFERED_PAYMENT_METHODS },
		{ label: 'one rail', rails: ['card'] as const }
	])('passes a config offering $label through untouched', ({ rails }) => {
		const answered = ladder(rails);
		expect(renderableConfig(answered)).toBe(answered);
	});

	/**
	 * a refusal the ladder already made is carried through as itself.
	 *
	 * the rails are empty on every refusing branch — nothing above assembles a config — so a rule
	 * that read the list without checking `ok` first would answer a draft form with a message about
	 * Stripe capabilities, which is the wrong screen and the wrong `error` code on the wire.
	 */
	it('carries an earlier refusal through under its own reason', () => {
		const draft = publishedConfig({
			id: FORM_ID,
			cadences: SERVED_CADENCES,
			program: null,
			rails: [],
			form: formRecord({ status: 'draft' }),
			profile: orgProfile(),
			env: STRIPE
		});
		const result = renderableConfig(draft);
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.reason).toBe('form_not_published');
	});
});

/** the config a live form on a fully configured deployment produces. */
function served(sources: Partial<PublishedConfigSources> = {}) {
	const result = publishedConfig({
		id: FORM_ID,
		cadences: SERVED_CADENCES,
		program: null,
		rails: OFFERED_PAYMENT_METHODS,
		form: formRecord(),
		profile: orgProfile(),
		env: STRIPE,
		...sources
	});
	if (!result.ok) throw new Error(`expected a config, got ${result.reason}`);
	return result.config;
}

describe('publishedConfig — the config it serves', () => {
	it('carries the form’s own amounts', () => {
		expect(served()).toMatchObject({
			formId: FORM_ID,
			currency: 'USD',
			suggestedAmountsMinor: [2500, 5000, 10000],
			minAmountMinor: 500,
			maxAmountMinor: 1000000
		});
	});

	/**
	 * how often a gift may repeat is served from the deployment's answer and never from the row.
	 *
	 * over rows differing on every other axis this function reads, because a single fixture would
	 * pass this whatever the source was — the same demonstration the rails get below. the column is
	 * not on `FormRecord` at all (./form-input.ts), so what is left to hold is that the served value
	 * moves with the argument and with nothing else.
	 */
	it.each([
		{ label: 'a deployment that can collect a repeating gift', cadences: SERVED_CADENCES },
		{ label: 'a deployment that cannot', cadences: ['one_time'] as const }
	])('serves the cadences $label was read as offering', ({ cadences }) => {
		expect(served({ cadences }).frequencies).toEqual([...cadences]);
		expect(served({ cadences, form: formRecord({ suggestedAmounts: [] }) }).frequencies).toEqual([
			...cadences
		]);
	});

	/**
	 * the rails are this deployment's and never this form's, and no column on `form` can say
	 * otherwise — the table carries no `payment_methods`, and `FormRecord` in ./form-input.ts has
	 * no key for it.
	 *
	 * so what is left to demonstrate is that the answer does not move with the row. over three
	 * rows differing on every other axis this function reads, because a single fixture would
	 * pass this whatever the source was.
	 */
	it.each([
		{ label: 'the default fixture', form: formRecord() },
		{
			label: 'no suggested amounts and the tightest bounds',
			form: formRecord({ suggestedAmounts: [], minMinor: 1, maxMinor: 1 })
		}
	])('serves the deployment’s own rails over a row holding $label', ({ form }) => {
		expect(served({ form }).paymentMethods).toEqual(OFFERED_PAYMENT_METHODS);
	});

	/**
	 * which rails are served is the deployment's answer and never the repository's constant.
	 *
	 * the same shape the cadences are held to above, and the defect it closes is the one
	 * ../payments/rail-chargeability.ts's header names: the processor enforces none of the operator's
	 * switches on a charge this app mints, so a form offering a rail the account is not approved for
	 * is a donor picking Bank and meeting a failure at the last step, on a page nobody here can see.
	 * `offeredRails` in ./offered-rails.ts is what reads it.
	 *
	 * over rows differing on every axis this function reads, because a single fixture would pass this
	 * whatever the source was.
	 */
	it.each([
		{ label: 'both rails', rails: OFFERED_PAYMENT_METHODS },
		{ label: 'cards alone', rails: ['card'] as const }
	])('serves the rails $label was read as offering', ({ rails }) => {
		expect(served({ rails }).paymentMethods).toEqual([...rails]);
		expect(served({ rails, form: formRecord({ suggestedAmounts: [] }) }).paymentMethods).toEqual([
			...rails
		]);
	});

	it('carries the organisation’s identity from the saved profile', () => {
		expect(served()).toMatchObject({
			orgLegalName: 'Hope Foundation',
			ein: '12-3456789',
			deductibilityStatement: 'No goods or services were provided in exchange for this gift.'
		});
	});

	/**
	 * the sentence a form states while asking, on a deployment that has never written one.
	 *
	 * the column is unseeded and no screen asks for it, so the standard 501(c)(3) wording is what
	 * a served config carries — a form is refused for a missing legal name or EIN and never for
	 * this, and `SUGGESTED_DEDUCTIBILITY_STATEMENT` is the whole of what "unwritten" means.
	 */
	it.each([
		{ label: 'never written', stored: null },
		{ label: 'written blank by hand', stored: '  ' }
	])('serves the standard wording where the statement is $label', ({ stored }) => {
		const config = served({ profile: orgProfile({ deductibilityStatement: stored }) });
		expect(config.deductibilityStatement).toBe(SUGGESTED_DEDUCTIBILITY_STATEMENT);
	});

	it('serves an organisation’s own wording ahead of the standard one', () => {
		const own = 'Your gift funds the clinic and nothing was given in return.';
		expect(
			served({ profile: orgProfile({ deductibilityStatement: own }) }).deductibilityStatement
		).toBe(own);
	});

	/**
	 * the publishable key and nothing else about Stripe. `name` is what tells an adapter which
	 * SDK to reach for — the vendor is data on this contract rather than a field named after one.
	 */
	it('names the payment provider and hands over the publishable key', () => {
		expect(served().provider).toEqual({ name: 'stripe', publishableKey: 'pk_test_abc' });
	});

	/**
	 * the fee rules are the repo constant, served whole.
	 *
	 * asserted by identity rather than by value, because the point is that nothing between the
	 * constant and the wire gets to reshape it: a rail dropped or a rate rounded on the way out
	 * is a fee line quoting a number the processor does not charge.
	 */
	it('serves the published Stripe fee rules unchanged', () => {
		expect(served().feeRules).toBe(STRIPE_US_FEE_RULES);
	});

	/**
	 * `optional` is served rather than stored, and no `form` column decides it.
	 *
	 * `DEFAULT_COVERS_FEE` in packages/form/src/value.ts is `true` and `payerCoversFee` beside it returns
	 * the donor's own answer, falling back to that default — so the fee line is opt-out with the box
	 * already ticked. that is a donor toggle with an on-by-default, not a per-form setting, which is
	 * why nothing in /admin offers it. `optional` is the only member of `FEE_COVERAGE_MODES`, and
	 * the field stays on the wire because `v1` is add-never-rename (CLAUDE.md).
	 */
	it('serves fee coverage as optional, the donor-toggle mode', () => {
		expect(served().feeCoverage).toBe('optional');
	});

	/**
	 * the locale is sent rather than left to the client's fallback.
	 *
	 * `FormConfig` types it as a required string, and a response that omits a field its own
	 * contract calls required is a response the type describes wrongly — the client's fallback at
	 * `readFormConfig` is there for a garbled response, not as this endpoint's storage. the value
	 * is fixed because there is no column behind it and every form is USD (`FORM_CURRENCY` in
	 * `$lib/forms/amounts.ts`); a form denominated elsewhere is what makes it data.
	 */
	it('states the locale explicitly', () => {
		expect(served().locale).toBe('en-US');
	});

	// the sitekey is public by design — it is rendered into the widget — and optional on the
	// contract, so a deployment without one serves a config with no such field rather than a
	// field holding an empty string, which `readFormConfig` would drop anyway.
	it('passes the Turnstile sitekey through when this deployment has one', () => {
		expect(
			served({ env: { ...STRIPE, TURNSTILE_SITE_KEY: '1x00000000000000000000AA' } })
		).toHaveProperty('turnstileSiteKey', '1x00000000000000000000AA');
	});

	it('omits the Turnstile sitekey entirely when it is unset', () => {
		expect(served()).not.toHaveProperty('turnstileSiteKey');
	});

	/**
	 * the claim this module exists for, made end to end.
	 *
	 * the config goes through `JSON.stringify`/`parse` and then through the client's own reader,
	 * because that is the exact path it takes to a donation form: anything this side serves that
	 * `readFormConfig` drops is a form that renders nothing on a site nobody here can see. a
	 * round trip is what catches a field that survives an object comparison and not a serialise —
	 * an `undefined`, a `Date`, a `Map`.
	 *
	 * over every shape that is actually served rather than over the default fixture alone, and
	 * that is the difference between this case holding the claim and merely appearing to. one
	 * comfortable row exercises one point in the middle of the space; the reader's disagreements
	 * live at its edges — a bound at the smallest value it will take, an empty suggested list, an
	 * optional field present and absent. run on the fixture alone, this passes over a bound of `0`
	 * that is served here and dropped there.
	 */
	it.each([
		{ label: 'the default fixture', sources: {} },
		{
			label: 'bounds at the smallest value the reader accepts',
			sources: { form: formRecord({ minMinor: 1, maxMinor: 1, suggestedAmounts: [1] }) }
		},
		{
			label: 'a deployment that cannot collect a repeating gift',
			sources: { cadences: ['one_time'] as const }
		},
		{
			label: 'no suggested amounts at all',
			sources: { form: formRecord({ suggestedAmounts: [] }) }
		},
		{
			label: 'a deployment with a Turnstile sitekey',
			sources: { env: { ...STRIPE, TURNSTILE_SITE_KEY: '1x00000000000000000000AA' } }
		},
		{
			// the ordinary deployment, and the one the embed's reader would drop whole: it requires
			// `deductibilityStatement` and hard-nulls a config that omits it, which is why the
			// fallback is applied before the config is built rather than after it is read.
			label: 'a profile that has never carried a deductibility statement',
			sources: { profile: orgProfile({ deductibilityStatement: null }) }
		},
		{
			label: 'a form pinned to one cause',
			sources: { program: { mode: 'pinned', name: 'Clean water' } as const }
		},
		{
			label: 'a form offering a donor the choice',
			sources: {
				program: {
					mode: 'choice',
					options: [{ id: '019fb300-0000-7000-8000-0000000000a1', name: 'Clean water' }]
				} as const
			}
		}
	])('produces a config the donation form’s own reader accepts, with $label', ({ sources }) => {
		const config = served(sources);
		const read = readFormConfig(JSON.parse(JSON.stringify(config)));
		expect(read).toEqual(config);
	});

	/**
	 * the cause, in the two shapes `Program` in packages/form/src/v1.ts admits and the absence that
	 * is neither.
	 *
	 * the shape arrives already read (`PublishedConfigSources.program`), so what is held here is the
	 * one judgement this half makes over it: a `choice` offering nothing is served as no program at
	 * all, because that is how `readFormConfig` reads it — a select drawn over no options is a
	 * question with no answers, and the config would carry a control the donation form then drops.
	 */
	it('serves a pinned cause as the name a donor reads', () => {
		expect(served({ program: { mode: 'pinned', name: 'Clean water' } }).program).toEqual({
			mode: 'pinned',
			name: 'Clean water'
		});
	});

	it('serves a choice as the options in the order they were read', () => {
		const options = [
			{ id: '019fb300-0000-7000-8000-0000000000a1', name: 'Clean water' },
			{ id: '019fb300-0000-7000-8000-0000000000a2', name: 'School meals' }
		];
		expect(served({ program: { mode: 'choice', options } }).program).toEqual({
			mode: 'choice',
			options
		});
	});

	it('omits the key entirely for a choice with nothing to choose from', () => {
		expect(served({ program: { mode: 'choice', options: [] } })).not.toHaveProperty('program');
	});

	it('omits the key entirely for a form that names no cause', () => {
		expect(served()).not.toHaveProperty('program');
	});
});
