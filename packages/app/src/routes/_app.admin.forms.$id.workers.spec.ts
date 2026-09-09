import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WHICH_FORM } from '$lib/forms/definition';
import type { FormInputValues } from '$lib/forms/fields';
import type { FormReadinessLine } from '$lib/forms/readiness';
import { redact } from '$lib/redact';
import { createAuth } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { createDb, type Db } from '$lib/server/db/client';
import { CREATED_FLASH, redirectWithFlash, SAVED_FLASH } from '$lib/server/flash';
import { readForm } from '$lib/server/forms/queries';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as editor from './_app.admin.forms.$id';

// a workers spec because every case here reads or writes a row. the half of this route that never
// reaches the database — a submission the parser rejects — is in `_app.admin.forms.$id.spec.ts`
// beside this file.
//
// the chain is mounted rather than the loader called, which is ../route-request.testing.ts's
// pattern: the session gate is a `middleware` on ./_app.tsx and the handle is on the request
// context, so a loader called on its own is a loader with the gate above it never run.
//
// the deploy-time values ride in a per-request `env`, and they are here for one property: nothing
// this route does turns on them. the ledger and the Live gate are built out of rows, and what a
// Stripe key can charge is read on the console when it is pasted
// (`packages/console-ui/src/lib/stripe-edits.ts`).
//
// no case here is about adding or dropping a row. the amounts editor is the form layer's own list
// field, so a row added or removed by the group's own controls is browser state that reaches no
// action, and there is nothing written for a case to read. what that leaves — a moved row leaving
// the save offering itself — is the form layer's own reading, mounted by `useAdminForm` in
// `$lib/admin/use-admin-form.ts` and asserted over a real document in
// `../lib/admin/use-admin-form.dom.spec.tsx`.

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://donations.example.workers.dev';

/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const PASSWORD = 'a-long-enough-password';

/** the form these cases edit, written by this file: no migration seeds one. */
const FORM_ID = 'frm_editformtest111';

/** the address this screen answers on, which is also where its own redirects leave a marker. */
const EDITOR_PATH = `/admin/forms/${FORM_ID}`;

/** the ids the four forms on this screen answer to, as a body names the one it came from. */
const NAME_FORM = 'form-edit-name';
const PROGRAM_FORM = 'form-edit-program';
const GIVING_FORM = 'form-edit-giving';
const ORIGINS_FORM = 'form-edit-origins';
const ARCHIVE_FORM = 'form-archive';

let db: Db;
let request: RouteRequester;
let session: string;

/**
 * the fund every form is pointed at, read out of the seeded chart rather than written down.
 *
 * it is no box on this screen and no group's write touches the column — the account is
 * `createForm`'s own decision (`$lib/server/forms/queries.ts`) — so what the cases below assert
 * about it is that a save left it where it stood.
 */
let revenueAccountId: string;

