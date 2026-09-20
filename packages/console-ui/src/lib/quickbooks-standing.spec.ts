import type {
	LedgerAccountLine,
	QuickbooksCompany,
	QuickbooksPress,
	QuickbooksPressReport,
	QuickbooksRecourse,
	QuickbooksReport
} from '@better-giving/operator/console/quickbooks';
import { QUICKBOOKS_RECOURSES } from '@better-giving/operator/console/quickbooks';
import { describe, expect, it } from 'vitest';
import type { NoReport } from '../api/types';
import type { QuickbooksAnswer } from './quickbooks-standing';
import {
	CHOOSE,
	accountPicker,
	backlogSays,
	backlogStands,
	connectAddress,
	landedPress,
	picksToSave,
	quickbooksIntent,
	retriedGifts,
	retriedStands,
	startDay,
	startToSave,
	unanswered,
	unpickableStands,
	waitedSays
} from './quickbooks-standing';

// the QuickBooks section's own decisions, read where they are made rather than through a render:
// this package pins one node pool and no dom (../../vite.config.ts).

const NOW = new Date('2026-09-20T12:00:00.000Z');

const account = (id: string, name: string): LedgerAccountLine => ({
	id,
	name,
	type: 'Income',
	classification: 'Revenue'
});

const CHART: LedgerAccountLine[] = [account('1', 'Donations'), account('2', 'Bank')];

const company = (over: Partial<QuickbooksCompany> = {}): QuickbooksCompany => ({
	state: 'connected',
	realmId: '9130',
	companyName: 'Habitat',
	income: { id: '1', name: 'Donations' },
	fee: { id: '2', name: 'Bank' },
	deposit: { id: '2', name: 'Bank' },
	startAt: '2026-01-31T00:00:00.000Z',
	...over
});

/** the whole read the section is handed, connected and with nothing owed. */
const report = (over: Partial<QuickbooksReport> = {}): QuickbooksReport => ({
	connection: company(),
	accounts: { state: 'read', accounts: CHART },
	backlog: { failed: 0, oldestWaitingAt: null },
	callbackAddress: 'https://give.example.org/quickbooks/callback',
	...over
});

/**
 * the address the deployment answered the connect press with, which this console hands on unread.
 *
 * the consent host itself is not spelled here and may not be: it lives in the adapter that builds
 * this address and nowhere else, which
 * packages/app/src/lib/server/accounting/sole-importer.spec.ts sweeps the whole tree for.
 */
const CONSENT = 'https://consent.example.org/connect/oauth2?state=abc';

/** nothing came back about a press, which is the silence drawn at the press that made it. */
const NOTHING_ANSWERED: NoReport = { kind: 'unreachable', detail: 'nothing answered' };

const reported = (report: QuickbooksPressReport): QuickbooksAnswer => ({
	kind: 'reported',
	report
});

const silence = (press: QuickbooksPress): QuickbooksAnswer => ({
	kind: 'unanswered',
	press,
	read: NOTHING_ANSWERED
});

describe('a picker over the company’s own chart', () => {
	it('opens on an empty line where nothing is picked, so no account is chosen by standing still', () => {
		const picker = accountPicker(CHART, null);
		expect(picker.options[0]).toEqual({ value: '', label: CHOOSE });
		expect(picker.retired).toBeUndefined();
	});

	it('rides the type on the name, which is how two accounts called the same thing are told apart', () => {
		expect(accountPicker(CHART, { id: '1', name: 'Donations' }).options).toEqual([
			{ value: '1', label: 'Donations — Income' },
			{ value: '2', label: 'Bank — Income' }
		]);
	});

	it('keeps a pick the chart no longer offers, so nothing silently moves where gifts are posted', () => {
		expect(accountPicker(CHART, { id: '9', name: 'Old donations' }).retired).toEqual({
			value: '9',
			label: 'Old donations'
		});
	});
});

describe('the three are one press', () => {
	it('is no press while one of them is unchosen', () => {
		expect(picksToSave({ income: '1', fee: '2', deposit: '' }, company())).toBe(false);
	});

	it('is no press where all three are what is already stored', () => {
		expect(picksToSave({ income: '1', fee: '2', deposit: '2' }, company())).toBe(false);
	});

	it('is a press where one of them moved', () => {
		expect(picksToSave({ income: '2', fee: '2', deposit: '2' }, company())).toBe(true);
	});

	it('is a press on a connection holding none of the three', () => {
		const fresh = company({ income: null, fee: null, deposit: null });
		expect(picksToSave({ income: '1', fee: '2', deposit: '2' }, fresh)).toBe(true);
	});
});

describe('the day gifts are sent from', () => {
	it('draws the box with the day the instant falls on', () => {
		expect(startDay('2026-01-31T00:00:00.000Z')).toBe('2026-01-31');
	});

	it('draws an empty box where the connection carries no day at all', () => {
		expect(startDay('whenever')).toBe('');
	});

	it('is no press while the box holds the day already stored, or nothing', () => {
		expect(startToSave('2026-01-31', company())).toBe(false);
		expect(startToSave('', company())).toBe(false);
	});

	it('is a press where the day moved', () => {
		expect(startToSave('2026-02-01', company())).toBe(true);
	});
});

describe('how long the oldest has waited', () => {
	it('says nothing where nothing is waiting', () => {
		expect(waitedSays(null, NOW)).toBeNull();
	});

	it('is the coarsest unit still true', () => {
		expect(waitedSays('2026-09-20T11:30:00.000Z', NOW)).toBe('under an hour');
		expect(waitedSays('2026-09-20T10:30:00.000Z', NOW)).toBe('an hour');
		expect(waitedSays('2026-09-20T02:00:00.000Z', NOW)).toBe('10 hours');
		expect(waitedSays('2026-09-16T12:00:00.000Z', NOW)).toBe('4 days');
	});

	it('says the same of a gift queued on a clock running ahead of this one', () => {
		expect(waitedSays('2026-09-20T12:05:00.000Z', NOW)).toBe('under an hour');
	});
});

