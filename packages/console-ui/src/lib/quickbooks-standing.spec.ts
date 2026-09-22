import type {
	ChosenAccountLine,
	LedgerAccountLine,
	QuickbooksCompany,
	QuickbooksPress,
	QuickbooksPressReport,
	QuickbooksRecourse,
	QuickbooksReport
} from '@better-giving/operator/console/quickbooks';
import { QUICKBOOKS_RECOURSES } from '@better-giving/operator/console/quickbooks';
import { describe, expect, it } from 'vitest';
import type { DeployedVar, NoReport } from '../api/types';
import { heldValues } from './held-values';
import type { AccountPick, QuickbooksAnswer } from './quickbooks-standing';
import {
	CHOOSE,
	accountPicker,
	backlogSays,
	backlogStands,
	connectAddress,
	credentialsPhase,
	credentialsStands,
	landedPress,
	picksToSave,
	QUICKBOOKS_FORM,
	quickbooksIntent,
	quickbooksRefused,
	retriedGifts,
	retriedStands,
	startDay,
	startToSave,
	unanswered,
	unpickableStands,
	waitedSays
} from './quickbooks-standing';
import { secretEdits } from './secret-edits';
import { QUICKBOOKS_GROUP, SECRET_GROUPS, VALUE_FIELD } from './secret-groups';

// the QuickBooks section's own decisions, read where they are made rather than through a render:
// this package pins one node pool and no dom (../../vite.config.ts).

const NOW = new Date('2026-09-20T12:00:00.000Z');

/** a line of the chart, fitting all three pickers unless it is said to fit fewer. */
const account = (
	id: string,
	name: string,
	roles: LedgerAccountLine['roles'] = ['income', 'fee', 'deposit']
): LedgerAccountLine => ({
	id,
	name,
	type: 'Income',
	subType: null,
	classification: 'Revenue',
	roles
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
		const picker = accountPicker(CHART, 'income', null, '');
		expect(picker.options[0]).toEqual({ value: '', label: CHOOSE });
		expect(picker.retired).toBeUndefined();
	});

	it('rides the type on the name, which is how two accounts called the same thing are told apart', () => {
		expect(accountPicker(CHART, 'income', { id: '1', name: 'Donations' }, '1').options).toEqual([
			{ value: '1', label: 'Donations — Income' },
			{ value: '2', label: 'Bank — Income' }
		]);
	});

	it('keeps a pick the chart no longer offers, so nothing silently moves where gifts are posted', () => {
		expect(accountPicker(CHART, 'income', { id: '9', name: 'Old donations' }, '9').retired).toEqual(
			{
				value: '9',
				label: 'Old donations'
			}
		);
	});

	it('offers the empty line whenever the picker is showing nothing, stored account or not', () => {
		// the list is built off the stored account and the selection is the operator's, so the two
		// can disagree: a picker showing nothing against a list that starts at the first account in
		// the chart displays that account, and posts it.
		const picker = accountPicker(CHART, 'income', { id: '1', name: 'Donations' }, '');
		expect(picker.options[0]).toEqual({ value: '', label: CHOOSE });
	});

	it('goes on offering the empty line after a pick, while the connection stores nothing', () => {
		// the line is what "nothing chosen" is, and a connection storing nothing is a connection an
		// operator can still be at that: a list that lost a row by being used leaves a mis-pick on a
		// fresh connection with no way back but a reload.
		const picker = accountPicker(CHART, 'income', null, '1');
		expect(picker.options[0]).toEqual({ value: '', label: CHOOSE });
	});

	it('drops the no-longer-offered line once another account is chosen', () => {
		// it is kept for the picker showing it and for nothing else
		// (`SelectWithNote` in packages/operator/src/components/forms/SelectWithNote.jsx).
		expect(
			accountPicker(CHART, 'income', { id: '9', name: 'Old donations' }, '2').retired
		).toBeUndefined();
	});

	it('names an account deactivated between two reads by the id the press posts', () => {
		// it was picked off a chart that held it and the next read does not, so there is no name for
		// it anywhere on this screen — and the id is what the press would send.
		expect(accountPicker(CHART, 'income', null, '8').retired).toEqual({ value: '8', label: '8' });
	});

	it('always offers a line matching what the picker is showing', () => {
		const retiredPick: ChosenAccountLine = { id: '9', name: 'Old donations' };
		const shown = (pick: ChosenAccountLine | null, showing: string): string => {
			const picker = accountPicker(CHART, 'income', pick, showing);
			const found =
				picker.options.some((option) => option.value === showing) ||
				picker.retired?.value === showing;
			return `${pick?.id ?? 'none'}/${showing === '' ? 'nothing' : showing}: ${found}`;
		};
		// the pairs `AccountsForm` can put on the screen: the selection starts at what the company
		// stores and moves only through the list, and every read of the chart can drop a line that
		// was in the last one — Intuit deactivates an account and the operator is mid-choice.
		expect([
			shown(null, ''),
			shown(null, '1'),
			shown(null, '8'),
			shown({ id: '1', name: 'Donations' }, '1'),
			shown({ id: '1', name: 'Donations' }, '2'),
			shown({ id: '1', name: 'Donations' }, '8'),
			shown(retiredPick, '9'),
			shown(retiredPick, '2'),
			shown(retiredPick, '8')
		]).toEqual([
			'none/nothing: true',
			'none/1: true',
			'none/8: true',
			'1/1: true',
			'1/2: true',
			'1/8: true',
			'9/9: true',
			'9/2: true',
			'9/8: true'
		]);
	});
});

