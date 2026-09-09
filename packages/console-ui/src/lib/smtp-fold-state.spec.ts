import { MAX_EMAIL } from '@better-giving/operator/console/org-rules';
import { parseWithZod } from '@conform-to/zod/v4';
import { describe, expect, it } from 'vitest';
import { MAIL_GROUP, SECRET_GROUPS, VALUE_FIELD, groupIntent, pressedNames } from './secret-groups';
import { TEST_EMAIL_INTENT } from './smtp-fold';
import type { MailSeeds } from './smtp-fold-state';
import {
	MAIL_BLANK,
	MAIL_FROM_SAID,
	MAIL_ORDER,
	TEST_TO_FIELD,
	TEST_TO_SAID,
	mailAct,
	mailForm,
	mailGaps,
	mailUnconfigured,
	ownPress,
	sendState,
	testSendForm
} from './smtp-fold-state';

// the mail fold's two blocks held to the one property tsc cannot see: that a press in either of
// them leaves the other alone.
//
// this package has no DOM pool (../../vite.config.ts), so nothing here is a claim about what
// ./smtp-fold.tsx draws. it is a claim about the values that fold draws from — which is why the
// readings live in ./smtp-fold-state.ts rather than as expressions inside the component.
//
// the intents are taken from where the presses take them rather than spelled again: an intent
// renamed on one side of a comparison and not the other is exactly the failure a literal here
// would hide.

/** what the credentials press posts, read off the enumeration the fold draws its boxes from. */
const mailGroup = SECRET_GROUPS.find((group) => group.id === MAIL_GROUP);
// a group that stopped being in the enumeration is this whole file reading a press nothing makes,
// so it fails at the door rather than in a case that would then be comparing two literals.
if (mailGroup === undefined) throw new Error(`no ${MAIL_GROUP} group to read a press off`);
const STORE_INTENT = groupIntent(mailGroup);

/** what the send press posts. */
const TEST_INTENT = TEST_EMAIL_INTENT;

/**
 * a send with nothing to report, an address in the box and a deployment that can send, which every
 * case below varies from.
 */
const resting = {
	pending: null as string | null,
	intent: TEST_INTENT,
	sent: false,
	expired: false,
	empty: false,
	unconfigured: false
};

/** the four names a mail press carries a value for, read off the group rather than spelled again. */
const PRESSED = pressedNames(mailGroup);

/** a deployment holding all four of the values a message leaves through. */
const set: MailSeeds = {
	SMTP_HOST: 'smtp.resend.com',
	SMTP_USERNAME: 'resend',
	SMTP_PASSWORD: 're_key',
	MAIL_FROM: 'donations@better.giving'
};

describe('the two blocks of the mail fold', () => {
	it('names two presses that are not each other', () => {
		// without this every case below would pass on one intent standing in for both.
		expect(STORE_INTENT).not.toBe(TEST_INTENT);
	});

	it('closes a block only while that block is the one writing', () => {
		expect(ownPress(STORE_INTENT, STORE_INTENT)).toBe(true);
		expect(ownPress(TEST_INTENT, TEST_INTENT)).toBe(true);
		expect(ownPress(null, STORE_INTENT)).toBe(false);
	});

	it('leaves the credentials open while the test send is in flight', () => {
		// the whole of the first defect: this is both of the flags the credentials form hands the seam
		// (packages/operator/src/saved-form-state.react.ts reads a press through `busy` and
		// `pending` and nothing else), so a `false` here is that hook's `pending` and `disabled`
		// arms unable to fire — its press draws off its own boxes, which is `idle` over a form
		// holding an edit. it is also what the five boxes state `disabled` on.
		expect(ownPress(TEST_INTENT, STORE_INTENT)).toBe(false);
	});

	it('leaves the send open while the credentials are being stored', () => {
		// the same defect read the other way: a store in flight is not this press's, so the send is
		// whatever its own box says and never `pending` or `disabled`.
		expect(sendState({ ...resting, pending: STORE_INTENT })).toBe('idle');
	});

	it('draws the send as pending only for its own press', () => {
		expect(sendState({ ...resting, pending: TEST_INTENT })).toBe('pending');
	});

	it('refuses a send with no address in the box, whatever else is true', () => {
		expect(sendState({ ...resting, empty: true })).toBe('disabled');
		expect(sendState({ ...resting, empty: true, pending: STORE_INTENT })).toBe('disabled');
		// and the press it is still making is not overruled by the empty box: what was typed can be
		// cleared while the message is on its way, and the press is still the one in flight.
		expect(sendState({ ...resting, empty: true, pending: TEST_INTENT })).toBe('pending');
	});

	it('refuses a send on a deployment holding no mail settings, address or none', () => {
		// the press on a deployment nobody has set mail up on can only fail, which is what closes it —
		// and it closes on the deployment rather than on the box, so an address typed into one changes
		// nothing about it.
		expect(sendState({ ...resting, unconfigured: true })).toBe('disabled');
		expect(sendState({ ...resting, unconfigured: true, empty: true })).toBe('disabled');
	});

	it('leaves that press pending while its own send is in flight', () => {
		// the same rung order the empty box is held to: a message already on its way is reported at the
		// press whatever the deployment last reported about itself.
		expect(sendState({ ...resting, unconfigured: true, pending: TEST_INTENT })).toBe('pending');
	});

	it('reports a send that landed', () => {
		expect(sendState({ ...resting, sent: true })).toBe('done');
	});

	it('gives the press back once that confirmation has stood its seconds out', () => {
		// the second defect, as a value: the tick is not a rung the press stays on. what ends it is
		// a timer in the fold, and what it means for the press is this.
		expect(sendState({ ...resting, sent: true, expired: true })).toBe('idle');
		// and a box emptied while the tick stood goes back to having nothing to send to, rather than
		// to a press that would send nowhere.
		expect(sendState({ ...resting, sent: true, expired: true, empty: true })).toBe('disabled');
	});
});