describe('the backlog speaks only where a gift was given up on', () => {
	it('says nothing at all where none was, however many are still on their way', () => {
		expect(
			backlogStands(report({ backlog: { failed: 0, oldestWaitingAt: NOW.toISOString() } }), NOW)
		).toBeNull();
	});

	it('names how many were given up on and how far behind the books are', () => {
		const stands = backlogStands(
			report({ backlog: { failed: 3, oldestWaitingAt: '2026-09-16T12:00:00.000Z' } }),
			NOW
		);
		expect(stands).toEqual({ failed: 3, waited: '4 days' });
	});

	it('says nothing where no company is connected, whatever the rows say', () => {
		// the press under it queues gifts for a deployment with nowhere to send them, and the
		// deployment refuses it (`notConnected` in packages/app/src/routes/console.quickbooks.ts).
		const stands = backlogStands(
			report({
				connection: { state: 'disconnected' },
				accounts: null,
				backlog: { failed: 3, oldestWaitingAt: '2026-09-16T12:00:00.000Z' }
			}),
			NOW
		);
		expect(stands).toBeNull();
	});

	it('says the two figures separately, each as what it is', () => {
		// the wait spans every gift still owed and the count is the given-up-on ones alone, so one
		// sentence over both would report a healthy gift's wait as a failure's.
		expect(backlogSays({ failed: 3, waited: '4 days' })).toBe(
			'3 gifts haven’t gone over. The books are 4 days behind.'
		);
	});

	it('says one gift as one gift', () => {
		expect(backlogSays({ failed: 1, waited: null })).toBe('1 gift hasn’t gone over.');
	});
});

describe('what the retry press answers with', () => {
	it('says what it queued, under a word off that sentence rather than off the press', () => {
		expect(retriedStands(0)).toEqual({
			word: 'Nothing queued',
			tone: 'note',
			says: 'Nothing was left to send.'
		});
		expect(retriedStands(1)).toEqual({
			word: 'Queued',
			tone: 'done',
			says: '1 gift will be tried again.'
		});
		expect(retriedStands(12).says).toBe('12 gifts will be tried again.');
	});
});

describe('which control an answer belongs to', () => {
	it('is the press the report names, and no other', () => {
		expect(landedPress(reported({ press: 'accounts' }), 'accounts')).toBe(true);
		expect(landedPress(reported({ press: 'accounts' }), 'start-date')).toBe(false);
		expect(landedPress(silence('accounts'), 'accounts')).toBe(false);
		expect(landedPress(null, 'accounts')).toBe(false);
	});

	it('hands the connect press its address and every other press none', () => {
		expect(connectAddress(reported({ press: 'connect', url: CONSENT }))).toBe(CONSENT);
		expect(connectAddress(reported({ press: 'disconnect' }))).toBeNull();
		expect(connectAddress(silence('connect'))).toBeNull();
		expect(connectAddress(null)).toBeNull();
	});

	it('hands the retry press what it queued, counting none as a count and not as silence', () => {
		expect(retriedGifts(reported({ press: 'retry', retried: 4 }))).toBe(4);
		expect(retriedGifts(reported({ press: 'retry', retried: 0 }))).toBe(0);
		expect(retriedGifts(reported({ press: 'accounts' }))).toBeNull();
		expect(retriedGifts(null)).toBeNull();
	});

	it('draws the deployment’s silence at the press it was silent about and at no other', () => {
		expect(unanswered(silence('retry'), 'retry')).toEqual(NOTHING_ANSWERED);
		expect(unanswered(silence('retry'), 'disconnect')).toBeNull();
		expect(unanswered(reported({ press: 'retry', retried: 1 }), 'retry')).toBeNull();
		expect(unanswered(null, 'retry')).toBeNull();
	});
});

describe('the intent a press posts', () => {
	it('is the press’s own name, so a section and the route answering it spell one thing once', () => {
		expect(quickbooksIntent('connect')).toBe('quickbooks:connect');
		expect(quickbooksIntent('start-date')).toBe('quickbooks:start-date');
	});
});

describe('where the three pickers would be, on a chart that could not be read', () => {
	it('offers the way back where the credential has lapsed, which is what a press mends', () => {
		expect(unpickableStands('reconnect')).toEqual({ connect: true, says: null });
	});

	it('offers no press where Intuit was unreachable, and says the read comes back on its own', () => {
		expect(unpickableStands('wait')).toEqual({
			connect: false,
			says: 'It keeps trying on its own.'
		});
	});

	it('offers no press and adds nothing where the deployment named no recourse', () => {
		// what it said is the whole of what is said: a press here would ask for a round trip through
		// Intuit over something like a rate limit.
		expect(unpickableStands(null)).toEqual({ connect: false, says: null });
	});

	it('draws no recourse at all where the deployment names one this console does not hold', () => {
		// the name arrives off the wire unread (`ask` in ../api/client.ts), so a deployment a release
		// ahead of this console names one the record has no entry for — and the type says otherwise.
		const ahead = 'rotate-keys' as QuickbooksRecourse;
		expect(unpickableStands(ahead)).toEqual({ connect: false, says: null });
	});

	it('answers every recourse the closed set holds with something an operator can read', () => {
		// read off the constant rather than listed here, so a third recourse fails this case instead
		// of falling through to the arm that draws nothing.
		const mute = QUICKBOOKS_RECOURSES.filter((recourse) => {
			const stands = unpickableStands(recourse);
			return !stands.connect && stands.says === null;
		});
		expect(mute).toEqual([]);
	});
});
