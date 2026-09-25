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
import type { DeployedVar, NoReport, QuickbooksRead } from '../api/types';
import { heldValues } from './held-values';
import type {
	AccountPick,
	QuickbooksAnswer,
	StepName,
	StepStanding,
	StepsStanding
} from './quickbooks-standing';
import {
	CHOOSE,
	FAILED,
	HOLDING_HINT,
	HOLDING_PICKS,
	NONE,
	PICK_GROUP_LEGEND,
	PICK_LABEL,
	awaitingSays,
	holdingsDrawn,
	misfitPick,
	misfitSays,
	revokeStands,
	REFUSED,
	UNANSWERED,
	answeredSince,
	connectLink,
	holdOpen,
	pressedAddress,
	savedSays,
	savingUntilRead,
	shutSendsTo,
	openedSays,
	opensNext,
	startDateNext,
	stepWord,
	unansweredSays,
	accountPicker,
	chartStands,
	companyCalled,
	disconnectLines,
	keysAsk,
	ownPress,
	picksArmed,
	picksMissing,
	startDateAsk,
	stepsStand,
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
	retryButton,
	startDay,
	startToSave,
	unanswered,
	waitedSays
} from './quickbooks-standing';
import { CHARGE_PAIRS } from './processor-links';
import { secretEdits } from './secret-edits';
import { QUICKBOOKS_GROUP, SECRET_GROUPS, VALUE_FIELD } from './secret-groups';

// the QuickBooks section's own decisions, read where they are made rather than through a render:
// this package pins one node pool and no dom (../../vite.config.ts).

const NOW = new Date('2026-09-20T12:00:00.000Z');

/** a line of the chart, fitting income, fees and Stripe's holding unless it is said to fit fewer. */
const account = (
	id: string,
	name: string,
	roles: LedgerAccountLine['roles'] = ['income', 'fee', 'stripeBalance']
): LedgerAccountLine => ({
	id,
	name,
	type: 'Income',
	subType: null,
	classification: 'Revenue',
	roles
});

const CHART: LedgerAccountLine[] = [account('1', 'Donations'), account('2', 'Bank')];

/** the holdings a case says nothing about, unchosen in the boxes as they are in `company()`. */
const UNHELD = {
	paypalBalance: '',
	chariotBalance: '',
	nowpaymentsBalance: '',
	undepositedFunds: ''
};

