import nock from 'nock';
import zapier from 'zapier-platform-core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import App from '../index.js';
import giftRefunded from './gift-refunded.js';
import newDonor from './new-donor.js';
import newGift from './new-gift.js';

const appTester = zapier.createAppTester(App);
const ADDRESS = 'https://give.example.org';
const KEY = 'bgz_test-key';
const authData = { address: ADDRESS, key: KEY };
const HOOK_URL = 'https://hooks.zapier.com/hooks/standard/1/abc/';

beforeAll(() => nock.disableNetConnect());
afterEach(() => {
	const pending = nock.pendingMocks();
	nock.cleanAll();
	expect(pending).toEqual([]);
});

function deployment() {
	return nock(ADDRESS, { reqheaders: { authorization: `Bearer ${KEY}` } });
}

it('offers every trigger the deployment serves', () => {
	expect(Object.keys(App.triggers ?? {}).sort()).toEqual([
		'gift_refunded',
		'new_donor',
		'new_gift'
	]);
});

describe.each([newGift, newDonor, giftRefunded])('$key', ({ key, operation }) => {
	it('subscribes the Zap by posting its hook url under this trigger', async () => {
		deployment()
			.post('/zapier/hooks', { trigger: key, hook_url: HOOK_URL })
			.reply(201, { id: 'sub_1' });

		const subscribeData = await appTester(operation.performSubscribe, {
			authData,
			targetUrl: HOOK_URL
		});

		expect(subscribeData).toEqual({ id: 'sub_1' });
	});

	it('unsubscribes the Zap by deleting the id its subscribe answered', async () => {
		deployment().delete('/zapier/hooks/sub_1').reply(204);

		await appTester(operation.performUnsubscribe, {
			authData,
			subscribeData: { id: 'sub_1' }
		});
	});

	it('hands the Zap the posted event as its one item', async () => {
		const event = { id: 'pay_1', amount: '51.50' };

		const items = await appTester(operation.perform, { authData, cleanedRequest: event });

		expect(items).toEqual([event]);
	});

	it("lists the deployment's samples for this trigger, unwrapped from their envelope", async () => {
		const events = [{ id: 'pay_2' }, { id: 'pay_1' }];
		deployment().get(`/zapier/samples/${key}`).reply(200, { data: events });

		const items = await appTester(operation.performList, { authData });

		expect(items).toEqual(events);
	});
});
