import nock from 'nock';
import zapier from 'zapier-platform-core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import authentication from './authentication.js';
import App from './index.js';

const appTester = zapier.createAppTester(App);
const ADDRESS = 'https://give.example.org';
const KEY = 'bgz_test-key';

beforeAll(() => nock.disableNetConnect());
afterEach(() => {
	const pending = nock.pendingMocks();
	nock.cleanAll();
	expect(pending).toEqual([]);
});

describe('authentication', () => {
	it('tests the key against /zapier/me with it as a bearer', async () => {
		nock(ADDRESS, { reqheaders: { authorization: `Bearer ${KEY}` } })
			.get('/zapier/me')
			.reply(200, { organisation: 'Clean Water Trust' });

		const result = await appTester(authentication.test, {
			authData: { address: ADDRESS, key: KEY }
		});

		expect(result).toEqual({ organisation: 'Clean Water Trust' });
	});

	it('refuses an address that is not https before sending the key anywhere', async () => {
		const tested = appTester(authentication.test, {
			authData: { address: 'http://give.example.org', key: KEY }
		});

		await expect(tested).rejects.toThrow(/give\.example\.org.*is not an https:\/\//);
	});

	it.each([
		['a page', '<!doctype html><title>Welcome</title>'],
		['JSON without an organisation', { ok: true }]
	])('refuses a site answering with %s, naming the address', async (_, body) => {
		nock(ADDRESS).get('/zapier/me').reply(200, body);

		const tested = appTester(authentication.test, { authData: { address: ADDRESS, key: KEY } });

		await expect(tested).rejects.toThrow(/give\.example\.org.*is not a Better Giving deployment/);
	});

	it('marks the connection expired when the deployment refuses the key, with its fix', async () => {
		nock(ADDRESS)
			.get('/zapier/me')
			.reply(401, { message: 'No key this deployment accepts.', fix: 'Make a Zapier key.' });

		const tested = appTester(authentication.test, {
			authData: { address: ADDRESS, key: 'bgz_replaced' }
		});

		await expect(tested).rejects.toMatchObject({
			name: 'ExpiredAuthError',
			message: expect.stringContaining('No key this deployment accepts. Make a Zapier key.')
		});
	});
});

describe('connection label', () => {
	it('is the organisation the test answered with', async () => {
		const label = await appTester(authentication.connectionLabel, {
			authData: { address: ADDRESS, key: KEY },
			inputData: { organisation: 'Clean Water Trust' }
		});

		expect(label).toBe('Clean Water Trust');
	});

	it('is the deployment host while the organisation has no name', async () => {
		const label = await appTester(authentication.connectionLabel, {
			authData: { address: `${ADDRESS}/`, key: KEY },
			inputData: { organisation: null }
		});

		expect(label).toBe('give.example.org');
	});
});
