import { describe, expect, it } from 'vitest';
import { PAYMENT_METHODS, type PaymentMethod } from '@better-giving/form/v1';
import {
	RAIL_STANDINGS,
	type RailChargeability,
	type RailStanding
} from '../payments/rail-chargeability';
import { railNotes } from './rail-notes';

// what the donation-form editor says beside a rail it cannot charge, away from anything that would
// have to be asked over a network.
//
// a node spec rather than a workers one: nothing here touches the database, which is what splits the
// two pools (CONTRIBUTING.md). the seam is `RailChargeability`, which is a value — every deployment
// worth a case is three lines here, where reaching one against a real account would mean owning a
// Stripe account per standing.
//
// half of these cases are about words rather than about a branch, and that is the point of the file:
// the sentences are the whole deliverable and three of the six standings are ones an operator sent
// to the wrong place by them has nowhere to go. ../payments/rail-chargeability.ts's header states
// the constraint they are held to.

/** an account that answered, with every rail's standing stated. */
function read(rails: Record<PaymentMethod, RailStanding>): RailChargeability {
	return { state: 'read', chargesEnabled: true, rails };
}

/** the best account there is, with one rail moved off where it stood — the shape most cases are. */
function standing(rail: PaymentMethod, value: RailStanding): RailChargeability {
	const rails = {} as Record<PaymentMethod, RailStanding>;
	for (const method of PAYMENT_METHODS) rails[method] = 'approved';
	rails[rail] = value;
	return read(rails);
}

/** the sentence written for `value`, taken off the rail it was put on. */
function noteFor(value: RailStanding): string {
	const note = railNotes(standing('ach', value)).ach;
	if (note === null) throw new Error(`\`${value}\` has no sentence`);
	return note;
}

/**
 * every standing that carries a sentence, read off the closed set rather than written out.
 *
 * derived so that an eighth standing added to ../payments/rail-chargeability.ts arrives inside the
 * cases below on its own. a list here would have left the new sentence unread by the two gates that
 * are the whole reason this file exists — and unread quietly, since every case would still pass.
 */
const SPEAKING = RAIL_STANDINGS.filter((value) => value !== 'approved');

describe('railNotes', () => {
	/**
	 * the deployment that has never configured Stripe, and the one this screen must not punish.
	 *
	 * an unreadable answer is not a rail that failed — nothing was ever asked — so a sentence on any
	 * of them would be this screen inventing a state out of silence. the editor draws exactly as it
	 * does with no payments configured at all, which is what keeps a fresh fork's first form
	 * editable.
	 */
	it('says nothing at all when the account could not be read', () => {
		const notes = railNotes({ state: 'unreadable', detail: 'no keys are set' });

		expect(notes).toEqual({ card: null, ach: null, apple_pay: null, google_pay: null });
	});

	/** the only standing a caller may act on, and the only one with nothing beside it. */
	it('says nothing beside a way of paying the account is approved for', () => {
		const notes = railNotes(standing('card', 'approved'));

		expect(notes.card).toBeNull();
		expect(notes.ach).toBeNull();
		expect(notes.apple_pay).toBeNull();
		expect(notes.google_pay).toBeNull();
	});

	/**
	 * a wallet's sentence is the account's, because a wallet's standing is read off the account.
	 *
	 * worth its own case because the sentence used to be the one thing on this screen that named no
	 * dashboard: a wallet was a limit here rather than at the processor. it is the processor's now,
	 * so an operator sent there arrives somewhere with a switch to throw.
	 */
	it('sends an operator to Stripe over a wallet', () => {
		const notes = railNotes(standing('apple_pay', 'switched_off'));

		expect(notes.apple_pay).toMatch(/Stripe dashboard/);
	});

	/** every standing past `approved` is a different thing to do about it, so each gets its own. */
	it.each(SPEAKING)('says something beside a way of paying that stands at %s', (value) => {
		expect(noteFor(value).length).toBeGreaterThan(0);
	});

	/** and no two of them are the same sentence, which is the other half of that claim. */
	it('gives each standing its own sentence', () => {
		const written = SPEAKING.map(noteFor);

		expect(new Set(written).size).toBe(written.length);
	});

	/**
	 * the constraint ../payments/rail-chargeability.ts's header states, held over the words.
	 *
	 * an approved rail is necessary and not sufficient — a real gift still fails on the currency, the
	 * amount or the donor's own bank — so nothing this screen prints may promise one works. the
	 * standings carry no word for it and this is what keeps the sentences from growing one.
	 */
	it('never says a way of paying works', () => {
		for (const value of SPEAKING) {
			expect(noteFor(value)).not.toMatch(/\bworks?\b|\bwill work\b|\bworking\b/i);
		}
	});

	/**
	 * a rail nobody asked for is not a rail anybody refused.
	 *
	 * the two send an operator to completely different places, and only one of those places exists:
	 * there is no rejection to appeal, no case to reopen and nobody to write to. what there is is a
	 * request that has never been made.
	 */
	it('never reports a way of paying as refused', () => {
		for (const value of SPEAKING) {
			expect(noteFor(value)).not.toMatch(/refus|reject|denied|turned down|declined/i);
		}
	});

	/**
	 * the three an operator can do something about, and where that something is done.
	 *
	 * each is answerable where the account is administered, and a sentence stopping at the
	 * consequence would leave an operator holding a problem and no door. the one left out is the one
	 * with no door to name: `in_review` is waiting, and naming a screen there is an invitation to go
	 * and press something that changes nothing.
	 */
	it.each<RailStanding>(['not_approved', 'never_requested', 'account_cannot_charge'])(
		'points at the account over %s',
		(value) => {
			expect(noteFor(value)).toMatch(/Stripe dashboard/);
		}
	);
});
