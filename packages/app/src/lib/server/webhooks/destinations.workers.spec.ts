import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { rejectionCode } from '../db/rejection.testing';
import { sql } from 'drizzle-orm';
import {
	createDestination,
	deleteDestination,
	resumeDestination,
	updateDestination
} from './destinations';
import {
	recurringGiftChangeWebhookStatements,
	recurringGiftStartedWebhookStatements
} from './events';

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

	it.each([
		'http://crm.example.org/hooks',
		'ftp://crm.example.org/hooks',
		'wss://crm.example.org/hooks'
	])('refuses %s, not https, and writes nothing', async (url) => {
		const made = await createDestination(db, { url, events: ['gift.made'] });

		expect(made).toEqual({
			ok: false,
			reason: 'not_https',
			field: 'url',
			box: 'must start with https://'
		});
		expect(await stored()).toEqual([]);
	});

	it.each(['https://exa mple.org/hooks', 'https://', 'https://crm.example.org:99999/'])(
		'refuses %s, which is no web address at all, and writes nothing',
		async (url) => {
			const made = await createDestination(db, { url, events: ['gift.made'] });

			expect(made).toEqual({
				ok: false,
				reason: 'not_an_address',
				field: 'url',
				box: 'isn’t a web address: check it for a space or a stray character'
			});
			expect(await stored()).toEqual([]);
		}
	);

	it('refuses a destination that takes no events, and writes nothing', async () => {
		const made = await createDestination(db, { url: 'https://crm.example.org/', events: [] });

		expect(made).toEqual({
			ok: false,
			reason: 'no_events',
			field: 'events',
			box: 'choose at least one'
		});
		expect(await stored()).toEqual([]);
	});

	it.each([
		['https://localhost/hooks', 'localhost names the machine the post is sent from'],
		['https://api.localhost/hooks', 'api.localhost names the machine the post is sent from'],
		['https://127.0.0.1/hooks', '127.0.0.1 is a loopback address'],
		['https://10.1.2.3/hooks', '10.1.2.3 is a private network address'],
		['https://172.20.0.9/hooks', '172.20.0.9 is a private network address'],
		['https://192.168.1.20/hooks', '192.168.1.20 is a private network address'],
		['https://169.254.169.254/latest', '169.254.169.254 is a link-local address'],
		['https://0x7f000001/hooks', '127.0.0.1 is a loopback address'],
		['https://[::1]/hooks', '[::1] is a loopback address'],
		['https://[fe80::1]/hooks', '[fe80::1] is a link-local address'],
		['https://[fd12:3456::1]/hooks', '[fd12:3456::1] is a unique local address'],
		['https://[::ffff:10.0.0.1]/hooks', '[::ffff:a00:1] is a private network address'],
		['https://crm.local/hooks', 'crm.local names a host on a local network'],
		['https://crm.local./hooks', 'crm.local. names a host on a local network'],
		['https://db.corp.internal/hooks', 'db.corp.internal names a host on an internal network'],
		['https://0.0.0.0/hooks', '0.0.0.0 is an address on no network'],
		['https://0/hooks', '0.0.0.0 is an address on no network'],
		['https://100.64.0.7/hooks', '100.64.0.7 is a carrier-grade NAT address'],
		['https://100.127.255.1/hooks', '100.127.255.1 is a carrier-grade NAT address'],
		['https://198.18.0.1/hooks', '198.18.0.1 is a benchmarking address'],
		['https://198.19.255.1/hooks', '198.19.255.1 is a benchmarking address'],
		['https://224.0.0.1/hooks', '224.0.0.1 is a multicast or reserved address'],
		['https://255.255.255.255/hooks', '255.255.255.255 is a multicast or reserved address'],
		['https://[::]/hooks', '[::] is an address on no network'],
		['https://[::127.0.0.1]/hooks', '[::7f00:1] is an IPv4-compatible address'],
		['https://[64:ff9b::7f00:1]/hooks', '[64:ff9b::7f00:1] is a NAT64 address'],
		['https://[2002:7f00:1::]/hooks', '[2002:7f00:1::] is a 6to4 address'],
		['https://[::ffff:0:7f00:1]/hooks', '[::ffff:0:7f00:1] is an IPv4-translated address'],
		['https://[fec0::1]/hooks', '[fec0::1] is a site-local address'],
		['https://intranet/hooks', 'intranet has no domain'],
		['https:/x', 'x has no domain'],
		['https://printer.home.arpa/hooks', 'printer.home.arpa names a host on a home network'],
		['https://192.0.0.9/hooks', '192.0.0.9 is a protocol assignment address'],
		['https://192.0.2.1/hooks', '192.0.2.1 is a documentation address'],
		['https://198.51.100.7/hooks', '198.51.100.7 is a documentation address'],
		['https://203.0.113.7/hooks', '203.0.113.7 is a documentation address'],
		['https://[2001::1]/hooks', '[2001::1] is a Teredo address'],
		['https://[2001:0:4136:e378::1]/hooks', '[2001:0:4136:e378::1] is a Teredo address'],
		['https://[2001:db8::1]/hooks', '[2001:db8::1] is a documentation address'],
		['https://[64:ff9b:1::a00:1]/hooks', '[64:ff9b:1::a00:1] is a NAT64 address'],
		['https://[100::1]/hooks', '[100::1] is a discard-only address']
	])('refuses %s, a host the internet cannot reach, and writes nothing', async (url, why) => {
		const made = await createDestination(db, { url, events: ['gift.made'] });

		expect(made).toEqual({
			ok: false,
			reason: 'not_public',
			field: 'url',
			box: `must be reachable from the internet: ${why}`
		});
		expect(await stored()).toEqual([]);
	});

	it.each([
		'https://203.0.114.7/hooks',
		'https://192.0.3.1/hooks',
		'https://198.51.101.7/hooks',
		'https://172.32.0.1/hooks',
		'https://[2001:4860::8888]/hooks',
		'https://[2001:db9::1]/hooks',
		'https://[64:ff9b:2::1]/hooks',
		'https://[100:0:0:1::1]/hooks',
		'https://local.example.org/hooks',
		'https://internal.example.org/hooks',
		'https://100.63.255.1/hooks',
		'https://100.128.0.1/hooks',
		'https://198.20.0.1/hooks',
		'https://223.255.255.1/hooks',
		'https://[2003::1]/hooks',
		'https://[64:ff9c::1]/hooks'
	])('takes %s, a public host', async (url) => {
		expect((await createDestination(db, { url, events: ['gift.made'] })).ok).toBe(true);
	});

	it.each([
		'https://user:secret@crm.example.org/hooks',
		'https://token@crm.example.org/hooks',
		'https://:secret@crm.example.org/hooks',
		'user:secret@crm.example.org/hooks',
		'https:\\\\user:secret@crm.example.org/hooks',
		'https:/\\token@crm.example.org/hooks'
	])('refuses %s, which carries a user name or password, and writes nothing', async (url) => {
		const made = await createDestination(db, { url, events: ['gift.made'] });

		expect(made).toEqual({
			ok: false,
			reason: 'has_credentials',
			field: 'url',
			box: 'can’t carry a user name or password: remove everything up to and including the @'
		});
		expect(await stored()).toEqual([]);
	});

	it('takes an address typed without a scheme as https', async () => {
		const made = await createDestination(db, {
			url: '  crm.example.org/hooks ',
			events: ['gift.made']
		});

		expect(made.ok && made.destination.url).toBe('https://crm.example.org/hooks');
	});

	it('takes a host and port typed without a scheme as https', async () => {
		const made = await createDestination(db, {
			url: 'crm.example.org:8443/hooks',
			events: ['gift.made']
		});

		expect(made.ok && made.destination.url).toBe('https://crm.example.org:8443/hooks');
	});

	it('reads https with one slash as the scheme it is, never as a host named https', async () => {
		const made = await createDestination(db, {
			url: 'https:/crm.example.org/hooks',
			events: ['gift.made']
		});

		expect(made.ok && made.destination.url).toBe('https://crm.example.org/hooks');
	});

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
		if (!made.ok) throw new Error(made.box);

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