describe('whether the deployment has anything to send through', () => {
	it('reads a deployment holding all four as one that can send', () => {
		expect(mailUnconfigured(PRESSED, set)).toBe(false);
	});

	it('reads a deployment holding none of them as one that cannot', () => {
		// the fresh deployment: every one of the four absent from the account, so every box is drawn
		// empty and the press below them has nothing to send through.
		expect(mailUnconfigured(PRESSED, {})).toBe(true);
	});

	it('reads one missing name as one that cannot, whichever name it is', () => {
		// any of the four is a send that can only fail, so the reading is not all-or-nothing: each
		// case is its own name, because a reading that happened to test one of them would pass on a
		// deployment missing any of the others.
		for (const name of PRESSED) {
			expect(mailUnconfigured(PRESSED, { ...set, [name]: '' })).toBe(true);
		}
	});

	it('closes nothing on a reading that did not land', () => {
		// `null` is a deployment this console could not read off cloudflare, so nothing about mail was
		// found out — and a press closed here would be closed on an answer nobody has.
		expect(mailUnconfigured(PRESSED, null)).toBe(false);
	});
});

/** the four the mail press carries a value for, as what one press would leave behind. */
const after = (held: Record<string, boolean>) =>
	Object.entries(held).map(([name, value]) => ({ name, held: value }));

const ALL = { SMTP_USERNAME: true, SMTP_PASSWORD: true, SMTP_HOST: true, MAIL_FROM: true };
const NONE = { SMTP_USERNAME: false, SMTP_PASSWORD: false, SMTP_HOST: false, MAIL_FROM: false };

describe('the mail values a press would leave half-set', () => {
	it('names nothing where the press leaves the deployment holding all of them', () => {
		expect(mailGaps(after(ALL))).toEqual([]);
	});

	it('names nothing where it leaves the deployment holding none', () => {
		// taking mail off is a press an operator makes on purpose, and refusing it would leave the
		// five stored with no way to clear them.
		expect(mailGaps(after(NONE))).toEqual([]);
	});

	it('names every one it would leave empty beside one it would leave set', () => {
		// the defect this exists for: a username typed into a fresh deployment and nothing else, which
		// stored a credential that sends nothing under a fold reading as set up.
		expect(mailGaps(after({ ...NONE, SMTP_USERNAME: true }))).toEqual([
			'SMTP_PASSWORD',
			'SMTP_HOST',
			'MAIL_FROM'
		]);
	});

	it('names one missing name whichever of them it is', () => {
		// each case is its own name: a reading that happened to test one of them would pass on a press
		// missing either of the others.
		for (const name of Object.keys(ALL)) {
			expect(mailGaps(after({ ...ALL, [name]: false }))).toEqual([name]);
		}
	});
});

