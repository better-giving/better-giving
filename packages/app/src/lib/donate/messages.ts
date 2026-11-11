// what the donate page's "Messages from donors" is handed, and what a gifts-list row says about a
// note on that page. client-safe: the reads are ../server/pages/messages.ts.
//
// a message is listed while its gift is settled and not reversed, its donor ticked Show my note,
// and the note is not blank. a hidden one is in no payload a donor's browser receives.

/** how many messages a load of the page or a press of Show more messages adds. */
export const MESSAGES_PER_PAGE = 6;

export type DonorMessage = {
	/** first name and last initial, "Maya R.", or "Anonymous". */
	readonly name: string;
	readonly note: string;
	/** when the gift was received, ISO 8601, for a `<time datetime>`. */
	readonly receivedAt: string;
};

export type DonorMessages = {
	/** newest first, at most `MESSAGES_PER_PAGE`. */
	readonly messages: readonly DonorMessage[];
	/** every message now on the page, for "Showing 6 of 48 messages". */
	readonly total: number;
	/**
	 * what to ask `/donate/messages?after=` for the next six with, opaque; null when these are the
	 * last.
	 */
	readonly next: string | null;
};

/**
 * where a gift's note stands on the donate page, for the word under it in the gifts list: `shown`
 * draws "On the page", `hidden` draws "Hidden", and `private` draws no word. a public note on a gift
 * not yet settled, or given back, is `private` here: it is on no page.
 */
export type NoteStanding = 'private' | 'shown' | 'hidden';