describe('resumeDestination()', () => {
	const NOW = new Date('2026-09-28T12:00:00.000Z');

	async function made() {
		const created = await createDestination(db, {
			url: 'https://crm.example.org/hooks/giving',
			events: ['gift.made']
		});
		if (!created.ok) throw new Error(created.box);
		return created.destination.id;
	}

	it('refuses a destination that does not exist, naming the id', async () => {
		const id = '019fb300-0000-7000-8000-00000000dead';

		expect(await resumeDestination(db, id, NOW)).toEqual({
			ok: false,
			reason: 'not_found',
			detail: `No destination has the id ${id}.`
		});
	});

	it('refuses a deleted destination as not found, and re-queues none of its rows', async () => {
		const id = await made();
		await env.DB.prepare(
			'update webhook_destination set paused_at = 1, failing_since = 1, archived_at = 2 where id = ?'
		)
			.bind(id)
			.run();
		await env.DB.prepare(
			`insert into webhook_delivery (id, destination_id, event, subject_id, status, attempts,
			   next_attempt_at, created_at, updated_at)
			 values (?, ?, 'gift.made', 'pay_1', 'failed', 3, 5, 0, 5)`
		)
			.bind(`msg_${crypto.randomUUID()}`, id)
			.run();

		expect(await resumeDestination(db, id, NOW)).toEqual({
			ok: false,
			reason: 'not_found',
			detail: `No destination has the id ${id}.`
		});
		expect(await env.DB.prepare('select status, attempts from webhook_delivery').first()).toEqual({
			status: 'failed',
			attempts: 3
		});
		expect(await env.DB.prepare('select paused_at from webhook_destination').first()).toEqual({
			paused_at: 1
		});
	});

	it('refuses a destination that is not paused, and re-queues none of its rows', async () => {
		const id = await made();
		await env.DB.prepare(
			`insert into webhook_delivery (id, destination_id, event, subject_id, status, attempts,
			   next_attempt_at, created_at, updated_at)
			 values (?, ?, 'gift.made', 'pay_1', 'pending', 3, ?, 0, 0)`
		)
			.bind(`msg_${crypto.randomUUID()}`, id, NOW.getTime() + 60_000)
			.run();

		expect(await resumeDestination(db, id, NOW)).toMatchObject({
			ok: false,
			reason: 'not_paused'
		});
		expect(
			await env.DB.prepare('select attempts, next_attempt_at from webhook_delivery').first()
		).toEqual({ attempts: 3, next_attempt_at: NOW.getTime() + 60_000 });
	});

	it('clears the pause and the failing mark, and a second resume is refused', async () => {
		const id = await made();
		await env.DB.prepare(
			'update webhook_destination set paused_at = 1, failing_since = 1 where id = ?'
		)
			.bind(id)
			.run();

		expect(await resumeDestination(db, id, NOW)).toEqual({ ok: true, requeued: 0 });
		expect(
			await env.DB.prepare('select paused_at, failing_since from webhook_destination').first()
		).toEqual({ paused_at: null, failing_since: null });
		expect(await resumeDestination(db, id, NOW)).toMatchObject({
			ok: false,
			reason: 'not_paused'
		});
	});
});