beforeAll(async () => {
	db = createDb(env.DB);
	// the pathless layout carries no path of its own, which is what makes the gate cover a screen
	// without adding a segment to its address.
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/forms/:id', module: editor }
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
	// every case starts from a deployment whose forms could serve, so the ones about the
	// organisation's identity are the only ones that say anything about it.
	await saveIdentity();
	await env.DB.prepare(
		`insert into form (id, name, status, revenue_account_id, currency, min_minor, max_minor,
		                   suggested_amounts, allowed_origins,
		                   created_at, updated_at)
		 values (?, 'General Fund', 'draft', ?, 'USD', 500, 1000000, '[2500]',
		         '["https://acme.org"]', 0, 0)`
	)
		.bind(FORM_ID, revenueAccountId)
		.run();
	// the sites this deployment has listed. the fixture form is ticked against the first of them, so
	// a case that says nothing about the list is one where every stored site is still listed.
	await listSites('https://acme.org', 'https://give.acme.org', 'https://events.acme.org');
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

/** no organisation details at all, which is what a fresh deployment has. */
async function clearOrgProfile(): Promise<void> {
	await env.DB.prepare('delete from org_profile').run();
}

/**
 * the two columns a donation form is refused without, as a case wants them.
 *
 * written past drizzle for the reason the form fixture is: what the loader reads is a column, and a
 * fixture going through the query that reads it would be testing itself.
 *
 * `legalName` is not nullable — the column carries `org_profile_legal_name_not_blank_check` — so
 * the only reachable state without one is no row at all, which `clearOrgProfile` is.
 */
async function saveIdentity(over: { taxId?: string | null } = {}): Promise<void> {
	const { taxId } = { taxId: '12-3456789', ...over };
	await clearOrgProfile();
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, created_at, updated_at)
		 values ('default', 'Acme Foundation', ?, 0, 0)`
	)
		.bind(taxId)
		.run();
}

/**
 * the deployment's own list of sites, which every case here starts from.
 *
 * written past drizzle for the reason the form fixture is: what the route reads is a table, and a
 * fixture going through `replaceSites` would be testing the write that the screen typing this list
 * owns rather than the one under test.
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

/**
 * the deploy-time values a fully set-up deployment holds.
 *
 * nothing this route reads is among them, which is what the pair below is for: a deployment with
 * none of these set draws the same screen and refuses the same writes.
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

/** the boxes one group is seeded with, as the screen is handed them. */
type EditorBoxes = {
	nameBoxes: { name: string; status: string };
	programBoxes: { program_mode: string; program_id: string };
	givingBoxes: { min_minor: string; max_minor: string; suggested_amounts: string[] };
	originsBoxes: { allowed_origins: string[] };
};

/** what the screen is handed, off one request through the chain the deployment serves it under. */
type Loaded = {
	id: string;
	name: string;
	status: string;
	currency: string;
	archived: boolean;
	editor: EditorBoxes | null;
	values: FormInputValues;
	snippet: string | null;
	readiness: FormReadinessLine[] | null;
	sites: string[];
	programs: { value: string; label: string }[];
	retiredProgram: { value: string; label: string } | null;
	programMode: string;
	pinnedProgram: string | null;
	liveOffered: boolean;
	saved: 'name' | 'program' | 'giving' | 'origins' | null;
	archivedJustNow: boolean;
	confirmArchive: boolean;
};

/** one visit to this screen, carrying the session and whatever the browser holds beside it. */
function visit(
	options: { id?: string; query?: string; vars?: Record<string, string>; flash?: string } = {}
): Promise<Response> {
	const { id = FORM_ID, query = '', vars = READY, flash = '' } = options;
	const cookie = [session, flash].filter((value) => value !== '').join('; ');
	return request(new Request(`${ORIGIN}/admin/forms/${id}${query}`, { headers: { cookie } }), {
		env: envOf(vars)
	});
}

async function runLoad(options: Parameters<typeof visit>[0] = {}): Promise<Loaded> {
	const response = await visit(options);
	expect(response.status).toBe(200);
	return (await response.json()) as Loaded;
}

/**
 * the editor's boxes, or a failure naming the reading that has none.
 *
 * an archived form is drawn as a record rather than as an editor, so its seeds are `null` — every
 * case reading a box is about a form somebody may still edit.
 */
async function boxes(options: Parameters<typeof visit>[0] = {}): Promise<EditorBoxes> {
	const { editor: seeded } = await runLoad(options);
	if (seeded === null) throw new Error('this reading of the screen draws no editor');
	return seeded;
}

/**
 * the organisation line of the readiness block, or a failure naming what went missing.
 *
 * looked up by label rather than by position, so a line added to the block ahead of it does not
 * quietly move these cases onto a different one.
 */
function identityLine(loaded: Loaded): FormReadinessLine {
	const found = loaded.readiness?.find((line) => line.label === 'Organisation details');
	if (!found) throw new Error('the readiness block has no organisation line');
	return found;
}

/**
 * a body as this screen's markup writes it, naming the form it was submitted from.
 *
 * the amounts are a repeating row editor, so each row carries its own indexed name; the sites are a
 * checkbox group, so each ticked box repeats one name.
 */
function bodyOf(form: string, fields: Record<string, string | string[]>): FormData {
	const body = new FormData();
	body.set(WHICH_FORM, form);
	for (const [field, value] of Object.entries(fields)) {
		if (field === 'suggested_amounts') {
			const rows = typeof value === 'string' ? [value] : value;
			rows.forEach((row, index) => {
				body.append(`suggested_amounts[${index}]`, row);
			});
			continue;
		}
		for (const one of typeof value === 'string' ? [value] : value) body.append(field, one);
	}
	return body;
}

/**
 * a submission for one group that parses, so each case states only what it is about.
 *
 * one object per group rather than one for the whole form, because the screen posts one group at a
 * time: an action parses its own schema and every box it states has to arrive, so a body carrying
 * keys from another group is not what any of them receives.
 */
const GROUP_BODIES: Record<string, () => Record<string, string | string[]>> = {
	[NAME_FORM]: () => ({ name: 'Gala 2026', status: 'live' }),
	[PROGRAM_FORM]: () => ({ program_mode: 'none', program_id: '' }),
	[GIVING_FORM]: () => ({
		suggested_amounts: ['25.00', '50.00'],
		min_minor: '5.00',
		max_minor: '10000.00'
	}),
	[ORIGINS_FORM]: () => ({ allowed_origins: ['https://acme.org'] })
};

function submission(
	form: string,
	over: Record<string, string | string[]> = {}
): Record<string, string | string[]> {
	return { ...(GROUP_BODIES[form]?.() ?? {}), ...over };
}

/**
 * what a rejected write hands back, off the response the deployment would send.
 *
 * `message` is the sentence keyed to no box, which on this screen is what a group says when the row
 * has gone or the write threw — and, for the archive, the whole of what a refusal can say. it is
 * read at every status rather than off the 500 arm alone, which is the one difference from the node
 * spec beside this file: the bodies here are complete, so nothing but the action's own sentence
 * reaches that key.
 */
type Failure = {
	status: number;
	valid: boolean;
	errors: Record<string, string[]>;
	message?: string;
};

/** what a write that went through hands back: a redirect and the marker riding on it. */
type Redirected = { status: number; location: string | null; cookie: string | null };

/**
 * posts a body at one of this screen's forms and hands back whatever it did.
 *
 * a real request through the mounted chain, because reading the body exactly once is one of the
 * things this route owes CLAUDE.md and calling the action directly would run it with the gate above
 * it never run.
 */
async function post(
	form: string,
	id: string,
	fields: Record<string, string | string[]>,
	vars: Record<string, string> = READY
): Promise<{ redirect?: Redirected; failure?: Failure }> {
	const response = await request(
		new Request(`${ORIGIN}/admin/forms/${id}`, {
			method: 'POST',
			headers: { cookie: session },
			body: bodyOf(form, fields)
		}),
		{ env: envOf(vars) }
	);

	if (response.status === 303) {
		return {
			redirect: {
				status: response.status,
				location: response.headers.get('Location'),
				cookie: response.headers.get('Set-Cookie')
			}
		};
	}

	const body = (await response.json()) as {
		form: { result: { status?: string; error?: Record<string, string[]> } };
	};
	const keyed = body.form.result.error ?? {};
	const banner = keyed['']?.at(-1);
	return {
		failure: {
			status: response.status,
			valid: body.form.result.status !== 'error',
			errors: Object.fromEntries(Object.entries(keyed).filter(([field]) => field !== '')),
			...(banner === undefined ? {} : { message: banner })
		}
	};
}

/**
 * a marker left for an address, as the pair a browser sends back.
 *
 * built by writing a real redirect rather than by spelling a cookie here: what has to reach this
 * loader is whatever `redirectWithFlash` produced, and a hand-written value would go on passing
 * after the transport changed shape.
 */
async function markerFor(
	name: typeof CREATED_FLASH | typeof SAVED_FLASH,
	destination: string,
	marker: string
): Promise<string> {
	const sent = await redirectWithFlash(
		new Request(`${ORIGIN}${EDITOR_PATH}`),
		name,
		destination,
		marker
	);
	const header = sent.headers.get('Set-Cookie');
	if (header === null) throw new Error('the redirect wrote no cookie');
	return header.split(';')[0] ?? '';
}

/** the cookie pair a redirect handed the browser, ready to send back on the next request. */
function held(cookie: string | null | undefined): string {
	return cookie?.split(';')[0] ?? '';
}

/** a cause, written past drizzle so a fixture is not also exercising the queries under test. */
async function insertProgram(id: string, name: string, archived = false): Promise<string> {
	await env.DB.prepare(
		`insert into program (id, name, status, created_at, updated_at, archived_at)
		 values (?, ?, ?, 0, 0, ?)`
	)
		.bind(id, name, archived ? 'archived' : 'active', archived ? 0 : null)
		.run();
	return id;
}

/** pins the fixture form past the queries, for the same reason. */
async function pinInPlace(programId: string): Promise<void> {
	await env.DB.prepare(`update form set program_mode = 'pinned', program_id = ? where id = ?`)
		.bind(programId, FORM_ID)
		.run();
}

/** publishes the form past the queries, so the thing under test is not what set it up. */
async function goLive(id = FORM_ID): Promise<void> {
	await env.DB.prepare('update form set status = ? where id = ?').bind('live', id).run();
}

/** retires the form past the queries, so the thing under test is not what set it up. */
async function archiveInPlace(id = FORM_ID): Promise<void> {
	await env.DB.prepare('update form set archived_at = 1, status = ? where id = ?')
		.bind('archived', id)
		.run();
}

describe('/admin/forms/[id] load', () => {
	it('renders the stored form into the boxes it was typed in', async () => {
		const { id, values, currency } = await runLoad();
		expect(id).toBe(FORM_ID);
		expect(values).toMatchObject({
			name: 'General Fund',
			status: 'draft',
			// the row holds 500, 1000000 and [2500]; the boxes hold what an operator types, which is
			// major units with no cents where there are none — the two are the same amounts read in
			// the two directions `$lib/forms/amounts.ts` converts between.
			suggested_amounts: ['25'],
			min_minor: '5',
			max_minor: '10000',
			allowed_origins: ['https://acme.org']
		});
		// shown and never editable: an operator who cannot see the currency cannot tell what their
		// form charges in.
		expect(currency).toBe('USD');
	});

	it('opens a form that suggests no amounts with one box to type in', async () => {
		// the same rule the sites are seeded under, for the same reason: a group whose only control
		// is Add has nothing to type into. the blank is not a value — `readSuggestedAmounts` in
		// `$lib/forms/amounts.ts` drops a row nobody typed into — so a form that stores no tiles is
		// unchanged by opening this screen and saving it.
		await env.DB.prepare('update form set suggested_amounts = ? where id = ?')
			.bind('[]', FORM_ID)
			.run();
		expect((await boxes()).givingBoxes.suggested_amounts).toEqual(['']);
		// and the record an archived form renders reads the row rather than the boxes: no amounts is
		// no amounts, not one blank.
		expect((await runLoad()).values.suggested_amounts).toEqual([]);
	});

	it('says a form is archived rather than pretending there is none', async () => {
		// `readForm` returns archived rows on purpose. a 404 here would tell an operator their form
		// does not exist, when what happened is that somebody retired it.
		await archiveInPlace();
		const { archived, status, editor: seeded } = await runLoad();
		expect(archived).toBe(true);
		expect(status).toBe('archived');
		// and there are no boxes at all: `updateForm*` refuses an archived row at its `where`, so a
		// box here would be one whose button never works.
		expect(seeded).toBe(null);
	});

	it('404s for an id no form carries, naming the whole id and where to look', async () => {
		// the id is in the address bar, so it is echoed — through `redactPublicId`, the carve-out in
		// the app's one echo policy: a form id is public by construction, so cutting it at `ECHO_MAX`
		// would withhold nothing from anyone and leave an operator staring at eight characters they
		// cannot tell apart from the id they meant. CLAUDE.md asks a 4xx to name the offending value
		// and where to fix it, and both halves are asserted rather than the sentence.
		const missing = 'frm_nosuchformatall';
		const response = await visit({ id: missing });
		expect(response.status).toBe(404);

		const body = (await response.json()) as string;
		expect(body).toContain(missing);
		// and not the cut version `redact` would give it.
		expect(body).not.toContain(`${redact(missing)}\``);
		expect(body).toContain('/admin/forms');
	});

	it('names both identity fields on a deployment nobody has filled anything in on', async () => {
		// this is the screen that sets a form live, and `publishedConfig` in
		// `$lib/server/forms/published-config.ts` refuses a config missing either of them —
		// silently, as far as the operator's own site is concerned. without this an operator chooses
		// Live here, saves, reads "Saved", and their own site shows nothing.
		//
		// both fields are named rather than the first, so filling them in is one trip rather than
		// two.
		await clearOrgProfile();
		const identity = identityLine(await runLoad());
		expect(identity.severity).toBe('blocker');
		expect(identity.detail).toContain('Registered name');
		expect(identity.detail).toContain('EIN');
	});

	it('reports the one that is blank, not every one it could have named', async () => {
		// the EIN is nullable and nothing seeds the row, so the state an operator is most often in is
		// one box short — and a block that listed both over a row holding one of them would send them
		// back to re-type what is already saved.
		await saveIdentity({ taxId: null });
		const identity = identityLine(await runLoad());
		expect(identity.detail).toContain('EIN');
		expect(identity.detail).not.toContain('Registered name');
	});

	it('renders no block at all once every line is resolved', async () => {
		// the identity columns saved is a deployment with nothing to report, and this screen is about
		// one form rather than about configuration.
		expect((await runLoad()).readiness).toBe(null);
	});

	it('says nothing about readiness on an archived form', async () => {
		// an archived form cannot be published whatever those values hold — every `updateForm*` group
		// write refuses the row at its `where` and there is no screen that brings one back — so the
		// block would be about a state nobody reading this page can act on, on the one reading of it
		// that has no status box at all.
		await clearOrgProfile();
		await archiveInPlace();
		const { archived, readiness } = await runLoad();
		expect(archived).toBe(true);
		expect(readiness).toBe(null);
	});

	/**
	 * the deletion this screen turns on: the snippet is handed over whatever the deployment's
	 * Stripe slots hold.
	 *
	 * every one of the wrong-slot mistakes is refused at the box it is pasted into —
	 * `stripeKeyEdits` in `packages/console-ui/src/lib/stripe-edits.ts` — so a screen here that
	 * withheld it would be checking forever for a mistake caught once, on a screen that could only
	 * ever point somewhere it is not.
	 */
	it.each([
		['a deployment set up in full', READY],
		['a deployment set up with nothing', NOTHING_SET]
	] as const)('hands the snippet over on %s', async (_case, vars) => {
		const loaded = await runLoad({ vars });
		expect(loaded.snippet).toContain(`form="${FORM_ID}"`);
		// and the editor is drawn in full beside it: configuring a form was never gated on the keys.
		expect(loaded.values.name).toBe('General Fund');
	});

	/**
	 * the deployment's own list of sites, which is what the tick boxes are drawn from.
	 *
	 * the whole list rather than the ticked ones: an operator adding a site to this form has to see
	 * the ones it is not on. in the operator's own order, which is `readSites`' — a list that came
	 * back re-sorted reads as the screen having eaten an edit.
	 */
	it('publishes every site this deployment has listed, in the operator’s own order', async () => {
		const { sites } = await runLoad();
		expect(sites).toEqual(['https://acme.org', 'https://give.acme.org', 'https://events.acme.org']);
		// and the form's own set is what the boxes are ticked from, which is a different list.
		expect((await boxes()).originsBoxes.allowed_origins).toEqual(['https://acme.org']);
	});

	it('seeds no blank site, because a tick box has nothing to type into', async () => {
		// the amounts are seeded with one blank row when a form has none and the sites are not: the
		// boxes are drawn from the deployment's list, so a blank entry would be a box the screen has
		// nothing to draw for.
		await env.DB.prepare('update form set allowed_origins = ? where id = ?')
			.bind('[]', FORM_ID)
			.run();
		expect((await boxes()).originsBoxes.allowed_origins).toEqual([]);
	});

	it('says nothing under the boxes on a form that is ticked against nothing yet', async () => {
		// a form seeded from a record reports no error until it is submitted, and the seam is what
		// gives it: a message reaches a form only through the result an action returned
		// (`$lib/admin/use-admin-form.ts`). so this screen publishes boxes and no error channel at
		// all — without that, a form with no site would open already refused by its own group rule,
		// over boxes nobody has touched.
		await env.DB.prepare('update form set allowed_origins = ? where id = ?')
			.bind('[]', FORM_ID)
			.run();
		const seeded = await boxes();
		expect(Object.keys(seeded).sort()).toEqual([
			'givingBoxes',
			'nameBoxes',
			'originsBoxes',
			'programBoxes'
		]);
		expect(Object.keys(seeded.originsBoxes)).toEqual(['allowed_origins']);
	});

	it('publishes the list for an archived form too, which draws no boxes at all', async () => {
		// the read is in the same `Promise.all` as the row, so whether it was needed is not knowable
		// until after it has happened — and awaiting the row first would pay a second round trip on
		// every reading of the page that is not archived.
		await archiveInPlace();
		const loaded = await runLoad();
		expect(loaded.archived).toBe(true);
		expect(loaded.sites).toHaveLength(3);
	});
});

