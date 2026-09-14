import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuth } from '$lib/server/auth';
import { resolveAuthSecret } from '$lib/server/auth/signing-key';
import { createDb, type Db } from '$lib/server/db/client';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import * as layout from './_app';
import * as donations from './_app.admin.donations._index';
import * as donorSearch from './_app.admin.donors.search';
import * as addDonation from './_app.admin.donations.new';

// a workers spec, against the real D1 the pool binds and the committed migrations: the press writes a
// gift, its payment and its entry in one `batch()`, and a stand-in would only prove the stand-in.
//
// what a gift in hand *is* — the rows, the entry, the idempotency on the two ids — is
// `$lib/server/donations/record-in-hand.workers.spec.ts`. what is here is this route's own: the body
// read into one, the donor and the cause checked against what is on file, the receipt sent or not,
// the redirect that clears the form, and the words the landing reports.
//
// the chain is mounted rather than the action called, for the reason ./_app.admin.books.workers.spec.ts
// gives: the session gate is a middleware on ./_app.tsx.

const sent = vi.hoisted(() => [] as { to: string; subject: string }[]);

// the mail transport, captured. the receipt itself is rendered for real from the org profile.
vi.mock('$lib/server/email/factory', () => ({
	createEmailProvider: () => ({
		async send(message: { to: string; subject: string; html: string; text: string }) {
			sent.push(message);
			return { ok: true as const };
		}
	})
}));

/** the origin every request in this file arrives on. not loopback, so the cookie is `__Secure-`. */
const ORIGIN = 'https://give.example';

/** the deployment's staff password, long enough for `readStaffCredential` to accept it. */
const PASSWORD = 'a-long-enough-password';

const SCREEN = '/admin/donations/new';

const DONOR_ID = '019fb300-0000-7000-8000-000000000001';
const NO_EMAIL_DONOR_ID = '019fb300-0000-7000-8000-000000000002';
const PROGRAM_ID = '019fb310-0000-7000-8000-000000000001';

let db: Db;
/** one requester per chain: `mountRoutes` nests each module under the one before it. */
let request: (req: Request) => Promise<Response>;
let session: string;

beforeAll(async () => {
	db = createDb(env.DB);
	const chains: [string, RouteRequester][] = [
		[
			SCREEN,
			mountRoutes([
				{ path: undefined, module: layout },
				{ path: 'admin/donations/new', module: addDonation }
			])
		],
		[
			'/admin/donations',
			mountRoutes([
				{ path: undefined, module: layout },
				{ path: 'admin/donations', module: donations }
			])
		],
		[
			'/admin/donors/search',
			mountRoutes([
				{ path: undefined, module: layout },
				{ path: 'admin/donors/search', module: donorSearch }
			])
		]
	];
	request = (req) => {
		const { pathname } = new URL(req.url);
		const chain = chains.find(([path]) => path === pathname);
		if (chain === undefined) throw new Error(`no chain mounted for ${pathname}`);
		return chain[1](req);
	};
	session = await signIn();
});