describe('a picker offers only the accounts that fit it', () => {
	/** a chart as a company holds one: an account per role, and one that fits none of them. */
	const MIXED: LedgerAccountLine[] = [
		account('10', 'Donations', ['income']),
		account('20', 'Merchant fees', ['fee']),
		account('30', 'Checking', ['deposit']),
		account('40', 'Accounts receivable', [])
	];
	const offered = (role: AccountPick) =>
		accountPicker(MIXED, role, null, '').options.map((option) => option.value);

	it('holds each picker to the accounts whose roles name it', () => {
		// the one list, filtered three ways: an account offered where it does not fit is a save the
		// deployment is certain to refuse.
		expect([offered('income'), offered('fee'), offered('deposit')]).toEqual([
			['', '10'],
			['', '20'],
			['', '30']
		]);
	});

	it('keeps a stored pick that does not fit, chosen and retired, until it is replaced', () => {
		// a deployment holding Accounts Receivable as its deposit account: the screen says so rather
		// than drawing the picker on an account the books do not post to.
		const stored = { id: '40', name: 'Accounts receivable' };
		const picker = accountPicker(MIXED, 'deposit', stored, '40');

		expect(picker.options.map((option) => option.value)).toEqual(['30']);
		expect(picker.retired).toEqual({ value: '40', label: 'Accounts receivable' });
		// and gone once another is chosen, as a deactivated one is.
		expect(accountPicker(MIXED, 'deposit', stored, '30').retired).toBeUndefined();
	});

	it('retires an account that fits another picker and not this one', () => {
		// the deployment holding an expense as its income account.
		const stored = { id: '20', name: 'Merchant fees' };

		expect(accountPicker(MIXED, 'income', stored, '20').retired).toEqual({
			value: '20',
			label: 'Merchant fees'
		});
	});
});