describe('/admin/forms/[id] — a group saves on its own', () => {
	/**
	 * the whole point of splitting the screen into three forms: a group's save must not write a
	 * column that group does not own.
	 *
	 * each of the three is posted with values that differ from the row in every column, and the
	 * assertion is on the row afterwards — what the group owns moved, and everything else is exactly
	 * what the fixture stored. a partial write that leaked would show as a column the submission
	 * never mentioned coming back changed, and a `Partial<>` argument shared by three writes is
	 * precisely how that happens.
	 */
	it('writes the name group and leaves every other column alone', async () => {
		const before = await readForm(db, FORM_ID);
		await post(NAME_FORM, FORM_ID, submission(NAME_FORM));

		const after = await readForm(db, FORM_ID);
		expect(after).toMatchObject({
			name: 'Gala 2026',
			status: 'live',
			// the fund is not this group's to move and is not a box: the column reads what the
			// fixture row was inserted with.
			revenueAccountId
		});
		expect(after?.minMinor).toBe(before?.minMinor);
		expect(after?.maxMinor).toBe(before?.maxMinor);
		expect(after?.suggestedAmounts).toEqual(before?.suggestedAmounts);
		expect(after?.allowedOrigins).toEqual(before?.allowedOrigins);
	});

	it('writes the giving group and leaves every other column alone', async () => {
		const before = await readForm(db, FORM_ID);
		await post(GIVING_FORM, FORM_ID, submission(GIVING_FORM));

		const after = await readForm(db, FORM_ID);
		expect(after).toMatchObject({
			minMinor: 500,
			maxMinor: 1000000,
			suggestedAmounts: [2500, 5000]
		});
		expect(after?.name).toBe(before?.name);
		expect(after?.status).toBe(before?.status);
		expect(after?.revenueAccountId).toBe(before?.revenueAccountId);
		expect(after?.allowedOrigins).toEqual(before?.allowedOrigins);
	});

	it('writes the origins group and leaves every other column alone', async () => {
		const before = await readForm(db, FORM_ID);
		await post(ORIGINS_FORM, FORM_ID, {
			allowed_origins: ['https://give.acme.org', 'https://events.acme.org']
		});

		const after = await readForm(db, FORM_ID);
		expect(after?.allowedOrigins).toEqual(['https://give.acme.org', 'https://events.acme.org']);
		expect(after?.name).toBe(before?.name);
		expect(after?.status).toBe(before?.status);
		expect(after?.minMinor).toBe(before?.minMinor);
		expect(after?.maxMinor).toBe(before?.maxMinor);
		expect(after?.suggestedAmounts).toEqual(before?.suggestedAmounts);
	});

	it('redirects each group back naming itself, so a reload does not re-post', async () => {
		// the marker is the group's rather than a shared flag, because it is the group's own button
		// that reports the save — one flag would put `Saved` on all three at once. the address the
		// browser lands on is the same for all three and carries nothing; what tells them apart is
		// the marker, and what proves it arrived is the load.
		const sections = [
			[NAME_FORM, 'name'],
			[GIVING_FORM, 'giving'],
			[ORIGINS_FORM, 'origins']
		] as const;
		for (const [form, section] of sections) {
			const { redirect } = await post(form, FORM_ID, submission(form));
			expect(redirect?.status, form).toBe(303);
			expect(redirect?.location, form).toBe(EDITOR_PATH);
			expect((await runLoad({ flash: held(redirect?.cookie) })).saved, form).toBe(section);
		}
	});

	it('lights the button once, and nothing at all on the reload after it', async () => {
		// the reason the marker is not in the address: a reload would confirm a save that happened
		// once, and a bookmark would confirm one from days ago. the clearing rides on the response
		// that publishes it, so a browser that applied it carries nothing on the next request.
		const { redirect } = await post(GIVING_FORM, FORM_ID, submission(GIVING_FORM));
		const landing = await visit({ flash: held(redirect?.cookie) });
		expect(((await landing.json()) as Loaded).saved).toBe('giving');
		expect(landing.headers.get('Set-Cookie')).toMatch(/max-age=0\b/i);
		expect((await runLoad()).saved).toBe(null);
	});
});

