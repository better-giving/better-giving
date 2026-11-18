import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createStaticHandler, type LoaderFunction, type MiddlewareFunction } from 'react-router';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '$lib/server/db/client';
import { client, first, run, stmt } from '$lib/server/db/database.testing';
import { readSendable } from '$lib/server/accounting/record';
import { recordConnectorGift } from '$lib/server/connector/record';
import { defaultCampaign } from '$lib/page/defaults';
import { NEW_FORM } from '$lib/forms/new-form';
import { page } from '$lib/server/db/schema';
import { parseFormInput } from '$lib/server/forms/form-input';
import { ownedFormInsert } from '$lib/server/forms/queries';
import {
	listDonations as connectorGifts,
	listDonors,
	readDonor
} from '$lib/server/connector/reads';
import { listDonations } from '$lib/server/donations/queries';
import { edgeCache } from '$lib/server/edge-cache.testing';
import { mintApiKey } from '$lib/server/integrations/keys';
import { nameEmployer } from '$lib/server/matching/match';
import { readGiftPage, readStaffMatch } from '$lib/server/matching/views';
import { writeOrgRow } from '$lib/server/org/org-row.testing';
import { ensureDonationPage } from '$lib/server/pages/donation-page';
import { readShownMessages } from '$lib/server/pages/messages';
import { noteGift } from '$lib/server/pages/settled-gifts.testing';
import { CLIENT_IP_HEADER } from '$lib/server/runtime/client-ip';
import { createDeferredWork } from '$lib/server/runtime/deferred';
import { readEnv } from '$lib/server/runtime/env';
import { specRateLimiters } from '$lib/server/runtime/rate-limiter.testing';
import { renderSubjects } from '$lib/server/webhooks/payload';
import { donorEventOf, readGiftEvents } from '$lib/server/zapier/payload';
import { requestContext } from '../request-context';
import { mountRoutes, queryDocument } from '../route-request.testing';
import * as donatePage from './_index';
import * as donateMessages from './donate_.messages';
import * as integrations from './integrations.v1';
import * as integrationGifts from './integrations.v1.gifts';
import * as integrationDonors from './integrations.v1.donors';
import * as integrationRecurring from './integrations.v1.recurring-gifts';
import * as statusPoll from './api.v1.forms.$id.donations.$donationId';
import * as apiSurface from './api.v1';
import * as campaignPage from './$slug';

// the employer a donor names stays with staff: it reaches no public page, no donor message list,
// no connector read or record, no `/integrations/v1` read, no Zapier event, no webhook payload, no
// accounting entry sent to the books, and no answer of the public form API, and it
// does reach /admin's gifts list and gift detail. one gift is seeded through the real quote and
// settlement path, its employer named with a string nothing else holds, and every surface's answer
// is searched for it.
//
// the second half is a source scan, as the `sole-*.spec.ts` gates are: only the modules named in
// `READERS` may import the `gift_match` table or read it in raw SQL, so a surface that starts
// selecting from it fails here before any response carries the employer.

const EMPLOYER = 'Quillfeather Zeppelin Works 7731';
const OWN = 'https://give.example.workers.dev';
const STRIPE = {
	STRIPE_SECRET_KEY: 'sk_test_abc',
	STRIPE_PUBLISHABLE_KEY: 'pk_test_abc',
	STRIPE_WEBHOOK_SECRET: 'whsec_abc'
};
const env = { ...readEnv({}, specRateLimiters()), ...STRIPE } as Env;
const db = createDb(client);

let donationId: string;
let paymentId: string;
let contactId: string;
let formId: string;
let campaignDonationId: string;
let caller = 0;

beforeAll(async () => {
	await writeOrgRow(client, { tax_id: '12-3456789' });
	// the served cadences, warmed so the donor page never sends the fixture key to Stripe.
	await edgeCache().put(
		new Request(`${OWN}/__recurring-cadences`),
		new Response(JSON.stringify(['one_time']), {
			headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' }
		})
	);
	({ formId } = await ensureDonationPage(db));
	({ donationId } = await noteGift(db, formId, {
		note: 'For the winter pantry',
		noteOnPage: 'named',
		firstName: 'Maya',
		lastName: 'Reyes',
		email: 'maya@example.org'
	}));
	const named = await nameEmployer(db, { donationId }, EMPLOYER);
	expect(named).toMatchObject({ ok: true, changed: true });
	const row = await first<{ id: string }>(
		stmt("select id from payment where donation_id = ? and direction = 'inbound'", donationId)
	);
	paymentId = row?.id ?? '';
	const owner = await first<{ contact_id: string }>(
		stmt('select contact_id from donation where id = ?', donationId)
	);
	contactId = owner?.contact_id ?? '';
	await seedRecurringPlan(formId, contactId);
	await seedCryptoGift(formId, contactId);
	await seedCampaign();
});

