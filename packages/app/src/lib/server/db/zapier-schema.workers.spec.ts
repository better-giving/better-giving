import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

// the constraints the three Zapier tables carry, which are one-way for the reason
// ./donation-schema.workers.spec.ts opens with: each is a rebuild of the table to change.
//
// what is deliberately not here, on that file's redundancy rule: `STRICT` on the three tables and
// `NO ACTION` on the delivery's two foreign keys, both read off sqlite's catalogue by
// ./strict.workers.spec.ts, and the `optionalNotBlank` body on `last_error` (the shared helper,
// pinned on `payment.provider_txn_id`).
//
// every query below is scoped to its own rows — the pool gives per-file storage, not per-test.

const SQLITE_CONSTRAINT_CHECK = 'SQLITE_CONSTRAINT_CHECK';
const SQLITE_CONSTRAINT_PRIMARYKEY = 'SQLITE_CONSTRAINT_PRIMARYKEY';
const SQLITE_CONSTRAINT_FOREIGNKEY = 'SQLITE_CONSTRAINT_FOREIGNKEY';

/** runs `fn` and requires D1 to have rejected it; same helper as the sibling schema specs. */
async function rejection(fn: () => Promise<unknown>): Promise<string> {
	try {
		await fn();
	} catch (e) {
		return String((e as Error).message);
	}
	throw new Error('expected D1 to reject this statement, but it succeeded');
}

const HASH = 'a'.repeat(64);

const insertKey = (id: string, keyHash: string) =>
	env.DB.prepare(
		`insert into zapier_key (id, key_hash, created_at, updated_at) values (?, ?, 0, 0)`
	)
		.bind(id, keyHash)
		.run();

// the singleton is seeded here rather than by the first test that needs it, so no case below
// depends on having run after another one.
beforeAll(async () => {
	await insertKey('zapier', HASH);
});

describe('one zapier key per deployment', () => {
	it('refuses a second key row under any other id', async () => {
		const message = await rejection(() => insertKey('zapier-2', HASH));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('zapier_key_id_check');
	});

	it('refuses a second key row under the same id', async () => {
		const message = await rejection(() => insertKey('zapier', HASH));
		expect(message).toContain(SQLITE_CONSTRAINT_PRIMARYKEY);
	});
});

describe('the key is stored as its lowercase hex sha-256 and nothing else', () => {
	const setHash = (keyHash: string) =>
		env.DB.prepare(`update zapier_key set key_hash = ? where id = 'zapier'`).bind(keyHash).run();

	it('accepts 64 lowercase hex digits', async () => {
		const hash = '0123456789abcdef'.repeat(4);
		await setHash(hash);
		const row = await env.DB.prepare(`select key_hash as h from zapier_key`).first();
		expect(row).toEqual({ h: hash });
	});

	// uppercase hex is the right digest in a case a comparison against the lowercase one misses;
	// the key itself is what a careless write stores instead of its hash; 63 and 65 are a digest
	// cut or padded by one.
	it.each([
		['uppercase hex', 'A'.repeat(64)],
		['the key itself', `bgz_${'a'.repeat(60)}`],
		['63 digits', 'a'.repeat(63)],
		['65 digits', 'a'.repeat(65)],
		['empty', '']
	])('refuses %s', async (_, keyHash) => {
		const message = await rejection(() => setHash(keyHash));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('zapier_key_key_hash_check');
	});
});

