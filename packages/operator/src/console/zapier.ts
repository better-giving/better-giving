// the one key Zapier presents to this deployment, and the Zaps listening on it — named once for
// both ends of the wire.
//
// it is here for the reason ./quickbooks.ts is here: the deployment holds the key and the
// subscriptions, answers with these values, the operator console draws them, and the two packages
// import nothing of each other's.
//
// **the key is in every reading**, as it is in the answer to the press that made it.
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

/** everything the screen draws, in one read. */
export interface ZapierReport {
	/** the key, or null before one is made. `madeAt` is an ISO-8601 instant; `key` is the plaintext. */
	readonly key: { readonly madeAt: string; readonly key: string } | null;
	/** the open subscriptions per trigger — what `replace` would disconnect. */
	readonly listening: { readonly newGift: number; readonly newDonor: number };
	readonly deliveries: {
		/** events still owed to a Zap, whether due now or waiting on a backoff. */
		readonly waiting: number;
		/** events given up on in the last seven days, so a line over them clears on its own. */
		readonly failed: number;
		/** when the oldest event still owed was queued, as an ISO-8601 instant, or null where none is. */
		readonly oldestWaitingAt: string | null;
	};
}

/**
 * what a press answers with.
 *
 * `key` is the plaintext, the same the next reading carries. `disconnected` is how many
 * subscriptions the old key took down with it, and 0 on `make`. of those, `paused` is how many
 * Zapier paused, asking the Zap's owner to reconnect, or no longer had, and `notPaused` how many
 * hooks did not take it — a fault, an error or no answer — whose Zaps still read as on in Zapier
 * until their owners switch them off; nothing asks again. the two sum to `disconnected`. a
 * refusal's `detail` names the press that would have landed.
 */
export type ZapierPressReport =
	| {
			readonly ok: true;
			readonly press: ZapierPress;
			readonly key: string;
			readonly madeAt: string;
			readonly disconnected: number;
			readonly paused: number;
			readonly notPaused: number;
	  }
	| { readonly ok: false; readonly press: ZapierPress; readonly detail: string };