/** a commitment of the seeded donor, in raw SQL as `sole-inserter.spec.ts` asks of a fixture. */
async function seedRecurringPlan(onForm: string, donor: string): Promise<void> {
	const at = Date.UTC(2026, 8, 10, 12);
	await run(
		stmt(
			`insert into recurring_plan (id, contact_id, form_id, amount_minor, currency, interval,
			                             status, provider, provider_subscription_id,
			                             provider_customer_id, started_at, next_charge_at, ended_at,
			                             created_at, updated_at)
			 values (?, ?, ?, 2500, 'USD', 'monthly', 'active',
			         'stripe', 'sub_privacy', 'cus_privacy', ?, ?, null, ?, ?)`,
			PLAN_ID,
			donor,
			onForm,
			at,
			at + 30 * 24 * 60 * 60_000,
			at,
			at
		)
	);
}

/** a crypto gift still awaited on the form, with its employer named: what the status poll reads. */
async function seedCryptoGift(onForm: string, donor: string): Promise<void> {
	const id = '019fb900-0000-7000-8000-0000000000b1';
	await run(
		stmt(
			`insert into donation (id, contact_id, total_minor, currency, received_at, form_id, created_at)
			 values (?, ?, 10000, 'USD', 0, ?, 0)`,
			id,
			donor,
			onForm
		)
	);
	await run(
		stmt(
			`insert into payment (id, donation_id, amount_minor, currency, direction, method, status,
			                      provider, provider_txn_id, occurred_at, created_at,
			                      coin, coin_network, valid_until)
			 values ('019fb900-0000-7000-8000-0000000000b2', ?, 10000, 'USD', 'inbound', 'crypto',
			         'pending', 'nowpayments', 'np_privacy', 0, 0, 'usdttrc20', 'trx', 0)`,
			id
		)
	);
	await run(
		stmt(
			'insert into gift_match (id, donation_id, token, created_at) values (?, ?, ?, 0)',
			'019fb900-0000-7000-8000-0000000000b3',
			id,
			'0123456789abcdefghjkmnpqrstvwxyz'
		)
	);
	expect(await nameEmployer(db, { donationId: id }, EMPLOYER)).toMatchObject({ ok: true });
}

const PLAN_ID = '019fb900-0000-7000-8000-0000000000a1';
const CAMPAIGN_SLUG = 'privacy-drive';
const CAMPAIGN_NOTE = 'For the campaign pantry';

/** a live campaign with one named note from a gift whose employer is named. */
async function seedCampaign(): Promise<void> {
	const settings = parseFormInput({ ...NEW_FORM, name: 'Privacy drive', status: 'live' });
	if (!settings.ok)
		throw new Error(`the fixture settings did not parse: ${JSON.stringify(settings)}`);
	const owned = ownedFormInsert(db, settings.value);
	await db.batch([
		owned.statement,
		db.insert(page).values({
			type: 'campaign',
			name: 'Privacy drive',
			slug: CAMPAIGN_SLUG,
			state: 'live',
			formId: owned.id,
			draft: JSON.stringify(defaultCampaign()),
			published: JSON.stringify(defaultCampaign())
		})
	]);
	({ donationId: campaignDonationId } = await noteGift(db, owned.id, {
		note: CAMPAIGN_NOTE,
		noteOnPage: 'named',
		firstName: 'Priya',
		lastName: 'Nair',
		email: 'priya@example.org'
	}));
	expect(await nameEmployer(db, { donationId: campaignDonationId }, EMPLOYER)).toMatchObject({
		ok: true
	});
}

const absent = (answer: unknown) => {
	const text = typeof answer === 'string' ? answer : JSON.stringify(answer);
	expect(text.length).toBeGreaterThan(2);
	expect(text).not.toContain(EMPLOYER);
};