describe('what a mail press does to the deployment', () => {
	it('reads a deployment holding none of them as one that starts sending', () => {
		expect(mailAct(false, after(ALL))).toBe('starting');
	});

	it('reads a deployment already holding them as one that sends through somewhere else', () => {
		expect(mailAct(true, after(ALL))).toBe('changing');
	});

	it('reads every box emptied as the deployment stopping, whatever it held before', () => {
		// the one act whose consequence is a donor's receipt not arriving, and the reading that
		// decides it is what the press leaves behind rather than what was there.
		expect(mailAct(true, after(NONE))).toBe('stopping');
		expect(mailAct(false, after(NONE))).toBe('stopping');
	});
});

/**
 * the same reading as it reaches a box, which is the pass ./smtp-fold.tsx's press runs before
 * anything is sent (./use-console-form.ts).
 *
 * it is read through `parseWithZod` rather than off the schema, because the one thing between the
 * two is what this console has no other reading of: conform drops every empty string before the
 * schema sees it, and an empty box here is an act rather than an absence — a box emptied over a
 * stored value is the removal, and every box emptied at once is mail taken off the deployment. a
 * schema that refused a box for being missing would turn both of those into a press that cannot be
 * made, and the gap sentences would then be unreachable.
 */
describe('mailForm', () => {
	/** a deployment holding none of the four, which is every box drawn empty. */
	const NOTHING: MailSeeds = {};

	/** one holding all four, every box drawn with the value it is holding. */
	const HOLDING: MailSeeds = set;

	/** what a box was drawn holding, which is what leaving it alone posts. */
	const untouched = (seeds: MailSeeds, name: string) => seeds[name] ?? '';

	/**
	 * the boxes as the browser posts them, under the names ./secret-edits.ts reads them back by.
	 *
	 * a name left out of `boxes` posts what it was drawn with, which is the box nobody went near —
	 * so a case states the boxes it is about and nothing else.
	 */
	const pressed = (boxes: Readonly<Record<string, string>>, seeds: MailSeeds) => {
		const posted = new FormData();
		for (const name of MAIL_ORDER) {
			if (name === 'SMTP_PORT') continue;
			posted.set(VALUE_FIELD(name), boxes[name] ?? untouched(seeds, name));
		}
		posted.set('intent', STORE_INTENT);
		return parseWithZod(posted, { schema: mailForm(mailGroup, seeds).schema });
	};

	/** the boxes a press was refused over, in the order the answer names them. */
	const named = (parsed: ReturnType<typeof pressed>) =>
		parsed.status === 'success' || parsed.error === null ? [] : Object.keys(parsed.error);

	it('names the box a press would leave the other three without', () => {
		const parsed = pressed(
			{ SMTP_USERNAME: 'resend', SMTP_HOST: 'smtp.resend.com', MAIL_FROM: 'd@better.giving' },
			NOTHING
		);
		expect(named(parsed)).toEqual([VALUE_FIELD('SMTP_PASSWORD')]);
		expect(
			parsed.status === 'success' ? null : parsed.error?.[VALUE_FIELD('SMTP_PASSWORD')]
		).toEqual(['required']);
	});

	it('names a box emptied on its own over a deployment holding the rest', () => {
		// the defect the boxes being optional exists for: conform posts nothing for an emptied box, so
		// a rule that read that as a box left out would answer this press with a type error about a
		// value that is missing rather than with the sentence under the box that is empty — and the
		// press would then be un-refusable.
		expect(named(pressed({ SMTP_PASSWORD: '' }, HOLDING))).toEqual([VALUE_FIELD('SMTP_PASSWORD')]);
	});

	it('names every box it would leave empty, in the order they are drawn', () => {
		// the first of them is where focus goes ({@link MAIL_ORDER}), so the order is the property
		// rather than the set.
		expect(named(pressed({ SMTP_USERNAME: 'resend' }, NOTHING))).toEqual([
			VALUE_FIELD('SMTP_PASSWORD'),
			VALUE_FIELD('SMTP_HOST'),
			VALUE_FIELD('MAIL_FROM')
		]);
	});

	it('refuses a box holding nothing but whitespace beside three that are filled', () => {
		// the deployment drops such a string, so it stores nothing under that name — which is a press
		// that leaves the deployment half-set while the box in front of the operator looks filled.
		expect(
			named(
				pressed(
					{
						SMTP_USERNAME: 'resend',
						SMTP_PASSWORD: 're_abc',
						SMTP_HOST: '   ',
						MAIL_FROM: 'd@better.giving'
					},
					NOTHING
				)
			)
		).toEqual([VALUE_FIELD('SMTP_HOST')]);
	});

	it('refuses a box holding nothing but whitespace over a value the deployment holds', () => {
		// the same box over the other seed: such a box asks for no act (`mailBoxAct`), so read
		// through what the press would leave behind it is the stored value still held and nothing is
		// said about it. the deployment drops the string either way, so the sentence is the same one.
		expect(named(pressed({ SMTP_HOST: '   ' }, HOLDING))).toEqual([VALUE_FIELD('SMTP_HOST')]);
	});

	it('refuses every box holding nothing but whitespace, on either seed', () => {
		// the press this rule is for, and the reason it is not read through what the press would
		// leave behind: four boxes of spaces leave the deployment holding nothing, which is the same
		// answer the four emptied boxes below give — and that one is the removal, whose card would
		// then be drawn over four rows nobody can name.
		const spaces = {
			SMTP_USERNAME: ' ',
			SMTP_PASSWORD: '  ',
			SMTP_HOST: '   ',
			MAIL_FROM: ' '
		};
		const boxes = [
			VALUE_FIELD('SMTP_USERNAME'),
			VALUE_FIELD('SMTP_PASSWORD'),
			VALUE_FIELD('SMTP_HOST'),
			VALUE_FIELD('MAIL_FROM')
		];

		expect(named(pressed(spaces, HOLDING))).toEqual(boxes);
		expect(named(pressed(spaces, NOTHING))).toEqual(boxes);
	});

	it('says one word under a box, not the same word twice', () => {
		// a box of spaces is a box the press would leave the others without as well, so both rules
		// reach it — and the fold draws the first sentence a box carries.
		const parsed = pressed({ SMTP_HOST: '   ' }, NOTHING);
		expect(parsed.status === 'success' ? null : parsed.error?.[VALUE_FIELD('SMTP_HOST')]).toEqual([
			'required'
		]);
	});

	it('says nothing about every box emptied at once', () => {
		// taking mail off a deployment is a press an operator makes on purpose, and refusing it would
		// leave the four stored with no way to clear them.
		expect(
			pressed({ SMTP_USERNAME: '', SMTP_PASSWORD: '', SMTP_HOST: '', MAIL_FROM: '' }, HOLDING)
				.status
		).toBe('success');
	});

	it('says nothing about boxes nobody has touched, the mark among them', () => {
		expect(pressed({}, HOLDING).status).toBe('success');
		expect(pressed({}, NOTHING).status).toBe('success');
	});

	it('says nothing about a press that fills all four', () => {
		expect(
			pressed(
				{
					SMTP_USERNAME: 'resend',
					SMTP_PASSWORD: 're_abc',
					SMTP_HOST: 'smtp.resend.com',
					MAIL_FROM: 'd@better.giving'
				},
				NOTHING
			).status
		).toBe('success');
	});

	/** the sentence one box was refused with, or nothing where it was not. */
	const said = (parsed: ReturnType<typeof pressed>, name: string) =>
		parsed.status === 'success' ? undefined : parsed.error?.[VALUE_FIELD(name)];

	it('refuses a From address with a name in front of it, and nothing else on the form', () => {
		// the send refuses this value days later at somebody else's host (`mailFromFault` in
		// `@better-giving/operator/console/mail-from`), and a box that said nothing about it stores
		// it and goes on reporting mail as set up.
		const parsed = pressed({ MAIL_FROM: 'Better Giving <hi@example.org>' }, HOLDING);
		expect(named(parsed)).toEqual([VALUE_FIELD('MAIL_FROM')]);
		// the sentence and not just the refusal: this value carries whitespace, so it fails the
		// address pattern as well — read in the other order it would earn the sentence for a value
		// that is not an address at all, which names nothing to delete.
		expect(said(parsed, 'MAIL_FROM')).toEqual([MAIL_FROM_SAID['display-name']]);
	});

	it('refuses a From box holding something that is not an address at all', () => {
		const parsed = pressed({ MAIL_FROM: 'Better Giving' }, HOLDING);
		expect(named(parsed)).toEqual([VALUE_FIELD('MAIL_FROM')]);
		expect(said(parsed, 'MAIL_FROM')).toEqual([MAIL_FROM_SAID['not-an-address']]);
	});

	it('says nothing about a bare address typed over a stored one', () => {
		expect(pressed({ MAIL_FROM: 'hi@example.org' }, HOLDING).status).toBe('success');
	});

	it('says nothing about a From box left holding the address it was drawn with', () => {
		// a box nobody went near, so the rule about what an address may be has nothing to answer: the
		// stored value already passed it on the press that stored it.
		expect(pressed({}, HOLDING).status).toBe('success');
	});

	it('answers a From box emptied over a holding deployment with the gap, not the address', () => {
		// an emptied box is a removal, and the four are one press or none — so what is wrong is that
		// the press would leave the other three set, which is a different sentence.
		const parsed = pressed({ MAIL_FROM: '' }, HOLDING);
		expect(said(parsed, 'MAIL_FROM')).toEqual([MAIL_BLANK]);
	});

	it('carries the port in no box, whatever is posted under its name', () => {
		// the port is stated rather than asked for (`STATED_VALUES` in ./secret-groups.ts), and a box
		// for it would be a value an operator cannot type that the press then reports on.
		const posted = new FormData();
		// every box carries the port's own value, the From box excepted: that one has a rule about
		// what is in it, and a press this one is refused reports on no box at all.
		for (const name of MAIL_ORDER)
			posted.set(VALUE_FIELD(name), name === 'MAIL_FROM' ? 'd@better.giving' : '465');
		posted.set('intent', STORE_INTENT);
		const parsed = parseWithZod(posted, { schema: mailForm(mailGroup, NOTHING).schema });
		expect(parsed.status).toBe('success');
		expect(
			Object.keys(parsed.status === 'success' ? (parsed.value as Record<string, unknown>) : {})
		).not.toContain(VALUE_FIELD('SMTP_PORT'));
	});
});