describe('the key itself is stored in the shape it is minted in, or not at all', () => {
	const setKey = (key: string | null) =>
		env.DB.prepare(`update zapier_key set key = ? where id = 'zapier'`).bind(key).run();

	// 43 base64url characters, the whole alphabet `-` and `_` included.
	const KEY = `bgz_${'AZaz09-_'.repeat(5)}abc`;

	it.each([
		['a minted key', KEY],
		['no key', null]
	])('accepts %s', async (_, key) => {
		await setKey(key);
		const row = await env.DB.prepare(`select key as k from zapier_key`).first();
		expect(row).toEqual({ k: key });
	});

	// the hash is what a careless write stores where the key belongs; the rest are a key cut,
	// padded, re-cased or re-encoded on its way into the row.
	it.each([
		['the hash', HASH],
		['an uppercase prefix', `BGZ_${KEY.slice(4)}`],
		['no prefix', KEY.slice(4)],
		['42 characters after the prefix', KEY.slice(0, -1)],
		['44 characters after the prefix', `${KEY.slice(0, -1)}==`],
		['standard base64', `${KEY.slice(0, -1)}+`],
		['a space', `${KEY.slice(0, -1)} `],
		['`+` first after the prefix', `bgz_+${KEY.slice(5)}`],
		['`/` mid-key', `${KEY.slice(0, 25)}/${KEY.slice(26)}`],
		['`=` mid-key', `${KEY.slice(0, 25)}=${KEY.slice(26)}`],
		['a space mid-key', `${KEY.slice(0, 25)} ${KEY.slice(26)}`],
		['a non-ASCII letter mid-key', `${KEY.slice(0, 25)}é${KEY.slice(26)}`],
		['empty', '']
	])('refuses %s', async (_, key) => {
		const message = await rejection(() => setKey(key));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('zapier_key_key_check');
	});
});

const HOOK = 'https://hooks.zapier.com/hooks/standard/1/abc/';

const insertSubscription = (opts: {
	id: string;
	trigger?: string;
	hookUrl?: string;
	endedAt?: number | null;
	endedReason?: string | null;
}) =>
	env.DB.prepare(
		`insert into zapier_subscription
		   (id, "trigger", hook_url, ended_at, ended_reason, created_at, updated_at)
		 values (?, ?, ?, ?, ?, 0, 0)`
	)
		.bind(
			opts.id,
			opts.trigger ?? 'new_gift',
			opts.hookUrl ?? `${HOOK}${opts.id}`,
			opts.endedAt ?? null,
			opts.endedReason ?? null
		)
		.run();

const subscriptionRow = (id: string) =>
	env.DB.prepare('select "trigger", ended_at, ended_reason from zapier_subscription where id = ?')
		.bind(id)
		.first();

