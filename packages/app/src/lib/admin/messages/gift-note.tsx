import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import type { NoteStanding } from '$lib/donate/messages';

// what the gifts list at /admin/donations says about donor messages: where each note stands on the
// donate page. the list stays a read — moderation is Public messages' (./public-messages.tsx), which
// the list's heading leads to.

/**
 * a gift's note in the gifts list's Message cell, with the word under it saying where it stands on
 * the donate page: "On the page", or "Hidden" without a ground, as an ended record's word is, under
 * the note in the quiet ink. a note its donor kept private carries no word.
 */
export function GiftNote({
	note,
	standing
}: {
	readonly note: string;
	readonly standing: NoteStanding;
}) {
	if (standing === 'private') return note;
	return (
		<>
			{standing === 'hidden' ? <span className="adm-cell__quiet">{note}</span> : note}
			<span className="adm-cell__under">
				{standing === 'shown' ? (
					<StatusWord>On the page</StatusWord>
				) : (
					<StatusWord tone="note">Hidden</StatusWord>
				)}
			</span>
		</>
	);
}
