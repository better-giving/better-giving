import { PRE_UPGRADE_RESERVATION } from '@better-giving/form/embed/reservation';
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { createDb, type Db } from '$lib/server/db/client';
import { CREATED_FLASH, redirectWithFlash, SAVED_FLASH } from '$lib/server/flash';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as forms from './_app.admin.forms._index';

// a workers spec rather than a node one because every case here reads a row, and CLAUDE.md splits
// the pools by what a spec needs. this route has no action of its own: a form's sites, its status
// and its retirement are written on the screens under `new` and `[id]`, each with a spec of its own.
//
// the chain is mounted rather than the loader called, which is ../route-request.testing.ts's
// pattern: the session gate is a `middleware` on ./_app.tsx and the handle is on the request
// context, so a loader called on its own is a loader with the gate above it never run.
//
// the Stripe keys ride in a per-request `env` rather than in a value a case builds, and they are
// here for one assertion: this screen hands out a snippet whatever is in those slots. what a key
// can charge is read on the console when it is pasted
// (`packages/console-ui/src/lib/stripe-edits.ts`), and no screen in /admin asks again.

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://donations.example.workers.dev';

/** the address this screen answers on, which is also the address a marker is written for. */
const LIST = '/admin/forms';

/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const PASSWORD = 'a-long-enough-password';

/**
 * the form these cases run against, written by this file.
 *
 * a deployment ships with no forms — nothing in `migrations/` seeds one — so the fixture makes the
 * row it needs. the id lives here and nowhere else: the route may not name a form id, and asserting
 * against a copy of one would be that same mistake a layer over.
 */
const FORM_ID = 'frm_adminformstest1';

let db: Db;
let request: RouteRequester;
let session: string;

/**
 * a postable revenue account, read out of the table. `form` carries the composite postable foreign
 * key, so a made-up id fails on the INSERT — and the ids are reference data belonging to
 * `migrations/0000_initial_schema.sql`.
 */
let revenueAccountId: string;

