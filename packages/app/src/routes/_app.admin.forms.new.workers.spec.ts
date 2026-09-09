import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { createDb, type Db } from '$lib/server/db/client';
import { CREATED_FLASH, takeFlash } from '$lib/server/flash';
import { readForm, readForms } from '$lib/server/forms/queries';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as create from './_app.admin.forms.new';

// a workers spec because making a form writes a row. the half of this route that never reaches
// the database — a submission the parser rejects — is in `_app.admin.forms.new.spec.ts` beside
// this file.
//
// the chain is mounted rather than the loader called, which is ../route-request.testing.ts's
// pattern: the session gate is a `middleware` on ./_app.tsx and the handle is on the request
// context, so a loader called on its own is a loader with the gate above it never run.
//
// the deploy-time half is a per-request `env` rather than a value a case builds, so what a case
// exercises is the deployment an operator can actually be in rather than a shape assembled here.

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://donations.example.workers.dev';

/** the address the create answers on. */
const NEW = '/admin/forms/new';

/** the address the create sends an operator to, which is also where it leaves its marker. */
const LIST = '/admin/forms';

/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const PASSWORD = 'a-long-enough-password';

let db: Db;
let request: RouteRequester;
let session: string;

/**
 * the fund every form is pointed at, read out of the seeded chart rather than written down.
 *
 * it is no box on this screen: the account is `createForm`'s own decision
 * (`$lib/server/forms/queries.ts`), so what a case here asserts is the column the write landed on
 * rather than anything a submission said.
 */
let revenueAccountId: string;

beforeAll(async () => {
	db = createDb(env.DB);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/forms/new', module: create }
	]);
	session = await signIn();

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
	// after the forms, because `form.program_id` points here and nothing carries an ON DELETE.
	await env.DB.prepare('delete from program').run();
	await saveIdentity();
	// every case starts from a deployment that has somewhere to serve a form, because a deployment
	// with no site listed can make no form at all — the cases about that state say so themselves.
	await listSites('https://acme.org', 'https://give.acme.org');
});

/** a real session, as the `Cookie` header a browser would send back. */
async function signIn(): Promise<string> {
	const signingKey = await resolveAuthSecret(db, {});
	if (!signingKey.ok) throw new Error(signingKey.message);

	const auth = createAuth(
		db,
		{ ADMIN_PASSWORD: PASSWORD },
		{ secret: signingKey.secret, requestOrigin: ORIGIN }
	);
	const { headers } = await auth.api.signInStaff({
		body: { password: PASSWORD },
		headers: new Headers({ origin: ORIGIN }),
		returnHeaders: true
	});

	const cookies = headers.getSetCookie().map((value) => value.split(';', 1)[0]);
	expect(cookies.length).toBeGreaterThan(0);
	return cookies.join('; ');
}

/**
 * the organisation's details as a deployment that has been set up holds them.
 *
 * written past drizzle for the reason the form fixtures are: what the route reads is a column, and a
 * fixture going through the query that reads it would be testing itself.
 *
 * every case starts from a deployment whose forms could serve, because the ledger is the gate on
 * this screen — a blank identity is a blocker, and a blocker refuses the write. the cases about that
 * state say so themselves.
 */
