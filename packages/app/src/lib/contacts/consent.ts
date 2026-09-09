// the words for `contact.consented_to_contact`, in the one place both a component and a `load` may
// import from — the same reason ./kinds.ts is not under `$lib/server/**`.
//
// unlike that file this one is the source of no constraint: the column is a nullable boolean and
// the database's whole opinion of it is that it holds true, false or nothing. what is stated here
// is the third state having a name at all.

/**
 * the three answers a contact row can hold.
 *
 * `unasked` is the one that matters and the one a screen loses first. an organisation deciding who
 * to email has to tell a donor who said no from one nobody put the question to — the first is a
 * decision it must honour, the second is a person it may still ask — and rendering an absent answer
 * as a refusal destroys exactly the distinction a consent record exists to keep. /admin's own
 * create form has no such field on it and writes null deliberately, so a deployment's donor file is
 * full of this state rather than short of it.
 */
export const CONSENT_STATES = ['agreed', 'declined', 'unasked'] as const;
export type ConsentState = (typeof CONSENT_STATES)[number];

/** the stored answer, as one of the three states. */
export function consentState(consented: boolean | null): ConsentState {
	if (consented === null) return 'unasked';
	return consented ? 'agreed' : 'declined';
}

/**
 * what each state is called on a screen.
 *
 * keyed by `ConsentState` rather than `string`, the same discipline `KIND_LABELS` in ./kinds.ts is
 * under. the words answer "may we contact this person", which is the question the donor was asked,
 * rather than naming the column.
 */
export const CONSENT_LABELS: Record<ConsentState, string> = {
	agreed: 'Yes',
	declined: 'No',
	unasked: 'Not asked'
};
