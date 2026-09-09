import type { Account, SignIn, SignInStatus, Unfinished } from '../api/types';

// which face of the connect panel is on screen, decided once, here.
//
// one route with several faces rather than several routes: the operator's whole task on this
// screen is getting this machine signed in, and a url change between each state of that would be a
// step in a wizard the console is not. what decides the face is four facts and nothing else — the
// repo's config, this machine's sign-in, the sign-in that may be open in a browser right now, and
// what this machine already recorded — so every state can be looked at without a cloudflare
// account, a network or a browser (./connect-face.spec.ts).
//
// **it decides and reads nothing, which is what lets it run in the browser.** the sign-in, the
// phase and the account are all the binary's answer (../api/client.ts), so the whole of what
// happens here is a decision over three values already in hand.
//
// **there is no face for a deployment this console could not read the settings of.** the names are
// baked into the binary (`packages/console/internal/release`), so a console that started at all has
// them.
//
// the order the four are weighed in is the order a refusal has to be met in, and it is not
// interchangeable:
//
//   1. the sign-in, because the accounts it reaches are what a sign-in carries.
//   2. what was recorded, because it is only meaningful against the accounts that came back.
//
// **no face here draws a list of accounts, because the account is chosen at the terminal.** what
// `unchosen` and `account-gone` say is that this deployment has no account recorded on this machine
// or that the recorded one is out of the sign-in's reach, and the panel names the command that
// settles it (./connect-panel.tsx).
//
// no refusal here is a dead end. every one of them is a state with a way out on it, which is what
// the console exists to be rather than a command that exits non-zero.

/** the one face on screen, and everything it needs to draw itself. */
export type Face =
	/** no sign-in on this machine. */
	| { kind: 'signed-out' }
	/** a sign-in is open in the operator's browser. */
	| { kind: 'waiting'; address: string | null }
	/**
	 * the last sign-in ended without one.
	 *
	 * `detail` is the folder a sign-in that could not be written down would have gone in, and is
	 * empty on the other three: the panel's sentence sends the operator to make that folder
	 * writable, and one that does not say which folder is one they cannot act on.
	 */
	| { kind: 'unfinished'; why: Unfinished; detail: string }
	/** a sign-in exists and cloudflare turned it down. */
	| { kind: 'expired'; token: boolean }
	/** the account list could not be read and there is nothing recorded to fall back on. */
	| { kind: 'unreachable' }
	/** a sign-in is held and no account has been recorded for this deployment. */
	| { kind: 'unchosen'; token: boolean; email: string | null }
	/**
	 * an account is recorded. `verified` is false where it is being shown from local state.
	 *
	 * `email` is the sign-in the account was read off, stated beside it so that the screen naming
	 * the account also names whose access reached it. it is `null` on an api token, which carries no
	 * address, and wherever the account is what this machine wrote down rather than what a sign-in
	 * answered.
	 *
	 * `notKept` is the folder a renewed sign-in could not be written to, and `null` where it was.
	 * **it is a state of being signed in and not a way of not being**: the credential in hand is
	 * good and the loss shows at the next launch, so the binary answers `signed-in` with the reason
	 * beside it (`packages/console/internal/oauth/flow.go`'s `kept`) — and a face drawing it only
	 * where nobody is signed in never draws it at all. the folder travels because the console is the
	 * only half that knows it and a sentence sending an operator to make one writable without naming
	 * it is one they cannot act on.
	 */
	| {
			kind: 'connected';
			account: Account;
			email: string | null;
			remembered: boolean;
			verified: boolean;
			notKept: string | null;
	  }
	/** the recorded account is not on the sign-in this machine holds now. */
	| { kind: 'account-gone'; account: Account; email: string | null; token: boolean };

export type FaceInputs = {
	/** how this machine is signed in, as the binary answered for it. */
	signIn: SignIn;
	/** what a sign-in opened in a browser is doing, out of the same answer. */
	login: Pick<SignInStatus, 'phase' | 'address' | 'why' | 'detail'>;
	/** what this machine chose, as the binary answers for it (../api/types.ts). */
	chosen: { account: Account; remembered: boolean } | null;
	/** whether the credential came from the environment the console was started in. */
	tokenSet: boolean;
};

export function connectFace(inputs: FaceInputs): Face {
	const { signIn, login, chosen, tokenSet } = inputs;
	// read off the phase the credential outranks rather than off the flow: a sign-in that arrived
	// and could not be written down leaves the binary answering `signed-in` and holding the reason,
	// which is the one reading below that survives being signed in.
	const notKept = login.phase === 'signed-in' && login.why === 'not-kept' ? login.detail : null;

	switch (signIn.kind) {
		case 'signed-out':
			// the sign-in that may be running belongs to the binary rather than to the page, so a
			// refresh, a second tab and a reopened tab all land on the same one of these three.
			if (login.phase === 'waiting') {
				return { kind: 'waiting', address: login.address === '' ? null : login.address };
			}
			if (login.phase === 'unfinished' && login.why !== '') {
				return { kind: 'unfinished', why: login.why, detail: login.detail };
			}
			return { kind: 'signed-out' };

		case 'refused':
			return { kind: 'expired', token: tokenSet };

		case 'unreachable':
			// what was recorded is still the truth about this deployment; what is missing is the
			// check against cloudflare, and the connected face says so rather than blocking on it.
			return chosen === null
				? { kind: 'unreachable' }
				: {
						kind: 'connected',
						account: chosen.account,
						email: null,
						remembered: chosen.remembered,
						verified: false,
						notKept
					};

		case 'oauth':
		case 'token': {
			const token = signIn.kind === 'token' || tokenSet;
			if (chosen === null) return { kind: 'unchosen', token, email: signIn.email };
			// the name is taken from the sign-in rather than from the record: a cloudflare account
			// can be renamed, and the record is how the id is remembered rather than what it is
			// called today.
			const live = signIn.accounts.find((account) => account.id === chosen.account.id);
			if (live === undefined) {
				return { kind: 'account-gone', account: chosen.account, email: signIn.email, token };
			}
			return {
				kind: 'connected',
				account: live,
				email: signIn.email,
				remembered: chosen.remembered,
				verified: true,
				notKept
			};
		}
	}
}