async function saveIdentity(): Promise<void> {
	await env.DB.prepare('delete from org_profile').run();
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, deductibility_statement, created_at, updated_at)
		 values ('default', 'Acme Foundation', '12-3456789', 'No goods or services were provided for this gift.', 0, 0)`
	).run();
}

/**
 * the deployment's own list of sites, which the tick boxes are drawn from.
 *
 * written past drizzle for the reason the identity fixture is: what the route reads is a table, and
 * a fixture going through `replaceSites` would be testing the write that the console owns.
 */
async function listSites(...origins: string[]): Promise<void> {
	await env.DB.prepare('delete from site').run();
	for (const [position, origin] of origins.entries()) {
		await env.DB.prepare(
			`insert into site (id, origin, position, created_at, updated_at) values (?, ?, ?, 0, 0)`
		)
			.bind(`ste_test${position}`, origin, position)
			.run();
	}
}

/** a cause, written past drizzle so a fixture is not also exercising the queries under test. */
async function insertProgram(id: string, name: string, archived = false): Promise<void> {
	await env.DB.prepare(
		`insert into program (id, name, status, created_at, updated_at, archived_at)
		 values (?, ?, ?, 0, 0, ?)`
	)
		.bind(id, name, archived ? 'archived' : 'active', archived ? 0 : null)
		.run();
}

/**
 * the deploy-time values a fully set-up deployment holds.
 *
 * nothing this route reads is among them, and that is the point of the pair below: the ledger is
 * built out of rows, so a deployment with none of these set makes a form exactly as this one does.
 */
const READY: Record<string, string> = {
	STRIPE_PUBLISHABLE_KEY: 'pk_test_publishable',
	STRIPE_SECRET_KEY: 'sk_test_secret',
	STRIPE_WEBHOOK_SECRET: 'whsec_signing',
	SMTP_HOST: 'smtp.hopefoundation.org',
	SMTP_PORT: '465',
	SMTP_USERNAME: 'mailer',
	SMTP_PASSWORD: 'a-mail-password',
	MAIL_FROM: 'donations@hopefoundation.org',
	TURNSTILE_SITE_KEY: '0x4AAAAAAAAAAAAAAAAAAAAA',
	TURNSTILE_SECRET_KEY: '0x4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
};

/** a deployment set up with nothing: no keys, no mail, no spam protection. */
const NOTHING_SET: Record<string, string> = Object.fromEntries(
	Object.keys(READY).map((name) => [name, ''])
);

function envOf(vars: Record<string, string>): Env {
	return { ...env, ...vars } as Env;
}

/** what the screen is handed. */
type Loaded = {
	readiness: { label: string; severity: string }[] | null;
	sites: string[];
	programs: { value: string; label: string }[];
	values: Record<string, unknown>;
	currency: string;
};

async function load(vars: Record<string, string> = READY): Promise<Loaded> {
	const response = await request(new Request(`${ORIGIN}${NEW}`, { headers: { cookie: session } }), {
		env: envOf(vars)
	});
	expect(response.status).toBe(200);
	return (await response.json()) as Loaded;
}

/**
 * a body as this screen's markup writes it: one indexed name per amount row, one repeat per ticked
 * site.
 */
function bodyOf(fields: Record<string, string[]>): FormData {
	const body = new FormData();
	for (const [field, values] of Object.entries(fields)) {
		if (field === 'suggested_amounts') {
			values.forEach((row, index) => {
				body.append(`suggested_amounts[${index}]`, row);
			});
			continue;
		}
		for (const value of values) body.append(field, value);
	}
	return body;
}

/** a submission that parses, so each case states only what it is about. */
function submission(over: Record<string, string | string[]> = {}): Record<string, string[]> {
	const values: Record<string, string | string[]> = {
		name: 'Gala 2026',
		status: 'live',
		suggested_amounts: ['25.00', '50.00'],
		min_minor: '5.00',
		max_minor: '10000.00',
		allowed_origins: 'https://acme.org',
		program_mode: 'none',
		program_id: '',
		...over
	};
	return Object.fromEntries(
		Object.entries(values).map(([field, value]) => [
			field,
			typeof value === 'string' ? [value] : value
		])
	);
}

/** what a rejected save hands back, off the response the deployment would send. */
type SaveFailure = {
	status: number;
	valid: boolean;
	errors: Record<string, string[]>;
	formErrors: string[];
};

/** what a save that went through hands back: a redirect and the marker riding on it. */
type SaveRedirect = { status: number; location: string | null; cookie: string | null };

/**
 * posts a body at the create and hands back whatever it did — a redirect or a rejection, and the
 * caller says which it wanted.
 *
 * a real request through the mounted chain, because reading the body exactly once is one of the
 * things this route owes CLAUDE.md and calling the action directly would run it with the gate above
 * it never run.
 */
async function save(fields: Record<string, string[]>, vars: Record<string, string> = READY) {
	const response = await request(
		new Request(`${ORIGIN}${NEW}`, {
			method: 'POST',
			headers: { cookie: session },
			body: bodyOf(fields)
		}),
		{ env: envOf(vars) }
	);

	if (response.status === 303) {
		return {
			redirect: {
				status: response.status,
				location: response.headers.get('Location'),
				cookie: response.headers.get('Set-Cookie')
			} satisfies SaveRedirect
		};
	}

	const body = (await response.json()) as {
		form: { result: { status?: string; error?: Record<string, string[]> } };
	};
	const keyed = body.form.result.error ?? {};
	return {
		failure: {
			status: response.status,
			valid: body.form.result.status !== 'error',
			errors: Object.fromEntries(Object.entries(keyed).filter(([field]) => field !== '')),
			formErrors: keyed[''] ?? []
		} satisfies SaveFailure
	};
}

describe('/admin/forms/new load', () => {
	it('starts a form as a draft that could serve, with the amounts already suggested', async () => {
		// a form is born `draft` — going live in the click that creates it means nobody looked at it.
		// the bounds are seeded rather than blank, so a form works before anyone edits them.
		//
		// read off the values this screen publishes, which is what the boxes are seeded from. every
		// box is stated rather than left absent, because a box the form layer was handed no value for
		// is a box with nothing to bind to.
		const { values, currency } = await load();
		// and the currency is stated rather than left off: it is not an input, and an operator who
		// cannot see it cannot tell what their form charges in.
		expect(currency).toBe('USD');
		expect(values.status).toBe('draft');
		// starting figures rather than a floor: the seed is editable and blocks nothing, and what a
		// save refuses below is `MIN_AMOUNT_MINOR` in `$lib/server/forms/form-input.ts`.
		expect(values.min_minor).toBe('1.00');
		expect(values.max_minor).toBe('10000.00');
		// three suggestions in the amounts row editor, which is what the form's tray shows before
		// anyone decides otherwise; the operator edits or clears them.
		expect(values.suggested_amounts).toEqual(['25', '50', '100']);
		// and no blank site, because a tick box has nothing to type into: a new form is ticked against
		// none of the deployment's list, which is the empty list rather than one blank entry.
		expect(values.allowed_origins).toEqual([]);
	});

	it('opens asking about no cause, with every one this deployment still offers to pick from', async () => {
		// a new form asks about none, which is what the column defaults to as well — a form pinned in
		// the click that creates it is one nobody chose a cause for. the retired ones are out: a form
		// that does not exist yet is on none, so there is nothing for it to be holding.
		await insertProgram('prg_cleanwatertest01', 'Clean Water');
		await insertProgram('prg_galatest000001', 'Gala 2024', true);

		const loaded = await load();
		expect(loaded.values.program_mode).toBe('none');
		expect(loaded.values.program_id).toBe('');
		expect(loaded.programs).toEqual([{ value: 'prg_cleanwatertest01', label: 'Clean Water' }]);
	});

	it('opens with no message under any box, on a form nobody has typed into', async () => {
		// a form seeded from values still reports no error until it is submitted, and the seam is what
		// gives it: errors reach a form only through the result an action returned
		// (`$lib/admin/use-admin-form.ts`). so this screen publishes values and no error channel at
		// all — without that a create screen would open telling an operator to set the smallest gift
		// on a form they have not touched.
		expect(Object.keys(await load()).sort()).toEqual([
			'currency',
			'donatePageOrigin',
			'programs',
			'readiness',
			'sites',
			'values'
		]);
	});

	it('publishes the readiness block, because this screen can publish a form as it makes it', async () => {
		// the status box on this screen offers Live, so a form can go live in the click that creates
		// it — on a deployment whose identity columns are blank that is a form serving nothing, with
		// no screen saying why. what each line means is asserted in
		// `$lib/server/forms/readiness.spec.ts`; what this route owes is publishing the answer.
		await env.DB.prepare('delete from org_profile').run();
		const { readiness } = await load();
		expect(readiness?.find((line) => line.label === 'Organisation details')?.severity).toBe(
			'blocker'
		);
	});

	it('reports nothing about the deployment on a deployment set up with nothing', async () => {
		// the block is built out of rows and reads no deploy-time value at all: what a Stripe key can
		// charge is settled on the console when it is pasted
		// (`packages/console-ui/src/lib/stripe-edits.ts`), and this screen could only ever repeat
		// it and point somewhere it is not.
		expect((await load(NOTHING_SET)).readiness).toBe(null);
	});

	it('publishes every site this deployment has listed, in the operator’s own order', async () => {
		// the whole list, with none of them ticked: a form that does not exist yet is on no site, and
		// what the operator is choosing from is everything this deployment can serve on.
		expect((await load()).sites).toEqual(['https://acme.org', 'https://give.acme.org']);
	});

	it('draws the group on a deployment with no site listed rather than hiding it', async () => {
		// the empty list is a real state and it is what the group says something about — the boxes are
		// still where the operator will come back and tick one. what it costs is the submit, which the
		// page draws switched off and the action refuses behind.
		await listSites();
		expect((await load()).sites).toEqual([]);
	});
});

describe('/admin/forms/new save', () => {
	it('stores the form as it was configured', async () => {
		await save(submission());
		const [stored] = await readForms(db);
		const made = stored && (await readForm(db, stored.id));
		expect(made).toMatchObject({
			name: 'Gala 2026',
			status: 'live',
			revenueAccountId,
			suggestedAmounts: [2500, 5000],
			minMinor: 500,
			maxMinor: 1000000,
			currency: 'USD',
			allowedOrigins: ['https://acme.org']
		});
	});

	it('redirects to the forms list, so a reload does not make a second', async () => {
		// POST-redirect-GET: a re-post of a create is not an overwrite, it is another row, which is the
		// worse half of the same hazard.
		const { redirect } = await save(submission());
		expect(redirect?.status).toBe(303);
		// the address carries nothing: a save reports on the button that did it, and the button
		// pressed here is on a page that no longer exists, so this reports as a banner where the
		// operator lands and the id that names the row travels in a one-shot cookie rather than in
		// the address bar.
		expect(redirect?.location).toBe(LIST);
	});

	it('leaves the new form’s id for the list, once, at the list’s own address', async () => {
		// the id comes off the write's own `returning()`, and the list looks it up against its rows
		// rather than printing it — so what has to arrive is exactly the id that was written. taking
		// it is what clears it: a second GET of the list announces nothing.
		const { redirect } = await save(submission());
		expect(redirect?.status).toBe(303);
		const [stored] = await readForms(db);

		const held = redirect?.cookie?.split(';')[0] ?? '';
		const landing = new Request(`${ORIGIN}${LIST}`, { headers: { cookie: held } });
		const taken = await takeFlash(landing, CREATED_FLASH);
		expect(taken?.marker).toBe(stored?.id);

		// and the header that came back with it is what burns it: a browser that applied the clearing
		// carries nothing on the next request.
		expect(taken?.clear).toMatch(/max-age=0\b/i);
	});

	it('leaves nothing behind when the create was refused', async () => {
		// no row, so no banner. the marker is written on the redirect and a refusal never reaches one —
		// worth pinning because a marker set before the write would survive a rejection and announce a
		// form nobody made.
		const { redirect, failure } = await save(submission({ name: [''] }));
		expect(redirect).toBeUndefined();
		expect(failure?.status).toBe(400);
		expect(await readForms(db)).toEqual([]);
	});

	it('ignores a fund a body names, because the column is no box on this screen', async () => {
		// the account is not an input, so a hand-built body naming one is neither honoured nor
		// refused: it is a key the parser does not read, and the write files the gift against 4110
		// like every other form. a rollup is the sharp case — `4100 Donations` is a real account no
		// gift may name, because its children already sum into it.
		const rollup = await env.DB.prepare(
			`select id from account where is_postable = 0 and code = '4100'`
		).first<{ id: string }>();

		await save(submission({ revenue_account_id: rollup?.id ?? '' }));
		const [stored] = await readForms(db);
		expect(stored && (await readForm(db, stored.id))).toMatchObject({ revenueAccountId });
	});

	it('refuses to make a form at all while a blocker stands, and writes nothing', async () => {
		// the ledger is the gate on this screen rather than a heads-up: the page draws no boxes and a
		// disabled button while a blocker stands, and this is the control behind that. a page drawn
		// without a submit is markup, and markup is not what stops a POST — a stale tab, a hand-built
		// body or a row emptied between the draw and the press all reach here.
		await env.DB.prepare('delete from org_profile').run();
		const { redirect, failure } = await save(submission());
		// asserted before the failure is read, because it is the shape the failure takes: a save that
		// went through redirects, and reading a status off `undefined` would report this as a
		// `TypeError` rather than as a form having been made on a deployment that serves nothing.
		expect(redirect).toBeUndefined();
		expect(failure?.status).toBe(400);
		// a banner and not a field error: no box on this form is what went wrong, and the block above
		// it is where the offending line is already named.
		expect(failure?.formErrors.at(-1)).toBeTypeOf('string');
		expect(failure?.valid).toBe(false);
		expect(failure?.errors).toEqual({});
		expect(await readForms(db)).toEqual([]);
	});

	it('makes a form on a deployment with no Stripe keys, because the gate is the rows', async () => {
		// what the ledger gates on is the identity a form has to state while asking, which is a row.
		// whether the deployment can charge is not asked here and is not this screen's to ask: it is
		// settled on the console when the keys are pasted
		// (`packages/console-ui/src/lib/stripe-edits.ts`).
		const { redirect } = await save(submission(), NOTHING_SET);
		expect(redirect?.status).toBe(303);
		expect(await readForms(db)).toHaveLength(1);
	});
});

describe('/admin/forms/new — the sites tick boxes', () => {
	it('stores every ticked site and nothing else', async () => {
		await save(submission({ allowed_origins: ['https://acme.org', 'https://give.acme.org'] }));
		const [stored] = await readForms(db);
		expect(stored?.allowedOrigins).toEqual(['https://acme.org', 'https://give.acme.org']);
	});

	it('makes a form with no site ticked, because the donation page is where it loads', async () => {
		// the group with nothing ticked submits no key at all, which is the body a drawn page actually
		// sends — `.prefault([])` is what feeds that absence through the rule, and the rule has nothing
		// to say about it. every form this deployment serves loads on the donation page it answers on
		// its own address, so a form on no site is an ordinary form.
		const withoutSites = submission();
		delete withoutSites.allowed_origins;
		const { redirect, failure } = await save(withoutSites);
		expect(failure).toBeUndefined();
		expect(redirect?.status).toBe(303);
		const [stored] = await readForms(db);
		expect(stored?.allowedOrigins).toEqual([]);
	});

	it('makes a form on a deployment that lists no site at all', async () => {
		// the deployment an organisation with no website of its own has: nothing to tick, and its forms
		// given on the donation page this deployment answers on its own address. it is the state set-up
		// is allowed to finish in, so it must be one a form can be made in — and there is no
		// arrangement left in which a form would load nowhere.
		await listSites();

		const empty = submission();
		delete empty.allowed_origins;
		const { redirect, failure } = await save(empty);
		expect(failure).toBeUndefined();
		expect(redirect?.status).toBe(303);
		expect(await readForms(db)).toHaveLength(1);
	});

	it('still refuses a body naming a site a deployment that lists none does not have', async () => {
		// the rule that survives: a set of tick boxes is markup, so a stale tab or a hand-built body
		// still reaches the action carrying an address the deployment stopped listing.
		await listSites();

		const stale = await save(submission());
		expect(stale.redirect).toBeUndefined();
		expect(stale.failure?.errors.allowed_origins?.at(-1)).toContain('`https://acme.org`');
		expect(await readForms(db)).toEqual([]);
	});

	it('refuses a site this deployment has never listed, and makes nothing', async () => {
		// unreachable from a drawn page — every box carries a listed value — so this is a stale tab or
		// a hand-built body. the list is re-read in the action, because a set of tick boxes is markup
		// and markup is not what stops a POST.
		const { redirect, failure } = await save(
			submission({ allowed_origins: ['https://acme.org', 'https://elsewhere.example'] })
		);
		expect(redirect).toBeUndefined();
		expect(failure?.status).toBe(400);
		const message = failure?.errors.allowed_origins?.at(-1);
		expect(message).toContain('`https://elsewhere.example`');
		expect(message).not.toContain('`https://acme.org`');
		expect(await readForms(db)).toEqual([]);
	});
});

