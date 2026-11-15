import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { STAFF_USER_ID } from '$lib/server/auth';
import { createDb, type Db } from '$lib/server/db/client';
import { mountRoutes, type RouteRequester } from '../route-request.testing';
import { deployedBindings, signInAsDeployer, signInAsMember } from '../staff-session.testing';
import * as layout from './_app';
import * as detail from './_app.admin.donations.$id';
import { client, first, run, stmt } from '$lib/server/db/database.testing';

// a gift's own page in /admin, against a real database, through the protected layout: who is signed
// in is what the names in the history and the Settings press turn on, and the session gate is that
// layout's middleware (../route-request.testing.ts). what each write refuses is
// `$lib/server/matching/match.db.spec.ts`; this file is the route — the projection, who a press is
// stamped by, and the answer each press comes back with.

const ORIGIN = 'https://give.example';
const PASSWORD = 'a-very-long-random-staff-password';
const DEPLOYMENT = { env: deployedBindings(PASSWORD), password: PASSWORD, origin: ORIGIN };

const DONOR_ID = '019fb800-0000-7000-8000-000000000001';
const GIFT_ID = '019fb800-0000-7000-8000-000000000002';
const SCREEN = `/admin/donations/${GIFT_ID}`;

let db: Db;
let request: RouteRequester;
let deployer: string;

beforeAll(() => {
	db = createDb(client);
	request = mountRoutes([
		{ path: undefined, module: layout },
		{ path: 'admin/donations/:id', module: detail }
	]);
});

beforeEach(async () => {
	for (const table of [
		'auth_member_invitation',
		'auth_session',
		'auth_user',
		'org_profile',
		'payment',
		'gift_match',
		'donation',
		'contact'
	]) {
		await run(stmt(`delete from ${table}`));
	}
	await run(
		stmt(
			`insert into contact (id, kind, display_name, primary_email, attributes, created_at, updated_at)
			 values (?, 'individual', 'Maya Reyes', 'maya@example.org', '{}', 0, 0)`,
			DONOR_ID
		)
	);
	await run(
		stmt(
			`insert into donation (id, contact_id, total_minor, currency, received_at, receipt_sent_at, created_at)
			 values (?, ?, 15000, 'USD', ?, ?, 0)`,
			GIFT_ID,
			DONOR_ID,
			Date.UTC(2026, 10, 12, 16),
			Date.UTC(2026, 10, 12, 16, 1)
		)
	);
	await run(
		stmt(
			`insert into payment (id, donation_id, amount_minor, currency, direction, method, status,
			                      provider, provider_txn_id, occurred_at, created_at)
			 values ('019fb800-0000-7000-8000-000000000003', ?, 15000, 'USD', 'inbound', 'card',
			         'succeeded', 'stripe', 'pi_detail1', 0, 0)`,
			GIFT_ID
		)
	);
	await profile({ address: true });
	deployer = await signInAsDeployer(db, DEPLOYMENT);
});

/** the organisation's profile, with a whole mailing address or with none. */
async function profile({ address }: { address: boolean }) {
	await run(stmt('delete from org_profile'));
	await run(
		stmt(
			`insert into org_profile (id, legal_name, tax_id, address_line1, city, country, notification_email, created_at, updated_at)
			 values ('default', 'Greenfield Food Bank', '12-3456789', ?, ?, ?, 'alerts@example.org', 0, 0)`,
			address ? '1 Main St' : null,
			address ? 'Springfield' : null,
			address ? 'US' : null
		)
	);
}

/** the gift's match row, holding these columns. */
async function matchRow(columns: Record<string, string | number> = {}) {
	const names = Object.keys(columns);
	await run(
		stmt(
			`insert into gift_match (id, donation_id, token, created_at${names.map((n) => `, ${n}`).join('')})
			 values ('019fb800-0000-7000-8000-000000000004', ?, 'abcdefghjkmnpqrstvwxyz0123456789', 0${names.map(() => ', ?').join('')})`,
			GIFT_ID,
			...Object.values(columns)
		)
	);
}

type Stamps = {
	filed_at: number | null;
	filed_by: string | null;
	matched_at: number | null;
	matched_by: string | null;
	voided_at: number | null;
	voided_by: string | null;
	void_reason: string | null;
};

