import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createStaticHandler, type LoaderFunction, type MiddlewareFunction } from 'react-router';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '$lib/server/db/client';
import { client, first, stmt } from '$lib/server/db/database.testing';
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
import * as donatePage from './donate';
import * as donateMessages from './donate.messages';
import * as integrations from './integrations.v1';
import * as integrationGifts from './integrations.v1.gifts';
import * as integrationDonors from './integrations.v1.donors';

// the employer a donor names stays with staff: it reaches no public page, no donor message list,
// no connector read, no `/integrations/v1` read, no Zapier event and no webhook payload, and it
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
	const { formId } = await ensureDonationPage(db);
	({ donationId } = await noteGift(db, formId, {
		note: 'For the winter pantry',
		noteOnPage: 'named',
		firstName: 'Maya',
		lastName: 'Reyes',
		email: 'maya@example.org'
	}));
	const named = await nameEmployer(db, { donationId }, EMPLOYER, new Date());
	expect(named).toMatchObject({ ok: true, changed: true });
	const row = await first<{ id: string }>(
		stmt("select id from payment where donation_id = ? and direction = 'inbound'", donationId)
	);
	paymentId = row?.id ?? '';
});

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
				path: 'donate',
				middleware: donatePage.middleware as unknown as MiddlewareFunction[],
				loader: donatePage.loader as unknown as LoaderFunction
			}
		]);
		const answered = await queryDocument(
			handler,
			new Request(`${OWN}/donate`),
			requestContext({ env, deferred: createDeferredWork(), client })
		);
		expect(JSON.stringify(answered.loaderData.donate)).toContain('For the winter pantry');
		absent(answered.loaderData.donate);
	});

	it('the donation page’s message list, and the reader every fundraiser’s list shares', async () => {
		const more = mountRoutes([
			{ path: 'donate', module: donatePage },
			{ path: 'messages', module: donateMessages }
		]);
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

	it.each([
		['gifts', integrationGifts],
		['donors', integrationDonors]
	] as const)('the read API’s %s', async (path, module) => {
		const { key } = await mintApiKey(db, { name: `privacy ${path}`, kind: 'api' });
		const routes = mountRoutes([
			{ path: 'integrations/v1', module: integrations },
			{ path, module }
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
		expect(body).toContain('maya@example.org');
		absent(body);
	});

	it('the Zapier gift and donor events', async () => {
		const events = await readGiftEvents(db, [paymentId]);
		const gift = events.get(paymentId);
		expect(gift).toBeDefined();
		absent(gift);
		if (gift !== undefined) absent(donorEventOf(gift));
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
		expect((await readGiftPage(db, token?.token ?? ''))?.employer).toBe(EMPLOYER);
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
	const TABLE_IMPORT = /import\s*\{[^}]*\bgiftMatch\b[^}]*\}\s*from\s*'[^']*db\/schema'/;
	/** a raw statement reading the table. */
	const RAW_READ = /\b(?:from|join)\s+[`"']?gift_match\b/i;

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

	it('are the match’s own and the gifts list’s, and no surface besides', () => {
		const naming = sources(SRC)
			.filter((path) => {
				const text = readFileSync(path, 'utf8');
				return TABLE_IMPORT.test(text) || RAW_READ.test(text);
			})
			.map((path) => relative(SRC, path));
		expect(naming.sort()).toEqual([...READERS].sort());
	});
});