describe('/admin/forms/[id] — a group that cannot be saved', () => {
	it('refuses to write an archived form, whichever group asked, and changes nothing', async () => {
		// the page never draws a save for one, so this is a tab that was open when the form was
		// archived. every group write refuses it at the `where` — each sets columns and none clears
		// `archived_at`, so a save that landed would leave a form the list hides forever and
		// `archiveForm` answers `false` about.
		await archiveInPlace();
		const before = await readForm(db, FORM_ID);

		for (const form of [NAME_FORM, GIVING_FORM, ORIGINS_FORM]) {
			const { failure } = await post(form, FORM_ID, submission(form));
			expect(failure?.status, form).toBe(400);
			// a banner rather than a field error: no box on this screen is what went wrong. and the
			// form is marked invalid whatever made it so — a rejection that still claimed to be valid
			// is one the client renders as a clean form over a 400, which is what `invalid()` is for.
			expect(failure?.message, form).toBeTypeOf('string');
			expect(failure?.valid, form).toBe(false);
			expect(failure?.errors, form).toEqual({});
		}
		expect(await readForm(db, FORM_ID)).toEqual(before);
	});

	it('writes nothing for a body with nothing in it', async () => {
		// the empty POST, pinned on the row rather than on what came back. what is worth pinning here
		// is that the refusal left the form alone — a save that got partway would leave an operator's
		// live form in a shape nobody submitted.
		await goLive();
		const before = await readForm(db, FORM_ID);

		for (const form of [NAME_FORM, GIVING_FORM]) {
			const { failure } = await post(form, FORM_ID, {});
			expect(failure?.status, form).toBe(400);
		}
		expect(await readForm(db, FORM_ID)).toEqual(before);
	});

	it('leaves a live form live when the body never mentions its status', async () => {
		// the one thing "every stated box must arrive" buys on this route that nothing else would,
		// seen on the row. every other key in the name group is refused by its own rule when the
		// schema generates it, but `status` is an enum — a generated one is its *first member*,
		// `draft` — so a body that parses in every other respect and never mentions the status would
		// save, and quietly unpublish a form that is taking money. `_app.admin.forms.$id.spec.ts`
		// pins that the submission is refused; this pins what the refusal is protecting.
		await goLive();

		const withoutStatus = submission(NAME_FORM);
		delete withoutStatus.status;
		const { failure, redirect } = await post(NAME_FORM, FORM_ID, withoutStatus);
		// asserted before the failure is read, because it is the shape the failure takes: a save that
		// went through redirects, and reading a status off `undefined` would report this as a
		// `TypeError` rather than as the form having been unpublished.
		expect(redirect).toBeUndefined();
		expect(failure?.status).toBe(400);
		expect(failure?.valid).toBe(false);

		// and the form is still the one the operator published. `name` too, because a save that wrote
		// would have renamed it to the submission's own value.
		const after = await readForm(db, FORM_ID);
		expect(after?.status).toBe('live');
		expect(after?.name).toBe('General Fund');
	});

	it('refuses an id no form carries the same way, rather than 500ing', async () => {
		const { failure } = await post(NAME_FORM, 'frm_nosuchformatall', submission(NAME_FORM));
		expect(failure?.status).toBe(400);
		expect(failure?.message).toBeTypeOf('string');
		expect(failure?.valid).toBe(false);
	});

	it('ignores a fund a body names, because the column is no box on this screen', async () => {
		// the account is not an input, so a hand-built body naming one is neither honoured nor
		// refused: it is a key the parser does not read, and the save leaves the column where it
		// stood. a rollup is the sharp case — `4100 Donations` is a real account no gift may name,
		// because its children already sum into it.
		const rollup = await env.DB.prepare(
			`select id from account where is_postable = 0 and code = '4100'`
		).first<{ id: string }>();

		const { redirect } = await post(
			NAME_FORM,
			FORM_ID,
			submission(NAME_FORM, { revenue_account_id: rollup?.id ?? '' })
		);
		expect(redirect?.status).toBe(303);
		expect((await readForm(db, FORM_ID))?.revenueAccountId).toBe(revenueAccountId);
	});
});