describe('updateDestination()', () => {
	async function made(events: Parameters<typeof createDestination>[1]['events']) {
		const created = await createDestination(db, {
			url: 'https://crm.example.org/hooks/giving',
			events
		});
		if (!created.ok) throw new Error(created.box);
		return created.destination.id;
	}

	/** a commitment starting and changing, which owes whichever destinations take each event. */
	async function planStartsAndChanges(planId: string) {
		await db.batch([
			...recurringGiftStartedWebhookStatements(db, { id: planId, status: 'active' }),
			recurringGiftChangeWebhookStatements(db, 'recurring_gift.updated', planId, sql`1`)
		]);
	}

	async function owed() {
		const { results } = await env.DB.prepare(
			'select event, subject_id from webhook_delivery order by event, subject_id'
		).all<{ event: string; subject_id: string }>();
		return results.map((row) => `${row.event} ${row.subject_id.split(':')[0]}`);
	}

	it('stops the events taken off and starts the ones added, for events after it', async () => {
		const id = await made(['recurring_gift.started']);
		await planStartsAndChanges('plan_before');

		expect(
			await updateDestination(db, id, {
				url: 'https://crm.example.org/hooks/giving',
				events: ['recurring_gift.updated']
			})
		).toEqual({ ok: true });
		await planStartsAndChanges('plan_after');

		expect(await owed()).toEqual([
			'recurring_gift.started plan_before',
			'recurring_gift.updated plan_after'
		]);
	});

	it('moves the address, and keeps the signing secret', async () => {
		const id = await made(['gift.made']);
		const before = await stored();

		await updateDestination(db, id, { url: 'crm.example.net/hooks', events: ['gift.made'] });

		expect(await stored()).toEqual([
			{ ...before[0], url: 'https://crm.example.net/hooks', events: 'gift.made' }
		]);
	});

	it('refuses an address it would not make a destination with, and changes nothing', async () => {
		const id = await made(['gift.made']);
		const before = await stored();

		expect(
			await updateDestination(db, id, { url: 'https://10.0.0.8/hooks', events: ['donor.added'] })
		).toMatchObject({ ok: false, reason: 'not_public' });
		expect(await stored()).toEqual(before);
	});

	it('refuses to leave it taking no events, and changes nothing', async () => {
		const id = await made(['gift.made']);
		const before = await stored();

		expect(
			await updateDestination(db, id, { url: 'https://crm.example.net/hooks', events: [] })
		).toEqual({ ok: false, reason: 'no_events', field: 'events', box: 'choose at least one' });
		expect(await stored()).toEqual(before);
	});

	it('refuses a destination that was deleted, or never was, as not found', async () => {
		const id = await made(['gift.made']);
		await env.DB.prepare('update webhook_destination set archived_at = 1 where id = ?')
			.bind(id)
			.run();
		const before = await stored();

		for (const which of [id, '019fb300-0000-7000-8000-00000000dead']) {
			expect(
				await updateDestination(db, which, { url: 'https://a.example.org/', events: ['gift.made'] })
			).toEqual({ ok: false, reason: 'not_found', detail: `No destination has the id ${which}.` });
		}
		expect(await stored()).toEqual(before);
	});
});

