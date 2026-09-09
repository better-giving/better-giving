import { CodeSlab } from '@better-giving/operator/components/data/CodeSlab';
import { Dialog } from '@better-giving/operator/components/shell/Dialog';

/*
 * the card, in the presentation the server sends it in, at every arrangement of controls it has.
 *
 * nothing here decides whether the dialog exists. it is a `dialog` the server renders `open`, so a
 * screen puts one in its markup from an action result or from a parameter on the URL — which is
 * what makes a dialog survive a navigation and a refused submit, and why every specimen below is
 * simply on the page rather than opened. ./behaviour-dialog.tsx is the same element lifted into the
 * top layer, and it is the one that has to be opened.
 *
 * **the control row is not three independent slots.** `danger` suppresses `exit`
 * (packages/operator/src/components/shell/Dialog.jsx:122), so a card with a destructive control has
 * no primary one and the way out is `cancel` or nothing. that rule is invisible in any single
 * specimen and is the reason the arrangements are walked in order: exit alone, exit and cancel,
 * danger and cancel, danger alone, and none at all.
 *
 * danger alone is drawn because it is reachable and it is a card with no way out — worth seeing
 * next to the pair that has one, since a screen writing it has almost certainly forgotten a
 * `cancel`.
 *
 * `exit` has a default and `cancel` and `danger` do not, so the card with nothing stated is the
 * "once" arrangement: one control, no close mark, no cancel — what a secret shown once and never
 * again is read in.
 *
 * `titleId` is stated where something else on the screen has to name the same heading and minted
 * otherwise; either way the element is labelled by the heading a reader can see. one specimen
 * states it, and the difference is in the markup rather than on the screen.
 *
 * the actions row holds controls and never a `form`: a confirm that posts is a submit and the
 * `form` goes around the whole card. no specimen here writes one, and that is the rule rather than
 * an omission.
 *
 * **the last specimen is `inPage={false}` — the presentation with no top layer under it.** that
 * combination is not a screen: it is what the modifier alone draws, and an open `dialog` that was
 * never shown modally is `position: absolute`, so it stands out of the flow and paints over
 * whatever follows. it is here because `inPage` is a two-valued prop and the false half is
 * otherwise only ever seen through the attachment.
 */
export default function ShellDialogPreview() {
	return (
		<div className="adm-stack">
			{/* everything defaulted: the "once" arrangement, one control and no way back. */}
			<Dialog title="Your API token">
				<p>
					This is shown once. Copy it now — it is not stored on this deployment and cannot be shown
					again.
				</p>
				<CodeSlab content="bg_tok_7hQ2xR9vLm4pW1sN" label="token" copyable />
			</Dialog>

			{/* the way out named and given an element and an address. */}
			<Dialog
				title="The winter appeal is published"
				exit="Back to donation forms"
				exitProps={{ as: 'a', href: '#' }}
			>
				<p>The snippet is live. Paste it into any page on an allowed origin.</p>
			</Dialog>

			<Dialog title="Send a test email" cancel="Not now" exit="Send it">
				<p>
					A short test message is sent to the address in the box. Nothing is recorded and no donor
					hears about it.
				</p>
			</Dialog>

			<Dialog
				title="Replace the Stripe secret key"
				danger="Replace the key"
				cancel="Keep the current key"
			>
				<p>
					The old key stops working the moment this deploys. If the new key is wrong, this
					deployment cannot charge anything until a good one is set.
				</p>
			</Dialog>

			{/* reachable and almost certainly a mistake: a destructive control and no way out. */}
			<Dialog title="Delete the test deployment" danger="Delete it">
				<p>The worker and its database are both removed.</p>
			</Dialog>

			{/* the heading named by the caller rather than minted, which is what a screen does when
			    something else on it has to point at the same heading. */}
			<Dialog titleId="shell-dialog-named-heading" title="Allowed origins" cancel="Close">
				<p>Only these sites may load the donation form.</p>
			</Dialog>

			{/* nothing at all: an empty heading over nothing, and the default way out. */}
			<Dialog />

			<Dialog
				title="What happens to the sites that have already pasted this snippet when the donation form is archived"
				danger="Archive the form"
				cancel="Keep it"
			>
				<p>
					The snippet is a script tag on a page this deployment cannot reach, so nothing can be
					taken off those sites. What changes is what the script is served: the form stops rendering
					and the space it stood in closes up, with no message where it was. Donations already taken
					are kept and every receipt stays valid. A donor part-way through a gift when this happens
					finishes it — the page they are holding was served before the change.
				</p>
			</Dialog>

			{/* the modifier off, with nothing lifting the element. it is out of the flow and paints over
			    what follows it. */}
			<Dialog
				inPage={false}
				title="The card with the in-page presentation taken off"
				cancel="Close"
			>
				<p>
					This is what packages/operator/src/behaviour/Dialog.tsx switches to at the moment it calls
					showModal(), and it is drawn here with no top layer under it.
				</p>
			</Dialog>
		</div>
	);
}