describe('/admin/forms/[id] — Live while a blocker stands', () => {
	it('does not offer Live on the screen while the identity columns are blank', async () => {
		// the select renders `EDITABLE_FORM_STATUSES` filtered by this flag. a blocker means
		// `publishedConfig` serves nothing — `readFormConfig` (packages/form/src/config.ts) drops
		// every config without those three columns — so publishing here would produce a form that
		// renders nothing on the org's own site.
		await clearOrgProfile();
		expect((await runLoad()).liveOffered).toBe(false);
	});

	it('offers Live once nothing stands', async () => {
		expect((await runLoad()).liveOffered).toBe(true);
	});

	it('offers Live on a deployment with no Stripe keys, because the gate is the rows', async () => {
		// the deletion this control turns on. what a key can charge is settled on the console when it
		// is pasted (`packages/console-ui/src/lib/stripe-edits.ts`), and a form set live over a
		// key that cannot charge is a deployment to fix there rather than a form to withhold here.
		const loaded = await runLoad({ vars: NOTHING_SET });
		expect(loaded.liveOffered).toBe(true);
		expect(loaded.snippet).toContain(`form="${FORM_ID}"`);
	});

	it('refuses a posted Live anyway, because a filtered option list is not a control', async () => {
		// a stale tab, a hand-built body, or a blocker that arrived between the page being drawn and
		// the button being pressed. the check is read in the action rather than carried from the
		// loader, so what it answers is the deployment as it stands at the moment of the write.
		await clearOrgProfile();
		const { failure, redirect } = await post(NAME_FORM, FORM_ID, submission(NAME_FORM));
		expect(redirect).toBeUndefined();
		expect(failure?.status).toBe(400);
		// keyed to the status box, because that is the one an operator can change — and the sentence
		// names the block above rather than a value, which the block already accounts for.
		expect(failure?.errors).toMatchObject({ status: [expect.any(String)] });
		expect((await readForm(db, FORM_ID))?.status).toBe('draft');
	});

	it('lets a form on no site at all go Live', async () => {
		// where a form loads is not a second gate on Live. every form this deployment serves loads on
		// the donation page it answers on its own address whatever is ticked, so the empty list is a
		// complete state and a form on no site publishes.
		await env.DB.prepare('update form set allowed_origins = ? where id = ?')
			.bind('[]', FORM_ID)
			.run();

		const { redirect } = await post(NAME_FORM, FORM_ID, submission(NAME_FORM));
		expect(redirect?.status).toBe(303);
		expect((await readForm(db, FORM_ID))?.status).toBe('live');
	});

	it('still saves the name as a draft while the blocker stands', async () => {
		// the gate is Live and not the group: everything else about a form stays editable on a
		// deployment that cannot serve it, which is what makes the screen usable while somebody fills
		// the organisation's details in in another tab.
		await clearOrgProfile();
		const { redirect } = await post(
			NAME_FORM,
			FORM_ID,
			submission(NAME_FORM, { status: 'draft', name: 'Renamed while blocked' })
		);
		expect(redirect?.status).toBe(303);
		expect((await readForm(db, FORM_ID))?.name).toBe('Renamed while blocked');
	});

	it('lets a posted Live through on a deployment with no Stripe keys', async () => {
		// the action re-checks the same rows the select was filtered by and nothing else. a key that
		// cannot charge is a deployment to fix on the console, not a publish to refuse here.
		const { redirect } = await post(
			NAME_FORM,
			FORM_ID,
			submission(NAME_FORM, { status: 'live' }),
			NOTHING_SET
		);
		expect(redirect?.status).toBe(303);
		expect((await readForm(db, FORM_ID))?.status).toBe('live');
	});
});

