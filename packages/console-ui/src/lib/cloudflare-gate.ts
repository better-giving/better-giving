import type { HomeFace, VarsRead } from '../api/types';

// which gate a console page stands behind when cloudflare would not say what this deployment holds,
// and the words on it (./deployment-states.tsx's `CloudflareGateFace` draws them).
//
// **nothing cloudflare wrote reaches a gate.** each kind already says which way the read failed, and
// cloudflare's own text is for someone reading its API, not an operator: the gate is built from the
// kind and the two names this console holds, and never from a `detail`.
//
// **a sign-in is repaired in the terminal and nowhere else**, so the refused and signed-out gates
// name the command and carry no press: a read again goes through the same sign-in and meets the
// same answer. the other three can change on their own, so they carry the read again.

/** a run of words, where `code` is what an operator types. */
export type GateWords = readonly (string | { code: string })[];

export type CloudflareGate = {
	title: string;
	/** the one sentence under the heading, or `null` where the heading is the whole of it. */
	sentence: GateWords | null;
	retry: boolean;
};

const START = { code: 'better-giving start' };

const REFUSED: CloudflareGate = {
	title: 'Cloudflare turned this sign-in down',
	sentence: [
		'Close the console, then run ',
		START,
		' in the terminal you start it from to sign in again.'
	],
	retry: false
};

const SIGNED_OUT: CloudflareGate = {
	title: 'Signed out of Cloudflare',
	sentence: ['Close the console, then run ', START, ' in the terminal you start it from.'],
	retry: false
};

const NO_ANSWER: CloudflareGate = {
	title: 'Cloudflare didn’t answer',
	sentence: null,
	retry: true
};

const UNREADABLE: CloudflareGate = {
	title: 'Cloudflare’s answer couldn’t be read',
	sentence: null,
	retry: true
};

type Names = { workerName: string; accountName: string };

const gone = ({ workerName, accountName }: Names): CloudflareGate => ({
	title: 'This deployment is gone',
	sentence: [`No Worker called ${workerName} is in ${accountName} any more.`],
	retry: true
});

/** the gate over a settings read that did not land, by the way it did not. */
function valuesGate(vars: VarsRead, names: Names): CloudflareGate {
	switch (vars.kind) {
		case 'not-deployed':
			return gone(names);
		case 'refused':
			return REFUSED;
		case 'no-credential':
			return SIGNED_OUT;
		case 'unreachable':
			return NO_ANSWER;
		case 'unreadable':
		// the binary blocks on the settings only where their read did not land, so a block over one
		// that did is an answer contradicting itself.
		case 'read':
			return UNREADABLE;
	}
}

/**
 * the gate over `face`, or `null` where the face is ready or is one `/` draws for itself — a
 * deployment that will not answer this console, two databases of one name, no address.
 *
 * a Worker that is not there is a gate only to a page it was open on: `/` draws its own face for
 * it, which is where the command that stands one up is named.
 */
export function cloudflareGate(
	face: HomeFace,
	vars: VarsRead,
	names: Names
): CloudflareGate | null {
	if (face.kind === 'deploy') return gone(names);
	if (face.kind !== 'blocked') return null;
	switch (face.why.kind) {
		case 'refused':
			return REFUSED;
		case 'no-credential':
			return SIGNED_OUT;
		case 'unreachable':
			return NO_ANSWER;
		case 'no-values':
			return valuesGate(vars, names);
		default:
			return null;
	}
}
