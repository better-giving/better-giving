import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { rejectionCode } from '../db/rejection.testing';
import { createDestination } from './destinations';

// a destination as it is made, against a real D1: what is stored, what comes back once, and the
// address refused before anything is written. the https rule is held twice — here, where a caller
// hears why, and by `webhook_destination_url_check`, which the last case reaches past this module.

let db: Db;
beforeAll(() => {
	db = createDb(env.DB);
});

beforeEach(async () => {
	for (const table of ['webhook_delivery', 'webhook_destination_event', 'webhook_destination']) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
});

async function stored() {
	const { results } = await env.DB.prepare(
		`select d.id, d.url, d.signing_secret, d.paused_at, d.archived_at,
		        (select group_concat(e.event, ' ') from
		           (select event from webhook_destination_event where destination_id = d.id order by event) e
		        ) as events
		 from webhook_destination d`
	).all<Record<string, unknown>>();
	return results;
}

describe('createDestination()', () => {
	it('stores the address and the events it takes, and answers with its signing secret', async () => {
		const made = await createDestination(db, {
			url: 'https://crm.example.org/hooks/giving',
			events: ['gift.made', 'donor.added']
		});

		expect(made.ok).toBe(true);
		if (!made.ok) return;
		expect(await stored()).toEqual([
			{
				id: made.destination.id,
				url: 'https://crm.example.org/hooks/giving',
				signing_secret: made.destination.signingSecret,
				paused_at: null,
				archived_at: null,
				events: 'donor.added gift.made'
			}
		]);
	});

	it('mints a Standard Webhooks secret: whsec_ and the base64 of 32 random bytes', async () => {
		const first = await createDestination(db, {
			url: 'https://a.example.org/',
			events: ['gift.made']
		});
		const second = await createDestination(db, {
			url: 'https://b.example.org/',
			events: ['gift.made']
		});
		if (!first.ok || !second.ok) throw new Error('both destinations should have been made');

		for (const { signingSecret } of [first.destination, second.destination]) {
			expect(signingSecret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
			const bytes = Uint8Array.from(atob(signingSecret.slice('whsec_'.length)), (c) =>
				c.charCodeAt(0)
			);
			expect(bytes).toHaveLength(32);
		}
		expect(first.destination.signingSecret).not.toBe(second.destination.signingSecret);
	});

	it.each(['http://crm.example.org/hooks', 'ftp://crm.example.org/hooks', 'crm.example.org/hooks'])(
		'refuses %s and writes nothing',
		async (url) => {
			const made = await createDestination(db, { url, events: ['gift.made'] });

			expect(made).toEqual({
				ok: false,
				reason: 'not_https',
				detail: expect.stringContaining(url)
			});
			expect(await stored()).toEqual([]);
		}
	);

	it('stores the address as parsed, so a scheme typed in capitals is https', async () => {
		const made = await createDestination(db, {
			url: 'HTTPS://CRM.example.org/hooks',
			events: ['gift.made']
		});

		expect(made.ok && made.destination.url).toBe('https://crm.example.org/hooks');
	});

	it('leaves the database refusing an address that is not https, whoever writes it', async () => {
		const code = await rejectionCode(() =>
			env.DB.prepare(
				`insert into webhook_destination (id, url, signing_secret, created_at, updated_at)
				 values ('d', 'http://crm.example.org/', ?, 0, 0)`
			)
				.bind(`whsec_${btoa('x'.repeat(32))}`)
				.run()
		);
		expect(code).toContain('SQLITE_CONSTRAINT_CHECK');
	});

	it('leaves the database refusing an event outside the catalog, whoever writes it', async () => {
		const made = await createDestination(db, {
			url: 'https://a.example.org/',
			events: ['gift.made']
		});
		if (!made.ok) throw new Error(made.detail);

		const code = await rejectionCode(() =>
			env.DB.prepare(
				`insert into webhook_destination_event (destination_id, event) values (?, 'gift.created')`
			)
				.bind(made.destination.id)
				.run()
		);
		expect(code).toContain('SQLITE_CONSTRAINT_CHECK');
	});
});
