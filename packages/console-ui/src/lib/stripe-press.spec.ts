import { describe, expect, it } from 'vitest';
import type { StripeFacts, StripeRunAct, StripeRunRead, StripeSetup } from '../api/types';
import type { KeysSent, KeysWrite, PressAnswer, PressPhase } from './stripe-press';
import {
	answerLanded,
	answeredRefusal,
	keysClosed,
	keysStanding,
	reportStands,
	secretStored,
	runUnderway,
	standingRefusal,
	writingElsewhere
} from './stripe-press';
import type { StripeKeyBoxes } from './stripe-keys';

// what a Stripe press is doing and what it was turned down for, read from the router's phase rather
// than from the answer alone.
//
// the property worth holding is the one the fold cannot see for itself: an answer on the page is
// not necessarily this press's, and a refusal that stands is not necessarily still on the page.
// every case below is one of those two crossings.

/** the two phases of one press, as ../routes/_index.tsx reads them off the navigation. */
const SUBMITTING: PressPhase = { pending: true, revalidating: false };
const LANDED: PressPhase = { pending: true, revalidating: true };
const IDLE: PressPhase = { pending: false, revalidating: false };

const NOTHING: PressAnswer = { turnedDownPair: false, refused: null };
const DOOR: PressAnswer = { turnedDownPair: true, refused: null };
const BOXES: PressAnswer = {
	turnedDownPair: false,
	refused: { STRIPE_SECRET_KEY: 'That is not a Stripe secret key.' }
};

/** the three states one press of the keys form leaves the boxes in (./reseed.ts). */
const UNWRITTEN: KeysWrite = { landed: false, spent: false };
const UNREAD: KeysWrite = { landed: true, spent: false };
const PUT_BACK: KeysWrite = { landed: true, spent: true };

describe('runUnderway', () => {
	it('counts the request that has not come back, whatever the page is still holding', () => {
		expect(runUnderway(SUBMITTING, DOOR, false)).toBe(true);
	});

	it('is over where the answer says the door turned the pair down', () => {
		expect(runUnderway(LANDED, DOOR, false)).toBe(false);
	});

	it('is over where the answer names boxes, since nothing left this machine', () => {
		expect(runUnderway(LANDED, BOXES, false)).toBe(false);
	});

	it('goes on where the answer says a run began, until the reading of it arrives', () => {
		expect(runUnderway(LANDED, NOTHING, false)).toBe(true);
	});

	it('counts a run reading as running, with no press of this page in flight', () => {
		expect(runUnderway(IDLE, DOOR, true)).toBe(true);
	});

	it('is over on a page with no press in flight and no run going', () => {
		expect(runUnderway(IDLE, NOTHING, false)).toBe(false);
	});
});

describe('keysClosed', () => {
	it('closes the boxes while a press somewhere else on the page is writing', () => {
		expect(keysClosed(IDLE, NOTHING, true, false, UNWRITTEN)).toBe(true);
	});

	it('closes them while this press is in flight, sending these very boxes', () => {
		expect(keysClosed(SUBMITTING, NOTHING, true, false, UNWRITTEN)).toBe(true);
	});

	it('closes them while a run is going', () => {
		expect(keysClosed(IDLE, NOTHING, false, true, UNWRITTEN)).toBe(true);
	});

	it('closes them while a landed write waits for the reading that puts them back', () => {
		expect(keysClosed(IDLE, NOTHING, false, false, UNREAD)).toBe(true);
	});

	it('opens them on the reading that landed after that write', () => {
		expect(keysClosed(IDLE, NOTHING, false, false, PUT_BACK)).toBe(false);
	});

	it('opens them where this press landed having begun nothing, page still re-reading', () => {
		expect(keysClosed(LANDED, DOOR, true, false, UNWRITTEN)).toBe(false);
		expect(keysClosed(LANDED, BOXES, true, false, UNWRITTEN)).toBe(false);
	});

	it('leaves them open on a page with nothing in flight at all', () => {
		expect(keysClosed(IDLE, DOOR, false, false, UNWRITTEN)).toBe(false);
	});
});

describe('writingElsewhere', () => {
	it('is what the page is doing that this form is not', () => {
		expect(writingElsewhere(IDLE, true)).toBe(true);
		expect(writingElsewhere(SUBMITTING, true)).toBe(false);
		expect(writingElsewhere(LANDED, true)).toBe(false);
		expect(writingElsewhere(IDLE, false)).toBe(false);
	});
});

describe('answerLanded', () => {
	it('is the one phase in which the answer on the page belongs to this press', () => {
		expect(answerLanded(LANDED)).toBe(true);
		expect(answerLanded(SUBMITTING)).toBe(false);
		expect(answerLanded(IDLE)).toBe(false);
	});
});

describe('answeredRefusal', () => {
	it('reads the door, which is the refusal no box is named in', () => {
		expect(answeredRefusal(DOOR)).toEqual({ kind: 'pair' });
	});

	it('reads the boxes the answer named', () => {
		expect(answeredRefusal(BOXES)).toEqual({
			kind: 'boxes',
			errors: { STRIPE_SECRET_KEY: 'That is not a Stripe secret key.' }
		});
	});

	it('says nothing of an answer that started a run', () => {
		expect(answeredRefusal(NOTHING)).toBe(null);
	});
});