describe('/admin/forms/[id] — the sites tick boxes', () => {
	/** the group's message, which is the only channel a rule about the sites has. */
	function underTheSites(failure: Failure | undefined): string | undefined {
		return failure?.errors.allowed_origins?.at(-1);
	}

	it('ticks a second listed site and leaves the first where it was', async () => {
		await post(ORIGINS_FORM, FORM_ID, {
			allowed_origins: ['https://acme.org', 'https://give.acme.org']
		});
		expect((await readForm(db, FORM_ID))?.allowedOrigins).toEqual([
			'https://acme.org',
			'https://give.acme.org'
		]);
	});

	it('lands two saves made from one mounted screen, with no reload between them', async () => {
		// the screen is drawn once and saved twice, which is an operator ticking a site, seeing the
		// tick, and then ticking another. the body is the boxes and nothing else, so the second save
		// is the first one's with a box moved and there is nothing on it that ages between the two.
		const first = await post(ORIGINS_FORM, FORM_ID, {
			allowed_origins: ['https://acme.org', 'https://give.acme.org']
		});
		expect(first.redirect?.status).toBe(303);

		const second = await post(ORIGINS_FORM, FORM_ID, {
			allowed_origins: ['https://give.acme.org']
		});
		expect(second.failure).toBeUndefined();
		expect(second.redirect?.status).toBe(303);
		expect((await readForm(db, FORM_ID))?.allowedOrigins).toEqual(['https://give.acme.org']);
	});

	it('empties a form of every site, because a form on no site is a form', async () => {
		// a form ticked onto nothing loads on the donation page this deployment answers on its own
		// address and takes real gifts there, so this group states no rule at all about the empty
		// list and neither does the status group.
		//
		// the group with nothing ticked submits no key at all, which is the body this posts.
		const { failure, redirect } = await post(ORIGINS_FORM, FORM_ID, {});
		expect(failure).toBeUndefined();
		expect(redirect?.status).toBe(303);
		expect((await readForm(db, FORM_ID))?.allowedOrigins).toEqual([]);
	});

	/**
	 * the orphan: a site this form still ticks that the deployment has stopped listing.
	 *
	 * both invariants over these two lists are read-then-write and D1 has no interactive
	 * transaction, so the state is reachable however the screen that types the list guards its own
	 * removals. it is benign on the public path — the form's own column is what `corsHeaders` reads
	 * — and it has to be visible and clearable, which is a box drawn ticked and a save refused.
	 */
	it('refuses a save that still ticks a site the deployment has stopped listing', async () => {
		await env.DB.prepare('update form set allowed_origins = ? where id = ?')
			.bind('["https://acme.org","https://old.example.org"]', FORM_ID)
			.run();

		const { failure, redirect } = await post(ORIGINS_FORM, FORM_ID, {
			allowed_origins: ['https://acme.org', 'https://old.example.org']
		});
		expect(redirect).toBeUndefined();
		expect(failure?.status).toBe(400);
		// the sentence names the site and both ways out, and says nothing about the one still listed.
		const message = underTheSites(failure);
		expect(message).toContain('`https://old.example.org`');
		expect(message).toContain('Untick it');
		expect(message).not.toContain('`https://acme.org`');
	});

	it('lets the same save through once the orphan is unticked', async () => {
		await env.DB.prepare('update form set allowed_origins = ? where id = ?')
			.bind('["https://acme.org","https://old.example.org"]', FORM_ID)
			.run();

		const { redirect } = await post(ORIGINS_FORM, FORM_ID, {
			allowed_origins: ['https://acme.org']
		});
		expect(redirect?.status).toBe(303);
		expect((await readForm(db, FORM_ID))?.allowedOrigins).toEqual(['https://acme.org']);
	});

	it('refuses a stale body naming a site that has left the list since the page was drawn', async () => {
		// the read is in the action rather than carried from the loader, and this is what that buys:
		// the page was drawn while the site was listed, and the list changed before the button was
		// pressed. a filtered set of tick boxes is markup, and markup is not what stops a POST.
		const { failure, redirect } = await post(ORIGINS_FORM, FORM_ID, {
			allowed_origins: ['https://acme.org', 'https://gone.example.org']
		});
		expect(redirect).toBeUndefined();
		expect(failure?.status).toBe(400);
		expect(underTheSites(failure)).toContain('`https://gone.example.org`');
		expect((await readForm(db, FORM_ID))?.allowedOrigins).toEqual(['https://acme.org']);
	});

	it('compares against the list what would be stored, not what the body carried', async () => {
		// the check reads through `readOriginList`, which is the same trim and dedupe the parse does.
		// a body carrying a padded copy of a listed site is stored trimmed, so it has to be accepted
		// — and the mirror of that is the one that matters: a padded copy of a site the deployment
		// does not list must not slip past a literal comparison and reach the column.
		const { redirect } = await post(ORIGINS_FORM, FORM_ID, {
			allowed_origins: ['  https://acme.org  ']
		});
		expect(redirect?.status).toBe(303);
		expect((await readForm(db, FORM_ID))?.allowedOrigins).toEqual(['https://acme.org']);

		const stale = await post(ORIGINS_FORM, FORM_ID, {
			allowed_origins: ['https://acme.org', '  https://gone.example.org  ']
		});
		expect(stale.redirect).toBeUndefined();
		expect(underTheSites(stale.failure)).toContain('`https://gone.example.org`');
	});
});