beforeEach(async () => {
	sent.length = 0;
	for (const table of [
		'ledger_entry',
		'entry_group',
		'payment',
		'line_item',
		'donation',
		'recurring_plan',
		'contact',
		'program',
		'org_profile'
	]) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
	await env.DB.prepare(
		`insert into contact (id, kind, display_name, primary_email, created_at, updated_at)
		 values (?, 'individual', 'Margaret O’Hara', 'm.ohara@rivergate.example', 0, 0),
		        (?, 'individual', 'Cash tin, harvest supper', null, 0, 0)`
	)
		.bind(DONOR_ID, NO_EMAIL_DONOR_ID)
		.run();
	await env.DB.prepare(
		`insert into program (id, name, status, created_at, updated_at)
		 values (?, 'Winter Shelter', 'active', 0, 0)`
	)
		.bind(PROGRAM_ID)
		.run();
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, deductibility_statement, address_line1,
		                          city, country, notification_email, created_at, updated_at)
		 values ('default', 'Hope Foundation', '12-3456789', 'No goods or services were provided.',
		         '1 Main St', 'Springfield', 'US', 'ops@hope.example', 0, 0)`
	).run();
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

/** every box of the create arm, empty, which is what the other two arms submit for them. */
const NO_NEW_DONOR = {
	kind: '',
	first_name: '',
	last_name: '',
	legal_name: '',
	display_name: '',
	primary_email: '',
	primary_phone: ''
};

/**
 * a body carrying the whole form, filed under the donor on file with an address.
 *
 * every box a form states must arrive (`$lib/server/conform.ts`), so a fixture carrying only the
 * boxes a case is about would be refused for a reason the case is not about.
 */
const GIFT = {
	donation_id: '019fb2c7-5d41-7e0a-9b62-8f3d1c7a4e29',
	payment_id: '019fb2c7-5d41-7c93-a4e8-2b70d9f16c85',
	donor: 'existing',
	donor_search: '',
	contact_id: DONOR_ID,
	...NO_NEW_DONOR,
	amount: '250.00',
	received_on: '2026-08-28',
	method: 'check',
	program_id: PROGRAM_ID,
	source: 'Harvest supper, cheque 4471'
};

/** posts a body at the screen. */
async function post(fields: Record<string, string>) {
	const body = new FormData();
	for (const [field, value] of Object.entries(fields)) body.append(field, value);
	return request(
		new Request(`${ORIGIN}${SCREEN}`, { method: 'POST', body, headers: { cookie: session } })
	);
}

type Answer = {
	recordedAgain?: { donationId: string; receipt: string } | null;
	freshIds?: { donationId: string; paymentId: string };
	releasedId?: string;
	form?: { result: { error?: Record<string, string[]> } };
};

async function answerOf(response: Response): Promise<Answer> {
	return (await response.json()) as Answer;
}

type Served = {
	donationId: string;
	paymentId: string;
	programs: { value: string; label: string }[];
	landed: {
		filing: string;
		receipt: string;
		gift: { amount: string; donorName: string; receivedOn: string } | null;
	} | null;
};

/** the screen as served, carrying whatever cookie a redirect set. */
async function visit(flash?: string | null): Promise<Served> {
	const cookie = flash ? `${session}; ${flash}` : session;
	const response = await request(new Request(`${ORIGIN}${SCREEN}`, { headers: { cookie } }));
	expect(response.status).toBe(200);
	return (await response.json()) as Served;
}

/** the flash a redirect set, as the `Cookie` a browser sends on the GET it follows. */
function flashOf(response: Response): string | null {
	const set = response.headers.get('Set-Cookie');
	return set === null ? null : (set.split(';', 1)[0] ?? null);
}

/** the gifts list's rows, as its loader hands them to the page. */
async function giftsList() {
	const response = await request(
		new Request(`${ORIGIN}/admin/donations`, { headers: { cookie: session } })
	);
	return (
		(await response.json()) as {
			donations: {
				status: string;
				paidWith: string | null;
				source: string | null;
				program: string | null;
				note: string | null;
			}[];
		}
	).donations;
}

async function count(table: string): Promise<number> {
	const row = await env.DB.prepare(`select count(*) as n from ${table}`).first<{ n: number }>();
	return row?.n ?? 0;
}

describe('recording a gift under a donor on file', () => {
	it('lands on Gifts as settled, and redirects to a fresh form that reports it', async () => {
		const response = await post(GIFT);
		expect(response.status).toBe(303);
		expect(response.headers.get('Location')).toBe(SCREEN);

		const [row] = await giftsList();
		expect(row?.status).toBe('completed');
		expect(row?.paidWith).toBe('Cheque');
		expect(row?.program).toBe('Winter Shelter');
		// the operator's words are the gift's source, never the donor's message.
		expect(row?.source).toBe(GIFT.source);
		expect(row?.note).toBeNull();

		const served = await visit(flashOf(response));
		expect(served.landed).toEqual({
			filing: 'picked',
			receipt: 'none',
			gift: { amount: '$250.00', donorName: 'Margaret O’Hara', receivedOn: '2026-08-28' }
		});
		// fresh ids, so the cleared form is a different gift.
		expect(served.donationId).not.toBe(GIFT.donation_id);
		expect(sent).toHaveLength(0);
	});

	it('reports nothing on a plain visit', async () => {
		expect((await visit()).landed).toBeNull();
	});

	it('sends the receipt when ticked, and says so', async () => {
		const response = await post({ ...GIFT, send_receipt: 'on' });
		expect(response.status).toBe(303);

		expect(sent.map((m) => m.to)).toEqual(['m.ohara@rivergate.example']);
		const stamp = await env.DB.prepare('select receipt_sent_at from donation').first<{
			receipt_sent_at: number | null;
		}>();
		expect(stamp?.receipt_sent_at).not.toBeNull();
		expect((await visit(flashOf(response))).landed?.receipt).toBe('sent');
	});

	it('records the gift and reports no address where the donor has none', async () => {
		const response = await post({ ...GIFT, contact_id: NO_EMAIL_DONOR_ID, send_receipt: 'on' });
		expect(response.status).toBe(303);
		expect(sent).toHaveLength(0);
		expect((await visit(flashOf(response))).landed?.receipt).toBe('no_address');
	});
});

describe('recording a gift under a new donor', () => {
	const NEW = {
		...GIFT,
		donor: 'new',
		contact_id: '',
		kind: 'individual',
		first_name: 'Deborah',
		last_name: 'Whitlock',
		primary_email: 'deborah@example.org',
		program_id: ''
	};

	it('creates the donor and files the gift under them', async () => {
		const response = await post(NEW);
		expect(response.status).toBe(303);
		expect(await count('contact')).toBe(3);
		const landed = (await visit(flashOf(response))).landed;
		expect(landed?.filing).toBe('created');
		expect(landed?.gift?.donorName).toBe('Deborah Whitlock');
	});

	it('files under the donor already holding that email, and says so', async () => {
		const response = await post({ ...NEW, primary_email: 'M.OHARA@rivergate.example' });
		expect(response.status).toBe(303);
		expect(await count('contact')).toBe(2);
		const landed = (await visit(flashOf(response))).landed;
		expect(landed?.filing).toBe('matched');
		expect(landed?.gift?.donorName).toBe('Margaret O’Hara');
	});

	it('is refused on the name box where no name was given, and writes nothing', async () => {
		const response = await post({ ...NEW, first_name: '', last_name: '' });
		expect(response.status).toBe(400);
		expect(Object.keys((await answerOf(response)).form?.result.error ?? {})).toContain(
			'first_name'
		);
		expect(await count('donation')).toBe(0);
	});
});

describe('the same ids pressed twice', () => {
	it('records the gift once, and the second press says it is already recorded', async () => {
		await post({ ...GIFT, send_receipt: 'on' });
		const second = await post({ ...GIFT, send_receipt: 'on' });

		expect(second.status).toBe(409);
		expect((await answerOf(second)).recordedAgain?.donationId).toBe(GIFT.donation_id);
		expect(await count('donation')).toBe(1);
		expect(await count('entry_group')).toBe(1);
		// the earlier press receipted it; the stamp's claim sends this one nothing.
		expect(sent).toHaveLength(1);
	});

	it('sends a ticked receipt the earlier press never sent, as after a write that landed and reported failure', async () => {
		// the earlier press stands in for a committed write whose answer was lost: it recorded the gift
		// and sent nothing. the operator ticks the box and presses again, unchanged.
		await post(GIFT);
		const second = await post({ ...GIFT, send_receipt: 'on' });

		expect(second.status).toBe(409);
		expect((await answerOf(second)).recordedAgain).toEqual({
			donationId: GIFT.donation_id,
			receipt: 'sent'
		});
		expect(sent.map((m) => m.to)).toEqual(['m.ohara@rivergate.example']);
		expect(await count('donation')).toBe(1);
	});
});

describe('a different gift presented under ids the database already holds', () => {
	it('is refused, never answered as already recorded, and hands back a fresh pair', async () => {
		// the page holds the ids only while the boxes hold what they were sent under, but a press the
		// page got wrong must not be swallowed: the gift read back under the ids is compared with what
		// was submitted.
		await post(GIFT);
		const differing = [
			{ ...GIFT, amount: '300.00' },
			{ ...GIFT, received_on: '2026-08-27' },
			{ ...GIFT, method: 'cash' },
			{ ...GIFT, program_id: '' },
			{ ...GIFT, source: 'Autumn appeal' },
			{ ...GIFT, contact_id: NO_EMAIL_DONOR_ID }
		];
		for (const body of differing) {
			const response = await post(body);
			expect(response.status).toBe(409);
			const answer = await answerOf(response);
			expect(answer.recordedAgain).toBeNull();
			const [sentence] = answer.form?.result.error?.[''] ?? [];
			expect(sentence).toBe(
				'This press matched an earlier gift with different details, so it was not added. Press again to add it.'
			);
			expect(answer.releasedId).toBe(GIFT.donation_id);
			expect(answer.freshIds?.donationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
			expect(answer.freshIds?.paymentId).not.toBe(answer.freshIds?.donationId);
		}
		expect(await count('donation')).toBe(1);
	});

	it('adds the gift under the fresh pair it handed back', async () => {
		await post(GIFT);
		const { freshIds } = await answerOf(await post({ ...GIFT, amount: '300.00' }));

		const again = await post({
			...GIFT,
			amount: '300.00',
			donation_id: freshIds?.donationId ?? '',
			payment_id: freshIds?.paymentId ?? ''
		});
		expect(again.status).toBe(303);
		expect(await count('donation')).toBe(2);
	});

	it('answers a new donor filed under an address on file as the same gift, whatever name was typed', async () => {
		const MATCHED = {
			...GIFT,
			donor: 'new',
			contact_id: '',
			kind: 'individual',
			first_name: 'Maggie',
			last_name: '',
			primary_email: 'M.OHARA@rivergate.example'
		};
		await post(MATCHED);
		const second = await post(MATCHED);
		expect(second.status).toBe(409);
		expect((await answerOf(second)).recordedAgain?.donationId).toBe(GIFT.donation_id);
	});
});

describe('ids no gift answers to', () => {
	it('is refused as a different gift rather than answered as already recorded', async () => {
		// a fresh gift id beside a payment id already taken: the database refuses the write, and no gift
		// stands under the donation id to be the one this press asked for.
		await post(GIFT);
		const response = await post({
			...GIFT,
			donation_id: '019fb2c7-5d41-7e0a-9b62-00000000beef'
		});

		expect(response.status).toBe(409);
		const answer = await answerOf(response);
		expect(answer.recordedAgain).toBeNull();
		expect(answer.releasedId).toBe('019fb2c7-5d41-7e0a-9b62-00000000beef');
		expect(await count('donation')).toBe(1);
	});
});

describe('a submission a rule refuses', () => {
	it('names every offending box in one pass, and never reaches the database', async () => {
		const response = await post({
			...GIFT,
			contact_id: '',
			amount: '1,200',
			received_on: '',
			method: ''
		});
		expect(response.status).toBe(400);
		expect(Object.keys((await answerOf(response)).form?.result.error ?? {}).sort()).toEqual([
			'amount',
			'donor_search',
			'method',
			'received_on'
		]);
		expect(await count('donation')).toBe(0);
		expect(await count('entry_group')).toBe(0);
	});

	it('refuses a donor or a cause that is not on file, on the box that chose it', async () => {
		const gone = await post({ ...GIFT, contact_id: '019fb300-0000-7000-8000-00000000dead' });
		expect(gone.status).toBe(400);
		expect(Object.keys((await answerOf(gone)).form?.result.error ?? {})).toEqual(['contact_id']);

		const retired = await post({ ...GIFT, program_id: '019fb310-0000-7000-8000-00000000dead' });
		expect(retired.status).toBe(400);
		expect(Object.keys((await answerOf(retired)).form?.result.error ?? {})).toEqual(['program_id']);

		expect(await count('donation')).toBe(0);
	});
});

describe('a write that failed', () => {
	it('says so without claiming nothing was recorded', async () => {
		await env.DB.prepare('alter table ledger_entry rename to ledger_entry_hidden').run();
		let response: Response;
		try {
			response = await post(GIFT);
		} finally {
			await env.DB.prepare('alter table ledger_entry_hidden rename to ledger_entry').run();
		}

		expect(response.status).toBe(500);
		const answer = await answerOf(response);
		const [sentence] = answer.form?.result.error?.[''] ?? [];
		expect(sentence).toContain('Press again');
		expect(sentence).not.toMatch(/nothing (was|has been) (recorded|added)/i);
		// a fresh pair rides back for a press whose boxes change before it is made again.
		const { freshIds } = answer;
		expect(freshIds?.donationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
		expect(freshIds?.donationId).not.toBe(GIFT.donation_id);
		expect(await count('donation')).toBe(0);
	});
});

describe('the screen as it is served', () => {
	it('mints fresh ids on every load, and offers the causes still offered', async () => {
		const first = await visit();
		const second = await visit();
		expect(first.donationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
		expect(first.paymentId).not.toBe(first.donationId);
		expect(second.donationId).not.toBe(first.donationId);
		expect(first.programs).toEqual([{ value: PROGRAM_ID, label: 'Winter Shelter' }]);
	});
});

describe('the donor search', () => {
	it('answers with the donors matching what was typed, address beneath name', async () => {
		const response = await request(
			new Request(`${ORIGIN}/admin/donors/search?q=ohara`, { headers: { cookie: session } })
		);
		expect(response.status).toBe(200);
		const answer = (await response.json()) as { q: string; matches: unknown[] };
		expect(answer.q).toBe('ohara');
		expect(answer.matches).toEqual([
			{ id: DONOR_ID, displayName: 'Margaret O’Hara', primaryEmail: 'm.ohara@rivergate.example' }
		]);
	});
});
