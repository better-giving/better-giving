import { env } from 'cloudflare:test';
import { SUGGESTED_DEDUCTIBILITY_STATEMENT } from '@better-giving/operator/deductibility';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OFFERED_PAYMENT_METHODS } from '$lib/forms/offered-rails';
import { createDb, type Db } from '$lib/server/db/client';
import { readPublishedConfig } from '$lib/server/forms/published-config';
import { parseOrgProfile } from '$lib/server/org/org-input';
import { saveOrgProfile } from '$lib/server/org/queries';

// a workers spec because the whole of what the composer adds is two reads. every refusal it can
// return is decided in `published-config.spec.ts` beside this file, against values rather than
// rows; what is under test here is that the rows reaching that judgement are the right ones —
// including an archived form, which `readForm` deliberately does not filter out.

let db: Db;

/** the form these cases publish, written by this file: no migration seeds one. */
const FORM_ID = 'frm_publishedcfgwrk1';

let revenueAccountId: string;

/** a deployment whose Stripe pair is set and agrees, so the env is never what refuses. */
const STRIPE = {
	STRIPE_SECRET_KEY: 'sk_test_abc',
	STRIPE_PUBLISHABLE_KEY: 'pk_test_abc',
	STRIPE_WEBHOOK_SECRET: 'whsec_abc'
};

/**
 * how often a gift may repeat, as a deployment whose account can collect one answers.
 *
 * a function rather than a value because that is the shape `readPublishedConfig` takes — how to
 * find out, called only once a row has been found — and it is stated here rather than reached for
 * so that nothing in this file leaves workerd. what the real one does is
 * `$lib/server/forms/cadence-cache.ts` over `$lib/server/forms/offered-cadences.ts`, and both have
 * specs of their own.
 */
const READY = async () => ['one_time', 'monthly', 'yearly'] as const;

/**
 * which rails a donor may be shown, as an account approved for both answers.
 *
 * a function for the reason `READY` above is one. what the real one does is
 * `$lib/server/forms/rail-cache.ts` over `$lib/server/forms/offered-rails.ts`, and both have specs
 * of their own.
 */
const BOTH_RAILS = async () => OFFERED_PAYMENT_METHODS;

beforeAll(async () => {
	db = createDb(env.DB);
	const row = await env.DB.prepare(
		`select id from account where is_postable = 1 and code = '4110'`
	).first<{ id: string }>();
	if (!row)
		throw new Error(
			'no 4110 account — has the chart of accounts in migrations/0000_initial_schema.sql moved?'
		);
	revenueAccountId = row.id;
});