beforeAll(async () => {
	db = createDb(env.DB);
	// the pathless layout carries no path of its own, which is what makes the gate cover a screen
	// without adding a segment to its address.
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/forms', module: forms }
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
	await env.DB.prepare(
		`insert into form (id, name, status, revenue_account_id, currency, created_at, updated_at)
		 values (?, 'General Fund', 'draft', ?, 'USD', 0, 0)`
	)
		.bind(FORM_ID, revenueAccountId)
		.run();
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
 * the four states a deployment's Stripe slots can be in, named here because this screen reads none
 * of them: the names are this file's own, so a case says which deployment it is standing in rather
 * than spelling three variables per visit.
 *
 * the keys and not a reading of them: what this screen has to go on doing over every one of them is
 * hand out the snippet. `keys-unset` is the pool's own env — no Stripe variable is set anywhere — so
 * it is stated as the empty set rather than by leaving them out.
 */
type StripeSlots = 'keys-unset' | 'publishable-slot-wrong' | 'secret-slot-wrong' | 'configured';

const STRIPE_KEYS: Record<StripeSlots, Record<string, string>> = {
	'keys-unset': {},
	// a secret key in the slot the donation form is handed, which is the one value that leaves the
	// deployment.
	'publishable-slot-wrong': {
		STRIPE_PUBLISHABLE_KEY: 'sk_test_wrongslot',
		STRIPE_SECRET_KEY: 'sk_test_secret',
		STRIPE_WEBHOOK_SECRET: 'whsec_signing'
	},
	// the signing secret in the secret-key slot: a value that cannot create a charge.
	'secret-slot-wrong': {
		STRIPE_PUBLISHABLE_KEY: 'pk_test_publishable',
		STRIPE_SECRET_KEY: 'whsec_wrongslot',
		STRIPE_WEBHOOK_SECRET: 'whsec_signing'
	},
	configured: {
		STRIPE_PUBLISHABLE_KEY: 'pk_test_publishable',
		STRIPE_SECRET_KEY: 'sk_test_secret',
		STRIPE_WEBHOOK_SECRET: 'whsec_signing'
	}
};

/** what the screen is handed, off one request through the chain the deployment serves it under. */
type Loaded = {
	created: { id: string; name: string } | null;
	embedding: { id: string; name: string; runtime: string; element: string } | null;
	forms: {
		id: string;
		name: string;
		status: string;
		origins: string[];
	}[];
};

/**
 * one visit to the list, carrying the session and whatever the browser holds beside it.
 *
 * `search` is the whole address bar past the path — the list asks its own question there, so a
 * case that opens the embed card visits the same address a press on the card's control navigates
 * to rather than calling anything of its own.
 */
function visit(reason: StripeSlots = 'configured', flash = '', search = ''): Promise<Response> {
	const cookie = [session, flash].filter((value) => value !== '').join('; ');
	return request(new Request(`${ORIGIN}${LIST}${search}`, { headers: { cookie } }), {
		env: { ...env, ...STRIPE_KEYS[reason] } as Env
	});
}

async function payload(response: Response): Promise<Loaded> {
	expect(response.status).toBe(200);
	return (await response.json()) as Loaded;
}

/** the loader's answer to a plain visit, or to one carrying a marker or a question. */
async function runLoad(
	reason: StripeSlots = 'configured',
	flash = '',
	search = ''
): Promise<Loaded> {
	return payload(await visit(reason, flash, search));
}

/** the address the Embed control navigates to, built the way the screen builds it. */
function embedQuestion(id: string): string {
	return `?embed=${encodeURIComponent(id)}`;
}

/**
 * the marker the create next door leaves, as the pair a browser sends back.
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
		new Request(`${ORIGIN}/admin/forms/new`),
		name,
		destination,
		marker
	);
	const header = sent.headers.get('Set-Cookie');
	if (header === null) throw new Error('the redirect wrote no cookie');
	return header.split(';')[0] ?? '';
}

/**
 * what the browser is still holding after a response, which is how a one-shot marker is spent.
 *
 * the clearing rides on the response that publishes the marker, so what is left is an expired
 * cookie and the next request carries nothing.
 */
function stillHeld(response: Response, was: string): string {
	const header = response.headers.get('Set-Cookie');
	if (header === null) return was;
	return /max-age=0\b/i.test(header) ? '' : (header.split(';')[0] ?? '');
}

describe('/admin/forms load — the snippet', () => {
	/**
	 * the deletion this screen turns on: a snippet is handed out whatever this deployment's Stripe
	 * slots hold, including the two that cannot take a donor's money.
	 *
	 * a case per state rather than one per status word, because what a slot holds is what a
	 * deployment holds. every one of them is refused at the box it is pasted into —
	 * `stripeKeyEdits` in `packages/console-ui/src/lib/stripe-edits.ts` — so a screen here that
	 * withheld the snippet would be checking forever for a mistake caught once, and could only ever
	 * point at a screen it is not.
	 */
	it.each(['keys-unset', 'publishable-slot-wrong', 'secret-slot-wrong', 'configured'] as const)(
		'hands every snippet over on %s',
		async (reason) => {
			const { embedding, forms: listed } = await runLoad(reason, '', embedQuestion(FORM_ID));
			expect(listed.map((f) => f.id)).toEqual([FORM_ID]);
			expect(embedding?.element).toContain(`form="${FORM_ID}"`);
		}
	);
});

describe('/admin/forms load', () => {
	it('lists each form by the id that is in its own row', async () => {
		// never a hardcoded id in the route. a `frm_…` written into the route file would show one form
		// on a deployment that had two, and nothing on a deployment whose operator has not made one
		// yet.
		expect((await runLoad()).forms.map((f) => f.id)).toEqual([FORM_ID]);
	});

	it('hands the origins over decoded, never as the JSON the column holds', async () => {
		await env.DB.prepare('update form set allowed_origins = ? where id = ?')
			.bind('["https://acme.org"]', FORM_ID)
			.run();
		const [form] = (await runLoad()).forms;
		expect(form?.origins).toEqual(['https://acme.org']);
	});

	it('hands the status over as the column holds it, for the page to put words to', async () => {
		// the word an operator reads is `FORM_STATUS_LABELS` in `$lib/forms/statuses.ts`, which a
		// component may import — so the label is not built here. what crosses is the value, and a
		// status the page has no word for is a type error rather than a blank on a screen.
		expect((await runLoad()).forms[0]?.status).toBe('draft');
		await env.DB.prepare(`update form set status = 'live' where id = ?`).bind(FORM_ID).run();
		expect((await runLoad()).forms[0]?.status).toBe('live');
	});

	it('publishes nothing the page does not render', async () => {
		// the projection is the whole guard: `revenue_account_id`, the timestamps and the three other
		// JSON columns are none of this page's business, and a column added to `form` later must not
		// reach the browser just because it was selected.
		//
		// the two absences worth naming: what a donor may pay by and how often a gift may repeat.
		// neither is a fact about a form — every form offers `OFFERED_PAYMENT_METHODS` in
		// `$lib/forms/offered-rails.ts` and the cadences `$lib/server/forms/offered-cadences.ts` reads
		// off the processor's account — so a per-form key for either would answer a question no form
		// answers. stated as the whole key set rather than as two absences, so it is refused whatever
		// puts one back.
		//
		// the snippet is one of those absences now and is the reason this key set shrank: no record on
		// the list draws it, and it crossed the wire once per form for a card drawn over one.
		const [form] = (await runLoad()).forms;
		expect(Object.keys(form ?? {}).sort()).toEqual(['id', 'name', 'origins', 'status']);
	});

	it('publishes the forms, the create outcome and the embed question, and nothing else', async () => {
		// the whole contract this screen publishes. nothing about the deployment's own state crosses:
		// the status ledger is not rendered here and the header action is never disabled here, so a
		// readiness key would have no consumer, and what the Stripe keys can charge is the console's
		// to say. asserted as the whole key set, so it is refused whatever puts one back.
		expect(Object.keys(await runLoad()).sort()).toEqual(['created', 'embedding', 'forms']);
	});

	it('lists the forms on a deployment with no organisation details saved at all', async () => {
		// what a fresh deployment is: no `org_profile` row. this page does not read that table — what
		// the missing identity fields cost is `$lib/server/forms/readiness.ts`'s to say, and it is said
		// on the screens that make and publish a form. so an empty `org_profile` is not an error here
		// and not a blank sentence either; it changes nothing about this screen.
		await env.DB.prepare('delete from org_profile').run();
		expect((await runLoad()).forms.map((f) => f.id)).toEqual([FORM_ID]);
	});

	it('hands back an empty list on a deployment that has no forms yet', async () => {
		// the state every fresh deployment is in: nothing in `migrations/` seeds a form, so the first
		// one is made by a human. an empty list is a page with an empty-state sentence on it.
		await env.DB.prepare('delete from form').run();
		expect((await runLoad()).forms).toEqual([]);
	});
});

describe('/admin/forms load — the form the create next door just made', () => {
	it('names the form the create next door just made', async () => {
		// ./_app.admin.forms.new.tsx redirects here with the new form's id, because the button that
		// was pressed is on a page that no longer exists — so the write reports as a banner where the
		// operator lands. the name comes off the row, so what the banner says is what the database
		// holds.
		const held = await markerFor(CREATED_FLASH, LIST, FORM_ID);
		expect((await runLoad('configured', held)).created).toEqual({
			id: FORM_ID,
			name: 'General Fund'
		});
	});

	it('draws the banner once, so a reload of the list announces nothing', async () => {
		// the reason the id is not in the address. a record key in an address bar is bookmarked and
		// shared, so a banner keyed to one re-announces a form made days ago on every reload.
		const held = await markerFor(CREATED_FLASH, LIST, FORM_ID);
		const landed = await visit('configured', held);
		expect((await payload(landed)).created).not.toBe(null);
		expect((await runLoad('configured', stillHeld(landed, held))).created).toBe(null);
	});

	it('reports nothing for an id no form on this list answers to', async () => {
		// the id is matched against the list rather than printed, so a marker nothing answers to costs
		// a banner rather than putting a sentence about a form that does not exist on the screen. the
		// live case is a form archived between the create and the landing: it is off this list, so the
		// banner it would have drawn is the one about a form that is no longer here.
		expect((await runLoad()).created).toBe(null);
		for (const marker of ['', 'frm_nosuchform']) {
			const held = await markerFor(CREATED_FLASH, LIST, marker);
			expect((await runLoad('configured', held)).created, marker || '(empty)').toBe(null);
		}
	});

	it('leaves the editor’s own marker alone, at an address the list’s marker also reaches', async () => {
		// a cookie set at `/admin/forms` is sent to `/admin/forms/<id>` as well, which is why the
		// create's marker and the editor's have different names. this list must not take the editor's:
		// an operator who saved a group and then came here would otherwise lose the confirmation
		// before ever landing on the button that earned it.
		const held = await markerFor(SAVED_FLASH, `/admin/forms/${FORM_ID}`, 'giving');
		const landed = await visit('configured', held);
		expect((await payload(landed)).created).toBe(null);
		expect(stillHeld(landed, held)).toBe(held);
	});
});

describe('/admin/forms load — the form the address asks to embed', () => {
	it('resolves the asked-for form into the card the modal draws', async () => {
		// the question is on the address because a snippet an operator is about to paste is a thing
		// they reload, share and back out of — the same shape the removal on ./_app.admin.members.tsx
		// asks its question in. the id is resolved against the list already read rather than read a
		// second time, so what the card names is a form this screen is showing.
		const { embedding } = await runLoad('configured', '', embedQuestion(FORM_ID));
		expect(embedding?.id).toBe(FORM_ID);
		expect(embedding?.name).toBe('General Fund');
		expect(Object.keys(embedding ?? {}).sort()).toEqual(['element', 'id', 'name', 'runtime']);
	});

	it('hands the card the two placements, built against this request’s own origin', async () => {
		// no hostname is committed to this repo — a fork inheriting a hardcoded one would inherit a
		// pointer at a domain it does not own. so the host is the request's.
		//
		// the reservation is spelled by the module that owns it rather than copied in here: what this
		// case is about is the origin and the split, and a second copy of the block would be one more
		// place the snippet drifts. packages/form/src/embed/snippet.spec.ts is where the halves are
		// held, including that joining them is the block that was handed over whole before.
		const { embedding } = await runLoad('configured', '', embedQuestion(FORM_ID));
		expect(embedding?.runtime).toBe(
			`<script src="${ORIGIN}/embed.js" async></script>\n${PRE_UPGRADE_RESERVATION}`
		);
		expect(embedding?.element).toBe(`<bg-donate-form form="${FORM_ID}"></bg-donate-form>`);
	});

	it('asks about nothing on a plain visit', async () => {
		expect((await runLoad()).embedding).toBe(null);
	});

	it('reports nothing for an id no form on this list answers to', async () => {
		// the id is matched against the list rather than printed, for the reason the create's marker
		// is: a card titled with an id nothing answers to would be a snippet for a form that does not
		// exist. the live case is a form archived between the press and the landing — `readForms`
		// leaves an archived row off the list, so the card closes rather than handing over a snippet
		// for a form staff have retired.
		for (const id of ['', 'frm_nosuchform']) {
			expect((await runLoad('configured', '', embedQuestion(id))).embedding, id || '(empty)').toBe(
				null
			);
		}

		await env.DB.prepare('update form set archived_at = 1, status = ? where id = ?')
			.bind('archived', FORM_ID)
			.run();
		expect((await runLoad('configured', '', embedQuestion(FORM_ID))).embedding).toBe(null);
	});
});
