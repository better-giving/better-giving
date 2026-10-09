import { Button } from '@better-giving/operator/components/controls/Button';
import { Field } from '@better-giving/operator/components/forms/Field';
import { Mark } from '@better-giving/operator/components/status/Mark';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { useEffect, useId, useRef } from 'react';
import type { Resized, ResizeRefusal } from '@better-giving/operator/images/resize';
import { usePhotoPicker } from '../photo-picker';
import type { SuggestParts } from './suggest';

/** the box that describes the photo, or none for an image whose words stand beside it. */
type Description =
	| {
			readonly describe?: true | undefined;
			/** what a screen reader reads for it. empty is a photo that only decorates the page. */
			readonly alt: string;
			readonly onAltChange: (alt: string) => void;
			/** the description box's id, for a caller that moves the caret there on a refusal. */
			readonly altId?: string | undefined;
			/** the last save's refusal of the description, under its box. */
			readonly altError?: string | null | undefined;
			/** Write with AI on the description's box (./suggest.tsx), as its field takes it. */
			readonly altSuggest?: SuggestParts | undefined;
	  }
	| {
			/** no box: a program photo's words are the program's name beside it. */
			readonly describe: false;
			readonly alt?: undefined;
			readonly onAltChange?: undefined;
			readonly altId?: undefined;
			readonly altError?: undefined;
			readonly altSuggest?: undefined;
	  };

export type ReplacePhotoControlProps = Description & {
	/** the placed photo as it is served; absent while the block holds none. */
	readonly imageSrc?: string | undefined;
	/** a new photo, resized or refused. the route posts `blob` and moves `state`. */
	readonly onResized: (result: Resized) => void;
	/** `uploading` while the route posts; `refused` with the words to show at the press. */
	readonly state?: 'uploading' | { readonly refused: string } | undefined;
	/** how the art is framed: absent, cropped to the sheet's frame; `square`, cropped as the
	 *  program chooser crops a program's photo. */
	readonly frame?: 'square' | undefined;
	/** Remove beside the press while an image is placed; absent, no Remove is drawn. */
	readonly onRemove?: (() => void) | undefined;
	/** a plain word over the art, naming what kind of image it is — Illustration. */
	readonly flag?: string | undefined;
};

/* a placed image and the press that swaps it: a block's photo in its edit sheet, a program's
   photo. a new image is resized here and reported; the route uploads it and hands back `state`.
   none placed yet draws the press alone, as Add photo, on the same path; the box that describes a
   photo comes with the photo, unless the caller leaves it off.

   the press reports its own outcome. while the image resizes or uploads it says so, held with
   `aria-disabled` so the focus stays on it; a refusal stands under it and the press is described
   by it. the refusal's region is mounted before it speaks and is out of sight while it is empty.

   Remove stands beside the press while an image is placed and nothing is in flight, named for what
   it takes away. the image it removed goes with it, so the focus is handed to the press, which then
   reads Add. */
export function ReplacePhotoControl({
	imageSrc,
	alt,
	onResized,
	onAltChange,
	state,
	altId,
	altError,
	altSuggest,
	describe = true,
	frame,
	onRemove,
	flag
}: ReplacePhotoControlProps) {
	const picker = usePhotoPicker({ onResized });
	const id = useId();
	const pressRef = useRef<HTMLButtonElement>(null);
	const removing = useRef(false);
	const uploading = state === 'uploading';
	const busy = picker.resizing || uploading;
	const refusal = typeof state === 'object' && !picker.resizing ? state.refused : '';
	const refusalId = `${id}-refused`;
	const placed = imageSrc !== undefined;

	useEffect(() => {
		if (placed || !removing.current) return;
		removing.current = false;
		pressRef.current?.focus();
	}, [placed]);

	return (
		<>
			<div className="adm-placed">
				{flag === undefined || !placed ? null : (
					<div className="adm-actions">
						<StatusWord>{flag}</StatusWord>
					</div>
				)}
				{placed ? (
					<img
						className={
							frame === 'square' ? 'adm-placed__art adm-placed__art--square' : 'adm-placed__art'
						}
						src={imageSrc}
						alt={alt ?? ''}
					/>
				) : null}
				<div className="adm-actions">
					<Button
						ref={pressRef}
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
								: placed
									? 'Replace photo'
									: 'Add photo'}
					</Button>
					{onRemove === undefined || !placed || busy ? null : (
						<Button
							type="button"
							variant="quiet"
							mark="trash-2"
							aria-label="Remove the photo"
							onClick={() => {
								removing.current = true;
								onRemove();
							}}
						>
							Remove
						</Button>
					)}
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
			{!placed || describe === false || onAltChange === undefined ? null : (
				<Field
					id={altId ?? `${id}-alt`}
					label="Describe the photo"
					optional
					hint="Read aloud to donors who can’t see it. Leave it empty if the photo only decorates the page."
					value={alt}
					error={altError}
					onChange={(event) => onAltChange(event.currentTarget.value)}
					{...altSuggest}
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
