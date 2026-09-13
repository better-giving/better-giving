import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeReading } from '../api/types';

// how often the console's reading reaches the binary: once per navigation, however many loaders
// ask. the client is replaced so a read is a count rather than a loopback call.

const read = vi.hoisted(() => ({ count: 0 }));

vi.mock('../api/client', () => ({
	homeShape: async () => {
		read.count += 1;
		return {
			account: { name: 'Riverbank Trust', id: 'acc' },
			remembered: true,
			notKept: null,
			workerName: 'better-giving',
			databaseName: 'better-giving'
		};
	},
	consoleVersion: async () => ({ version: '0.0.1' }),
	homeReading: async (): Promise<HomeReading> => ({
		face: { kind: 'ready', address: 'https://a.example' },
		values: { vars: { kind: 'read', vars: [] } },
		sites: [],
		donatePage: 'https://a.example',
		org: null,
		holdsStripeKey: false
	})
}));

const { handOver, readConsole } = await import('./console-reading');

const navigation = () => new Request('http://localhost/password');

describe('the console reading', () => {
	beforeEach(() => {
		read.count = 0;
	});

	it('is read once for every loader of one navigation', async () => {
		const request = navigation();
		await Promise.all([readConsole(request), readConsole(request)]);
		expect(read.count).toBe(1);
	});

	it('is read again by the next navigation', async () => {
		await readConsole(navigation());
		await readConsole(navigation());
		expect(read.count).toBe(2);
	});

	it('is handed over to the next navigation once, and read afresh after it', async () => {
		const first = await readConsole(navigation());
		handOver(first);
		expect(await readConsole(navigation())).toBe(first);
		expect(read.count).toBe(1);
		await readConsole(navigation());
		expect(read.count).toBe(2);
	});
});
