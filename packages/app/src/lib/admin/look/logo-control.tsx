import { Button } from '@better-giving/operator/components/controls/Button';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { useId } from 'react';
import type { Resized } from '$lib/images/resize';
import { imageSrc } from '$lib/page/image-src';
import { ReplacePhotoControl, type ReplacePhotoControlProps } from '../editor/replace-photo';

// the organisation's logo, first in the Organisation page's Look: the placed-photo control
// (../editor/replace-photo.tsx) pressed as Add logo or Replace logo, drawn whole and never cropped,
// with Remove beside it and no description box — a donor page reads the organisation's name for it.
//
// a logo applies the moment it lands, as every Organisation save does, and reports at its own group
// rather than on the Look's status line: that line speaks for every page wearing the organisation's
// look, and the logo stands atop every page whatever look it wears. the report says what landed
// and offers Undo beside it, or Redo where what landed was an Undo; its region is mounted empty in
// every state, so what arrives in it is read out.
//
// the logo is handed in by its stored id and drawn from the deployment's image route by that id.
// the resize, the upload and the write are the route's, reported back through `state` and `report`.

export type LogoLanded = 'saved' | 'removed';

export type LogoControlProps = {
	/** the stored logo's image id; null while the organisation has none. */
	readonly imageId: string | null;
	/** a new logo, resized or refused. the route posts `blob` and moves `state`. */
	readonly onResized: (result: Resized) => void;
	/** `uploading` while the route posts; `refused` with the words to show at the press. */
	readonly state?: ReplacePhotoControlProps['state'];
	readonly onRemove: () => void;
	/** the write that landed last, reported with Undo beside it; null once the moment has passed. */
	readonly report?:
		| {
				readonly landed: LogoLanded;
				readonly onUndo: () => void;
				/** the Undo is in flight. */
				readonly undoing?: boolean | undefined;
				/** the write that landed was itself an Undo, so the press puts it back: it reads Redo. */
				readonly redo?: boolean | undefined;
		  }
		| null
		| undefined;
	/** the caller's placement of the group. */
	readonly className?: string | undefined;
};

const LANDED: Record<LogoLanded, string> = {
	saved: 'Saved to every page.',
	removed: 'Removed from every page.'
};

export function LogoControl({
	imageId,
	onResized,
	state,
	onRemove,
	report,
	className
}: LogoControlProps) {
	const hintId = `${useId()}-hint`;
	const undoing = report?.undoing ?? false;
	return (
		<fieldset
			className={className === undefined ? 'adm-fieldset' : `adm-fieldset ${className}`}
			aria-describedby={hintId}
		>
			<legend className="adm-fieldset__legend">Logo</legend>
			<p className="adm-hint" id={hintId}>
				Atop the Donation page and every campaign. A logo twice as wide as it is tall stands in for
				your name; a narrower one sits beside it.
			</p>
			<ReplacePhotoControl
				imageSrc={imageId === null ? undefined : imageSrc(imageId)}
				describe={false}
				noun="logo"
				frame="whole"
				onResized={onResized}
				state={state}
				onRemove={onRemove}
			/>
			<div className="adm-actions">
				<span role="status">
					{report ? <StatusWord register="momentary">{LANDED[report.landed]}</StatusWord> : null}
				</span>
				{report ? (
					<Button
						type="button"
						variant="quiet"
						size="sm"
						mark="undo-2"
						aria-busy={undoing || undefined}
						aria-disabled={undoing || undefined}
						onClick={() => {
							if (!undoing) report.onUndo();
						}}
					>
						{report.redo ? 'Redo' : 'Undo'}
					</Button>
				) : null}
			</div>
		</fieldset>
	);
}