async function stamps(): Promise<Stamps | null> {
	return first<Stamps>(
		stmt(
			`select filed_at, filed_by, matched_at, matched_by, voided_at, voided_by, void_reason
			 from gift_match where donation_id = ?`,
			GIFT_ID
		)
	);
}

/** the id of the one member a case signed in, beside the deployer. */
async function memberId(): Promise<string> {
	const row = await first<{ id: string }>(
		stmt('select id from auth_user where id <> ?', STAFF_USER_ID)
	);
	if (!row) throw new Error('no member signed in');
	return row.id;
}

function get(cookie: string, path = SCREEN): Promise<Response> {
	return request(new Request(`${ORIGIN}${path}`, { headers: { cookie } }), {
		env: DEPLOYMENT.env
	});
}

type Loaded = {
	gift: {
		donorName: string;
		donorEmail: string | null;
		amountMinor: number;
		currency: string;
		receivedAt?: string;
		paidWith: string | null;
		status: string;
		receiptSentAt: string | null;
	};
	match: {
		status: string | null;
		employer: string | null;
		history: { event: string; who: string; at: string; reason?: string }[];
	} | null;
	mailingAddressMissing: boolean;
	canOpenSettings: boolean;
};

async function load(cookie: string): Promise<Loaded> {
	const response = await get(cookie);
	expect(response.status).toBe(200);
	return (await response.json()) as Loaded;
}

/** a press on this screen, as the screen's own form posts it. */
function press(
	cookie: string,
	form: 'match-filed' | 'match-matched' | 'match-void',
	boxes: Record<string, string>
): Promise<Response> {
	const body = new FormData();
	body.set('__form_id__', form);
	for (const [name, value] of Object.entries(boxes)) body.set(name, value);
	return request(
		new Request(`${ORIGIN}${SCREEN}`, {
			method: 'POST',
			headers: { cookie, origin: ORIGIN },
			body
		}),
		{ env: DEPLOYMENT.env }
	);
}

const markFiled = (cookie: string) => press(cookie, 'match-filed', { intent: 'filed' });
const markMatched = (cookie: string) => press(cookie, 'match-matched', { intent: 'matched' });
const voidIt = (cookie: string, reason: string) =>
	press(cookie, 'match-void', { intent: 'void', reason });

describe('the gift and its match, as the page is handed them', () => {
	it('crosses the gift with its instants as ISO strings and its rail as a word', async () => {
		await matchRow();
		const { gift } = await load(deployer);
		expect(gift).toEqual({
			donorName: 'Maya Reyes',
			donorEmail: 'maya@example.org',
			amountMinor: 15000,
			currency: 'USD',
			receivedAt: '2026-11-12T16:00:00.000Z',
			paidWith: 'Card',
			status: 'completed',
			receiptSentAt: '2026-11-12T16:01:00.000Z'
		});
	});

	it('names the employer for staff, and every stamp’s author by name and never by id', async () => {
		const member = await signInAsMember(db, DEPLOYMENT);
		const nadia = await memberId();
		await matchRow({
			employer: 'Northwind',
			pack_sent_at: 1,
			filed_at: 2,
			filed_by: 'donor',
			matched_at: 3,
			matched_by: nadia
		});

		const loaded = await load(member);
		expect(loaded.match?.employer).toBe('Northwind');
		expect(loaded.match?.status).toBe('matched');
		expect(loaded.match?.history.map(({ event, who }) => [event, who])).toEqual([
			['pack_sent', 'system'],
			['filed', 'the donor'],
			['matched', 'Nadia Hart']
		]);
		expect(loaded.match?.history[0]?.at).toBe('1970-01-01T00:00:00.001Z');
		expect(JSON.stringify(loaded)).not.toContain(nadia);
	});

	it('names a member who has since been removed with a plain word', async () => {
		await matchRow({ filed_at: 1, filed_by: '019fb800-0000-7000-8000-0000000000ff' });
		const loaded = await load(deployer);
		expect(loaded.match?.history).toEqual([
			{ event: 'filed', who: 'a former member', at: '1970-01-01T00:00:00.001Z' }
		]);
		expect(JSON.stringify(loaded)).not.toContain('0000000000ff');
	});

	it('shows the void’s reason in the history', async () => {
		await matchRow({ voided_at: 1, voided_by: 'system', void_reason: 'Gift refunded' });
		const { match } = await load(deployer);
		expect(match?.history).toEqual([
			{ event: 'voided', who: 'system', at: '1970-01-01T00:00:00.001Z', reason: 'Gift refunded' }
		]);
	});

	it('draws a gift recorded before matching with no match', async () => {
		expect((await load(deployer)).match).toBeNull();
	});

	it('answers an id no gift has with a 404', async () => {
		const response = await get(deployer, '/admin/donations/019fb800-0000-7000-8000-0000000000aa');
		expect(response.status).toBe(404);
	});

	it('says the mailing address is missing, and who may open Settings to save it', async () => {
		await matchRow();
		await profile({ address: false });
		const member = await signInAsMember(db, DEPLOYMENT);

		expect(await load(deployer)).toMatchObject({
			mailingAddressMissing: true,
			canOpenSettings: true
		});
		expect(await load(member)).toMatchObject({
			mailingAddressMissing: true,
			canOpenSettings: false
		});

		await profile({ address: true });
		expect((await load(deployer)).mailingAddressMissing).toBe(false);
	});
});

