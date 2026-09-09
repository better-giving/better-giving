import { describe, expect, it } from 'vitest';
import type { StripeFacts, StripeRunRead } from '../api/types';
import type { KeysWrite, PressAnswer, PressPhase } from './stripe-press';
import {
	answerLanded,
	answeredRefusal,
	keysClosed,
	reportStands,
	runUnderway,
	standingRefusal,
	writingElsewhere
} from './stripe-press';

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