const company = (over: Partial<QuickbooksCompany> = {}): QuickbooksCompany => ({
	state: 'connected',
	realmId: '9130',
	companyName: 'Habitat',
	income: { id: '1', name: 'Donations' },
	fee: { id: '2', name: 'Bank' },
	stripeBalance: { id: '2', name: 'Bank' },
	paypalBalance: null,
	chariotBalance: null,
	nowpaymentsBalance: null,
	undepositedFunds: null,
	awaitingAccounts: false,
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

	it('keeps a pick the chart no longer holds, under its stored name alone, so nothing silently moves', () => {
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
		account('30', 'Stripe balance', ['stripeBalance']),
		account('40', 'Accounts receivable', [])
	];
	const offered = (role: AccountPick) =>
		accountPicker(MIXED, role, null, '').options.map((option) => option.value);

	it('holds each picker to the accounts whose roles name it', () => {
		// the one list, filtered three ways: an account offered where it does not fit is a save the
		// deployment is certain to refuse.
		expect([offered('income'), offered('fee'), offered('stripeBalance')]).toEqual([
			['', '10'],
			['', '20'],
			['', '30']
		]);
	});

	it('keeps a stored pick that does not fit, chosen and retired, until it is replaced', () => {
		// a deployment holding Accounts Receivable as Stripe's holding: the screen says so rather
		// than drawing the picker on an account the books do not post to.
		const stored = { id: '40', name: 'Accounts receivable' };
		const picker = accountPicker(MIXED, 'stripeBalance', stored, '40');

		// none first, as every holding offers it, stored account or not.
		expect(picker.options.map((option) => option.value)).toEqual(['', '30']);
		// labelled as the offered lines are, off the chart that still holds it: the type is the
		// reason it was retired.
		expect(picker.retired).toEqual({ value: '40', label: 'Accounts receivable — Income' });
		// and gone once another is chosen, as a deactivated one is.
		expect(accountPicker(MIXED, 'stripeBalance', stored, '30').retired).toBeUndefined();
	});

	it('retires an account that fits another picker and not this one', () => {
		// the deployment holding an expense as its income account.
		const stored = { id: '20', name: 'Merchant fees' };

		expect(accountPicker(MIXED, 'income', stored, '20').retired).toEqual({
			value: '20',
			label: 'Merchant fees — Income'
		});
	});
});

describe('the picks are one press', () => {
	it('is no press while income or fees is unchosen', () => {
		expect(
			picksToSave({ ...UNHELD, income: '1', fee: '', stripeBalance: '2' }, company(), CHART)
		).toBe(false);
	});

	it('is a press where a holding is left unchosen, which holds that processor’s gifts alone', () => {
		expect(
			picksToSave({ ...UNHELD, income: '1', fee: '2', stripeBalance: '' }, company(), CHART)
		).toBe(true);
	});

	it('is no press where all three are what is already stored', () => {
		expect(
			picksToSave({ ...UNHELD, income: '1', fee: '2', stripeBalance: '2' }, company(), CHART)
		).toBe(false);
	});

	it('is a press where one of them moved', () => {
		expect(
			picksToSave({ ...UNHELD, income: '2', fee: '2', stripeBalance: '2' }, company(), CHART)
		).toBe(true);
	});

	it('is no press while one of them still shows a pick its picker does not offer', () => {
		// Accounts Receivable held as Stripe's holding, carried as the picker's retired line: the
		// income moved, and the save would still be refused over the holding.
		const chart = [
			account('1', 'Donations', ['income']),
			account('3', 'Sponsorships', ['income']),
			account('2', 'Bank', ['fee', 'stripeBalance']),
			account('4', 'Accounts receivable', [])
		];
		const stored = company({ stripeBalance: { id: '4', name: 'Accounts receivable' } });

		expect(
			picksToSave({ ...UNHELD, income: '3', fee: '2', stripeBalance: '4' }, stored, chart)
		).toBe(false);
		// and armed again once it is replaced.
		expect(
			picksToSave({ ...UNHELD, income: '3', fee: '2', stripeBalance: '2' }, stored, chart)
		).toBe(true);
		// an account the chart no longer holds at all is refused the same way.
		expect(
			picksToSave({ ...UNHELD, income: '9', fee: '2', stripeBalance: '2' }, stored, chart)
		).toBe(false);
	});

	it('is a press over the stored picks on a connection awaiting its accounts', () => {
		// the save is what releases a moved connection, so saving it as it stands is the press.
		const moved = company({ awaitingAccounts: true });
		expect(
			picksToSave({ ...UNHELD, income: '1', fee: '2', stripeBalance: '2' }, moved, CHART)
		).toBe(true);
	});

	it('is a press on a connection holding none of the three', () => {
		const fresh = company({ income: null, fee: null, stripeBalance: null });
		expect(
			picksToSave({ ...UNHELD, income: '1', fee: '2', stripeBalance: '2' }, fresh, CHART)
		).toBe(true);
	});
});

describe('a holding offers none', () => {
	it('offers none first on a holding the connection stores', () => {
		const picker = accountPicker(CHART, 'stripeBalance', { id: '2', name: 'Bank' }, '2');
		expect(picker.options[0]).toEqual({ value: '', label: NONE });
	});

	it('offers none, and not the prompt, on a holding storing nothing', () => {
		expect(accountPicker(CHART, 'stripeBalance', null, '').options[0]).toEqual({
			value: '',
			label: NONE
		});
	});

	it('leaves income without an empty line once it stores one', () => {
		expect(
			accountPicker(CHART, 'income', { id: '1', name: 'Donations' }, '1').options.map(
				(option) => option.value
			)
		).toEqual(['1', '2']);
	});

	it('is a press set back to none from a stored holding', () => {
		expect(
			picksToSave({ ...UNHELD, income: '1', fee: '2', stripeBalance: '' }, company(), CHART)
		).toBe(true);
	});
});

describe('which holdings the section draws', () => {
	const nothingStored = company({ stripeBalance: null });

	it('draws the gifts recorded by hand alone where the deployment takes no processor', () => {
		expect(holdingsDrawn(nothingStored, new Set())).toEqual(['undepositedFunds']);
	});

	it('draws a processor’s holding once its charge pair is held, and not on half of it', () => {
		expect(holdingsDrawn(nothingStored, new Set(CHARGE_PAIRS.paypal))).toEqual([
			'paypalBalance',
			'undepositedFunds'
		]);
		expect(holdingsDrawn(nothingStored, new Set(CHARGE_PAIRS.paypal.slice(0, 1)))).toEqual([
			'undepositedFunds'
		]);
	});

	it('draws every holding in the wire’s order where every processor is set up', () => {
		expect(holdingsDrawn(nothingStored, new Set(Object.values(CHARGE_PAIRS).flat()))).toEqual(
			HOLDING_PICKS
		);
	});

	it('draws a holding the connection stores whatever the processor', () => {
		expect(holdingsDrawn(company(), new Set())).toEqual(['stripeBalance', 'undepositedFunds']);
	});
});

describe('what each picker is called', () => {
	it('names the two groups and every picker in fundraiser words', () => {
		expect(PICK_GROUP_LEGEND).toEqual({
			gift: 'What a gift is recorded as',
			holding: 'Where money waits before it reaches your bank'
		});
		expect(PICK_LABEL).toEqual({
			income: 'Income',
			fee: 'Processing fees',
			stripeBalance: 'Stripe balance',
			paypalBalance: 'PayPal balance',
			chariotBalance: 'Chariot balance',
			nowpaymentsBalance: 'NOWPayments balance',
			undepositedFunds: 'Gifts recorded by hand'
		});
	});

	it('says over every holding that its money leaves as a transfer off the bank feed', () => {
		for (const pick of HOLDING_PICKS)
			expect(HOLDING_HINT[pick]).toMatch(
				/from your bank feed as a transfer out of this account\.$/
			);
		expect(HOLDING_HINT.nowpaymentsBalance).toBe(
			'Record each NOWPayments payout from your bank feed as a transfer out of this account.'
		);
	});
});

describe('a connection awaiting its accounts', () => {
	it('says the connection moved, to which company, and that nothing is sent until a save', () => {
		expect(awaitingSays(company({ awaitingAccounts: true }))).toBe(
			'This connection moved to Habitat, and nothing is sent to QuickBooks until its accounts are saved.'
		);
	});

	it('says nothing over a connection that stayed', () => {
		expect(awaitingSays(company())).toBeNull();
	});
});

describe('the picker a refusal of the accounts press names', () => {
	const DRAWN: AccountPick[] = ['income', 'fee', 'stripeBalance', 'undepositedFunds'];
	const refused = (over: Partial<Extract<NoReport, { kind: 'unreadable' }>>): QuickbooksAnswer => ({
		kind: 'unanswered',
		press: 'accounts',
		read: {
			kind: 'unreadable',
			error: 'account_wrong_type',
			detail:
				'`stripeBalance` names Checking, a Bank account. Stripe balance is where a gift waits.',
			fix: 'Send the `id` of an Other Current Asset account for `stripeBalance`.',
			status: 400,
			...over
		}
	});

	it('is the holding a Bank account was chosen for', () => {
		expect(misfitPick(refused({}), DRAWN)).toBe('stripeBalance');
	});

	it('is nothing where the named picker is not drawn, so the press says it', () => {
		expect(misfitPick(refused({}), ['income', 'fee', 'undepositedFunds'])).toBeNull();
	});

	it('is nothing for another refusal, a failure outside 4xx, or another press', () => {
		expect(misfitPick(refused({ error: 'bad_body' }), DRAWN)).toBeNull();
		expect(misfitPick(refused({ status: 502 }), DRAWN)).toBeNull();
		expect(misfitPick(silence('accounts'), DRAWN)).toBeNull();
		expect(misfitPick(reported({ press: 'accounts' }), DRAWN)).toBeNull();
	});

	it('is nothing where the sentence names no role it leads with', () => {
		expect(misfitPick(refused({ detail: 'Checking is a Bank account.' }), DRAWN)).toBeNull();
		expect(misfitPick(refused({ detail: '`deposit` names Checking.' }), DRAWN)).toBeNull();
	});

	it('says at a holding what a holding takes, and at income or fees to pick again', () => {
		expect(misfitSays('stripeBalance')).toBe(
			'pick an Other Current Asset account, never a bank account'
		);
		expect(misfitSays('income')).toBe('pick another account from this list');
	});
});

describe('what a disconnect answers about the revoke', () => {
	it('carries the detail and the fix where Intuit did not confirm it', () => {
		expect(
			revokeStands(
				reported({
					press: 'disconnect',
					revoke: { state: 'not_revoked', detail: 'Intuit answered 500.', fix: 'Open My Apps.' }
				})
			)
		).toEqual({ detail: 'Intuit answered 500.', fix: 'Open My Apps.' });
	});

	it('says nothing where the revoke landed, or the answer is another press’s', () => {
		expect(
			revokeStands(reported({ press: 'disconnect', revoke: { state: 'revoked' } }))
		).toBeNull();
		expect(revokeStands(reported({ press: 'retry', retried: 0 }))).toBeNull();
		expect(revokeStands(silence('disconnect'))).toBeNull();
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
		expect(waitedSays('2026-09-20T02:00:00.000Z', NOW)).toBe('10\u00a0hours');
		expect(waitedSays('2026-09-16T12:00:00.000Z', NOW)).toBe('4\u00a0days');
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
		expect(stands).toEqual({ failed: 3, waited: '4\u00a0days' });
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
			'3 gifts didn’t sync. QuickBooks is 4 days behind.'
		);
	});

	it('says one gift as one gift', () => {
		expect(backlogSays({ failed: 1, waited: null })).toBe('1 gift didn’t sync.');
	});
});

