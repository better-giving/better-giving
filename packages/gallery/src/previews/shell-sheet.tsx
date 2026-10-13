import { Button } from '@better-giving/operator/components/controls/Button';
import { Field } from '@better-giving/operator/components/forms/Field';
import { Sheet } from '@better-giving/operator/components/shell/Sheet';
import { useState } from 'react';

/*
 * the sheet: a modal panel risen from the foot of a phone, standing at the right edge from the wide
 * breakpoint. narrow the window past 64rem to see the phone's.
 *
 * **a sheet cannot be a resting specimen**, for ./behaviour-dialog.tsx's reason: it is in the top
 * layer with the page inert behind it, so one standing open would cover every other preview. each
 * is opened by the press beside it, which is also the only honest specimen — the sheet exists while
 * the caller renders it, and closing it is the caller rendering it no longer. X and Escape are the
 * two ways out, and both land the focus back on the press that opened it.
 *
 * one specimen per arrangement: the bare sheet (a list, nothing to finish, so no foot), a sheet with
 * a foot, `tall` (the whole height a phone leaves it), `wide` (the dialog's measure at the edge),
 * and `stacked` — a sheet opened from inside another, which stops a step lower on a phone and lays
 * no second ground. the stacked one is opened from inside the tall one, as it is on a screen.
 */

type Which = 'plain' | 'foot' | 'tall' | 'wide';

export default function ShellSheetPreview() {
	const [open, setOpen] = useState<Which | null>(null);
	const [stacked, setStacked] = useState(false);
	const dismiss = () => {
		setOpen(null);
		setStacked(false);
	};

	return (
		<div className="adm-stack">
			<div className="adm-actions">
				<Button aria-haspopup="dialog" onClick={() => setOpen('plain')}>
					Show a sheet with no foot
				</Button>
				<Button aria-haspopup="dialog" onClick={() => setOpen('foot')}>
					Show a sheet with a foot
				</Button>
				<Button aria-haspopup="dialog" onClick={() => setOpen('tall')}>
					Show a tall sheet
				</Button>
				<Button aria-haspopup="dialog" onClick={() => setOpen('wide')}>
					Show a wide sheet
				</Button>
			</div>

			{open === 'plain' ? (
				<Sheet title="Look" onDismiss={dismiss}>
					<p>Every pick applies as it is made, so there is nothing to finish and no foot.</p>
				</Sheet>
			) : null}

			{open === 'foot' ? (
				<Sheet
					title="Goal"
					onDismiss={dismiss}
					foot={
						<Button variant="primary" onClick={dismiss}>
							Done
						</Button>
					}
				>
					<Field id="gallery-sheet-goal" label="Goal" defaultValue="15000" />
				</Sheet>
			) : null}

			{open === 'tall' ? (
				<Sheet title="Settings" tall onDismiss={dismiss}>
					<Field id="gallery-sheet-name" label="Name" defaultValue="Winter coat drive" />
					<Button aria-haspopup="dialog" onClick={() => setStacked(true)}>
						Edit the share message
					</Button>
				</Sheet>
			) : null}

			{open === 'tall' && stacked ? (
				<Sheet
					title="Share message"
					stacked
					onDismiss={() => setStacked(false)}
					foot={
						<Button variant="primary" onClick={() => setStacked(false)}>
							Done
						</Button>
					}
				>
					<Field
						id="gallery-sheet-share"
						label="Share message"
						as="textarea"
						rows={3}
						defaultValue="Help Riverbank families stay warm this winter."
					/>
				</Sheet>
			) : null}

			{open === 'wide' ? (
				<Sheet
					title="Donation settings"
					wide
					onDismiss={dismiss}
					foot={
						<Button variant="primary" onClick={dismiss}>
							Done
						</Button>
					}
				>
					<Field id="gallery-sheet-program" label="Program" defaultValue="Winter coats" />
					<Field id="gallery-sheet-minimum" label="Smallest gift" defaultValue="5" />
				</Sheet>
			) : null}
		</div>
	);
}