describe('/admin/forms/[id] load — which group just saved', () => {
	it('tells the three groups apart, so one save lights one button', async () => {
		// the whole reason the marker names a group rather than being one bare flag: each group is
		// its own submission with its own button at its own foot, and a flag they shared would
		// report one write on all three.
		for (const group of ['name', 'giving', 'origins'] as const) {
			const flash = await markerFor(SAVED_FLASH, EDITOR_PATH, group);
			expect((await runLoad({ flash })).saved, group).toBe(group);
		}
	});

	it('reports no save at all for a marker no group answers to', async () => {
		// `archived` is in this list deliberately: it rides in the same marker as the three saves, so
		// nothing but keeping it outside `SAVED_SECTIONS` stops a retired form from lighting a
		// button. the case below is the other half of that pair.
		expect((await runLoad()).saved).toBe(null);
		for (const marker of ['snippet', 'archived', 'giving ']) {
			const flash = await markerFor(SAVED_FLASH, EDITOR_PATH, marker);
			expect((await runLoad({ flash })).saved, marker).toBe(null);
		}
	});

	it('never takes the marker a create left for the forms list', async () => {
		// a create lands on the forms list and is reported there against the row it made —
		// ./_app.admin.forms.new.tsx redirects to `/admin/forms`, and that list's own spec covers the
		// landing. the cookie is written at `/`, so the browser sends it to this address too. this
		// screen must neither report it — no button of its own performed that write — nor take it, or
		// an operator who opened a form before the list would never see the banner at all.
		const flash = await markerFor(CREATED_FLASH, '/admin/forms', FORM_ID);
		const response = await visit({ flash });
		const loaded = (await response.json()) as Loaded;
		expect(loaded.saved).toBe(null);
		expect(loaded.archivedJustNow).toBe(false);
		expect('created' in loaded).toBe(false);
		// and it is still in the jar: nothing on this response clears it.
		expect(response.headers.get('Set-Cookie')).toBe(null);
	});
});

describe('/admin/forms/[id] load — the archive confirmation', () => {
	it('asks first, and the asking is a state of the URL rather than of the client', async () => {
		// archiving cannot be undone — this version has no screen that brings a form back — so it is
		// two steps. the first is a link, which is why the flag is read off the URL: a confirmation
		// held in the browser is one nobody can share, reload or back out of.
		expect((await runLoad()).confirmArchive).toBe(false);
		expect((await runLoad({ query: '?confirm=archive' })).confirmArchive).toBe(true);
	});

	it('ignores a `confirm` that names something else', async () => {
		// the value is checked rather than the key being present, so the panel that appears is always
		// the one the link asked for.
		expect((await runLoad({ query: '?confirm=delete' })).confirmArchive).toBe(false);
	});

	it('does not offer to confirm an archive of a form that is already archived', async () => {
		// there is nothing to confirm, and a panel asking would be one whose button comes back
		// refused. the page draws neither for an archived form; this is the loader agreeing.
		await archiveInPlace();
		expect((await runLoad({ query: '?confirm=archive' })).confirmArchive).toBe(false);
	});
});

describe('/admin/forms/[id] archive', () => {
	it('sets the status and the timestamp together, and never deletes the row', async () => {
		// a pasted snippet outlives the form: it sits in someone else's HTML on a site we cannot
		// reach, so a hard delete breaks a live donation page with no way to find out.
		await post(ARCHIVE_FORM, FORM_ID, {});
		expect((await readForm(db, FORM_ID))?.status).toBe('archived');
		const row = await env.DB.prepare('select archived_at as at from form where id = ?')
			.bind(FORM_ID)
			.first<{ at: number | null }>();
		expect(row?.at).toBeTypeOf('number');
	});

	it('redirects back to the form, which now reads as archived', async () => {
		const { redirect } = await post(ARCHIVE_FORM, FORM_ID, {});
		expect(redirect?.status).toBe(303);
		expect(redirect?.location).toBe(EDITOR_PATH);

		// and the page that lands says so, once. the banner is about the whole form rather than a
		// button, but it is delivered on the same terms as a save's: the reload after it reports
		// nothing, and the form itself is re-read from its row either way.
		expect((await runLoad({ flash: held(redirect?.cookie) })).archivedJustNow).toBe(true);
		expect((await runLoad()).archivedJustNow).toBe(false);
	});

	it('reports the archive as an archive and never as a save', async () => {
		// the two share one marker, so the only thing keeping an archive from lighting one of the
		// three save buttons is `archived` being outside the list of groups.
		const { redirect } = await post(ARCHIVE_FORM, FORM_ID, {});
		const loaded = await runLoad({ flash: held(redirect?.cookie) });
		expect(loaded.archivedJustNow).toBe(true);
		expect(loaded.saved).toBe(null);
	});

	it('refuses a second archive rather than overwriting when it happened', async () => {
		await post(ARCHIVE_FORM, FORM_ID, {});
		const first = await env.DB.prepare('select archived_at as at from form where id = ?')
			.bind(FORM_ID)
			.first<{ at: number }>();

		const { failure } = await post(ARCHIVE_FORM, FORM_ID, {});
		expect(failure?.status).toBe(400);
		// a banner and nothing else: archiving is a fieldless submission, so there is no box for a
		// message to sit under. it comes back under the archive's own id, which is what keeps a page
		// reading one channel for both from rendering a refused archive as a complaint about an
		// input.
		expect(failure?.message).toBeTypeOf('string');
		expect(failure?.errors).toEqual({});

		const second = await env.DB.prepare('select archived_at as at from form where id = ?')
			.bind(FORM_ID)
			.first<{ at: number }>();
		expect(second?.at).toBe(first?.at);
	});

	it('reads no form field off the request body, so nothing on it can aim it elsewhere', async () => {
		// the id comes from the route. a body naming another form is ignored, which is what keeps a
		// stale tab from retiring a form nobody was looking at — the one box this submission carries
		// says which of this screen's four forms it is and nothing about which row it acts on.
		await env.DB.prepare(
			`insert into form (id, name, status, revenue_account_id, currency, created_at, updated_at)
			 values ('frm_secondformtest1', 'Building Fund', 'draft', ?, 'USD', 0, 0)`
		)
			.bind(revenueAccountId)
			.run();

		await post(ARCHIVE_FORM, FORM_ID, {
			form_id: 'frm_secondformtest1',
			id: 'frm_secondformtest1'
		});
		expect((await readForm(db, 'frm_secondformtest1'))?.status).toBe('draft');
		expect((await readForm(db, FORM_ID))?.status).toBe('archived');
	});
});