describe('what the retry press answers with', () => {
	it('reports what it queued on its own button', () => {
		expect(retriedStands(1)).toEqual({ doneLabel: '1 retrying', says: null });
		expect(retriedStands(12)).toEqual({ doneLabel: '12 retrying', says: null });
	});

	it('draws no tick where nothing was left, and says so beside the button instead', () => {
		// a sweep drained the queue between the read and the press, or this is the second press: a
		// tick over nothing moving is a save that did not happen.
		expect(retriedStands(0)).toEqual({ doneLabel: null, says: 'Nothing was left to send.' });
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
		expect(
			connectAddress(reported({ press: 'disconnect', revoke: { state: 'revoked' } }))
		).toBeNull();
		expect(connectAddress(silence('connect'))).toBeNull();
		expect(connectAddress(null)).toBeNull();
	});

	it('draws the address only for a connect press made since the press was drawn', () => {
		const stale = reported({ press: 'connect', url: CONSENT });
		// drawn over an answer already standing, and never pressed: that address is spent.
		expect(pressedAddress(stale, null)).toBeNull();
		expect(pressedAddress(stale, { over: stale })).toBeNull();
		const fresh = reported({ press: 'connect', url: `${CONSENT}2` });
		expect(pressedAddress(fresh, { over: stale })).toBe(`${CONSENT}2`);
		expect(pressedAddress(fresh, { over: null })).toBe(`${CONSENT}2`);
		expect(pressedAddress(reported({ press: 'retry', retried: 1 }), { over: null })).toBeNull();
	});

	it('keeps the link through a re-read that shows no company, which carries no answer', () => {
		const still = { fresh: null, connected: false, otherPress: false };
		expect(connectLink(CONSENT, still)).toBe(CONSENT);
		expect(connectLink(null, still)).toBeNull();
	});

	it('takes the link away once a re-read shows the company connected', () => {
		expect(connectLink(CONSENT, { fresh: null, connected: true, otherPress: false })).toBeNull();
		expect(connectLink(CONSENT, { fresh: CONSENT, connected: true, otherPress: false })).toBeNull();
	});

	it('replaces the link with the one a new connect press answered', () => {
		expect(
			connectLink(CONSENT, { fresh: `${CONSENT}2`, connected: false, otherPress: false })
		).toBe(`${CONSENT}2`);
	});

	it('takes the link away when another press on the page is made', () => {
		expect(connectLink(CONSENT, { fresh: CONSENT, connected: false, otherPress: true })).toBeNull();
	});

	it('counts an answer as a control’s own only where it arrived after that control’s press', () => {
		const standing = reported({ press: 'accounts' });
		expect(answeredSince(standing, null)).toBeNull();
		expect(answeredSince(standing, { over: standing })).toBeNull();
		expect(answeredSince(standing, { over: null })).toBe(standing);
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

describe('a chart that could not be read', () => {
	const unreadable = (recourse: QuickbooksRecourse | null): QuickbooksReport['accounts'] => ({
		state: 'unreadable',
		recourse,
		detail: 'QuickBooks refused the credential (401).'
	});

	it('says nothing where the chart was read, or where nothing is connected', () => {
		expect(chartStands({ state: 'read', accounts: CHART })).toBeNull();
		expect(chartStands(null)).toBeNull();
	});

	it('puts a lapsed credential at Connect, with the press that mends it', () => {
		expect(chartStands(unreadable('reconnect'))).toEqual({
			step: 'connect',
			says: 'QuickBooks turned this connection down.'
		});
	});

	it('puts an unreachable QuickBooks at Accounts, and says the read comes back on its own', () => {
		expect(chartStands(unreadable('wait'))).toEqual({
			step: 'accounts',
			says: 'QuickBooks can’t be reached right now. This deployment keeps trying.'
		});
	});

	it('never quotes the deployment, whatever recourse it named or did not', () => {
		// the name arrives off the wire unread (`ask` in ../api/client.ts), so a deployment a release
		// ahead of this console names one the closed set has no entry for.
		const ahead = 'rotate-keys' as QuickbooksRecourse;
		for (const recourse of [null, ahead]) {
			expect(chartStands(unreadable(recourse))).toEqual({
				step: 'accounts',
				says: 'This deployment couldn’t read your chart of accounts.'
			});
		}
	});

	it('answers every recourse the closed set holds at a step', () => {
		const said = QUICKBOOKS_RECOURSES.map((recourse) => chartStands(unreadable(recourse))?.says);
		expect(said.every((says) => typeof says === 'string' && !says.includes('401'))).toBe(true);
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

describe('which steps stand open, shut, locked or out of sight', () => {
	const read = (over: Partial<QuickbooksReport> = {}): QuickbooksRead => ({
		kind: 'read',
		report: report(over)
	});
	const DISCONNECTED = read({ connection: { state: 'disconnected' }, accounts: null });

	/** each step as one word a case reads down: open, shut, locked, and what it stands at. */
	const drawn = (steps: StepsStanding): string[] => [
		...(['setup', 'connect', 'accounts'] as const).map((name: StepName) => {
			const step = steps[name];
			const at = step.trouble ? 'trouble' : step.done ? 'done' : 'todo';
			return `${name}: ${step.locked ? 'locked' : step.open ? 'open' : 'shut'} ${at}`;
		}),
		`sync: ${steps.sync ? 'shown' : 'hidden'}`
	];
	const stand = (over: Partial<Parameters<typeof stepsStand>[0]> = {}) =>
		drawn(stepsStand({ configured: true, books: read(), answer: null, confirming: null, ...over }));

	it('opens Setup on a first visit and locks the two after it', () => {
		expect(stand({ configured: false, books: DISCONNECTED })).toEqual([
			'setup: open todo',
			'connect: locked todo',
			'accounts: locked todo',
			'sync: hidden'
		]);
	});

	it('moves on to Connect once the keys are held, and keeps Accounts locked behind it', () => {
		expect(stand({ books: DISCONNECTED })).toEqual([
			'setup: shut done',
			'connect: open todo',
			'accounts: locked todo',
			'sync: hidden'
		]);
	});

	it('reopens Accounts and hides sync over a connection that moved, whatever it stores', () => {
		// nothing is sent until the moved connection's accounts are saved, so the step is not done.
		expect(stand({ books: read({ connection: company({ awaitingAccounts: true }) }) })).toEqual([
			'setup: shut done',
			'connect: shut done',
			'accounts: open todo',
			'sync: hidden'
		]);
	});

	it('holds a finished step open while its button is still showing the save that finished it', () => {
		expect(stand({ books: DISCONNECTED, confirming: { step: 'setup', finishing: true } })[0]).toBe(
			'setup: open done'
		);
		expect(stand({ confirming: { step: 'accounts', finishing: true } })[2]).toBe(
			'accounts: open done'
		);
	});

	it('leaves a step saved again to whoever opened it: the prop never moves, so nothing shuts it', () => {
		expect(stand({ confirming: { step: 'accounts', finishing: false } })[2]).toBe(
			'accounts: shut done'
		);
		expect(stand({ confirming: { step: 'setup', finishing: false } })[0]).toBe('setup: shut done');
	});

	it('never opens a locked step, whatever else asks for it', () => {
		expect(
			stand({
				configured: false,
				books: DISCONNECTED,
				confirming: { step: 'accounts', finishing: true }
			}).slice(1, 3)
		).toEqual(['connect: locked todo', 'accounts: locked todo']);
	});

	it('opens Accounts where the connect left one of the three unpicked', () => {
		expect(stand({ books: read({ connection: company({ fee: null }) }) })).toEqual([
			'setup: shut done',
			'connect: shut done',
			'accounts: open todo',
			'sync: hidden'
		]);
	});

	it('shuts every step and shows Sync once all three are done', () => {
		expect(stand()).toEqual([
			'setup: shut done',
			'connect: shut done',
			'accounts: shut done',
			'sync: shown'
		]);
	});

	it('opens Connect in trouble where the credential lapsed, and leaves Sync standing', () => {
		const lapsed = read({
			accounts: { state: 'unreadable', recourse: 'reconnect', detail: '401' }
		});
		expect(stand({ books: lapsed })).toEqual([
			'setup: shut done',
			'connect: open trouble',
			'accounts: shut done',
			'sync: shown'
		]);
	});

	it('opens Accounts in trouble where QuickBooks could not be reached, and leaves Sync standing', () => {
		// the backlog and its retry are what an operator reaches for while gifts are failing, so an
		// outage is the last reason to take them away.
		const away = read({ accounts: { state: 'unreadable', recourse: 'wait', detail: 'TypeError' } });
		expect(stand({ books: away })).toEqual([
			'setup: shut done',
			'connect: shut done',
			'accounts: open trouble',
			'sync: shown'
		]);
	});

	it('opens Connect in trouble where the connection could not be read at all', () => {
		expect(stand({ books: { kind: 'unread', read: NOTHING_ANSWERED } })).toEqual([
			'setup: shut done',
			'connect: open trouble',
			'accounts: locked todo',
			'sync: hidden'
		]);
	});

	it('opens Connect in trouble where the connect press went unanswered', () => {
		expect(stand({ books: DISCONNECTED, answer: silence('connect') })[1]).toBe(
			'connect: open trouble'
		);
	});

	it('opens a finished Accounts where its save went unanswered, and leaves Sync standing', () => {
		expect(stand({ answer: silence('accounts') })).toEqual([
			'setup: shut done',
			'connect: shut done',
			'accounts: open done',
			'sync: shown'
		]);
	});

	it('opens a finished Connect where Intuit has not named the company', () => {
		expect(stand({ books: read({ connection: company({ companyName: null }) }) })[1]).toBe(
			'connect: open done'
		);
	});
});

describe('what a step says about itself and what its save opens', () => {
	const standing = (over: Partial<StepStanding> = {}): StepStanding => ({
		done: false,
		trouble: false,
		locked: false,
		open: false,
		...over
	});
	const all = (
		over: Partial<Record<StepName, Partial<StepStanding>>>,
		sync = false
	): StepsStanding => ({
		setup: standing(over.setup),
		connect: standing(over.connect),
		accounts: standing(over.accounts),
		sync
	});

	it('names its state in a word, trouble over done', () => {
		expect([
			stepWord(standing()),
			stepWord(standing({ done: true })),
			stepWord(standing({ trouble: true })),
			stepWord(standing({ done: true, trouble: true }))
		]).toEqual(['To do', 'Done', 'Needs attention', 'Needs attention']);
	});

	it('opens the next open step after the one saved, or Sync after the last, or nothing', () => {
		expect(
			opensNext(all({ setup: { done: true, open: true }, connect: { open: true } }), 'setup')
		).toBe('connect');
		expect(opensNext(all({ accounts: { done: true, open: true } }, true), 'accounts')).toBe('sync');
		// a step open before the one saved is not what the save opened.
		expect(
			opensNext(all({ setup: { open: true }, accounts: { open: true } }), 'accounts')
		).toBeNull();
		expect(opensNext(all({}), 'setup')).toBeNull();
	});

	it('says what a save opened, and today’s sentence where it opened nothing', () => {
		expect(openedSays('connect')).toBe('Connect is open.');
		expect(openedSays('sync')).toBe('Sync is open.');
		expect(openedSays(null)).toBeUndefined();
	});

	it('says what a save opened only for the save that finished its step', () => {
		const opened = all({ setup: { done: true, open: true }, connect: { open: true } });
		expect(savedSays(opened, { step: 'setup', finishing: true }, 'setup')).toBe('Connect is open.');
		// Sync was already there, so a save of a done Accounts opened nothing.
		const finished = all({ accounts: { done: true } }, true);
		expect(savedSays(finished, { step: 'accounts', finishing: false }, 'accounts')).toBeUndefined();
		expect(savedSays(opened, { step: 'accounts', finishing: true }, 'setup')).toBeUndefined();
		expect(savedSays(opened, null, 'setup')).toBeUndefined();
	});

	it('sends the reader on only from a step its save finished, and to its own label where nothing opened', () => {
		const opened = all({ setup: { done: true }, connect: { open: true } });
		expect(shutSendsTo(opened, { step: 'setup', finishing: true })).toBe('connect');
		expect(
			shutSendsTo(all({ accounts: { done: true } }, true), { step: 'accounts', finishing: true })
		).toBe('sync');
		expect(shutSendsTo(all({ setup: { done: true } }), { step: 'setup', finishing: true })).toBe(
			'setup'
		);
		// saved again, it never shut: the reader stays on its button.
		expect(
			shutSendsTo(all({ accounts: { done: true } }, true), { step: 'accounts', finishing: false })
		).toBeNull();
	});
});

describe('which step a save holds open', () => {
	it('records whether the save is the one finishing its step when it starts', () => {
		expect(holdOpen('setup', true, false)(null)).toEqual({ step: 'setup', finishing: true });
		expect(holdOpen('accounts', true, true)(null)).toEqual({ step: 'accounts', finishing: false });
	});

	it('keeps what it recorded while the save goes on, though the step is done by then', () => {
		const held = { step: 'setup', finishing: true } as const;
		expect(holdOpen('setup', true, true)(held)).toBe(held);
	});

	it('lets go of its own step and of no other', () => {
		const held = { step: 'setup', finishing: true } as const;
		expect(holdOpen('setup', false, true)(held)).toBeNull();
		expect(holdOpen('accounts', false, true)(held)).toBe(held);
		expect(holdOpen('accounts', true, false)(held)).toEqual({ step: 'accounts', finishing: true });
	});
});

describe('a save that is answered before the page is read again', () => {
	it('stays saving through the read its answer sets off, and confirms once that read lands', () => {
		expect(savingUntilRead({ own: true, landed: false, spent: false })).toBe(true);
		expect(savingUntilRead({ own: false, landed: true, spent: false })).toBe(true);
		expect(savingUntilRead({ own: false, landed: true, spent: true })).toBe(false);
	});

	it('holds nothing over a press that did not land', () => {
		expect(savingUntilRead({ own: false, landed: false, spent: false })).toBe(false);
	});
});

describe('which preview a press of the day acts on', () => {
	const RIVERBANK = company({
		companyName: 'Riverbank Trust Inc.',
		startAt: '2026-09-01T00:00:00.000Z'
	});
	const side = (gifts: number) => ({
		gifts,
		corrections: 0,
		earliest: gifts > 0 ? '2026-06-03T00:00:00.000Z' : null,
		latest: gifts > 0 ? '2026-08-31T00:00:00.000Z' : null
	});
	const preview = (startAt: string, queues: number, drops: number): QuickbooksAnswer =>
		reported({ press: 'start-date-preview', startAt, queues: side(queues), drops: side(drops) });

	it('asks over a preview of the day asked, and moves straight away where it touches nothing', () => {
		expect(
			startDateNext('2026-06-01', RIVERBANK, preview('2026-06-01T00:00:00.000Z', 3, 0)).kind
		).toBe('ask');
		expect(
			startDateNext('2026-06-01', RIVERBANK, preview('2026-06-01T00:00:00.000Z', 0, 0))
		).toEqual({
			kind: 'move'
		});
	});

	it('never saves or asks over a preview for another day, in either direction', () => {
		// the defect: an earlier preview left standing is read against a later day, whose drops it
		// counts as none, so the move later went with no confirm and dropped unsent gifts.
		const earlier = preview('2026-06-01T00:00:00.000Z', 38, 0);
		const later = preview('2026-09-15T00:00:00.000Z', 0, 3);
		expect(startDateNext('2026-09-15', RIVERBANK, earlier)).toEqual({ kind: 'wait' });
		expect(startDateNext('2026-06-01', RIVERBANK, later)).toEqual({ kind: 'wait' });
	});

	it('waits on any answer that is not a preview', () => {
		expect(startDateNext('2026-06-01', RIVERBANK, reported({ press: 'start-date' }))).toEqual({
			kind: 'wait'
		});
		expect(startDateNext('2026-06-01', RIVERBANK, null)).toEqual({ kind: 'wait' });
	});
});

describe('what the press over the day asks before it moves', () => {
	const side = (
		gifts: number,
		corrections: number,
		earliest: string | null,
		latest: string | null
	) => ({
		gifts,
		corrections,
		earliest,
		latest
	});
	const NONE = side(0, 0, null, null);
	const RIVERBANK = company({
		companyName: 'Riverbank Trust Inc.',
		startAt: '2026-09-01T00:00:00.000Z'
	});

	it('asks before sending past gifts, with what goes, from when, to whom, and what it can cost', () => {
		const ask = startDateAsk('2026-06-01', RIVERBANK, {
			queues: side(38, 2, '2026-06-03T00:00:00.000Z', '2026-08-31T00:00:00.000Z'),
			drops: NONE
		});
		expect(ask).toEqual({
			title: 'Send past gifts?',
			press: 'Send gifts',
			rank: 'exit',
			lines: [
				'Gifts · 38',
				'Corrections · 2',
				'Dated · 3 June to 31 August 2026',
				'Company · Riverbank Trust Inc.',
				'Any of these already entered in QuickBooks by hand will appear there twice.'
			]
		});
	});

	it('asks before skipping unsent gifts, and never ends a sentence on two stops', () => {
		const ask = startDateAsk('2026-09-15', RIVERBANK, {
			queues: NONE,
			drops: side(3, 0, '2026-09-02T00:00:00.000Z', '2026-09-12T00:00:00.000Z')
		});
		expect(ask).toEqual({
			title: 'Skip unsent gifts?',
			press: 'Skip gifts',
			rank: 'danger',
			lines: [
				'Gifts · 3',
				'Dated · 2 to 12 September 2026',
				'These won’t be sent to Riverbank Trust Inc.'
			]
		});
	});

	it('leaves out a count that is zero', () => {
		const ask = startDateAsk('2026-06-01', RIVERBANK, {
			queues: side(0, 4, '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'),
			drops: NONE
		});
		expect(ask?.lines.slice(0, 2)).toEqual(['Corrections · 4', 'Dated · 1 July 2026']);
	});

	it('reads the side the move touches, and asks nothing where that side is empty', () => {
		const busy = side(5, 1, '2026-06-03T00:00:00.000Z', '2026-06-04T00:00:00.000Z');
		// earlier queues and never drops; later drops and never queues.
		expect(startDateAsk('2026-06-01', RIVERBANK, { queues: NONE, drops: busy })).toBeNull();
		expect(startDateAsk('2026-09-15', RIVERBANK, { queues: busy, drops: NONE })).toBeNull();
	});

	it('says the dates across a year where the range crosses one', () => {
		const ask = startDateAsk('2025-06-01', RIVERBANK, {
			queues: side(2, 0, '2025-12-30T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
			drops: NONE
		});
		expect(ask?.lines[1]).toBe('Dated · 30 December 2025 to 2 January 2026');
	});

	it('names an unnamed company by the id the screen already shows for it', () => {
		const ask = startDateAsk('2026-09-15', company({ companyName: null, realmId: '9130' }), {
			queues: NONE,
			drops: side(1, 0, null, null)
		});
		expect(ask?.lines).toEqual(['Gifts · 1', 'These won’t be sent to 9130.']);
	});
});

describe('what changing the keys on a connected company asks first', () => {
	const SEEDS = {
		QUICKBOOKS_CLIENT_ID: 'id-1',
		QUICKBOOKS_CLIENT_SECRET: 'secret-1',
		QUICKBOOKS_API_URL: ''
	};
	const edits = (typed: Record<string, string>) => {
		const posted = new FormData();
		for (const name of NAMES)
			posted.set(VALUE_FIELD(name), typed[name] ?? SEEDS[name as keyof typeof SEEDS]);
		return secretEdits(NAMES, posted, SEEDS);
	};

	it('itemises each box it changes against the value it was, then the cost', () => {
		expect(
			keysAsk(
				edits({
					QUICKBOOKS_CLIENT_SECRET: 'secret-2',
					QUICKBOOKS_CLIENT_ID: '',
					QUICKBOOKS_API_URL: 'https://sandbox'
				}),
				SEEDS,
				company()
			)
		).toEqual([
			'Client ID · Removed',
			'Client secret · Replaced',
			'API address · Set',
			'Habitat stops syncing until you sign in again.'
		]);
	});

	it('asks nothing where the press changes nothing, or is refused before it goes', () => {
		expect(keysAsk(edits({}), SEEDS, company())).toBeNull();
		expect(keysAsk(edits({ QUICKBOOKS_CLIENT_ID: '  ' }), SEEDS, company())).toBeNull();
	});
});

describe('the rest of what the section says', () => {
	it('names what disconnecting costs against the company', () => {
		expect(disconnectLines(company({ companyName: 'Riverbank Trust Inc.' }))).toEqual([
			'Gifts stop syncing to Riverbank Trust Inc.',
			'This deployment forgets the company, its accounts and the day gifts sync from.'
		]);
	});

	it('calls a company Intuit has not named by its id', () => {
		expect(companyCalled(company({ companyName: null, realmId: '9130' }))).toBe('9130');
		expect(companyCalled(company())).toBe('Habitat');
	});

	it('says one plain sentence over a press the deployment answered nothing to', () => {
		expect(UNANSWERED).toBe('This deployment didn’t answer.');
		expect(unansweredSays(NOTHING_ANSWERED)).toBe(UNANSWERED);
	});

	it('says the deployment turned a press down where it refused it, never in its own words', () => {
		const refusal: NoReport = {
			kind: 'unreadable',
			error: 'not_connected',
			detail: 'no QuickBooks company is connected',
			fix: 'connect one first',
			status: 409
		};
		expect(REFUSED).toBe('This deployment turned that down.');
		expect(unansweredSays(refusal)).toBe(REFUSED);
	});

	it('says the deployment could not do it where it answered with a coded failure', () => {
		const failure: NoReport = {
			kind: 'unreadable',
			error: 'accounts_unreadable',
			detail: 'QuickBooks returned 500',
			fix: 'try again later',
			status: 502
		};
		expect(FAILED).toBe('This deployment couldn’t do that.');
		expect(unansweredSays(failure)).toBe(FAILED);
		expect(unansweredSays({ ...failure, error: 'no_signing_key', status: 500 })).toBe(FAILED);
		// no code is no answer anyone wrote.
		expect(unansweredSays({ ...failure, error: null, status: 500 })).toBe(UNANSWERED);
	});
});

describe('the three pickers’ own press', () => {
	it('is armed while one is unchosen, so pressing it can say which', () => {
		const fresh = company({ fee: null });
		expect(picksArmed({ ...UNHELD, income: '1', fee: '', stripeBalance: '2' }, fresh, CHART)).toBe(
			true
		);
		// a holding may stay unchosen; income and fees may not.
		expect(picksMissing({ ...UNHELD, income: '1', fee: '', stripeBalance: '' })).toEqual(['fee']);
	});

	it('is closed over what is already stored, and over a pick its picker does not offer', () => {
		expect(
			picksArmed({ ...UNHELD, income: '1', fee: '2', stripeBalance: '2' }, company(), CHART)
		).toBe(false);
		expect(
			picksArmed({ ...UNHELD, income: '9', fee: '2', stripeBalance: '2' }, company(), CHART)
		).toBe(false);
		expect(picksMissing({ ...UNHELD, income: '1', fee: '2', stripeBalance: '2' })).toEqual([]);
	});
});

describe('which press on the page is this control’s own', () => {
	it('is the intent in flight, read against each press the control makes', () => {
		expect(ownPress('quickbooks:start-date-preview', 'start-date', 'start-date-preview')).toBe(
			true
		);
		expect(ownPress('quickbooks:retry', 'start-date', 'start-date-preview')).toBe(false);
		expect(ownPress(null, 'retry')).toBe(false);
	});
});

describe('the retry press is one button from rest to its report', () => {
	const at = (over: Partial<Parameters<typeof retryButton>[0]> = {}) =>
		retryButton({ backlog: true, pending: false, done: false, doneLabel: null, ...over });

	it('rests while there is something to retry, and is not drawn where there is nothing', () => {
		expect(at()).toEqual({ shown: true, state: 'idle' });
		expect(at({ backlog: false })).toEqual({ shown: false, state: 'idle' });
	});

	it('stays through its press and its report, after the backlog it cleared has gone', () => {
		expect(at({ pending: true })).toEqual({ shown: true, state: 'pending' });
		expect(at({ backlog: false, pending: true })).toEqual({ shown: true, state: 'pending' });
		expect(at({ backlog: false, done: true, doneLabel: '2 retrying' })).toEqual({
			shown: true,
			state: 'done'
		});
	});

	it('draws no tick over a press that moved nothing', () => {
		expect(at({ backlog: false, done: true, doneLabel: null })).toEqual({
			shown: false,
			state: 'idle'
		});
	});
});