describe('the three presses', () => {
	it('marks the match filed once, by the member who pressed', async () => {
		await matchRow({ employer: 'Northwind' });
		const member = await signInAsMember(db, DEPLOYMENT);

		const response = await markFiled(member);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ done: 'filed' });
		const once = await stamps();
		expect(once?.filed_by).toBe(await memberId());
		expect(once?.filed_at).not.toBeNull();

		const again = await markFiled(member);
		expect(again.status).toBe(409);
		expect(await again.json()).toMatchObject({
			error:
				'This match was already marked filed, so nothing changed. Reload the page to see how it stands.'
		});
		expect(await stamps()).toEqual(once);
	});

	it('marks the match matched once, by the member who pressed', async () => {
		await matchRow();
		const member = await signInAsMember(db, DEPLOYMENT);

		expect(await (await markMatched(member)).json()).toEqual({ done: 'matched' });
		const once = await stamps();
		expect(once?.matched_by).toBe(await memberId());
		expect(once?.filed_at).toBeNull();

		const again = await markMatched(member);
		expect(again.status).toBe(409);
		expect(await stamps()).toEqual(once);
	});

	it('voids the match once, with the reason and the member who pressed', async () => {
		await matchRow();
		const member = await signInAsMember(db, DEPLOYMENT);

		expect(await (await voidIt(member, '  Donor asked us to stop  ')).json()).toEqual({
			done: 'void'
		});
		const once = await stamps();
		expect(once).toMatchObject({
			voided_by: await memberId(),
			void_reason: 'Donor asked us to stop'
		});

		const again = await voidIt(member, 'A second reason');
		expect(again.status).toBe(409);
		expect(await again.json()).toMatchObject({
			error:
				'This match was already voided, so nothing changed. Reload the page to see how it stands.'
		});
		expect(await stamps()).toEqual(once);
	});

	it('refuses a void with a blank reason under the box, and writes nothing', async () => {
		await matchRow();
		const response = await voidIt(deployer, '   ');
		expect(response.status).toBe(400);
		const answered = (await response.json()) as {
			form: { id: string; result: { status: string; error: Record<string, string[]> } };
		};
		expect(answered.form.id).toBe('match-void');
		expect(answered.form.result.error.reason).toEqual(['required']);
		expect((await stamps())?.voided_at).toBeNull();
	});

	it('refuses a void once the employer’s money arrived, in a sentence', async () => {
		await matchRow({ matched_at: 1, matched_by: STAFF_USER_ID });
		const response = await voidIt(deployer, 'Changed our mind');
		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			error:
				'This match was already marked matched, so nothing changed. Reload the page to see how it stands.',
			// the pressed form's own rejection rides beside the sentence, so the dialog keeps its reason.
			form: { id: 'match-void', result: { status: 'error' } }
		});
		expect((await stamps())?.voided_at).toBeNull();
	});

	it('answers a press on a gift with no match with a 404', async () => {
		expect((await markFiled(deployer)).status).toBe(404);
	});

	it('stamps a press by the deployer under the staff row’s own name', async () => {
		await matchRow();
		await markFiled(deployer);
		expect((await stamps())?.filed_by).toBe(STAFF_USER_ID);
		expect((await load(deployer)).match?.history.map((row) => row.who)).toEqual(['Staff']);
	});
});
