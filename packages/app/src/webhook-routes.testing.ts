import { env } from 'cloudflare:test';
import { uuidv7 } from 'uuidv7';
import type { Db } from '$lib/server/db/client';
import { contact, donation, payment } from '$lib/server/db/schema';
import { sendDueWebhooks } from '$lib/server/webhooks/deliver';
import { webhookStatements } from '$lib/server/webhooks/events';
import { type MountedRoute, mountRoutes, type RouteRequester } from './route-request.testing';
import {
	deployedBindings,
	signInAsDeployer as signInDeployer,
	signInAsMember as signInMember
} from './staff-session.testing';
import * as layout from './routes/_app';

// what the dashboard route specs share: a deployment set up far enough for the layout to serve
// its children, the deployer's session and a member's, and each page mounted under the protected
// layout, whose middleware is the session gate (./route-request.testing.ts).
//
// here rather than beside the routes for ./program-routes.testing.ts's reason: every file directly
// under ./routes/ is an address to `flatRoutes`, bar a spec.

export const ORIGIN = 'https://give.example';

const PASSWORD = 'a-very-long-random-staff-password';

/** the bindings a set-up deployment carries. */
export function deployed(): Env {
	return deployedBindings(PASSWORD);
}

/** every table these specs write emptied, and the one row the five set-up jobs are read off. */
export async function freshDeployment(): Promise<void> {
	for (const table of [
		'webhook_delivery',
		'webhook_destination_event',
		'webhook_destination',
		'payment',
		'donation',
		'contact',
		'auth_member_invitation',
		'auth_session',
		'auth_user',
		'org_profile'
	]) {
		await env.DB.prepare(`delete from ${table}`).run();
	}
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, notification_email, created_at, updated_at)
		 values ('default', 'Riverbank Trust', '12-3456789', 'alerts@example.org', 0, 0)`
	).run();
}

/**
 * a deployment whose five set-up jobs are done, for a spec that mounts a screen under the layout
 * and asserts on the screen rather than on the set-up gate (../routes/_app.tsx).
 *
 * answers the bindings to send each request with, `password` being the staff password the spec
 * signs in with, and writes the one row the jobs are read off: the registered name and EIN and the
 * notifications address, each filled only where the spec's own profile left it blank. a profile the
 * spec wrote first keeps every column it set, so a case about what a screen shows of the identity
 * still reads its own values. call it after the spec has emptied and refilled `org_profile`.
 */
export async function finishSetup(password: string): Promise<Env> {
	await env.DB.prepare(
		`insert into org_profile (id, legal_name, tax_id, notification_email, created_at, updated_at)
		 values ('default', 'Riverbank Trust', '12-3456789', 'alerts@example.org', 0, 0)
		 on conflict (id) do update set
		   tax_id = coalesce(tax_id, excluded.tax_id),
		   notification_email = coalesce(notification_email, excluded.notification_email)`
	).run();
	return deployedBindings(password);
}

const DEPLOYMENT = { env: deployed(), password: PASSWORD, origin: ORIGIN };

/** the deployer's session, as the `Cookie` header a browser would send back. */
export function signInAsDeployer(db: Db): Promise<string> {
	return signInDeployer(db, DEPLOYMENT);
}

/** a colleague who accepted an invitation, through the real invite and redeem. */
export function signInAsMember(db: Db): Promise<string> {
	return signInMember(db, DEPLOYMENT);
}

/** a GET and a form POST to one page mounted at `path` under the protected layout. */
export function page(path: string, module: MountedRoute['module']) {
	const request: RouteRequester = mountRoutes([
		{ path: undefined, module: layout },
		{ path, module }
	]);
	return {
		get: (at: string, cookie: string, bindings: Env = deployed()) =>
			request(new Request(`${ORIGIN}${at}`, { headers: { cookie } }), { env: bindings }),
		post: (at: string, cookie: string, body: FormData) =>
			request(
				new Request(`${ORIGIN}${at}`, {
					method: 'POST',
					headers: { cookie, origin: ORIGIN },
					body
				}),
				{ env: deployed() }
			)
	};
}

/** a form body, `__form_id__` first, with a repeated key for each value of an array. */
export function formBody(fields: Record<string, string | readonly string[]>): FormData {
	const body = new FormData();
	for (const [name, value] of Object.entries(fields)) {
		for (const each of typeof value === 'string' ? [value] : value) body.append(name, each);
	}
	return body;
}

/** the cookies a flash-setting redirect sets, joined onto `cookie` for the load it lands on. */
export function withFlash(cookie: string, answer: Response): string {
	const flash = answer.headers.getSetCookie().map((value) => value.split(';', 1)[0]);
	return [cookie, ...flash].join('; ');
}

/** a $50 gift settled with its fan-out, the way every caller commits one; answers its payment id. */
export async function settleGift(db: Db): Promise<string> {
	const contactId = uuidv7();
	const donationId = uuidv7();
	const paymentId = uuidv7();
	const at = new Date('2026-09-10T12:00:00.000Z');
	await db.batch([
		db.insert(contact).values({
			id: contactId,
			kind: 'individual',
			displayName: 'Ada Okafor',
			primaryEmail: 'ada@example.org'
		}),
		db
			.insert(donation)
			.values({ id: donationId, contactId, totalMinor: 5_000, currency: 'USD', receivedAt: at }),
		db.insert(payment).values({
			id: paymentId,
			donationId,
			amountMinor: 5_000,
			currency: 'USD',
			direction: 'inbound',
			method: 'check',
			status: 'succeeded',
			provider: 'manual',
			occurredAt: at
		}),
		...webhookStatements(db, { paymentId, contactId })
	]);
	return paymentId;
}

/** one delivery run now, every receiver answering 200: the address and event of each post. */
export async function deliverNow(db: Db): Promise<{ url: string; type: string }[]> {
	const posts: { url: string; type: string }[] = [];
	const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		posts.push({ url: String(input), type: JSON.parse(String(init?.body)).type });
		return new Response('ok');
	}) as typeof globalThis.fetch;
	await sendDueWebhooks({ db, fetch, onPaused: async () => undefined }, new Date());
	return posts;
}
