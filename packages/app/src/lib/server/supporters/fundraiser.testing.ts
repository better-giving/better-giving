import { SUPPORTER_START_INPUT, type SupporterStart } from '../../supporters/input';
import type { Db } from '../db/client';
import { CLIENT_IP_HEADER } from '../runtime/client-ip';
import { createDeferredWork } from '../runtime/deferred';
import { createRateLimiter } from '../runtime/rate-limiter';
import { run, stmt } from '$lib/server/db/database.testing';
import type { LinkMail } from './links';
import { type StartDeps, type StartResult, startFundraiser } from './start';

// supporter fundraisers put in by the path production makes them by — `startFundraiser`, then the
// confirm link it mails — for a spec that reads or acts on one. not a spec itself: no project's
// `include` matches this name.

/** every table a supporter spec writes, children first. */
const SUPPORTER_TABLES = [
	'supporter_session',
	'supporter_link',
	'dispute',
	'zapier_delivery',
	'quickbooks_sync',
	'ledger_entry',
	'entry_group',
	'payment',
	'line_item',
	'donation',
	'recurring_plan',
	'contact',
	'supporter_page',
	'supporter',
	'page',
	'form',
	'org_profile'
] as const;

export async function emptySupporterTables(): Promise<void> {
	for (const table of SUPPORTER_TABLES) await run(stmt(`delete from ${table}`));
}

export const STARTED_AT = new Date('2026-11-11T12:00:00.000Z');

let caller = 0;

/** a request from an address of its own, so no case spends another's bucket. */
export function fromCaller(): Request {
	caller += 1;
	return new Request('https://give.example/f/start', {
		method: 'POST',
		headers: { [CLIENT_IP_HEADER]: `192.0.2.${caller % 250}` }
	});
}

/** a start as posted, parsed: Maya's run unless `over` says otherwise. */
export function startInput(
	over: Partial<Record<keyof SupporterStart, string>> = {}
): SupporterStart {
	return SUPPORTER_START_INPUT.parse({
		name: 'Maya Rivera',
		email: 'maya@example.org',
		title: 'Run for the shelter',
		goal: '500',
		story: 'I am running 10k.',
		...over
	});
}

/** the deps a start runs on, a challenge that clears, and every mail it sent once its work ran. */
export function startDeps(db: Db, over: Partial<StartDeps> = {}) {
	const mailed: LinkMail[] = [];
	const deferred = createDeferredWork();
	const deps: StartDeps = {
		db,
		limiter: createRateLimiter({ limit: 100, period: 60 }),
		defer: (work) => deferred.waitUntil(work),
		sendLink: async (mail) => {
			mailed.push(mail);
		},
		checkChallenge: async () => ({ ok: true }),
		now: STARTED_AT,
		...over
	};
	return { deps, mailed, settled: () => deferred.settled() };
}

/** a started page, pending, and the confirm token mailed for it. */
export async function pendingPage(
	db: Db,
	over: Partial<Record<keyof SupporterStart, string>> = {}
): Promise<{ pageId: string; slug: string; token: string }> {
	const { deps, mailed, settled } = startDeps(db);
	const started: StartResult = await startFundraiser(deps, fromCaller(), startInput(over));
	if (!started.ok) throw new Error(`the fixture fundraiser was refused: ${started.reason}`);
	await settled();
	const mail = mailed.at(-1);
	if (!mail) throw new Error('the fixture fundraiser mailed no link');
	return { pageId: started.pageId, slug: started.slug, token: mail.token };
}