/**
 * the same reading as it reaches the To box, which is the pass ./smtp-fold.tsx's send press runs
 * before anything leaves the deployment (./use-console-form.ts).
 *
 * read through `parseWithZod` for the block above's reason and one of its own: conform drops an
 * empty box before the schema sees it, and the empty box is the state this rule has to stay silent
 * through — the press beside it is already closed on that emptiness, and a sentence would arrive on
 * first paint over a deployment that has never stored a notification address.
 *
 * the cap is read from where both ends read it rather than spelled: a length this file stated would
 * pass against a console that measured against another one.
 */
describe('testSendForm', () => {
	/** the box as the browser posts it, under the name the page's own action reads it back by. */
	const typed = (to: string) => {
		const posted = new FormData();
		posted.set(TEST_TO_FIELD, to);
		posted.set('intent', TEST_INTENT);
		return parseWithZod(posted, { schema: testSendForm(TEST_INTENT).schema });
	};

	/** the sentence standing under the box, or nothing where the press was let through. */
	const said = (parsed: ReturnType<typeof typed>) =>
		parsed.status === 'success' ? undefined : parsed.error?.[TEST_TO_FIELD];

	it('refuses a value that is not an address at all', () => {
		// the word an operator typed into the box beside the press, answered at the box rather
		// than by a message the deployment sends back.
		expect(said(typed('treasurer'))).toEqual([TEST_TO_SAID]);
	});

	it('refuses an address longer than the deployment will take', () => {
		// measured against the cap the endpoint measures against
		// (`packages/app/src/routes/console.test-email.ts`), so a value one end takes and the other
		// turns down is not a state either can be in.
		expect(said(typed(`${'a'.repeat(MAX_EMAIL)}@example.org`))).toEqual([TEST_TO_SAID]);
	});

	it('says nothing at all about an empty box', () => {
		const parsed = typed('');
		expect(parsed.status).toBe('success');
		expect(said(parsed)).toBeUndefined();
	});

	it('says nothing about a box holding nothing but spaces', () => {
		// the trim makes it the empty box above, which is the press `sendState` already closes.
		expect(typed('   ').status).toBe('success');
	});

	it('lets a bare address through', () => {
		expect(typed('treasurer@example.org').status).toBe('success');
	});

	it('lets an address through with the spaces it was pasted with', () => {
		// the deployment trims before it measures, so a value refused here would be one it would
		// have sent to.
		expect(typed('  treasurer@example.org  ').status).toBe('success');
	});
});