describe('/admin/forms/new — pinning a new form to a cause', () => {
	const WATER = 'prg_cleanwatertest01';
	const GALA = 'prg_galatest000001';

	it('stores the cause a pinned form names', async () => {
		await insertProgram(WATER, 'Clean Water');
		await save(submission({ program_mode: 'pinned', program_id: WATER }));

		const [stored] = await readForms(db);
		expect(stored && (await readForm(db, stored.id))).toMatchObject({
			programMode: 'pinned',
			programId: WATER
		});
	});

	it('refuses a pin to a cause this deployment has retired, and writes nothing', async () => {
		// only ever a stale tab or a hand-built body on this screen — the select is drawn from the
		// active list — and the foreign key cannot answer it: a retired cause is still a row.
		await insertProgram(GALA, 'Gala 2024', true);
		const { failure } = await save(submission({ program_mode: 'pinned', program_id: GALA }));
		expect(failure?.status).toBe(400);
		expect(failure?.errors.program_id?.at(-1)).toBe('Choose an active program.');
		expect(await readForms(db)).toEqual([]);
	});

	it('refuses a pinned form that names no cause, under the box that has to be filled in', async () => {
		const { failure } = await save(submission({ program_mode: 'pinned', program_id: '' }));
		expect(failure?.status).toBe(400);
		expect(failure?.errors.program_id).toHaveLength(1);
		expect(await readForms(db)).toEqual([]);
	});

	it('records no cause for the two modes that name none, whatever the hidden box carried', async () => {
		// the box stays in the tree in every mode, so a form moved off `pinned` submits the id it
		// was drawn with — and stored, it would credit every gift to a cause the form stopped
		// offering.
		await insertProgram(WATER, 'Clean Water');
		await save(submission({ program_mode: 'choice', program_id: WATER }));

		const [stored] = await readForms(db);
		expect(stored && (await readForm(db, stored.id))).toMatchObject({
			programMode: 'choice',
			programId: null
		});
	});
});