describe('the employer is absent from', () => {
	it('the public donation page', async () => {
		const handler = createStaticHandler([
			{
				id: 'donate',
				path: '/',
				middleware: donatePage.middleware as unknown as MiddlewareFunction[],
				loader: donatePage.loader as unknown as LoaderFunction
			}
		]);
		const answered = await queryDocument(
			handler,
			new Request(`${OWN}/`),
			requestContext({ env, deferred: createDeferredWork(), client })
		);
		expect(JSON.stringify(answered.loaderData.donate)).toContain('For the winter pantry');
		absent(answered.loaderData.donate);
	});

	it('the donation page’s message list, and the reader every fundraiser’s list shares', async () => {
		const more = mountRoutes([{ path: 'donate/messages', module: donateMessages }]);
		const answer = await more(
			new Request(`${OWN}/donate/messages`, {
				headers: { [CLIENT_IP_HEADER]: '2001:db8:7731::1' }
			}),
			{ env }
		);
		absent(await answer.text());
		absent(await readShownMessages(db, null));
	});

	it('the connector’s gift and donor reads', async () => {
		const gifts = await connectorGifts(db, new URL(`${OWN}/connector/v1/donations`));
		expect(JSON.stringify(gifts)).toContain('maya@example.org');
		absent(gifts);
		absent(await listDonors(db, new URL(`${OWN}/connector/v1/donors`)));
		const contact = await first<{ contact_id: string }>(
			stmt('select contact_id from donation where id = ?', donationId)
		);
		const id = contact?.contact_id ?? '';
		const donor = await readDonor(db, id, new URL(`${OWN}/connector/v1/donors/${id}`));
		expect(donor).toMatchObject({ ok: true });
		absent(donor);
	});

	// each read names what proves it answered with the seeded donor, so a read that came back empty
	// is not mistaken for one that held back the employer.
	it.each([
		['gifts', 'gifts', integrationGifts, 'maya@example.org'],
		[
			'gifts changed since a date',
			'gifts?updated_since=2000-01-01T00:00:00Z',
			integrationGifts,
			'maya@example.org'
		],
		['donors', 'donors', integrationDonors, 'maya@example.org'],
		['recurring gifts', 'recurring-gifts', integrationRecurring, PLAN_ID]
	] as const)('the read API’s %s', async (label, path, module, proves) => {
		const { key } = await mintApiKey(db, { name: `privacy ${label}`, kind: 'api' });
		const routes = mountRoutes([
			{ path: 'integrations/v1', module: integrations },
			{ path: path.split('?')[0] ?? path, module }
		]);
		caller += 1;
		const answer = await routes(
			new Request(`${OWN}/integrations/v1/${path}`, {
				headers: { authorization: `Bearer ${key}`, [CLIENT_IP_HEADER]: `198.51.100.${caller}` }
			}),
			{ env }
		);
		expect(answer.status).toBe(200);
		const body = await answer.text();
		expect(body).toContain(proves);
		absent(body);
	});

	it('the connector’s record of a gift, as first answered and as answered again', async () => {
		const call = {
			amount: { amount: '250.00', currency: 'USD' },
			date: '2026-09-03',
			donor: { name: 'Maya Reyes', email: 'maya@example.org' },
			method: 'check',
			note: 'envelope at the spring fair'
		};
		const recorded = await recordConnectorGift(db, 'privacy-key', 'privacy-record-1', call);
		if (!recorded.ok) throw new Error(`the fixture gift was not recorded: ${recorded.detail}`);
		expect(recorded.status).toBe(201);
		const named = await nameEmployer(db, { donationId: recorded.gift.donation_id }, EMPLOYER);
		expect(named).toMatchObject({ ok: true, changed: true });

		const again = await recordConnectorGift(db, 'privacy-key', 'privacy-record-1', call);

		expect(again).toMatchObject({ ok: true, status: 200 });
		expect(JSON.stringify(again)).toContain('envelope at the spring fair');
		absent(recorded);
		absent(again);
	});

	it('the Zapier gift and donor events', async () => {
		const gift = (await readGiftEvents(db, [paymentId])).get(paymentId);
		if (gift === undefined) throw new Error('the seeded gift is not a Zapier gift event');
		expect(gift).toMatchObject({ donor_email: 'maya@example.org' });
		absent(gift);
		absent(donorEventOf(gift));
	});

	it('the webhook payloads', async () => {
		const subjects = [
			{ event: 'gift.made', subjectId: paymentId, detail: null },
			{ event: 'donor.added', subjectId: paymentId, detail: null }
		] as const;
		const rendered = await renderSubjects(db, subjects);
		for (const subject of subjects) absent(rendered(subject));
	});
});

