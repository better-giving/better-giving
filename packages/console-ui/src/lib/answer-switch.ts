import type { DeployValueName } from '@better-giving/operator/deploy-split';

// a value that holds an operator's answer to a yes-or-no question about the organisation or the
// account rather than a credential, drawn as a switch with two positions — and what one press of
// that switch writes.
//
// **there is no third position.** no call reports the answer, so the stored value is the whole of
// it, and the deployment reads every spelling but one word as no, exactly as it reads an absent
// value. so off is the name taken away rather than a stored no: a word stored for off would be a
// value this console draws a filled box over while the deployment reads it as no, and a third
// shape to word with nothing true to say in it.
//
// **the console's door refuses every other spelling before cloudflare is asked** (`answerSwitches`
// in packages/console/internal/server/values.go). {@link switchEdit} is what makes a refusal there
// unreachable from a switch rather than merely unlikely: the payload is composed from the two
// positions, so no third thing can be carried whatever a box holds.
//
// **each switch is a press of its own and in no group** (./deploy-vars.ts): an answer is given long
// after, and apart from, the credentials beside it, and folding it into their press would make
// changing it a re-commit of every one of them.
//
// the switches are ./paypal-charity.ts and ./cloudflare-plan.ts, drawn by ./answer-switch-block.tsx.

/** what one switch is, apart from the words drawn beside it. */
export type AnswerSwitch = {
	/** the value the answer is stored under. */
	readonly name: DeployValueName;
	/** the one word the deployment reads as yes, and the only value the switch ever posts. */
	readonly word: string;
	/** what the press posts as its intent, and what its outcome is reported against. */
	readonly intent: string;
	/** the box the switch is drawn as, which is what the press reads its position off. */
	readonly field: string;
};

/**
 * what one press of `answer`'s switch puts on the deployment: the one word where the box is ticked,
 * and `null` — the name taken off — where it is not.
 *
 * **it is composed from the two positions and never from what the box holds**, so anything else a
 * body claimed lands on the same two answers the screen has.
 */
export const switchEdit = (
	answer: AnswerSwitch,
	posted: FormData
): Record<string, string | null> => ({
	[answer.name]: posted.get(answer.field) === answer.word ? answer.word : null
});
