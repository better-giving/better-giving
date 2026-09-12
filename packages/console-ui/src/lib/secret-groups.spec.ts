import { DEPLOY_VARS } from '@better-giving/operator/deploy-split';
import { describe, expect, it } from 'vitest';
import { UNGROUPED_VARS } from './deploy-vars';
import type { SecretGroup } from './secret-groups';
import {
	MAIL_GROUP,
	MASKED_VALUES,
	MINTED_BY_CONSOLE,
	SECRET_GROUPS,
	SIGN_IN_GROUP,
	isMasked,
	pressedNames,
	typedNames
} from './secret-groups';

// which names in a group an operator is offered a box for.
//
// it is asserted here rather than seen on the page because this package has no DOM pool
// (../../vite.config.ts is `node`), and the one name it is about is the one no operator may be
// invited to type: `BETTER_AUTH_SECRET` signs the session a staff member gets back and is minted by
// `packages/console/internal/first`, which argues that a box whose only correct answer is a random string is
// a box somebody fills with a word they can remember. a rendered check of that would be a look
// taken once; this is the property held.

const group = (names: readonly string[]): SecretGroup =>
	({ id: 'made-up', label: 'Made up', names }) as unknown as SecretGroup;

describe('the names a group is typed through', () => {
	it('is every name where the console mints none of them', () => {
		expect(typedNames(group(['A', 'B']))).toEqual(['A', 'B']);
	});

	it('drops the minted ones and keeps the order of the rest', () => {
		expect(typedNames(group(['A', 'B', 'C']), ['B'])).toEqual(['A', 'C']);
	});

	it('is empty where every name is minted, rather than falling back to all of them', () => {
		// the block reads this to decide whether to draw a control at all, so an empty answer has to
		// stay empty: the fallback would be a press that opens no box.
		expect(typedNames(group(['A']), ['A'])).toEqual([]);
	});

	it('ignores a minted name the group does not carry', () => {
		expect(typedNames(group(['A']), ['Z'])).toEqual(['A']);
	});

	it('leaves the sign-in group with the password alone to type', () => {
		// the case this file exists for, over the real group rather than a made-up one.
		const signIn = SECRET_GROUPS.find((one) => one.id === SIGN_IN_GROUP);
		expect(signIn?.names).toEqual(['ADMIN_PASSWORD', 'BETTER_AUTH_SECRET']);
		expect(typedNames(signIn as SecretGroup, MINTED_BY_CONSOLE)).toEqual(['ADMIN_PASSWORD']);
	});
});

describe('the names a press carries a value for', () => {
	it('leaves the sign-in group with the password alone, which is the one box it draws', () => {
		// the reading this exists for. `BETTER_AUTH_SECRET` is minted by the console and gets no box
		// at all, so a press that read the name would find nothing behind it and file the group's
		// signing secret as a box the operator emptied — every dashboard-password change signing out
		// every staff session.
		const signIn = SECRET_GROUPS.find((one) => one.id === SIGN_IN_GROUP) as SecretGroup;
		expect(signIn.names).toContain('BETTER_AUTH_SECRET');
		expect(pressedNames(signIn)).toEqual(['ADMIN_PASSWORD']);
	});

	it('carries no name the console mints, in any group', () => {
		// held over the enumeration rather than over the one group above it: a minted name added to
		// another group is the same collapse under a different press.
		const pressed = SECRET_GROUPS.flatMap(pressedNames);
		expect(pressed.filter((name) => MINTED_BY_CONSOLE.includes(name))).toEqual([]);
	});

	it('leaves the mail group without the port, which the form states rather than takes', () => {
		// the reading this exists for, and the one that breaks quietly: a name arriving with no box
		// behind it reads as an emptied box and so as a removal — of a value nobody touched
		// (./secret-edits.ts).
		const mail = SECRET_GROUPS.find((one) => one.id === MAIL_GROUP) as SecretGroup;
		expect(mail.names).toContain('SMTP_PORT');
		expect(pressedNames(mail)).toEqual([
			'SMTP_HOST',
			'SMTP_USERNAME',
			'SMTP_PASSWORD',
			'MAIL_FROM'
		]);
	});
});

describe('the groups the seventeen are set in', () => {
	it('covers the enumeration exactly, each name in one group or named as having none', () => {
		const grouped = SECRET_GROUPS.flatMap((group) => group.names);
		expect([...grouped, ...UNGROUPED_VARS].sort()).toEqual([...DEPLOY_VARS].sort());
		expect(new Set(grouped).size).toBe(grouped.length);
	});
});

describe('the boxes that arrive masked', () => {
	it('is the four values reading over a shoulder is enough to take, and no others', () => {
		// what makes a value one of these is what somebody could do with it after reading it off the
		// screen, and the only place that judgement is recorded is the list itself — so this case is
		// what makes changing the list deliberate.
		expect(MASKED_VALUES).toEqual([
			'ADMIN_PASSWORD',
			'SMTP_PASSWORD',
			'STRIPE_SECRET_KEY',
			'PAYPAL_CLIENT_SECRET'
		]);
	});

	it('leaves the other thirteen of the seventeen legible, the two public halves among them', () => {
		// held over the enumeration, so an eighteenth value lands unmasked and this case is where that
		// shows. the two named are the ones worth asserting: each stands beside a masked box in the
		// same fold and carries a word that reads like a credential, and ./secret-groups.ts argues why
		// neither is one.
		expect([...DEPLOY_VARS].filter(isMasked).sort()).toEqual([...MASKED_VALUES].sort());
		expect(isMasked('STRIPE_PUBLISHABLE_KEY')).toBe(false);
		expect(isMasked('PAYPAL_CLIENT_ID')).toBe(false);
	});
});