describe('deleteDestination()', () => {
	const NOW = new Date('2026-09-28T12:00:00.000Z');

	async function made() {
		const created = await createDestination(db, {
			url: 'https://crm.example.org/hooks/giving',
			events: ['recurring_gift.started']
		});
		if (!created.ok) throw new Error(created.box);
		return created.destination.id;
	}

	async function row(subject: string, status: string, destinationId: string) {
		await env.DB.prepare(
			`insert into webhook_delivery (id, destination_id, event, subject_id, status, attempts,
			   next_attempt_at, delivered_at, created_at, updated_at)
			 values (?, ?, 'gift.made', ?, ?, 1, 0, ?, 0, 0)`
		)
			.bind(
				`msg_${crypto.randomUUID()}`,
				destinationId,
				subject,
				status,
				status === 'delivered' ? 1 : null
			)
			.run();
	}

	async function rows() {
		const { results } = await env.DB.prepare(
			'select subject_id, status, last_error, updated_at from webhook_delivery order by subject_id'
		).all();
		return results;
	}

	it('drops what it was still owed, keeps what it was sent, and owes it nothing new', async () => {
		const id = await made();
		const other = await made();
		await row('a_pending', 'pending', id);
		await row('b_delivered', 'delivered', id);
		await row('c_failed', 'failed', id);
		await row('d_other', 'pending', other);

		expect(await deleteDestination(db, id, NOW)).toEqual({
			ok: true,
			url: 'https://crm.example.org/hooks/giving'
		});
		await db.batch([
			...recurringGiftStartedWebhookStatements(db, { id: 'plan_1', status: 'active' })
		]);

		expect(await rows()).toEqual([
			{
				subject_id: 'a_pending',
				status: 'dropped',
				last_error: 'Its destination was deleted.',
				updated_at: NOW.getTime()
			},
			{ subject_id: 'b_delivered', status: 'delivered', last_error: null, updated_at: 0 },
			{ subject_id: 'c_failed', status: 'failed', last_error: null, updated_at: 0 },
			{ subject_id: 'd_other', status: 'pending', last_error: null, updated_at: 0 },
			{ subject_id: 'plan_1', status: 'pending', last_error: null, updated_at: expect.any(Number) }
		]);
		expect(
			await env.DB.prepare('select archived_at from webhook_destination where id = ?')
				.bind(id)
				.first()
		).toEqual({ archived_at: NOW.getTime() });
	});

	it('refuses one already deleted, or never made, as not found, and drops nothing', async () => {
		const id = await made();
		await deleteDestination(db, id, NOW);
		await row('late', 'pending', id);

		for (const which of [id, '019fb300-0000-7000-8000-00000000dead']) {
			expect(await deleteDestination(db, which, NOW)).toEqual({
				ok: false,
				reason: 'not_found',
				detail: `No destination has the id ${which}.`
			});
		}
		expect(await rows()).toMatchObject([{ subject_id: 'late', status: 'pending' }]);
	});
});