describe('a subscription listens for one of the three triggers', () => {
	it.each(['new_gift', 'new_donor', 'gift_refunded'])('accepts %s', async (trigger) => {
		const id = `sub-trigger-${trigger}`;
		await insertSubscription({ id, trigger });
		expect(await subscriptionRow(id)).toMatchObject({ trigger });
	});

	it.each(['new_payment', 'NEW_GIFT', 'gift_disputed', ''])('refuses %j', async (trigger) => {
		const message = await rejection(() =>
			insertSubscription({ id: `sub-trigger-bad-${trigger}`, trigger })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('zapier_subscription_trigger_check');
	});
});

describe('a hook url is https and nothing else', () => {
	// `HTTPS://` is the case `like 'https://%'` would have admitted: sqlite's like folds ASCII case.
	it.each([
		['plain http', 'http://hooks.zapier.com/hooks/standard/1/abc/'],
		['an uppercase scheme', 'HTTPS://hooks.zapier.com/hooks/standard/1/abc/'],
		['no scheme', 'hooks.zapier.com/hooks/standard/1/abc/'],
		['empty', '']
	])('refuses %s', async (_, hookUrl) => {
		const message = await rejection(() =>
			insertSubscription({ id: `sub-url-${hookUrl}`, hookUrl })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('zapier_subscription_hook_url_check');
	});
});

describe('a subscription ends with a when and a why, or not at all', () => {
	it.each(['unsubscribed', 'gone', 'key_replaced'])('accepts an end for %s', async (reason) => {
		const id = `sub-ended-${reason}`;
		await insertSubscription({ id, endedAt: 1, endedReason: reason });
		expect(await subscriptionRow(id)).toMatchObject({ ended_at: 1, ended_reason: reason });
	});

	it('refuses an end reason outside the three', async () => {
		const message = await rejection(() =>
			insertSubscription({ id: 'sub-ended-bad', endedAt: 1, endedReason: 'deleted' })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('zapier_subscription_ended_reason_check');
	});

	it.each([
		['a when with no why', 1, null],
		['a why with no when', null, 'gone']
	])('refuses %s', async (_, endedAt, endedReason) => {
		const message = await rejection(() =>
			insertSubscription({ id: `sub-half-${endedReason}`, endedAt, endedReason })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('zapier_subscription_ended_check');
	});
});

describe('one open subscription per hook url', () => {
	const hookUrl = `${HOOK}open-once`;

	it('refuses a second open subscription to a hook that already has one', async () => {
		await insertSubscription({ id: 'sub-open-1', hookUrl });
		const message = await rejection(() => insertSubscription({ id: 'sub-open-2', hookUrl }));
		expect(message).toContain('SQLITE_CONSTRAINT_UNIQUE');
		expect(message).toContain('zapier_subscription.hook_url');
	});

	it('admits the hook again once its earlier subscription has ended', async () => {
		// ended rows are kept, so the uniqueness has to be over open rows only or a Zap turned off
		// and on again could never re-subscribe.
		const reopened = `${HOOK}reopened`;
		await insertSubscription({
			id: 'sub-reopen-1',
			hookUrl: reopened,
			endedAt: 1,
			endedReason: 'unsubscribed'
		});
		await insertSubscription({
			id: 'sub-reopen-2',
			hookUrl: reopened,
			endedAt: 2,
			endedReason: 'gone'
		});
		await insertSubscription({ id: 'sub-reopen-3', hookUrl: reopened });
		const { results } = await env.DB.prepare(
			'select id from zapier_subscription where hook_url = ? order by id'
		)
			.bind(reopened)
			.all<{ id: string }>();
		expect(results.map((r) => r.id)).toEqual(['sub-reopen-1', 'sub-reopen-2', 'sub-reopen-3']);
	});
});

const CONTACT_ID = '019fb600-0000-7000-8000-000000000001';
const DONATION_ID = '019fb600-0000-7000-8000-000000000002';
const PAYMENT_ID = '019fb600-0000-7000-8000-000000000003';
const DELIVERY_SUBSCRIPTION_ID = 'sub-delivery';

beforeAll(async () => {
	await env.DB.batch([
		env.DB.prepare(
			`insert into contact (id, kind, display_name, created_at, updated_at)
			 values (?, 'individual', 'Probe Donor', 0, 0)`
		).bind(CONTACT_ID),
		env.DB.prepare(
			`insert into donation (id, contact_id, total_minor, currency, received_at, created_at)
			 values (?, ?, 10000, 'USD', 0, 0)`
		).bind(DONATION_ID, CONTACT_ID),
		env.DB.prepare(
			`insert into payment (id, donation_id, amount_minor, currency, direction, method, status,
			                      provider, provider_txn_id, occurred_at, created_at)
			 values (?, ?, 10000, 'USD', 'inbound', 'card', 'succeeded', 'stripe', 'pi_zapier', 0, 0)`
		).bind(PAYMENT_ID, DONATION_ID)
	]);
	await insertSubscription({ id: DELIVERY_SUBSCRIPTION_ID });
});

/** a delivery row stating only what the builder always binds; `columns` adds the rest. */
const insertDelivery = (
	eventId: string,
	extra: { subscriptionId?: string; paymentId?: string; columns?: Record<string, unknown> } = {}
) => {
	const columns = extra.columns ?? {};
	const names = Object.keys(columns);
	return env.DB.prepare(
		`insert into zapier_delivery
		   (subscription_id, event_id, payment_id, next_attempt_at, created_at, updated_at
		    ${names.map((n) => `, ${n}`).join('')})
		 values (?, ?, ?, 0, 0, 0 ${names.map(() => ', ?').join('')})`
	)
		.bind(
			extra.subscriptionId ?? DELIVERY_SUBSCRIPTION_ID,
			eventId,
			extra.paymentId ?? PAYMENT_ID,
			...Object.values(columns)
		)
		.run();
};

const deliveryRow = (eventId: string) =>
	env.DB.prepare(
		`select status, attempts, leased_until, last_error from zapier_delivery
		 where subscription_id = ? and event_id = ?`
	)
		.bind(DELIVERY_SUBSCRIPTION_ID, eventId)
		.first();

describe('an event reaches a subscription once', () => {
	it('refuses a second delivery of one event to one subscription', async () => {
		// the key the fan-out's `on conflict do nothing` lands on, and what holds "new donor" to
		// one row per donor per Zap.
		await insertDelivery('evt-once');
		const message = await rejection(() => insertDelivery('evt-once'));
		expect(message).toContain(SQLITE_CONSTRAINT_PRIMARYKEY);
	});

	it('admits the same event to a second subscription', async () => {
		await insertSubscription({ id: 'sub-delivery-2' });
		await insertDelivery('evt-twice', { subscriptionId: 'sub-delivery-2' });
		await insertDelivery('evt-twice');
		const { results } = await env.DB.prepare(
			'select subscription_id as s from zapier_delivery where event_id = ? order by s'
		)
			.bind('evt-twice')
			.all();
		expect(results).toEqual([{ s: DELIVERY_SUBSCRIPTION_ID }, { s: 'sub-delivery-2' }]);
	});
});

describe('a delivery row points at a subscription and a gift that exist', () => {
	it('refuses a subscription id naming no subscription', async () => {
		const message = await rejection(() =>
			insertDelivery('evt-no-sub', { subscriptionId: 'sub-missing' })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_FOREIGNKEY);
	});

	it('refuses a payment id naming no payment', async () => {
		const message = await rejection(() =>
			insertDelivery('evt-no-payment', { paymentId: '019fb600-0000-7000-8000-00000000dead' })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_FOREIGNKEY);
	});
});

describe('a delivery row is in one of four states', () => {
	it('arrives pending, untried and claimed by nobody', async () => {
		// drizzle binds its own schema-level defaults and never emits the SQL `DEFAULT` keyword,
		// and the fan-out's INSERT…SELECT names only the columns it binds — so a raw insert like
		// this one is what reads the migration's copy.
		await insertDelivery('evt-defaults');
		expect(await deliveryRow('evt-defaults')).toEqual({
			status: 'pending',
			attempts: 0,
			leased_until: null,
			last_error: null
		});
	});

	it.each(['pending', 'sent', 'failed', 'dropped'])('accepts %s', async (status) => {
		await insertDelivery(`evt-status-${status}`, { columns: { status } });
		expect(await deliveryRow(`evt-status-${status}`)).toMatchObject({ status });
	});

	it.each(['succeeded', 'SENT', 'ended', ''])('refuses %j', async (status) => {
		const message = await rejection(() =>
			insertDelivery(`evt-status-bad-${status}`, { columns: { status } })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('zapier_delivery_status_check');
	});

	it('refuses a negative attempt count', async () => {
		const message = await rejection(() =>
			insertDelivery('evt-attempts-negative', { columns: { attempts: -1 } })
		);
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('zapier_delivery_attempts_check');
	});
});

describe('a delivery row names the event it carries', () => {
	// the id the payload carries as `id`, so a blank one gives a Zap nothing to tell two events apart by.
	it.each([
		['empty', ''],
		['a lone space', ' '],
		['a non-breaking space', '\u00a0']
	])('refuses %s', async (_, eventId) => {
		const message = await rejection(() => insertDelivery(eventId));
		expect(message).toContain(SQLITE_CONSTRAINT_CHECK);
		expect(message).toContain('zapier_delivery_event_id_not_blank_check');
	});
});