describe('the employer is absent from, continued', () => {
	it('the entry the books are sent for the gift', async () => {
		const group = await first<{ id: string }>(
			stmt("select id from entry_group where source_type = 'payment' and source_id = ?", paymentId)
		);
		const sendable = await readSendable(db, group?.id ?? '');
		expect(sendable).toMatchObject({ ok: true, value: { kind: 'gift' } });
		expect(JSON.stringify(sendable)).toContain('maya@example.org');
		absent(sendable);
	});

	it('a campaign’s page at its address', async () => {
		const handler = createStaticHandler([
			{
				id: 'campaign',
				path: ':slug',
				middleware: campaignPage.middleware as unknown as MiddlewareFunction[],
				loader: campaignPage.loader as unknown as LoaderFunction
			}
		]);
		const answered = await queryDocument(
			handler,
			new Request(`${OWN}/${CAMPAIGN_SLUG}`),
			requestContext({ env, deferred: createDeferredWork(), client })
		);
		expect(JSON.stringify(answered.loaderData.campaign)).toContain('Privacy drive');
		absent(answered.loaderData.campaign);
	});

	it('the public form API’s status poll of a gift', async () => {
		const routes = mountRoutes([
			{ path: 'api/v1', module: apiSurface },
			{ path: 'forms/:id/donations/:donationId', module: statusPoll }
		]);
		const answer = await routes(
			new Request(`${OWN}/api/v1/forms/${formId}/donations/019fb900-0000-7000-8000-0000000000b1`, {
				headers: { [CLIENT_IP_HEADER]: '203.0.113.77' }
			}),
			{ env }
		);
		expect(answer.status).toBe(200);
		const body = await answer.text();
		expect(JSON.parse(body)).toEqual({ state: 'waiting' });
		absent(body);
	});
});

describe('the employer is present for staff', () => {
	it('on the gifts list and the gift detail', async () => {
		const { donations } = await listDonations(db);
		expect(donations.find((d) => d.id === donationId)?.match?.employer).toBe(EMPLOYER);
		expect((await readStaffMatch(db, donationId))?.match?.employer).toBe(EMPLOYER);
	});

	it('and on the donor’s own gift page, which only its token reaches', async () => {
		const token = await first<{ token: string }>(
			stmt('select token from gift_match where donation_id = ?', donationId)
		);
		expect((await readGiftPage(db, token?.token ?? '', true))?.employer).toBe(EMPLOYER);
	});
});

describe('the modules that may read the employer', () => {
	const SRC = resolve(import.meta.dirname, '..');
	/** the match's own modules, and the gifts list's read, which is /admin's alone. */
	const READERS = [
		'lib/server/matching/match.ts',
		'lib/server/matching/pack.ts',
		'lib/server/matching/reminders.ts',
		'lib/server/matching/views.ts',
		'lib/server/donations/queries.ts'
	];

	/** `giftMatch` imported from the schema, in any import list. */
	const TABLE_IMPORT = /import\s*\{[^}]*\bgiftMatch\b[^}]*\}\s*from\s*['"][^'"]*db\/schema['"]/;
	/** the schema imported whole, under the name its namespace is bound to. */
	const NAMESPACE_IMPORT = /import\s*\*\s*as\s+(\w+)\s+from\s*['"][^'"]*db\/schema['"]/g;
	/** a raw statement reading the table. */
	const RAW_READ = /\b(?:from|join)\s+[`"']?gift_match\b/i;

	/** whether `text` reaches the table: by import, through a namespace import, or in raw SQL. */
	function readsTable(text: string): boolean {
		if (TABLE_IMPORT.test(text) || RAW_READ.test(text)) return true;
		for (const [, binding] of text.matchAll(NAMESPACE_IMPORT)) {
			if (new RegExp(`\\b${binding}\\s*\\.\\s*giftMatch\\b`).test(text)) return true;
		}
		return false;
	}

	function sources(dir: string, out: string[] = []): string[] {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) sources(path, out);
			else if (/\.[jt]sx?$/.test(entry.name) && !/\.(?:spec|testing)\.[jt]sx?$/.test(entry.name)) {
				out.push(path);
			}
		}
		return out;
	}

	it.each([
		['a named import', "import { giftMatch } from '$lib/server/db/schema';", true],
		['a double-quoted import', 'import { giftMatch } from "../db/schema";', true],
		[
			'a namespace import reached by property',
			"import * as tables from '$lib/server/db/schema';\nconst t = tables.giftMatch;",
			true
		],
		['raw SQL', "const q = 'select * from gift_match';", true],
		[
			'a namespace import that never names the table',
			"import * as tables from '$lib/server/db/schema';\nconst t = tables.donation;",
			false
		],
		['a mention in a name that only contains it', 'const giftMatchesShown = 3;', false]
	])('sees %s', (_, text, reads) => {
		expect(readsTable(text)).toBe(reads);
	});

	it('are the match’s own and the gifts list’s, and no surface besides', () => {
		const naming = sources(SRC)
			.filter((path) => readsTable(readFileSync(path, 'utf8')))
			.map((path) => relative(SRC, path));
		expect(naming.sort()).toEqual([...READERS].sort());
	});
});