describe('the three are one press', () => {
	it('is no press while one of them is unchosen', () => {
		expect(picksToSave({ income: '1', fee: '2', deposit: '' }, company(), CHART)).toBe(false);
	});

	it('is no press where all three are what is already stored', () => {
		expect(picksToSave({ income: '1', fee: '2', deposit: '2' }, company(), CHART)).toBe(false);
	});

	it('is a press where one of them moved', () => {
		expect(picksToSave({ income: '2', fee: '2', deposit: '2' }, company(), CHART)).toBe(true);
	});

	it('is no press while one of them still shows a pick its picker does not offer', () => {
		// Accounts Receivable held as the deposit account, carried as the picker's retired line: the
		// income moved, and the save would still be refused over the deposit.
		const chart = [
			account('1', 'Donations', ['income']),
			account('3', 'Sponsorships', ['income']),
			account('2', 'Bank', ['fee', 'deposit']),
			account('4', 'Accounts receivable', [])
		];
		const stored = company({ deposit: { id: '4', name: 'Accounts receivable' } });

		expect(picksToSave({ income: '3', fee: '2', deposit: '4' }, stored, chart)).toBe(false);
		// and armed again once it is replaced.
		expect(picksToSave({ income: '3', fee: '2', deposit: '2' }, stored, chart)).toBe(true);
		// an account the chart no longer holds at all is refused the same way.
		expect(picksToSave({ income: '9', fee: '2', deposit: '2' }, stored, chart)).toBe(false);
	});

	it('is a press on a connection holding none of the three', () => {
		const fresh = company({ income: null, fee: null, deposit: null });
		expect(picksToSave({ income: '1', fee: '2', deposit: '2' }, fresh, CHART)).toBe(true);
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

/** the three names the group's press carries, which is what the boxes are drawn from. */
const NAMES = SECRET_GROUPS.find((one) => one.id === QUICKBOOKS_GROUP)?.names ?? [];

/** what each of the three boxes is drawn holding, as ./quickbooks-section.tsx seeds them. */
const drawn = (vars: readonly DeployedVar[]): Record<string, string> => {
	const values = heldValues(vars);
	return Object.fromEntries(NAMES.map((name) => [name, values.seeds[name] ?? '']));
};

/** the same three, in the order the group lists, as `name → value`. */
const boxes = (...vars: readonly DeployedVar[]): string[] => {
	const holding = drawn(vars);
	return NAMES.map((name) => `${name} → ${holding[name]}`);
};

describe('what the three QuickBooks boxes open holding', () => {
	it('opens every one of them empty where the deployment holds nothing, the address included', () => {
		// the production address stands on the address box as a placeholder and is no value of it
		// (`PLACEHOLDER` in ./quickbooks-section.tsx): a box drawn holding a string
		// nobody typed is one the next press stores.
		expect(boxes()).toEqual([
			'QUICKBOOKS_CLIENT_ID → ',
			'QUICKBOOKS_CLIENT_SECRET → ',
			'QUICKBOOKS_API_URL → '
		]);
	});

	it('opens a name held in a form nothing can read back blank', () => {
		expect(boxes({ name: 'QUICKBOOKS_API_URL', kind: 'withheld' })).toEqual([
			'QUICKBOOKS_CLIENT_ID → ',
			'QUICKBOOKS_CLIENT_SECRET → ',
			'QUICKBOOKS_API_URL → '
		]);
	});

	it('opens the address box on the address the deployment stores, which a sandbox one is', () => {
		expect(
			boxes({
				name: 'QUICKBOOKS_API_URL',
				kind: 'value',
				value: 'https://sandbox-quickbooks.api.intuit.com'
			})
		).toEqual([
			'QUICKBOOKS_CLIENT_ID → ',
			'QUICKBOOKS_CLIENT_SECRET → ',
			'QUICKBOOKS_API_URL → https://sandbox-quickbooks.api.intuit.com'
		]);
	});
});

describe('what a press of the three boxes asks the deployment to do', () => {
	/**
	 * a deployment holding none of the three, which is the state a press is made in twice: before
	 * anything was ever stored, and on the read after an address was removed.
	 */
	const FRESH: DeployedVar[] = NAMES.map((name) => ({ name, kind: 'absent' }));

	/** the three boxes as they are drawn, with what the operator typed over them, pressed. */
	const pressed = (vars: readonly DeployedVar[], typed: Record<string, string>) => {
		const holding = drawn(vars);
		const posted = new FormData();
		for (const name of NAMES) posted.set(VALUE_FIELD(name), typed[name] ?? holding[name] ?? '');
		return secretEdits(NAMES, posted, heldValues(vars).seeds);
	};

	it('stores no address where the operator typed the pair and left the third box alone', () => {
		// an operator connecting a sandbox company types the pair, never reads the third box and
		// presses Save — and an address drawn into that box is stored by that press, against a
		// company whose books are real. the same press on the read after a removal puts the removed
		// address back.
		expect(
			pressed(FRESH, { QUICKBOOKS_CLIENT_ID: 'AB0123', QUICKBOOKS_CLIENT_SECRET: 'shh' })
		).toEqual({
			ok: true,
			payload: { QUICKBOOKS_CLIENT_ID: 'AB0123', QUICKBOOKS_CLIENT_SECRET: 'shh' }
		});
	});

	it('takes the address the operator typed into the box', () => {
		expect(
			pressed(FRESH, { QUICKBOOKS_API_URL: 'https://sandbox-quickbooks.api.intuit.com' })
		).toEqual({
			ok: true,
			payload: { QUICKBOOKS_API_URL: 'https://sandbox-quickbooks.api.intuit.com' }
		});
	});
});

describe('what one press of the three boxes did', () => {
	it('reports a write that left something on the deployment', () => {
		expect(credentialsStands({ kind: 'set' })).toEqual({
			landed: true,
			settled: true,
			says: null
		});
	});

	it('says so where the deployment was already holding what the boxes asked for', () => {
		// nothing was stored, so the button reports nothing — and a press answered by nothing at all
		// moving is one an operator makes again.
		expect(credentialsStands({ kind: 'unchanged' })).toEqual({
			landed: false,
			settled: true,
			says: 'Your deployment was already holding these, so nothing was stored.'
		});
	});

	it('says the same where there was nothing to send at all', () => {
		// the two are one fact to whoever pressed: a box is sent only where it differs from what the
		// deployment holds (`secretEdits` in ./secret-edits.ts).
		expect(credentialsStands({ kind: 'nothing' })).toEqual({
			landed: false,
			settled: true,
			says: 'Your deployment was already holding these, so nothing was stored.'
		});
	});

	it('leaves a name held as a credential to the block that frees it', () => {
		// the boxes still hold what was typed and the press is worth making again once it is freed
		// (./withheld-values.tsx).
		expect(credentialsStands({ kind: 'withheld', names: ['QUICKBOOKS_API_URL'] })).toEqual({
			landed: false,
			settled: false,
			says: null
		});
	});

	it('leaves a refusal to the sentence drawn under the press', () => {
		expect(credentialsStands({ kind: 'refused', detail: 'no' })).toEqual({
			landed: false,
			settled: false,
			says: null
		});
	});

	it('says nothing where no press of these boxes has been answered', () => {
		expect(credentialsStands(null)).toEqual({ landed: false, settled: false, says: null });
	});
});

const phase = (over: Partial<Parameters<typeof credentialsPhase>[0]> = {}) =>
	credentialsPhase({
		own: false,
		revalidating: false,
		busy: false,
		settled: false,
		spent: false,
		...over
	});

describe('where the press of the three boxes stands', () => {
	it('leaves them open at rest', () => {
		expect(phase()).toEqual({ underway: false, closed: false });
	});

	it('closes them while the press is sent', () => {
		expect(phase({ own: true, busy: true })).toEqual({ underway: true, closed: true });
	});

	it('reopens them the moment a press that stored nothing is answered', () => {
		// the page is read again over that answer for seconds, and a box closed then is one the
		// focus move to a refused box cannot reach (./use-console-form.ts).
		expect(phase({ own: true, busy: true, revalidating: true })).toEqual({
			underway: false,
			closed: false
		});
	});

	it('keeps them closed over a press that settled until the reading behind it lands', () => {
		expect(phase({ own: true, busy: true, revalidating: true, settled: true }).closed).toBe(true);
		expect(phase({ settled: true }).closed).toBe(true);
		expect(phase({ settled: true, spent: true }).closed).toBe(false);
	});

	it('closes them while another press on the page writes', () => {
		expect(phase({ busy: true })).toEqual({ underway: false, closed: true });
	});
});

describe('the form the three boxes are mounted through', () => {
	it('states a box for every name the press writes, keyed by what that box posts', () => {
		// the seam counts a form dirty over the boxes the schema states and no others, so a name
		// missing here is a box whose value never arms the save.
		expect(Object.keys(QUICKBOOKS_FORM.schema.shape)).toEqual(NAMES.map(VALUE_FIELD));
	});

	it('takes an empty box, which is how a stored value is asked to be removed', () => {
		// the rule over these three is the deployment's and not the browser's (./secret-edits.ts):
		// a box the pass refused as required would be a value nothing on this page could take away.
		const empty = Object.fromEntries(NAMES.map((name) => [VALUE_FIELD(name), '']));
		expect(QUICKBOOKS_FORM.schema.safeParse(empty).success).toBe(true);
	});
});

describe('the deployment’s refusal carried onto these boxes', () => {
	it('keys it to the box that posts the name it is about', () => {
		expect(quickbooksRefused({ QUICKBOOKS_API_URL: 'Not an address.' }, NAMES)).toEqual({
			[VALUE_FIELD('QUICKBOOKS_API_URL')]: 'Not an address.'
		});
	});

	it('drops a name this section draws no box for', () => {
		// a sentence keyed to a box nobody has on the screen puts focus nowhere and holds the next
		// press back over a box that cannot be put right.
		expect(quickbooksRefused({ SMTP_HOST: 'No.' }, NAMES)).toBeNull();
	});

	it('answers nothing where the last press was not refused', () => {
		expect(quickbooksRefused(null, NAMES)).toBeNull();
	});
});