describe('standingRefusal', () => {
	it('reads the door refusal off the answer that carries it', () => {
		expect(standingRefusal(LANDED, DOOR, null)).toEqual({ kind: 'pair' });
	});

	it('reads the named boxes off the answer that carries them', () => {
		expect(standingRefusal(LANDED, BOXES, null)).toEqual({
			kind: 'boxes',
			errors: { STRIPE_SECRET_KEY: 'That is not a Stripe secret key.' }
		});
	});

	it('keeps what was remembered once a revalidation has dropped the answer', () => {
		expect(standingRefusal(IDLE, NOTHING, { kind: 'pair' })).toEqual({ kind: 'pair' });
	});

	it('drops both while a new press is in flight, answer and memory alike', () => {
		expect(standingRefusal(SUBMITTING, DOOR, { kind: 'pair' })).toBe(null);
	});

	it('stands down where this press landed saying a run began', () => {
		expect(standingRefusal(LANDED, NOTHING, null)).toBe(null);
	});
});

describe('reportStands', () => {
	const facts: StripeFacts = { named: null, registration: null, elsewhere: [] };
	const stopped: StripeRunRead = {
		kind: 'ended',
		act: 'errand',
		stage: 'registering',
		facts,
		outcome: { kind: 'console-stopped' }
	};
	const atKeys: StripeRunRead = { ...stopped, stage: 'naming' };
	const landed: StripeRunRead = { ...stopped, stage: 'repeating', outcome: { kind: 'done' } };
	const going: StripeRunRead = { kind: 'running', act: 'errand', stage: 'storing', facts };

	it('stands under the boxes over a run that stopped past the key check, with no card up', () => {
		expect(reportStands(stopped, false)).toBe(true);
	});

	it('gives way to a card, which is the report while one is up', () => {
		expect(reportStands(stopped, true)).toBe(false);
	});

	it('draws nothing over a run still going, which a card carries', () => {
		expect(reportStands(going, false)).toBe(false);
	});

	it('draws nothing over a run that landed, which the readings above the boxes say', () => {
		expect(reportStands(landed, false)).toBe(false);
	});

	it('draws nothing over a run stopped at the key check, which the box under it says', () => {
		expect(reportStands(atKeys, false)).toBe(false);
	});

	it('draws nothing where no run is held', () => {
		expect(reportStands(null, false)).toBe(false);
	});
});

