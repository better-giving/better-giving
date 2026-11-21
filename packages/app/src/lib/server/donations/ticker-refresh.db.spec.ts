import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type Db } from '../db/client';
import { client, run, stmt } from '../db/database.testing';
import type { EmailMessage, EmailProvider } from '../email/provider';
import { saveProfile } from '../org/profile.testing';
import {
	EXCHANGE_FILE_URL,
	FUND_FILE_URL,
	refreshTickers,
	refreshTickersIfNoneHeld
} from './ticker-refresh';
import { exchangeFile, fundFile, ok, secStandIn, wholeFiles } from './ticker-refresh.testing';
import { replaceTickers, searchTickers } from './tickers';

// the daily ticker refresh against a real database, with sec.gov stood in by a function that
// answers each of the two files from what the case hands it (./ticker-refresh.testing.ts).

const NOW = new Date('2026-11-21T04:20:00.000Z');
const HOUR = 60 * 60_000;

function recordingEmail() {
	const sent: EmailMessage[] = [];
	const email: EmailProvider = {
		async send(message) {
			sent.push(message);
			return { ok: true };
		}
	};
	return { sent, email };
}

let db: Db;
beforeAll(() => {
	db = createDb(client);
});

/** a list already held, replaced `ago` before `NOW`. */
async function holdOldList(ago: number): Promise<void> {
	await replaceTickers(db, [
		{ symbol: 'OLD', name: 'Old Holdings Inc.', exchange: 'NYSE', kind: 'company' }
	]);
	await run(stmt('update ticker set replaced_at = ?', NOW.getTime() - ago));
}

beforeEach(async () => {
	await saveProfile(db);
	await holdOldList(2 * 24 * HOUR);
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** one run at `NOW`, against the stand-in. */
function refresh(
	sec: ReturnType<typeof secStandIn>,
	email: EmailProvider,
	mailFrom: string | null = null
): Promise<void> {
	return refreshTickers({ db, fetch: sec.fetch, email, mailFrom }, NOW);
}

describe('refreshTickers', () => {
	it('fetches nothing when the list held was replaced under a day ago', async () => {
		await holdOldList(20 * HOUR);
		const sec = wholeFiles();
		const { email, sent } = recordingEmail();

		await refresh(sec, email);

		expect(sec.requests).toEqual([]);
		expect(sent).toEqual([]);
	});

	it('refreshes on the next day’s run, the list having been stored a little after the last run fired', async () => {
		await holdOldList(24 * HOUR - 30_000);
		const sec = wholeFiles();

		await refresh(sec, recordingEmail().email);

		expect(sec.requests).toHaveLength(2);
		expect(await searchTickers(db, 'OLD', 8)).toEqual([]);
	});

	it('refreshes where no notifications address is saved, naming the From address as its contact', async () => {
		await saveProfile(db, { notification_email: '' });
		const sec = wholeFiles();

		await refresh(sec, recordingEmail().email, 'donations@example.org');

		expect(sec.requests.map((r) => r.headers.get('user-agent'))).toEqual([
			'better-giving donations@example.org',
			'better-giving donations@example.org'
		]);
		expect(await searchTickers(db, 'OLD', 8)).toEqual([]);
	});

	it('logs a failure where no notifications address is saved, mailing nobody', async () => {
		await saveProfile(db, { notification_email: '' });
		const sec = secStandIn({ exchange: { status: 403, body: {} }, fund: ok(fundFile(15_000)) });
		const { email, sent } = recordingEmail();
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

		await refresh(sec, email);

		expect(sent).toEqual([]);
		expect(logged.mock.calls.map(([line]) => line)).toEqual([
			'The stock ticker list did not refresh:'
		]);
	});

	it('replaces the list from both files, a ticker on both keeping its company name', async () => {
		const sec = secStandIn({
			exchange: ok(exchangeFile(6_000, [[1067983, 'BERKSHIRE HATHAWAY INC', 'BRK-B', 'NYSE']])),
			fund: ok(fundFile(15_000, [[36405, 'S000002839', 'C000007801', 'brk-b']]))
		});
		const { email, sent } = recordingEmail();

		await refresh(sec, email);

		expect(await searchTickers(db, 'BRK-B', 8)).toEqual([
			{ symbol: 'BRK-B', name: 'BERKSHIRE HATHAWAY INC', exchange: 'NYSE', kind: 'company' }
		]);
		expect(await searchTickers(db, 'F0X', 8)).toEqual([
			{ symbol: 'F0X', name: null, exchange: null, kind: 'fund' }
		]);
		expect(await searchTickers(db, 'OLD', 8)).toEqual([]);
		expect(sec.requests.map((r) => r.url)).toEqual([EXCHANGE_FILE_URL, FUND_FILE_URL]);
		for (const request of sec.requests) {
			expect(request.headers.get('user-agent')).toContain('alerts@example.org');
		}
		expect(sent).toEqual([]);
	});

	it('keeps the old list and alerts when a file changed shape', async () => {
		const changed = exchangeFile(6_000);
		changed.fields.push('sic');
		changed.data = changed.data.map((row) => [...row, 7372]);
		const sec = secStandIn({ exchange: ok(changed), fund: ok(fundFile(15_000)) });
		const { email, sent } = recordingEmail();

		await refresh(sec, email);

		expect((await searchTickers(db, 'OLD', 8)).map((row) => row.symbol)).toEqual(['OLD']);
		expect(sent.map((message) => [message.to, message.subject])).toEqual([
			['alerts@example.org', 'The stock ticker list did not refresh']
		]);
		expect(sent[0]?.text).toContain(EXCHANGE_FILE_URL);
	});

	it('alerts with the status when sec.gov refuses a file, fetching nothing after it', async () => {
		const sec = secStandIn({
			exchange: { status: 403, body: { message: 'Request Rate Threshold Exceeded' } },
			fund: ok(fundFile(15_000))
		});
		const { email, sent } = recordingEmail();

		await refresh(sec, email);

		expect(sec.requests.map((r) => r.url)).toEqual([EXCHANGE_FILE_URL]);
		expect((await searchTickers(db, 'OLD', 8)).map((row) => row.symbol)).toEqual(['OLD']);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.text).toContain('sec.gov answered 403');
	});

	it('keeps the old list when a file parses to far fewer rows than sec.gov lists', async () => {
		const sec = secStandIn({ exchange: ok(exchangeFile(6_000)), fund: ok(fundFile(40)) });
		const { email, sent } = recordingEmail();

		await refresh(sec, email);

		expect((await searchTickers(db, 'OLD', 8)).map((row) => row.symbol)).toEqual(['OLD']);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.text).toContain(FUND_FILE_URL);
	});
});

describe('refreshTickersIfNoneHeld', () => {
	const refreshIfNone = (sec: ReturnType<typeof secStandIn>) =>
		refreshTickersIfNoneHeld(
			{ db, fetch: sec.fetch, email: recordingEmail().email, mailFrom: null },
			NOW
		);

	it('fetches nothing where a list is held, however old, leaving it to the daily run', async () => {
		const sec = wholeFiles();

		await refreshIfNone(sec);

		expect(sec.requests).toEqual([]);
		expect((await searchTickers(db, 'OLD', 8)).map((row) => row.symbol)).toEqual(['OLD']);
	});

	it('fetches the list where none was ever stored', async () => {
		await run(stmt('delete from ticker'));
		const sec = wholeFiles();

		await refreshIfNone(sec);

		expect(sec.requests).toHaveLength(2);
		expect(await searchTickers(db, 'C0', 1)).toHaveLength(1);
	});
});