describe('/admin/forms/[id] — the cause a form records against', () => {
	const WATER = 'prg_cleanwatertest01';
	const GALA = 'prg_galatest000001';

	it('offers the causes this deployment still has, and none of the retired ones', async () => {
		await insertProgram(WATER, 'Clean Water');
		await insertProgram(GALA, 'Gala 2024', true);

		const loaded = await runLoad();
		expect(loaded.programs).toEqual([{ value: WATER, label: 'Clean Water' }]);
		// nothing to append: this form is pinned to nothing, so there is no retired cause it holds.
		expect(loaded.retiredProgram).toBeNull();
	});

	it('carries the retired cause a form is already pinned to, beside the active list', async () => {
		// a picker drawn without it would show a blank where the operator's own answer is, and the
		// next save of any other group would go through with the pin silently gone.
		await insertProgram(WATER, 'Clean Water');
		await insertProgram(GALA, 'Gala 2024', true);
		await pinInPlace(GALA);

		const loaded = await runLoad();
		expect(loaded.retiredProgram).toEqual({ value: GALA, label: 'Gala 2024' });
		expect(loaded.programs.map((cause) => cause.value)).not.toContain(GALA);
		expect(loaded.editor?.programBoxes).toEqual({ program_mode: 'pinned', program_id: GALA });
	});

	it('writes the group and leaves every other column alone', async () => {
		await insertProgram(WATER, 'Clean Water');
		const before = await readForm(db, FORM_ID);
		await post(PROGRAM_FORM, FORM_ID, { program_mode: 'pinned', program_id: WATER });

		const after = await readForm(db, FORM_ID);
		expect(after).toMatchObject({ programMode: 'pinned', programId: WATER });
		expect(after?.name).toBe(before?.name);
		expect(after?.status).toBe(before?.status);
		expect(after?.minMinor).toBe(before?.minMinor);
		expect(after?.allowedOrigins).toEqual(before?.allowedOrigins);
	});

	it('reports the save on its own button and on no other', async () => {
		// the marker is the group's rather than a shared flag: one flag would put `Saved` on all
		// four buttons at once.
		const { redirect } = await post(PROGRAM_FORM, FORM_ID, submission(PROGRAM_FORM));
		expect(redirect?.status).toBe(303);
		expect(redirect?.location).toBe(EDITOR_PATH);

		const loaded = await runLoad({ flash: held(redirect?.cookie) });
		expect(loaded.saved).toBe('program');
	});

	it('refuses a pin to a cause this deployment has retired, under the program box', async () => {
		// a page whose select was drawn while the cause was still offered, and a body nothing on this
		// screen drew. no schema can say it — what is still offered is a table, and the schema runs
		// in a browser too — so the write is the only thing that answers.
		await insertProgram(GALA, 'Gala 2024', true);
		const { failure } = await post(PROGRAM_FORM, FORM_ID, {
			program_mode: 'pinned',
			program_id: GALA
		});
		expect(failure?.status).toBe(400);
		expect(failure?.errors.program_id?.at(-1)).toBe('Choose an active program.');
		expect(await readForm(db, FORM_ID)).toMatchObject({ programMode: 'none', programId: null });
	});

	it('refuses a body that never mentions the mode, rather than quietly unpinning the form', async () => {
		// an enum absent is otherwise its first member, which here is `none` — a form silently taken
		// off the cause its gifts were being recorded against.
		await insertProgram(WATER, 'Clean Water');
		await pinInPlace(WATER);

		const { failure } = await post(PROGRAM_FORM, FORM_ID, { program_id: WATER });
		expect(failure?.status).toBe(400);
		expect(failure?.valid).toBe(false);
		expect(await readForm(db, FORM_ID)).toMatchObject({ programMode: 'pinned', programId: WATER });
	});

	it('holds nothing to save once a pin is dropped, though the select still submits the old id', async () => {
		// the select is in the tree in every mode and hidden in two of them
		// (`$lib/admin/forms/program-fields.tsx`), so a group taken off a pin posts the id it was
		// pinned to and would post it again unpressed. read raw against the seed the write blanked,
		// that id is a change nobody made: the save lands, `Saved` never draws, and the button goes on
		// offering itself over a group with nothing in it.
		await insertProgram(WATER, 'Clean Water');
		await pinInPlace(WATER);

		const { redirect } = await post(PROGRAM_FORM, FORM_ID, {
			program_mode: 'choice',
			program_id: WATER
		});
		const loaded = await runLoad({ flash: held(redirect?.cookie) });
		expect(loaded.saved).toBe('program');
		expect(loaded.editor?.programBoxes).toEqual({ program_mode: 'choice', program_id: '' });

		// the same body a second time, from boxes nobody touched: the two sides are one submission
		// once the id is read off the mode.
		expect(
			editor.programChanged(loaded.editor?.programBoxes, {
				program_mode: 'choice',
				program_id: WATER
			})
		).toBe(false);
	});

	it('names the cause on the record an archived form draws', async () => {
		// the one screen that still says where a retired form's gifts went, so it renders the name
		// rather than the id the column holds.
		await insertProgram(WATER, 'Clean Water');
		await pinInPlace(WATER);
		await archiveInPlace();

		const loaded = await runLoad();
		expect(loaded.editor).toBeNull();
		expect(loaded.programMode).toBe('pinned');
		expect(loaded.pinnedProgram).toBe('Clean Water');
	});
});
