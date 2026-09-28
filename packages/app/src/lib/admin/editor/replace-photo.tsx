import { Button } from '@better-giving/operator/components/controls/Button';
import { Field } from '@better-giving/operator/components/forms/Field';
import { Mark } from '@better-giving/operator/components/status/Mark';
import { useId } from 'react';
import type { Resized, ResizeRefusal } from '$lib/images/resize';
import { usePhotoPicker } from '../photo-picker';

export interface ReplacePhotoControlProps {
	/** the placed photo as it is served; absent while the block holds none. */
	readonly imageSrc?: string | undefined;
	/** what a screen reader reads for it. empty is a photo that only decorates the page. */
	readonly alt: string;
	/** a new photo, resized or refused. the route posts `blob` and moves `state`. */
	readonly onResized: (result: Resized) => void;
	readonly onAltChange: (alt: string) => void;
	/** `uploading` while the route posts; `refused` with the words to show at the press. */
	readonly state?: 'uploading' | { readonly refused: string } | undefined;
	/** the description box's id, for a caller that moves the caret there on a refusal. */
	readonly altId?: string | undefined;
	/** the last save's refusal of the description, under its box. */
	readonly altError?: string | null | undefined;
}

/* a block's photo in its edit sheet: the photo, the press that swaps it, and the box that
   describes it. a new photo is resized here and reported; the route uploads it and hands back
   `state`. a block with no photo yet draws the press alone, as Add photo, on the same path; the box
   comes with the photo it describes.

   the press reports its own outcome. while the photo resizes or uploads it says so, held with
   `aria-disabled` so the focus stays on it; a refusal stands under it and the press is described
   by it. the refusal's region is mounted before it speaks and is out of sight while it is empty. */
export function ReplacePhotoControl({
	imageSrc,
	alt,
	onResized,
	onAltChange,
	state,
	altId,
	altError
}: ReplacePhotoControlProps) {
	const picker = usePhotoPicker({ onResized });
	const id = useId();
	const uploading = state === 'uploading';
	const busy = picker.resizing || uploading;
	const refusal = typeof state === 'object' && !picker.resizing ? state.refused : '';
	const refusalId = `${id}-refused`;

	return (
		<>
			<div className="adm-placed">
				{imageSrc === undefined ? null : (
					<img className="adm-placed__art" src={imageSrc} alt={alt} />
				)}
				<div className="adm-actions">
					<Button
						type="button"
						mark="image-up"
						state={picker.choosing ? 'active' : undefined}
						aria-busy={busy || undefined}
						aria-disabled={busy || undefined}
						aria-describedby={refusal === '' ? undefined : refusalId}
						onClick={() => {
							if (!busy) picker.open();
						}}
					>
						{picker.resizing
							? 'Resizing'
							: uploading
								? 'Uploading'
								: imageSrc === undefined
									? 'Add photo'
									: 'Replace photo'}
					</Button>
					{picker.field}
				</div>
				<p
					id={refusalId}
					role="status"
					className={refusal === '' ? 'adm-vh' : 'adm-momentary adm-momentary--blocked'}
				>
					{refusal === '' ? null : (
						<>
							<Mark name="circle-alert" />
							{refusal}
						</>
					)}
				</p>
			</div>
			{imageSrc === undefined ? null : (
				<Field
					id={altId ?? `${id}-alt`}
					label="Describe the photo"
					optional
					hint="Read aloud to donors who can’t see it. Leave it empty if the photo only decorates the page."
					value={alt}
					error={altError}
					onChange={(event) => onAltChange(event.currentTarget.value)}
				/>
			)}
		</>
	);
}

const REFUSED: Record<ResizeRefusal, string> = {
	'not-an-image': 'That file isn’t a photo. Choose a JPEG, PNG, WebP or HEIC.',
	unreadable: 'That photo couldn’t be opened here. Choose it as a JPEG, PNG or WebP.',
	'too-large-after-resize': 'That photo is too large even after resizing. Choose a smaller one.'
};

/** the words under the press for a refused pick: `state`'s `refused`. */
export const replaceRefusal = (reason: ResizeRefusal) => REFUSED[reason];
