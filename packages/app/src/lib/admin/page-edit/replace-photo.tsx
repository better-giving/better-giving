import { Button } from '@better-giving/operator/components/controls/Button';
import { Field } from '@better-giving/operator/components/forms/Field';
import { Mark } from '@better-giving/operator/components/status/Mark';
import { useEffect, useId, useRef } from 'react';
import type { Resized, ResizeRefusal } from '@better-giving/operator/images/resize';
import { type PhotoPickerOptions, usePhotoPicker } from '../photo-picker';

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
	  }
	| {
			/** no box: a program photo's words are the program's name beside it. */
			readonly describe: false;
			readonly alt?: undefined;
			readonly onAltChange?: undefined;
			readonly altId?: undefined;
			readonly altError?: undefined;
	  };

/**
 * what a pick is handed to: resized here and reported through `onResized`, or, with `onChosen`,
 * handed over as chosen for a step the caller runs before its own resize (`resizing` in `state`).
 */
type Picked =
	| {
			/** a new photo was chosen, and its resize begins. */
			readonly onPicked?: (() => void) | undefined;
			/** a new photo, resized or refused. the route posts `blob` and moves `state`. */
			readonly onResized: (result: Resized) => void;
			readonly onChosen?: undefined;
			readonly accept?: undefined;
	  }
	| {
			readonly onChosen: (file: File) => void;
			/** the file chooser's `accept`. */
			readonly accept: string;
			readonly onPicked?: undefined;
			readonly onResized?: undefined;
	  };

export type ReplacePhotoControlProps = Description &
	Picked & {
		/** the placed photo as it is served; absent while the block holds none. */
		readonly imageSrc?: string | undefined;
		/** what the presses name: `Add photo`, `Replace photo`, `Remove the photo`. */
		readonly noun?: 'photo' | 'logo' | undefined;
		/**
		 * `resizing` while a caller's own step after an `onChosen` pick runs; `uploading` while the
		 * route posts; `removing` while it takes the image off; `refused` with the words to show at the
		 * press.
		 */
		readonly state?:
			| 'resizing'
			| 'uploading'
			| 'removing'
			| { readonly refused: string }
			| undefined;
		/** how the art is framed: absent, cropped 16:9; `square`, cropped as the program chooser
		 *  crops a program's photo; `banner`, cropped 4:1 as a campaign's banner, its empty band drawn
		 *  while there is none. */
		readonly frame?: 'square' | 'banner' | undefined;
		/** Remove beside the press while an image is placed; absent, no Remove is drawn. */
		readonly onRemove?: (() => void) | undefined;
		/** the press's id, for a caller that moves the focus to it. */
		readonly pressId?: string | undefined;
	};

/* a placed image and the press that swaps it: a campaign's banner, a program's photo, the organisation's logo. a new image is resized here and reported, or, with `onChosen`,
   handed over for the caller's own step first (`Picked`); the route uploads it and hands back
   `state`. none placed yet draws the press alone, as Add, on the same path; the box that
   describes a photo comes with the photo, unless the caller leaves it off.

   the press reports its own outcome. while the image resizes or uploads it says so, held with
   `aria-disabled` so the focus stays on it; a refusal stands under it and the press is described
   by it. the refusal's region is mounted before it speaks and is out of sight while it is empty.

   Remove stands beside the press while an image is placed and nothing is in flight, named for what
   it takes away, and stays through its own removal saying so. the image it removed goes with it,
   so the focus is handed to the press, which then reads Add. */
export function ReplacePhotoControl(props: ReplacePhotoControlProps) {
	const {
		imageSrc,
		alt,
		noun = 'photo',
		onAltChange,
		state,
		altId,
		altError,
		describe = true,
		frame,
		onRemove,
		pressId
	} = props;
	const picker = usePhotoPicker(pickerOptions(props));
	const id = useId();
	const pressRef = useRef<HTMLButtonElement>(null);
	const removing = useRef(false);
	const resizing = picker.resizing || state === 'resizing';
	const uploading = state === 'uploading';
	const taking = state === 'removing';
	const busy = resizing || uploading || taking;
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
				{placed ? (
					<img
						className={
							frame === 'square'
								? 'adm-placed__art adm-placed__art--square'
								: frame === 'banner'
									? 'adm-placed__art adm-placed__art--banner'
									: 'adm-placed__art'
						}
						src={imageSrc}
						alt={alt ?? ''}
					/>
				) : frame === 'banner' ? (
					<div className="adm-placed__empty" aria-hidden="true" />
				) : null}
				<div className="adm-actions">
					<Button
						ref={pressRef}
						id={pressId}
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
						{resizing
							? 'Resizing'
							: uploading
								? 'Uploading'
								: placed
									? `Replace ${noun}`
									: `Add ${noun}`}
					</Button>
					{/* drawn on through its own removal, as the same element, so the focus a press left
					    on it stays there while it says so. */}
					{onRemove === undefined || !placed || (busy && !taking) ? null : (
						<Button
							type="button"
							variant="quiet"
							mark="trash-2"
							aria-label={taking ? `Removing the ${noun}` : `Remove the ${noun}`}
							aria-busy={taking || undefined}
							aria-disabled={taking || undefined}
							onClick={() => {
								if (taking) return;
								removing.current = true;
								onRemove();
							}}
						>
							{taking ? 'Removing' : 'Remove'}
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
				/>
			)}
		</>
	);
}

/** the picker's options from the control's own props, narrowed to the one way a pick is taken. */
function pickerOptions(picked: Picked): PhotoPickerOptions {
	return picked.onChosen === undefined
		? { onPicked: picked.onPicked, onResized: picked.onResized }
		: { onChosen: picked.onChosen, accept: picked.accept };
}

const REFUSED: Record<ResizeRefusal, string> = {
	'not-an-image': 'That file isn’t a photo. Choose a JPEG, PNG, WebP or HEIC.',
	unreadable: 'That photo couldn’t be opened here. Choose it as a JPEG, PNG or WebP.',
	'too-large-after-resize': 'That photo is too large even after resizing. Choose a smaller one.'
};

/** the words under the press for a refused pick: `state`'s `refused`. */
export const replaceRefusal = (reason: ResizeRefusal) => REFUSED[reason];