beforeEach(async () => {
	await env.DB.prepare('delete from form').run();
	await env.DB.prepare('delete from org_profile').run();
	await env.DB.prepare(
		`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
		                   suggested_amounts, allowed_origins,
		                   created_at, updated_at)
		 values (?, 'General Fund', 'live', ?, 'USD', 500, 1000000, '[2500,5000]',
		         '["https://acme.org"]', 0, 0)`
	)
		.bind(FORM_ID, revenueAccountId)
		.run();
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, created_at, updated_at)
		 values ('default', 'Hope Foundation', '12-3456789', 0, 0)`
	).run();
});

describe('readPublishedConfig', () => {
	it('serves the stored form’s own amounts, and this deployment’s rails and cadences', async () => {
		// the halves of the served config come from different places and the row is only one of
		// them: the amounts are this form's, while the rails and the cadences are both read off the
		// processor's account. each is asserted against what this file handed in rather than against
		// a written-out list, because no column could disagree with either: `form` carries no
		// `payment_methods` and no `frequencies`.
		const result = await readPublishedConfig(db, FORM_ID, STRIPE, READY, BOTH_RAILS);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.config).toMatchObject({
			formId: FORM_ID,
			currency: 'USD',
			suggestedAmountsMinor: [2500, 5000],
			// what the cadence read handed in. no row could disagree: what a donor may pick has no
			// column behind it any more.
			frequencies: ['one_time', 'monthly', 'yearly'],
			paymentMethods: OFFERED_PAYMENT_METHODS,
			orgLegalName: 'Hope Foundation'
		});
	});

	/**
	 * the rail read's answer reaches the served config, narrower than the repository's own list.
	 *
	 * the composer's half of the defect: served unconditionally, the repository's list offers a rail
	 * the account may never have been approved for, and the refusal arrives at the last step on a
	 * page nobody here can see — see
	 * `$lib/server/payments/rail-chargeability.ts`, whose header states that the processor enforces
	 * none of the operator's switches on a charge this app mints.
	 */
	it('serves the rails the account read answered with, not the repository’s list', async () => {
		const result = await readPublishedConfig(db, FORM_ID, STRIPE, READY, async () => ['card']);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.config.paymentMethods).toEqual(['card']);
	});

	/**
	 * an account approved for no rail is served by this reader and refused by nothing in it.
	 *
	 * this is the reader `mintQuote` in ../donations/quote.ts shares, so a refusal minted here lands
	 * on a donor's POST rather than on a config request — and its `fix` names /admin, which is an
	 * operator's screen rendered to a donor. the rule that does refuse an unrenderable config is
	 * `renderableConfig`, covered in ./published-config.spec.ts, and only the config route composes
	 * it. this case fails if it is ever folded back in here.
	 */
	it('serves a deployment whose account can charge none of its rails, refusing nothing', async () => {
		const result = await readPublishedConfig(db, FORM_ID, STRIPE, READY, async () => []);
		expect(result.ok).toBe(true);
		expect(result.ok && result.config.paymentMethods).toEqual([]);
	});

	/**
	 * an id nothing matches costs no outbound call, and the two reads throw to prove it.
	 *
	 * this route is public and unauthenticated, so an id nobody has a row for is a request anyone can
	 * make this deployment issue — and each of these is a call to Stripe rather than a query. the
	 * reader answers `form_not_found` before the `Promise.all` that would make them, and a throwing
	 * pair is what turns "does not currently call them" into a case that fails if the early return is
	 * ever moved below the reads.
	 */
	it('refuses an id no row carries, without asking the processor anything', async () => {
		const refuseToRead = (name: string) => async () => {
			throw new Error(`${name} was called for an id no form matches`);
		};
		const result = await readPublishedConfig(
			db,
			'frm_nosuchformatall1',
			STRIPE,
			refuseToRead('readCadences'),
			refuseToRead('readRails')
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('form_not_found');
	});

	/**
	 * a retired form is read back rather than 404'd, and this is the case that proves it.
	 *
	 * `readForm` in ./queries.ts deliberately does not filter `archived_at`, precisely so "that
	 * form was retired" and "there is no such form" stay different sentences. a composer that
	 * reached for `readForms` instead — which does filter — would collapse them, and the snippet
	 * sitting in someone else's HTML would get the wrong answer forever.
	 */
	it('tells a retired form apart from one that never existed', async () => {
		await env.DB.prepare(`update form set status = 'archived', archived_at = 1 where id = ?`)
			.bind(FORM_ID)
			.run();
		const result = await readPublishedConfig(db, FORM_ID, STRIPE, READY, BOTH_RAILS);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('form_retired');
	});

	// the state every fresh deployment is in: a form can exist before anyone has opened Settings,
	// because nothing seeds `org_profile` and a blank row would read as configured.
	it('refuses when no organisation profile has been saved', async () => {
		await env.DB.prepare('delete from org_profile').run();
		const result = await readPublishedConfig(db, FORM_ID, STRIPE, READY, BOTH_RAILS);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('org_profile_incomplete');
	});

	// the ordinary deployment: nothing has ever written a wording, and a form is served anyway.
	//
	// through the real save rather than a direct write, because that is the whole claim — the
	// profile an operator's own press stores carries no statement at all, and the standard sentence
	// is what the served config states while asking.
	it('serves the standard wording for a saved profile that carries no statement', async () => {
		await env.DB.prepare('delete from org_profile').run();
		const parsed = parseOrgProfile({
			legal_name: 'Hope Foundation',
			tax_id: '12-3456789',
			address_line1: '12 Kigali Road',
			city: 'Kigali',
			country: 'Rwanda'
		});
		if (!parsed.ok) throw new Error(`the profile was refused: ${JSON.stringify(parsed.errors)}`);
		await saveOrgProfile(db, parsed.value);

		const result = await readPublishedConfig(db, FORM_ID, STRIPE, READY, BOTH_RAILS);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.config.deductibilityStatement).toBe(SUGGESTED_DEDUCTIBILITY_STATEMENT);
	});

	// the two nullable bound columns, which no /admin save can leave empty and a direct write can.
	it('refuses a stored form whose amount bounds were never set', async () => {
		await env.DB.prepare('update form set min_minor = null, max_minor = null where id = ?')
			.bind(FORM_ID)
			.run();
		const result = await readPublishedConfig(db, FORM_ID, STRIPE, READY, BOTH_RAILS);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('form_unservable');
	});

	/**
	 * a bound of zero, and the point of making this claim against D1 rather than against a value
	 * is that the row is storable at all: `form_min_minor_check` and `form_max_minor_check` in
	 * migrations/0000_initial_schema.sql are `is null or >= 0`, so the update below succeeds and
	 * the refusal is load-bearing rather than defensive. `readFormConfig` in packages/form/src/config.ts
	 * reads both bounds through `wholeAtLeast(value, 1)` and drops the whole config, so a served 0
	 * is a donation form that renders nothing on a site nobody here can see.
	 *
	 * the largest-gift case zeroes both columns because a zero on that one alone is not storable:
	 * `form_min_max_minor_check` refuses it under a smallest gift of 500, which is the pair check
	 * doing its job. so the reachable shape is both at zero, and the message names both.
	 */
	it.each([
		{ column: 'min_minor', sql: 'update form set min_minor = 0 where id = ?' },
		{ column: 'max_minor', sql: 'update form set min_minor = 0, max_minor = 0 where id = ?' }
	])('refuses a stored form whose $column is zero, which D1 accepts', async ({ column, sql }) => {
		await env.DB.prepare(sql).bind(FORM_ID).run();
		const result = await readPublishedConfig(db, FORM_ID, STRIPE, READY, BOTH_RAILS);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('form_unservable');
		expect(result.error.message).toContain(`${column} is 0`);
	});

	/**
	 * the row on the way back out, from a real read.
	 *
	 * the endpoint answers every one of these with CORS headers taken from `allowed_origins`, and
	 * a browser cannot read a 4xx body without `Access-Control-Allow-Origin` — so the row has to
	 * survive a refusal as well as an answer, or the endpoint reads it a second time on a public,
	 * unauthenticated path to get the origins back.
	 */
	it('carries the stored row out with both an answer and a refusal', async () => {
		const answered = await readPublishedConfig(db, FORM_ID, STRIPE, READY, BOTH_RAILS);
		expect(answered.ok).toBe(true);
		expect(answered.form?.allowedOrigins).toEqual(['https://acme.org']);

		await env.DB.prepare(`update form set status = 'draft' where id = ?`).bind(FORM_ID).run();
		const refused = await readPublishedConfig(db, FORM_ID, STRIPE, READY, BOTH_RAILS);
		expect(refused.ok).toBe(false);
		expect(refused.form?.allowedOrigins).toEqual(['https://acme.org']);
	});

	// no row, so no origins — which is the correct CORS answer to an id nothing matches.
	it('carries no row when no form matched the id', async () => {
		const result = await readPublishedConfig(db, 'frm_nosuchformatall1', STRIPE, READY, BOTH_RAILS);
		expect(result.form).toBeNull();
	});

	/**
	 * the third argument is the platform env itself, bindings and all, and the narrowing happens
	 * in here rather than at the caller.
	 *
	 * that is what lets the endpoint take `platform.env` directly instead of being handed a
	 * pre-narrowed copy — and a copy shaped for a screen is a copy of the Stripe secret and the
	 * SMTP password sitting in a loader, one `return { env }` away from being serialized to a
	 * browser.
	 *
	 * the case is a binding sitting where a string is expected, because that is the shape the
	 * narrowing exists for (`readConfigEnv` in ../config/env.ts): a `D1Database` has no `.trim()`,
	 * so the judgement below would throw on it rather than treat it as unset.
	 */
	it('narrows the platform env itself, dropping a value that is not a string', async () => {
		const result = await readPublishedConfig(
			db,
			FORM_ID,
			{ ...env, ...STRIPE, TURNSTILE_SITE_KEY: env.DB },
			READY,
			BOTH_RAILS
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.config).not.toHaveProperty('turnstileSiteKey');
	});

	/**
	 * which query a form's mode asks for, against real rows — the whole of what the composer adds
	 * to the program the judgement beside this file is handed.
	 *
	 * the two reads answer different questions and one of them hides an archived row while the
	 * other does not, so the cases that matter are the ones where those disagree: a pin on a
	 * retired cause, and a choice offering one.
	 */
	describe('the cause it reads', () => {
		const CLEAN = '019fb300-0000-7000-8000-0000000000c1';
		const MEALS = '019fb300-0000-7000-8000-0000000000c2';
		const RETIRED = '019fb300-0000-7000-8000-0000000000c3';

		beforeEach(async () => {
			await env.DB.prepare('delete from program').run();
			await env.DB.prepare(
				`insert into program (id, name, status, created_at, updated_at)
				 values (?, 'Clean water', 'active', 0, 0), (?, 'School meals', 'active', 0, 0)`
			)
				.bind(CLEAN, MEALS)
				.run();
			await env.DB.prepare(
				`insert into program (id, name, status, created_at, updated_at, archived_at)
				 values (?, 'Winter appeal', 'archived', 0, 0, 0)`
			)
				.bind(RETIRED)
				.run();
		});

		const pin = (programId: string) =>
			env.DB.prepare(`update form set program_mode = 'pinned', program_id = ? where id = ?`)
				.bind(programId, FORM_ID)
				.run();

		it('serves a pinned cause by name', async () => {
			await pin(CLEAN);
			const result = await readPublishedConfig(db, FORM_ID, STRIPE, READY, BOTH_RAILS);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.config.program).toEqual({ mode: 'pinned', name: 'Clean water' });
		});

		/**
		 * a form pinned to a cause the organisation has since retired goes on naming it.
		 *
		 * `readProgram` in ../programs/queries.ts does not filter archived rows and that is what this
		 * turns on: the form is still live and still taking gifts, so a donor reading a blank where
		 * the cause was is the loss. retiring a cause stops it being offered, and a pin is not an
		 * offer.
		 */
		it('serves a pin on a retired cause', async () => {
			await pin(RETIRED);
			const result = await readPublishedConfig(db, FORM_ID, STRIPE, READY, BOTH_RAILS);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.config.program).toEqual({ mode: 'pinned', name: 'Winter appeal' });
		});

		it('serves a choice as the active causes alone, by name', async () => {
			await env.DB.prepare(`update form set program_mode = 'choice' where id = ?`)
				.bind(FORM_ID)
				.run();
			const result = await readPublishedConfig(db, FORM_ID, STRIPE, READY, BOTH_RAILS);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.config.program).toEqual({
				mode: 'choice',
				options: [
					{ id: CLEAN, name: 'Clean water' },
					{ id: MEALS, name: 'School meals' }
				]
			});
		});

		it('omits the key on a choice with every cause retired', async () => {
			await env.DB.prepare(`update program set status = 'archived', archived_at = 0`).run();
			await env.DB.prepare(`update form set program_mode = 'choice' where id = ?`)
				.bind(FORM_ID)
				.run();
			const result = await readPublishedConfig(db, FORM_ID, STRIPE, READY, BOTH_RAILS);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.config).not.toHaveProperty('program');
		});

		it('omits the key on a form that asks about no cause', async () => {
			const result = await readPublishedConfig(db, FORM_ID, STRIPE, READY, BOTH_RAILS);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.config).not.toHaveProperty('program');
		});
	});
});
