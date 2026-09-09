import { Popover } from '@ark-ui/react/popover';
import { Portal } from '@ark-ui/react/portal';
import type { ReactNode } from 'react';
import { AnchoredPanelCard } from '../components/data/Disclosure.jsx';
import { Mark, type MarkName } from '../components/status/Mark.jsx';

// a panel of controls, placed against the press that opens it.
//
// it is a file beside ./AnchoredCard.tsx rather than a second export inside it, because that whole
// file is mark-triggered: what opens the card there is a shape standing after the thing it is
// about, and its header says so. what opens this one is a word or a shape, and where the press
// stands is what decides which. a press standing beside a value in the body of a screen is a word:
// an operator came to that row to act, and a shape there says there is something to look at rather
// than something to do. a press standing on the top bar is a shape: the bar is one line of stated
// facts, read at a glance and never worked through, so a word on it is a second thing to read on a
// row that exists not to be read. the shape names itself with `label` either way, so the two
// presses differ in what is drawn and in nothing a reader is told.
//
// a press opens it and a dismissal closes it, which is ./AnchoredCard.tsx's note as well: what
// separates the two is what is inside, and the `unmountOnExit` below is the whole of it. the portal
// is what keeps this one out of whatever the press was rendered inside — a bar slot, a table cell —
// and the positioner writes the `--available-width` ../styles/adm.css caps the panel by.
//
// what the panel looks like is `AnchoredPanelCard`'s and not this file's, the same way the card
// `AnchoredNote` opens is `AnchoredCard`'s (../components/data/Disclosure.jsx): a behaviour module
// places a thing and never draws one, which is what keeps every `.adm-*` class on a component
// rather than spread across the modules that position them.
//
// what stands inside is the caller's whole: this draws no heading and no controls of its own,
// because a panel is opened over the one act it holds and the surface that owns that act is what
// knows its words.
//
// **a panel that is dismissed is discarded, and that is what `unmountOnExit` is for.** the machine's
// own answer to a close is the panel left mounted and `hidden`, which keeps every box in it holding
// whatever was typed and every control in it wherever it was pressed to — so a panel carrying a
// credential hands it back in the clear the next time the press is made, and one whose act was
// opened has no way back to the shape it opened in. the panels here are acted through rather than
// read, so the resting shape is the only one a press should ever open.

type AnchoredPanelProps = {
	/** the word on the press, and the name of the panel it opens. */
	readonly label: string;
	/**
	 * the shape on the press instead of the word, for a press standing on the top bar. `label` is
	 * still stated and is still the whole of the trigger's name: the mark itself is out of the tree.
	 */
	readonly mark?: MarkName;
	readonly children?: ReactNode;
};

/** the panel a press opens, one press away from the value it acts on. */
export function AnchoredPanel({ label, mark, children }: AnchoredPanelProps) {
	return (
		<Popover.Root positioning={{ placement: 'bottom-start' }} unmountOnExit>
			{/* the quiet rank, which is what a press beside a stated value takes: the act the panel
			    holds is over that one value, and a filled control there would rank it above whatever
			    the screen under the bar is for. the shape takes the same rank and the same box — what
			    changes is what is drawn in it.

			    two shapes of markup and not one trigger with `aria-label` standing beside a word: a
			    press labelled by its own text and a press labelled by an attribute are different
			    elements, which is ../components/status/Mark.jsx's own reason.

			    the machine sets `type="button"`, so it cannot post the form it is standing inside on
			    the way to opening. it also gives it `aria-haspopup="dialog"` and an `aria-expanded`
			    that tracks the state, which is why nothing describes it here. */}
			{mark === undefined ? (
				<Popover.Trigger className="adm-btn adm-btn--quiet adm-btn--sm">{label}</Popover.Trigger>
			) : (
				<Popover.Trigger className="adm-btn adm-btn--quiet adm-btn--sm" aria-label={label}>
					<Mark name={mark} />
				</Popover.Trigger>
			)}
			<Portal>
				<Popover.Positioner>
					{/* the panel is named by the word that opened it. the machine names one off a title
					    part instead, and reaching that part means importing the machine — which a
					    surface drawing this must not do, because a second declaration of it is a
					    second copy of one state machine (pnpm-workspace.yaml's catalog comment). */}
					<Popover.Content aria-label={label}>
						<AnchoredPanelCard>{children}</AnchoredPanelCard>
					</Popover.Content>
				</Popover.Positioner>
			</Portal>
		</Popover.Root>
	);
}
