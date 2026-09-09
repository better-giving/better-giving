import { Popover } from '@ark-ui/react/popover';
import { Portal } from '@ark-ui/react/portal';
import type { ReactNode } from 'react';
import { AnchoredCard } from '../components/data/Disclosure.jsx';
import { Mark, type MarkName } from '../components/status/Mark.jsx';

// the card a positioner places beside the mark that opens it.
//
// it draws no card of its own: ../components/data/Disclosure.jsx is what is on the screen, and what
// is added here is the machine — a trigger, a portal out of whatever the mark was rendered inside,
// and the positioner that writes the `--available-width` packages/operator/src/styles/adm.css caps
// the card by. all three need a document, which is why they are on this side of the split;
// ./AnchoredCard.dom.spec.tsx asserts the property reaches an ancestor of the card that sheet caps.
//
// the card goes to the document body, so it is not clipped by whatever the mark sits inside — a
// scrolling table plane, a definition value.
//
// **a press opens it and a dismissal closes it, and a finger can make both.** the mark is the whole
// of the affordance — nothing else on the row leads to the note — so an open that a hover has to
// start is an open a touch screen never reaches, and ../styles/adm.css says the same thing where it
// tones the mark: a bare mark on a line exists for the device with no pointer.
//
// it holds text and no control, so a dismissal leaves nothing behind worth discarding and the card
// stays mounted. ./AnchoredPanel.tsx is the shape for a card with controls inside it, and the
// `unmountOnExit` there is what a panel holding typed values needs and this one does not.
//
// a mark stands after the thing it is about and is handed that thing's own words: the label is
// what names the row to a reader who cannot see which line the mark is on. the phrasing is the
// caller's because it is the screen that knows what the note is about.

type AnchoredNoteProps = {
	/**
	 * the shape on the trigger. it says what kind of thing is behind the mark before it is read —
	 * an operator screen draws a note about a value at fault in one shape and a note explaining a
	 * value that is fine in another.
	 */
	readonly mark: MarkName;
	/** the trigger's accessible name, and the whole of it: the mark itself is out of the tree. */
	readonly label: string;
	readonly children?: ReactNode;
};

/** a note about the thing the mark stands beside, one press away from it. */
export function AnchoredNote({ mark, label, children }: AnchoredNoteProps) {
	return (
		<Popover.Root positioning={{ placement: 'bottom-start' }}>
			{/* the machine sets `type="button"`, so the trigger cannot post the form it is standing
			    inside on the way to showing a sentence. it also gives it `aria-haspopup="dialog"`, an
			    `aria-controls` naming the card and an `aria-expanded` that tracks the state — the
			    attribute ../styles/adm.css tones the mark off — so nothing about the trigger is
			    stated here. */}
			<Popover.Trigger className="adm-markbtn" aria-label={label}>
				<Mark name={mark} />
			</Popover.Trigger>
			<Portal>
				<Popover.Positioner>
					{/* the card is named by the mark that opened it. the machine names one off a title
					    part instead, and reaching that part means importing the machine — which a
					    surface drawing this must not do, because a second declaration of it is a
					    second copy of one state machine (pnpm-workspace.yaml's catalog comment). */}
					<Popover.Content aria-label={label}>
						<AnchoredCard>{children}</AnchoredCard>
					</Popover.Content>
				</Popover.Positioner>
			</Portal>
		</Popover.Root>
	);
}
