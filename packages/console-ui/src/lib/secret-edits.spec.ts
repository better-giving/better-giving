import { describe, expect, it } from 'vitest';
import type { SecretGroup } from './secret-groups';
import { SECRET_GROUPS, SIGN_IN_GROUP, VALUE_FIELD, pressedNames } from './secret-groups';
import { secretEdits } from './secret-edits';

// what a group's boxes asked the deployment to do, read one name at a time.
//
// nothing here reaches a network and nothing could: the reading is a list of names, a form body and
// the seeds those boxes were drawn with — so every state below is a value a case can read, and what
// a press goes on to send is the payload this answers with.

/** the boxes of one group, as the browser posts them. */
function posted(boxes: Record<string, string>) {
	const body = new FormData();
	for (const [name, value] of Object.entries(boxes)) body.set(VALUE_FIELD(name), value);
	return body;
}

const PAIR = ['SMTP_USERNAME', 'SMTP_PASSWORD'] as const;

/** what the deployment is holding, which is what those boxes were drawn with. */
const HOLDING = { SMTP_USERNAME: 'apikey', SMTP_PASSWORD: 're_key' };

/** a deployment holding nothing under either name, so both boxes were drawn empty. */
const EMPTY = {};

describe('reading what a group was asked to do', () => {
	it('posts nothing where every box came back holding its seed', () => {
		// every box on this console is drawn holding what the deployment is holding, so a form nobody
		// edited is a press with nothing in it — and a reading that answered otherwise would rewrite
		// every value on the group each time the fold was opened and saved.
		expect(secretEdits(PAIR, posted(HOLDING), HOLDING)).toEqual({ ok: true, payload: {} });
	});

	it('posts nothing where a deployment holding neither name comes back with both boxes empty', () => {
		expect(secretEdits(PAIR, posted({ SMTP_USERNAME: '', SMTP_PASSWORD: '' }), EMPTY)).toEqual({
			ok: true,
			payload: {}
		});
	});

	it('sets a box that came back holding something else', () => {
		expect(secretEdits(PAIR, posted({ ...HOLDING, SMTP_USERNAME: 'postmaster' }), HOLDING)).toEqual(
			{ ok: true, payload: { SMTP_USERNAME: 'postmaster' } }
		);
	});

	it('sets a box the deployment held nothing under', () => {
		expect(secretEdits(PAIR, posted({ SMTP_USERNAME: 'apikey' }), EMPTY)).toEqual({
			ok: true,
			payload: { SMTP_USERNAME: 'apikey' }
		});
	});

	it('sends a value character for character', () => {
		// a leading or trailing space is a character of the credential, and quietly removing one
		// turns a correct paste into a wrong value with nothing on the screen to see.
		expect(secretEdits(PAIR, posted({ SMTP_PASSWORD: '  spaced  ' }), EMPTY)).toEqual({
			ok: true,
			payload: { SMTP_PASSWORD: '  spaced  ' }
		});
	});

	it('removes a stored value whose box was emptied', () => {
		// the operator can see the value, so emptying the box is an act rather than the absence of
		// one — and it is the only gesture this form draws for taking a value away.
		expect(secretEdits(PAIR, posted({ ...HOLDING, SMTP_PASSWORD: '' }), HOLDING)).toEqual({
			ok: true,
			payload: { SMTP_PASSWORD: null }
		});
	});

	it('removes nothing over a name the deployment holds nothing under', () => {
		// the same empty box and the opposite meaning: there is nothing behind this one to take away.
		expect(secretEdits(PAIR, posted({ SMTP_USERNAME: '' }), EMPTY)).toEqual({
			ok: true,
			payload: {}
		});
	});

	it('leaves a name held in a form nothing can read back exactly as it is', () => {
		// its box is seeded empty and came back empty, so this press writes nothing over it. the fold
		// that drew it is what says the value is there and offers the press that frees it.
		expect(secretEdits(PAIR, posted({ SMTP_USERNAME: '' }), { SMTP_USERNAME: '' })).toEqual({
			ok: true,
			payload: {}
		});
	});

	it('refuses a box holding only whitespace', () => {
		// the deployment drops a value that trims to empty (`readConfigEnv` in
		// packages/app/src/lib/server/config/env.ts), so storing one would leave this screen drawing a
		// value back over a name the deployment reads as unset.
		const read = secretEdits(PAIR, posted({ SMTP_USERNAME: '   ' }), EMPTY);
		expect(read.ok).toBe(false);
		expect(read.ok === false && Object.keys(read.errors)).toEqual(['SMTP_USERNAME']);
	});

	it('says how to remove a value without naming a tick this form does not draw', () => {
		const read = secretEdits(PAIR, posted({ SMTP_USERNAME: '   ' }), HOLDING);
		expect(read.ok === false && read.errors.SMTP_USERNAME).not.toContain('tick');
	});

	it('refuses the whole group rather than writing the half of it that parsed', () => {
		const read = secretEdits(
			PAIR,
			posted({ SMTP_USERNAME: 'apikey', SMTP_PASSWORD: '   ' }),
			EMPTY
		);
		expect(read.ok).toBe(false);
		expect(read.ok === false && Object.keys(read.errors)).toEqual(['SMTP_PASSWORD']);
	});

	it('reads only the names of the group being saved', () => {
		// the payload is built from the group's own names, so a body naming a value under another
		// group's name has nowhere to reach — a press saves the group it was pressed in.
		const body = posted({ SMTP_USERNAME: 'apikey' });
		body.set(VALUE_FIELD('ADMIN_PASSWORD'), 'not this one');

		expect(secretEdits(PAIR, body, EMPTY)).toEqual({
			ok: true,
			payload: { SMTP_USERNAME: 'apikey' }
		});
	});

	it('takes what the deployment holds from the read and never from the body', () => {
		// the seeds are derived from what was read off the account. a body that says otherwise would
		// turn an empty box into a delete of a name nothing is stored under.
		const body = posted({ SMTP_USERNAME: '' });
		body.set('stored:SMTP_USERNAME', 'on');

		expect(secretEdits(PAIR, body, EMPTY)).toEqual({ ok: true, payload: {} });
	});
});

