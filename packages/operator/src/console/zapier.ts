// the one key Zapier presents to this deployment, and the Zaps listening on it — named once for
// both ends of the wire.
//
// it is here for the reason ./quickbooks.ts is here: the deployment holds the key's hash and the
// subscriptions, answers with these values, the operator console draws them, and the two packages
// import nothing of each other's.
//
// **the key crosses once.** the deployment stores a hash and never the key, so the plaintext is in
// the answer to the press that made it and in no reading after — a console that lost it makes a
// new one with `replace`.
//
// **it is a block and never a member of the report**, the decision ./quickbooks.ts states: a
// deployment nobody connects to Zapier is not half set up.

/**
 * every press this surface takes, as the `press` on the body.
 *
 *   make    — the first key, refused where one already exists.
 *   replace — a new key in place of the current one, refused where there is none. the old key
 *             stops working and every Zap subscribed on it is disconnected in the same write.
 *
 * two verbs rather than one "new key": two consoles pressing at once cannot replace a key by
 * accident, because the second make is refused.
 */
export const ZAPIER_PRESSES = ['make', 'replace'] as const;

export type ZapierPress = (typeof ZAPIER_PRESSES)[number];

/** everything the screen draws, in one read. no key is ever in it. */
export interface ZapierReport {
	/** when the key was made, as an ISO-8601 instant, or null before one is. */
	readonly key: { readonly madeAt: string } | null;
	/** the open subscriptions per trigger — what `replace` would disconnect. */
	readonly listening: { readonly newGift: number; readonly newDonor: number };
	readonly deliveries: {
		/** events still owed to a Zap, whether due now or waiting on a backoff. */
		readonly waiting: number;
		/** events given up on. */
		readonly failed: number;
		/** when the oldest event still owed was queued, as an ISO-8601 instant, or null where none is. */
		readonly oldestWaitingAt: string | null;
	};
}

/**
 * what a press answers with.
 *
 * `key` is the plaintext, and this is the only answer that carries it. `disconnected` is how many
 * subscriptions the old key took down with it, and 0 on `make`. a refusal's `detail` names the
 * press that would have landed.
 */
export type ZapierPressReport =
	| {
			readonly ok: true;
			readonly press: ZapierPress;
			readonly key: string;
			readonly madeAt: string;
			readonly disconnected: number;
	  }
	| { readonly ok: false; readonly press: ZapierPress; readonly detail: string };
