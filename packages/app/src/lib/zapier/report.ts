// the one key Zapier presents to this deployment, and the Zaps listening on it, as the dashboard's
// Zapier page (../../routes/_app.admin.integrations.zapier.tsx) reads them and its presses answer.
//
// a leaf that imports nothing, so $lib/server/zapier/ can build the reading to this shape and the
// page can draw it.
//
// **the key is in no reading.** a reading shows its head and tail; the plaintext is in the answer
// to the press that made it and nowhere after, since the deployment stores only its hash.

/**
 * every press this surface takes, as the `press` its answer names.
 *
 *   make    — the first key, refused where one already exists.
 *   replace — a new key in place of the current one, refused where there is none. the old key
 *             stops working and every Zap subscribed on it is disconnected in the same write.
 *
 * two verbs rather than one "new key": two operators pressing at once cannot replace a key
 * by accident, because the second make is refused.
 */
export const ZAPIER_PRESSES = ['make', 'replace'] as const;

export type ZapierPress = (typeof ZAPIER_PRESSES)[number];

/** everything the screen draws, in one read. */
export interface ZapierReport {
	/**
	 * the key's first eight and last four characters, or null before one is made. `madeAt` is an
	 * ISO-8601 instant, and `id` is the key's own row, which a replace names so it cannot end a key
	 * nobody was shown.
	 */
	readonly key: {
		readonly id: string;
		readonly prefix: string;
		readonly lastFour: string;
		readonly madeAt: string;
	} | null;
	/** the open subscriptions per trigger — what `replace` would disconnect. */
	readonly listening: {
		readonly newGift: number;
		readonly newDonor: number;
		readonly giftRefunded: number;
	};
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
 * what a press that landed answers with.
 *
 * `key` is the plaintext, shown this once: no reading carries it. `disconnected` is how many
 * subscriptions the old key took down with it, and 0 on `make`. of those, `paused` is how many
 * Zapier paused, asking the Zap's owner to reconnect, or no longer had, and `notPaused` how many
 * hooks did not take it — a fault, an error or no answer — whose Zaps still read as on in Zapier
 * until their owners turn them off and on again; nothing asks again. the two sum to
 * `disconnected`. a refused press does not answer with this type.
 */
export type ZapierPressReport = {
	readonly press: ZapierPress;
	readonly key: string;
	readonly madeAt: string;
	readonly disconnected: number;
	readonly paused: number;
	readonly notPaused: number;
};
