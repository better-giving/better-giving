import { describe, expect, it } from 'vitest';
import { FREQUENCIES } from '@better-giving/form/v1';
import type { PaymentProvider, PaymentResult, RecurringGiftStanding } from '../payments/provider';
import { soleProcessor } from '../payments/processors.testing';
import { offeredCadences, readOfferedCadences } from './offered-cadences';

// how often a gift may repeat, away from anything that serves it.
//
// a node spec rather than a workers one because nothing here touches the database (CLAUDE.md splits
// the pools by that), and the seam is the port, which is a value: a case that wants an account
// holding a usable product just says so. ./cadence-cache.workers.spec.ts is the other half, and it
// is a workers spec because the edge cache is workerd's.

/**
 * a port that answers the read arm from a script and refuses every other arm by name.
 *
 * `prepareRecurringGifts` throws rather than answering, which is what pins the difference this
 * module rests on: it is find-or-create, so a read that reached it would put a product on an
 * operator's account as a side effect of a donor loading a form.
 */
function port(read: PaymentResult<RecurringGiftStanding>): PaymentProvider {
	const unused = (name: string) => () => {
		throw new Error(`${name} is not part of reading how often a gift may repeat`);
	};
	return {
		processor: 'stripe',
		async readRecurringGiftProvision() {
			return read;
		},
		prepareRecurringGifts: unused('prepareRecurringGifts'),
		createRecurringGift: unused('createRecurringGift'),
		cancelRecurringGift: unused('cancelRecurringGift'),
		createIntent: unused('createIntent'),
		verifyEvent: unused('verifyEvent'),
		readSettlement: unused('readSettlement'),
		readRecurringGift: unused('readRecurringGift'),
		readAccountChargeability: unused('readAccountChargeability'),
		readRailSwitchboard: unused('readRailSwitchboard'),
		listWebhookEndpoints: unused('listWebhookEndpoints'),
		registerWebhookEndpoint: unused('registerWebhookEndpoint'),
		resubscribeWebhookEndpoint: unused('resubscribeWebhookEndpoint'),
		replaceWebhookEndpoint: unused('replaceWebhookEndpoint'),
		listWalletDomains: unused('listWalletDomains'),
		registerWalletDomain: unused('registerWalletDomain')
	};
}

const REFUSAL = {
	ok: false,
	reason: 'not_configured',
	detail: 'This deployment cannot take a payment: `STRIPE_SECRET_KEY` is not set.'
} as const;

describe('offeredCadences', () => {
	it('offers every cadence the wire names where the account holds a usable product', () => {
		expect(offeredCadences({ stripe: { state: 'ready' } })).toEqual([...FREQUENCIES]);
	});

	it('offers one-time alone where the account holds nothing', () => {
		expect(offeredCadences({ stripe: { state: 'absent' } })).toEqual(['one_time']);
	});

	/**
	 * an archived product cannot be charged against, so it offers what an absent one does.
	 *
	 * the two are separate standings and stay separate — `RecurringGiftStanding` in
	 * ../payments/provider.ts says why — and they agree here because what a donor may pick is
	 * decided by whether a repeating gift can be collected, which is false on both.
	 */
	it('offers one-time alone where the account holds an archived product', () => {
		expect(offeredCadences({ stripe: { state: 'archived' } })).toEqual(['one_time']);
	});

	/**
	 * a read nobody could make offers one-time alone, which is the narrow direction.
	 *
	 * a cadence offered and not chargeable is a donor picking Monthly and meeting a failure at the
	 * last step, on a page nobody here can see. one that is chargeable and not offered costs a
	 * donor nothing they can tell.
	 */
	it('offers one-time alone where the standing could not be read', () => {
		expect(offeredCadences({ stripe: { state: 'unreadable', detail: REFUSAL.detail } })).toEqual([
			'one_time'
		]);
	});

	/**
	 * the invariant that replaces `publishedConfig`'s refusal over an empty list.
	 *
	 * `readFormConfig` in packages/form/src/config.ts drops a config offering nothing, which is a donation
	 * form that renders nothing on a site nobody here can see — so no arm may answer with an empty
	 * list, and one-time is what every arm has in common.
	 */
	it('never answers with an empty list, and always offers one-time', () => {
		const provisions = [
			{ state: 'ready' },
			{ state: 'absent' },
			{ state: 'archived' },
			{ state: 'unreadable', detail: 'anything' }
		] as const;
		for (const provision of provisions) {
			expect(offeredCadences({ stripe: provision })).toContain('one_time');
		}
	});

	/**
	 * a deployment that can charge on no processor offers one-time alone.
	 *
	 * the fresh fork. the composition below is an intersection, and over no readings at all an
	 * intersection is everything — which would be this module offering Monthly on a deployment with
	 * no processor to collect it.
	 */
	it('offers one-time alone where no processor is configured', () => {
		expect(offeredCadences({})).toEqual(['one_time']);
	});

	/**
	 * every configured processor has to be able to collect a cadence before a donor is shown it.
	 *
	 * `FormConfig` in packages/form/src/v1.ts carries one flat list for the whole form and a donor
	 * picks a cadence before a rail, so a cadence one processor cannot collect is one some donors
	 * would pick and none of them could pay — and CLAUDE.md's repeating-gifts rule is that such a
	 * cadence is not offered in the first place.
	 */
	it('offers a cadence only where every configured processor can collect it', () => {
		expect(offeredCadences({ stripe: { state: 'ready' }, paypal: { state: 'absent' } })).toEqual([
			'one_time'
		]);
	});
});

describe('readOfferedCadences', () => {
	it('reads the account and offers every cadence where it is ready', async () => {
		expect(await readOfferedCadences(soleProcessor(port({ ok: true, value: 'ready' })))).toEqual([
			...FREQUENCIES
		]);
	});

	it('offers one-time alone where the port refused', async () => {
		expect(await readOfferedCadences(soleProcessor(port(REFUSAL)))).toEqual(['one_time']);
	});
});
