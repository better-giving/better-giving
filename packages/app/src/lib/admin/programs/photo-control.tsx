import { useId } from 'react';
import type { Resized } from '$lib/images/resize';
import { imageSrc } from '$lib/page/image-src';
import { ReplacePhotoControl, type ReplacePhotoControlProps } from '../editor/replace-photo';

// a program's photo, in the program's own group beside its name: the two things a donor sees of a
// program on the Donation page's chooser. the placed-photo control (../editor/replace-photo.tsx),
// cropped square as the chooser crops it, with Remove beside the press and no description box —
// the program's name beside the photo is what it says.
//
// the photo is part of the program and saved with it: a new one is uploaded as soon as it is
// resized, and Save program writes it, as a block's photo is kept by Done. so the id stands in a
// hidden box named `name` inside the program's form, empty while the program has no photo, and
// Remove clears it for Save program to write.

export type ProgramPhotoControlProps = {
	/** the photo's image id as the form holds it now; null for none. */
	readonly imageId: string | null;
	/** the hidden box the id is posted in with Save program. */
	readonly name: string;
	/** a new photo, resized or refused. the route posts `blob` and moves `state`. */
	readonly onResized: (result: Resized) => void;
	/** `uploading` while the route posts; `refused` with the words to show at the press. */
	readonly state?: ReplacePhotoControlProps['state'];
	readonly onRemove: () => void;
};

export function ProgramPhotoControl({
	imageId,
	name,
	onResized,
	state,
	onRemove
}: ProgramPhotoControlProps) {
	const hintId = `${useId()}-hint`;
	return (
		<fieldset className="adm-fieldset" aria-describedby={hintId}>
			<legend className="adm-fieldset__legend">
				Photo<span className="adm-field__optional"> (optional)</span>
			</legend>
			<p className="adm-hint" id={hintId}>
				Beside the name on the Donation page’s program chooser, cropped square.
			</p>
			<ReplacePhotoControl
				imageSrc={imageId === null ? undefined : imageSrc(imageId)}
				describe={false}
				frame="square"
				onResized={onResized}
				state={state}
				onRemove={onRemove}
			/>
			<input type="hidden" name={name} value={imageId ?? ''} />
		</fieldset>
	);
}
