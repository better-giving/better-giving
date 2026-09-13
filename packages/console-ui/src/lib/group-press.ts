import { homeReading, setVars } from '../api/client';
import { heldValues } from './held-values';
import type { GroupReport } from './secret-group-form';
import { PAYPAL_GROUP, groupPosted, pressedNames } from './secret-groups';
import { secretEdits } from './secret-edits';
import { unreadHeld } from './unread-held';

// **a credential goes from the box it was typed in into one request body and nowhere else.** a
// group's boxes are read here in the browser (./secret-edits.ts) and what they asked for is handed
// to the binary on the loopback address, which sends the one request to cloudflare — the address the
// value is deliberately absent from included. nothing about a press is written to disk or put in an
// argument list, and no answer to one carries a value: what comes back is a kind, what cloudflare
// said, and the names of any boxes it refused.

/**
 * stores and clears a group of credentials, in one request to cloudflare — the press the password
 * page and the mail page both draw (../routes/_sections.password.tsx, ../routes/_sections.smtp.tsx),
 * or `null` where the posted intent names no group.
 *
 * **the boxes are read here and the act is what crosses.** what an empty box means is decided by
 * what the box was drawn holding, which is a fact about this page rather than about the account
 * (./secret-edits.ts) — so the press names what to store and what to remove, and the binary sends
 * the one merge patch that does both. a name it does not name is left exactly as it was.
 *
 * **the group is the posted intent read back against the enumeration**, so a body naming no group
 * reaches nothing and the names a payload may carry are the group's rather than the body's own
 * keys. every group is answered rather than the ones the calling page draws — a list of ids here
 * would be a second enumeration to keep level with ./secret-groups.ts, and the way that fails is a
 * control that posts and is answered by nothing.
 *
 * **every group is read against its seeds, and they are asked of the account for this press rather
 * than taken off the form.** a page claiming a name is stored would turn an empty box into a
 * delete, and one claiming it is not would turn an untouched box into a save. a read that did not
 * land is a press refused rather than a press guessed at.
 *
 * no lock: a write that loses a race here leaves a credential the rows in the block report exactly
 * as it is.
 *
 * **PayPal's group is drawn and never pressed.** its three names arrive only through the set-up
 * press on PayPal's page (../routes/_sections.payments.paypal.tsx), which settles the listener its
 * id names, and the binary refuses them on the values door
 * (`packages/console/internal/server/values.go`).
 */
export async function groupPress(
	intent: FormDataEntryValue | null,
	posted: FormData
): Promise<{ secrets: GroupReport } | null> {
	const group = groupPosted(intent);
	if (group === null || group.id === PAYPAL_GROUP) return null;

	const read = await homeReading();
	if (read.values.vars.kind !== 'read') {
		return { secrets: { group: group.id, written: unreadHeld(read.values.vars) } };
	}
	const seeds = heldValues(read.values.vars.vars).seeds;

	// the names the form carries a value for, and never the whole group: the mail form states the
	// port rather than drawing a box for it (./secret-groups.ts), and the reading takes a name
	// arriving with no box behind it as an emptied one — which would delete the deployment's port on
	// every mail save, with the confirm having said nothing about it.
	const edits = secretEdits(pressedNames(group), posted, seeds);
	// nothing is sent and nothing is written: one press is one request, so a group holding a box this
	// console could not read as an act comes back whole, with what was typed still in it. the boxes
	// come back as names and sentences — what was typed in them is not in this answer.
	if (!edits.ok) return { secrets: { group: group.id, errors: edits.errors } };

	return { secrets: { group: group.id, written: await setVars(edits.payload) } };
}
