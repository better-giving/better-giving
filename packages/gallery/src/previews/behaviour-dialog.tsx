import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Button } from '@better-giving/operator/components/controls/Button';
import { CodeSlab } from '@better-giving/operator/components/data/CodeSlab';
import { useState } from 'react';

/*
 * the same dialog ./shell-dialog.tsx draws, lifted into the browser's top layer.
 *
 * it draws no markup of its own — packages/operator/src/components/shell/Dialog.jsx is the whole of
 * what is on the screen — so what is here is the one thing that file cannot carry: an effect that
 * calls `showModal()`, and the two answers to a dismissal. the interior is the shell component's and
 * its arrangements are covered there; what these specimens are for is what the top layer changes.
 *
 * **a modal cannot be a resting specimen, and that is the element rather than the gallery.** the top
 * layer paints over the whole document with `.adm-dialog::backdrop` behind it, keeps the tab ring
 * inside the card and makes everything else inert — so a modal standing open on this page would
 * cover every other preview and there would be nothing to look at. each one is opened by the press
 * beside it instead, which is also the only honest specimen: the element arrives open in a screen's
 * markup and this attachment lifts it, so an opening is what a reader has to do.
 *
 * **it decides nothing about whether the dialog exists**, and the presses below are the proof rather
 * than a convenience. `onDismiss` is a request and not a close — Escape and a press on the ground
 * both arrive there — and the screen is what answers it, by navigating or by clearing what the
 * dialog was rendered from. the state held here is that clearing: a dialog that closed itself would
 * take an action result off a page that is still holding it.
 *
 * three arrangements rather than the shell component's full set, because what differs between them
 * in the top layer is where focus lands. the card takes it on all three, and the destructive
 * specimen is where that is worth pressing: the actions row puts `danger` first, so the platform's
 * own dialog focusing steps would land the reader on "Replace the key" — the answer before the
 * question. packages/operator/src/behaviour/Dialog.tsx focuses the card in the same effect that
 * calls `showModal()`, which is what these specimens are for looking at.
 *
 * the in-page presentation ./shell-dialog.tsx draws takes no focus at all, and nothing here may
 * rely on `autoFocus` to change that: react strips the prop and focuses at mount, which the
 * `showModal()` call happens after.
 */

type Which = 'once' | 'danger' | 'pair';

export default function BehaviourDialogPreview() {
	const [open, setOpen] = useState<Which | null>(null);
	const dismiss = () => setOpen(null);

	return (
		<div className="adm-stack">
			<div className="adm-actions">
				<Button onClick={() => setOpen('once')}>Show the once arrangement</Button>
				<Button variant="danger" onClick={() => setOpen('danger')}>
					Show the destructive one
				</Button>
				<Button variant="primary" onClick={() => setOpen('pair')}>
					Show the confirming one
				</Button>
			</div>

			{/* everything defaulted: one control, no close mark, no cancel — a secret shown once. */}
			{open === 'once' ? (
				<Modal title="Your API token" onDismiss={dismiss} exitProps={{ onClick: dismiss }}>
					<p>
						This is shown once. Copy it now — it is not stored on this deployment and cannot be
						shown again.
					</p>
					<CodeSlab content="bg_tok_7hQ2xR9vLm4pW1sN" label="token" copyable />
				</Modal>
			) : null}

			{/* the destructive pair, which is the arrangement the top layer is for: replacing a payment
			    credential confirms here, where archiving a form confirms in the page. */}
			{open === 'danger' ? (
				<Modal
					title="Replace the Stripe secret key"
					danger="Replace the key"
					dangerProps={{ onClick: dismiss }}
					cancel="Keep the current key"
					cancelProps={{ onClick: dismiss }}
					onDismiss={dismiss}
				>
					<p>
						The old key stops working the moment this deploys. If the new key is wrong, this
						deployment cannot charge anything until a good one is set.
					</p>
				</Modal>
			) : null}

			{/* a way out and a way on, with a literal in between long enough to reach the card's cap. */}
			{open === 'pair' ? (
				<Modal
					title="Send a test donation"
					cancel="Not now"
					cancelProps={{ onClick: dismiss }}
					exit="Send £1"
					exitProps={{ onClick: dismiss }}
					onDismiss={dismiss}
				>
					<p>
						One pound is charged to the card you enter and refunded straight away. The donation is
						written down and then reversed, so the figures on these screens are unchanged by the end
						of it.
					</p>
					<CodeSlab content="4242 4242 4242 4242" label="test card" copyable />
					<p>Any future expiry, any CVC, any postcode.</p>
				</Modal>
			) : null}
		</div>
	);
}
