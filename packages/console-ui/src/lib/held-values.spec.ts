import { describe, expect, it } from 'vitest';
import type { DeployVarName, DeployedVar } from '../api/types';
import { heldValues, withheldInGroup } from './held-values';
import {
	MAIL_GROUP,
	PAYMENTS_GROUP,
	SECRET_GROUPS,
	SIGN_IN_GROUP,
	SPAM_GROUP
} from './secret-groups';

// which group names a value the deployment holds in a form nothing can read back, which is what
// decides where the press that frees it is drawn.
//
// **the reading is a group's whole name list and never the names its press types.** a fold scoped
// to its own boxes leaves every name nobody types named nowhere at all — the session signing
// secret and the spam widget's key are both minted rather than typed — so the value sits in a
// state no box can be typed out of with nothing on the page saying so and no press beside it.
//
// it is asserted here rather than seen on the page because this package has no DOM pool
// (../../vite.config.ts is `node`). what each fold hands this is its own group, so the property
// below is the one the blocks are drawn off — ./payments-fold.tsx reads the same property over the
// three names its press writes, since the publishable key it stores is in no group.
//
// **the spam group is named here and is drawn by no fold**, which ../every-group-drawn.spec.ts
// holds as a deliberate exemption: `TURNSTILE_SECRET_KEY` is minted with the widget by the first
// deploy and nothing on a deployed console stores one, so a withheld one is still named nowhere on
// the page. the case below is the reading, not the drawing.

const withholding = (...names: readonly DeployVarName[]): DeployedVar[] =>
	names.map((name) => ({ name, kind: 'withheld' }));

/** the groups that would draw a block over a deployment withholding exactly `names`. */
const naming = (...names: readonly DeployVarName[]): string[] => {
	const values = heldValues(withholding(...names));
	return SECRET_GROUPS.filter((group) => withheldInGroup(values, group).length > 0).map(
		(group) => group.id
	);
};

describe('the group a withheld name is named in', () => {
	it('names the sign-in group for the signing secret, which has no box in it', () => {
		// `BETTER_AUTH_SECRET` is minted by the console and typed by nobody, so a block scoped to the
		// boxes drew nothing for it at all.
		expect(naming('BETTER_AUTH_SECRET')).toEqual([SIGN_IN_GROUP]);
	});

	it('names the spam group for the widget key, which no press on the page types', () => {
		expect(naming('TURNSTILE_SECRET_KEY')).toEqual([SPAM_GROUP]);
	});

	it('names the mail group for the port, which the form states rather than takes', () => {
		expect(naming('SMTP_PORT')).toEqual([MAIL_GROUP]);
	});

	it('names the payments group for the signing secret Stripe issues', () => {
		expect(naming('STRIPE_WEBHOOK_SECRET')).toEqual([PAYMENTS_GROUP]);
	});

	it('names one group per withheld name and never a second', () => {
		// the enumeration files each of the thirteen in one group or none (./secret-groups.spec.ts),
		// so a name reaching two blocks would be two presses drawn for one act.
		for (const group of SECRET_GROUPS) {
			for (const name of group.names) expect(naming(name)).toEqual([group.id]);
		}
	});

	it('names no group where the deployment withholds nothing', () => {
		expect(naming()).toEqual([]);
	});

	it('leaves a name it can read back out of every group', () => {
		const values = heldValues([{ name: 'ADMIN_PASSWORD', kind: 'value', value: 'twelve chars' }]);
		const signIn = SECRET_GROUPS.find((one) => one.id === SIGN_IN_GROUP);
		expect(signIn === undefined ? null : withheldInGroup(values, signIn)).toEqual([]);
	});
});
