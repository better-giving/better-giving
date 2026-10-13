import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeReading } from '../api/types';

// how often the console's reading reaches the binary: once per navigation, however many loaders
// ask. the client is replaced so a read is a count rather than a loopback call.

const read = vi.hoisted(() => ({ count: 0, org: null as unknown }));

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
	// `retired` stands for a field a binary from another release answers with and no page reads.
	homeReading: async (): Promise<HomeReading> =>
		({
			face: { kind: 'ready', address: 'https://a.example' },
			values: { vars: { kind: 'read', vars: [] } },
			sites: [],
			donatePage: 'https://a.example/donate',
			org: read.org,
			holdsStripeKey: false,
			retired: true
		}) as HomeReading,
	writesAnswered: async () => {}
}));

const { handOver, readConsole, valuesNotRead } = await import('./console-reading');

const navigation = () => new Request('http://localhost/password');

describe('the console reading', () => {
	beforeEach(() => {
		read.count = 0;
		read.org = null;
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

	it('carries what the pages read, and no other field the binary answers', async () => {
		const { reading } = await readConsole(navigation());
		expect(Object.keys(reading).sort()).toEqual(
			['donatePage', 'face', 'processors', 'sections', 'sites', 'stored', 'values'].sort()
		);
	});

	it('carries the links and the logo the deployment holds beside the boxes', async () => {
		// the Organisation fold draws both off this reading (`storedOrg` in ./org-form.ts).
		read.org = {
			legal_name: 'Riverbank Trust',
			social_links: [{ platform: 'linkedin', href: 'https://www.linkedin.com/company/riverbank' }],
			logo: { id: 'img_9', url: 'https://a.example/image/img_9' }
		};

		const { stored } = (await readConsole(navigation())).reading;

		expect(stored.legal_name).toBe('Riverbank Trust');
		expect(stored.social_links).toEqual([
			{ platform: 'linkedin', href: 'https://www.linkedin.com/company/riverbank' }
		]);
		expect(stored.logo).toEqual({ id: 'img_9', url: 'https://a.example/image/img_9' });
	});

	it('carries no links and no logo where the deployment holds none', async () => {
		read.org = { legal_name: 'Riverbank Trust', social_links: [], logo: null };

		const { stored } = (await readConsole(navigation())).reading;

		expect(stored.social_links).toEqual([]);
		expect(stored.logo).toBeNull();
	});
});

describe('a page whose own read of the values did not land', () => {
	it('stands behind the gate that read would have put up, with the head it draws around it', async () => {
		const reading = await readConsole(navigation());
		let thrown: unknown = null;
		try {
			valuesNotRead(reading, { kind: 'refused', detail: 'Authentication error' });
		} catch (error) {
			thrown = error;
		}
		// thrown as data with a status; the router hands it to the layout's boundary as a 503.
		expect(thrown).toMatchObject({
			data: {
				gate: { title: 'Cloudflare turned this sign-in down', retry: false },
				account: 'Riverbank Trust',
				accountId: 'acc'
			},
			init: { status: 503 }
		});
	});
});