describe('reading a box the deployment states a rule about', () => {
	const SIGN_IN = ['ADMIN_PASSWORD', 'BETTER_AUTH_SECRET'] as const;

	it('refuses a dashboard password the deployment would not authenticate against', () => {
		// the console is the only end that reads this value before it is stored, so a short one
		// accepted here is an operator locked out of their own dashboard with both surfaces saying
		// the password is fine (packages/operator/src/admin-password.ts).
		const read = secretEdits(SIGN_IN, posted({ ADMIN_PASSWORD: 'eleven char' }), {});
		expect(read).toEqual({
			ok: false,
			errors: { ADMIN_PASSWORD: 'Must be at least 12 characters' }
		});
	});

	it('never carries the typed value into the sentence', () => {
		const read = secretEdits(SIGN_IN, posted({ ADMIN_PASSWORD: 'hunter2' }), {});
		expect(read.ok).toBe(false);
		expect(JSON.stringify(read)).not.toContain('hunter2');
	});

	it('stores one the deployment can authenticate against', () => {
		expect(secretEdits(SIGN_IN, posted({ ADMIN_PASSWORD: 'twelve chars' }), {})).toEqual({
			ok: true,
			payload: { ADMIN_PASSWORD: 'twelve chars' }
		});
	});

	it('says nothing about a box that came back holding its seed', () => {
		// the stored password read back into its own box: the untouched box is read before any rule
		// about what a value may be.
		expect(
			secretEdits(SIGN_IN, posted({ ADMIN_PASSWORD: 'short one' }), { ADMIN_PASSWORD: 'short one' })
		).toEqual({ ok: true, payload: {} });
	});

	it('refuses an emptied box over the stored password rather than removing it', () => {
		// the one box on this console whose emptying is not a removal: the deployment refuses every
		// sign-in while the name is unset (`readStaffCredential` in
		// packages/app/src/lib/server/auth/credential.ts) and the way back is this same box, so an
		// operator who cleared it to type a new one and pressed instead is locked out of /admin.
		const read = secretEdits(SIGN_IN, posted({ ADMIN_PASSWORD: '' }), {
			ADMIN_PASSWORD: 'twelve chars'
		});
		expect(read.ok).toBe(false);
		expect(read.ok === false && Object.keys(read.errors)).toEqual(['ADMIN_PASSWORD']);
	});

	it('says nothing about an empty box the deployment holds no password under', () => {
		// the untouched box is read before any rule about it, so a deployment that never stored one
		// is not a press being refused for a box nobody went near.
		expect(secretEdits(SIGN_IN, posted({ ADMIN_PASSWORD: '' }), {})).toEqual({
			ok: true,
			payload: {}
		});
	});

	it('leaves the generated credential of the same group alone', () => {
		// the rule is the dashboard password's own. nothing else in the group is typed by a staff
		// member or compared against one.
		expect(secretEdits(SIGN_IN, posted({ BETTER_AUTH_SECRET: 'short' }), {})).toEqual({
			ok: true,
			payload: { BETTER_AUTH_SECRET: 'short' }
		});
	});
});

describe('the sign-in press, over the names the page actually draws boxes for', () => {
	// the two ends composed, which is the reading that broke: the form draws one box and the press
	// reads the group. a name with no box behind it comes back empty against a seed that is not, so
	// the console files the deployment's signing secret as a box the operator emptied and takes it
	// off — every live staff session signed out on a routine password change.
	const signIn = SECRET_GROUPS.find((one) => one.id === SIGN_IN_GROUP) as SecretGroup;
	const HELD = { ADMIN_PASSWORD: 'twelve chars', BETTER_AUTH_SECRET: 'minted-on-the-first-press' };

	it('posts nothing where the password box came back holding its seed', () => {
		const body = posted({ ADMIN_PASSWORD: 'twelve chars' });
		expect(secretEdits(pressedNames(signIn), body, HELD)).toEqual({ ok: true, payload: {} });
	});

	it('posts the password alone where a new one was typed', () => {
		const body = posted({ ADMIN_PASSWORD: 'a longer one' });
		expect(secretEdits(pressedNames(signIn), body, HELD)).toEqual({
			ok: true,
			payload: { ADMIN_PASSWORD: 'a longer one' }
		});
	});
});