describe('keysStanding', () => {
	const facts: StripeFacts = { named: null, registration: null, elsewhere: [] };
	/** the run this fold holds once a press of it has ended, whatever it ended as. */
	const ended = (outcome: StripeSetup): StripeRunRead => ({
		kind: 'ended',
		act: 'errand',
		stage: 'covering',
		facts,
		outcome
	});

	/** what cloudflare answered for the two names before the press went. */
	const REPORTED: StripeKeyBoxes = {
		STRIPE_SECRET_KEY: 'sk_live_was',
		STRIPE_PUBLISHABLE_KEY: 'pk_live_was'
	};

	/** and what the press carried, which is what the deployment holds the moment it stores them. */
	const SENT: KeysSent = {
		act: 'errand',
		boxes: { STRIPE_SECRET_KEY: 'sk_live_now', STRIPE_PUBLISHABLE_KEY: 'pk_live_now' }
	};

	it('puts the boxes back to the pair the press sent, on the answer that stored it', () => {
		expect(
			keysStanding({ reported: REPORTED, sent: SENT, run: ended({ kind: 'done' }), reread: false })
		).toEqual({ seeded: SENT.boxes, spent: true });
	});

	/**
	 * and the reading that follows lands on the same two values, because the deployment reports both
	 * of them back: nothing moves under an operator already typing in the boxes.
	 */
	it('hands the boxes to the reading once it lands, holding what the answer put there', () => {
		const read: StripeKeyBoxes = { ...SENT.boxes };
		expect(
			keysStanding({ reported: read, sent: SENT, run: ended({ kind: 'done' }), reread: true })
		).toEqual({ seeded: read, spent: true });
	});

	// a run that stored the pair and failed further down stored it all the same, and the fold is
	// holding a deployment that charges.
	it('reads a stop past the store as the pair being held', () => {
		expect(
			keysStanding({
				reported: REPORTED,
				sent: SENT,
				run: ended({
					kind: 'unrepeating',
					setup: {
						kind: 'reported',
						report: {
							outcome: 'failed',
							processors: [
								{
									processor: 'stripe',
									label: 'Stripe',
									outcome: 'failed',
									detail: null,
									reason: 'failed'
								}
							]
						}
					},
					awaitingKey: false
				}),
				reread: false
			})
		).toEqual({ seeded: SENT.boxes, spent: true });
	});

	// the wallet hostnames are the last step of the chain and the published key went up two steps in
	// front of them, so both boxes are what the press sent.
	it('reads a stop at the hostnames as both values being held', () => {
		expect(
			keysStanding({
				reported: REPORTED,
				sent: SENT,
				run: ended({
					kind: 'uncovered',
					levelled: { kind: 'unanswered', read: { kind: 'no-session' } },
					awaitingKey: false
				}),
				reread: false
			})
		).toEqual({ seeded: SENT.boxes, spent: true });
	});

	/**
	 * the one stop past the store that left the published slot alone, and the whole press is left as
	 * the operator made it: both boxes hold what they held and the press is armed over them, so
	 * pressing again retries the one write that did not land.
	 */
	it('puts nothing back where the press stored the key and did not publish', () => {
		expect(
			keysStanding({
				reported: REPORTED,
				sent: SENT,
				run: ended({ kind: 'not-published', published: { kind: 'unreachable', detail: '' } }),
				reread: false
			})
		).toEqual({ seeded: REPORTED, spent: false });
	});

	it('seeds nothing from a run still going, whose press has stored nothing yet', () => {
		expect(
			keysStanding({
				reported: REPORTED,
				sent: SENT,
				run: { kind: 'running', act: 'errand', stage: 'storing', facts },
				reread: false
			})
		).toEqual({ seeded: REPORTED, spent: false });
	});

	// the key named no account, so the chain stopped in front of the store and the boxes still hold
	// what has to change.
	it('seeds nothing from a run that stopped short of the store', () => {
		expect(
			keysStanding({
				reported: REPORTED,
				sent: SENT,
				run: ended({ kind: 'unnamed', failure: { kind: 'refused', detail: 'no such key' } }),
				reread: false
			})
		).toEqual({ seeded: REPORTED, spent: false });
	});

	/**
	 * a removal is one request and no run at all (`stripeAsked` in ./stripe-keys.ts), so the run on
	 * the page is an earlier press's — and read as this one's answer it would seed the boxes from a
	 * pair the removal took off.
	 */
	it('reads no pair off a removal, whatever run the fold is still holding', () => {
		expect(
			keysStanding({
				reported: REPORTED,
				sent: { act: 'remove', boxes: { STRIPE_SECRET_KEY: '', STRIPE_PUBLISHABLE_KEY: 'pk' } },
				run: ended({ kind: 'done' }),
				reread: false
			})
		).toEqual({ seeded: REPORTED, spent: false });
	});

	// a run outlives the page it was pressed on, so a fold drawn over a reload holds an answer to a
	// press whose boxes are gone.
	it('reads no pair where this page made no press', () => {
		expect(
			keysStanding({ reported: REPORTED, sent: null, run: ended({ kind: 'done' }), reread: false })
		).toEqual({ seeded: REPORTED, spent: false });
	});

	it('still spends the boxes on the reading, for a press the run says nothing about', () => {
		expect(keysStanding({ reported: REPORTED, sent: null, run: null, reread: true })).toEqual({
			seeded: REPORTED,
			spent: true
		});
	});
});

describe('secretStored', () => {
	const facts: StripeFacts = { named: null, registration: null, elsewhere: [] };
	const ended = (outcome: StripeSetup, act: StripeRunAct = 'errand'): StripeRunRead => ({
		kind: 'ended',
		act,
		stage: 'covering',
		facts,
		outcome
	});

	// every stop behind the store is the charging key on the deployment, whatever else did not land
	// after it — and each of them is a reading of that deployment worth taking again.
	it('counts every stop the chain reaches with the key already stored', () => {
		expect(secretStored(ended({ kind: 'done' }))).toBe(true);
		expect(
			secretStored(
				ended({
					kind: 'unrepeating',
					setup: {
						kind: 'reported',
						report: {
							outcome: 'failed',
							processors: [
								{
									processor: 'stripe',
									label: 'Stripe',
									outcome: 'failed',
									detail: null,
									reason: 'failed'
								}
							]
						}
					},
					awaitingKey: false
				})
			)
		).toBe(true);
		expect(
			secretStored(
				ended({
					kind: 'uncovered',
					levelled: { kind: 'unanswered', read: { kind: 'no-session' } },
					awaitingKey: false
				})
			)
		).toBe(true);
		expect(
			secretStored(ended({ kind: 'not-published', published: { kind: 'unreachable', detail: '' } }))
		).toBe(true);
	});

	it('counts no stop in front of the store, where the deployment holds nothing new', () => {
		expect(
			secretStored(ended({ kind: 'unnamed', failure: { kind: 'refused', detail: 'no such key' } }))
		).toBe(false);
	});

	// a press that left the charging key alone carries none and can store none: what it writes is
	// the published var and nothing else.
	it('counts no publish, which stores no key whatever it ends as', () => {
		expect(secretStored(ended({ kind: 'done' }, 'publish'))).toBe(false);
	});

	it('counts no run still going, and no fold holding one at all', () => {
		expect(secretStored({ kind: 'running', act: 'errand', stage: 'storing', facts })).toBe(false);
		expect(secretStored(null)).toBe(false);
	});
});
