import { type DragEvent, useEffect, useRef, useState } from 'react';
import { type CropRect, type CropRefusal, cropImage } from '$lib/admin/settings/crop-image';
import { LOGO_ACCEPT, LOGO_REFUSED, takesLogo } from '$lib/admin/settings/logo-crop';
import { imageSrc } from '$lib/page/image-src';
import { PHOTO_NOT_STORED } from './copy';
import { Refusal } from './field';
import { Mark } from './glyph';
import { PhotoCropDialog } from './photo-crop-dialog';
import { PHOTO_WIDTH_MIN, photoSourceRefusal } from './photo-crop';

// a page's photo: a 16:9 preview, or the empty well a photo is chosen or dropped into, with Add
// photo (Replace photo once there is one) and Remove. a chosen file is measured first, and one too
// small for a page is turned down under the press without a crop; the rest open the crop card
// (./photo-crop-dialog.tsx), and Use this photo crops and resizes the frame here
// (`cropImage` in $lib/admin/settings/crop-image.ts). given an `uploadUrl`, the crop is posted there
// and its answer's `id` is what the form posts under `name`; given none, the crop is the file the
// form posts under `name` itself, which a form doing so sends as `multipart/form-data`. a refusal,
// the server's included, is said under the press and describes it.

/** what `uploadUrl` answers: the stored photo's id, or why it was not stored. */
type UploadAnswer = { readonly id: string } | { readonly error: string };

const PHOTO_REFUSED: Readonly<Record<CropRefusal, string>> = {
	'not-an-image': LOGO_REFUSED['not-an-image'],
	unreadable: LOGO_REFUSED.unreadable,
	'too-large-after-resize': LOGO_REFUSED['too-large-after-resize'],
	'crop-outside': 'That frame runs past the edge of the photo. Move it inside the photo.'
};

/** the photo's own size, or null where the browser cannot open it. */
async function measure(file: Blob): Promise<{ width: number; height: number } | null> {
	try {
		const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
		const size = { width: bitmap.width, height: bitmap.height };
		bitmap.close();
		return size;
	} catch {
		return null;
	}
}

/**
 * the stored photo's id, or the sentence saying why not: the server's own where it refused the photo
 * or the caller (routes/fundraise.photo.ts), ours where the server failed or never answered.
 */
async function upload(
	uploadUrl: string,
	blob: Blob
): Promise<{ readonly id: string } | { readonly refused: string }> {
	const body = new FormData();
	body.set('file', blob, 'photo.png');
	let answer: Response;
	let read: UploadAnswer;
	try {
		answer = await fetch(uploadUrl, { method: 'POST', body });
		read = (await answer.json()) as UploadAnswer;
	} catch {
		return { refused: PHOTO_NOT_STORED };
	}
	if (answer.ok && 'id' in read && typeof read.id === 'string') return { id: read.id };
	// a 5xx's `error` is written for the log, not for a supporter.
	if (answer.status < 500 && 'error' in read && typeof read.error === 'string') {
		return { refused: read.error };
	}
	return { refused: PHOTO_NOT_STORED };
}

export type PhotoFieldProps = {
	/** the box's id; `${id}-hint` and `${id}-err` describe the press. */
	readonly id: string;
	/**
	 * what the photo posts under: the stored photo's id in a hidden box where there is an
	 * `uploadUrl`, the cropped file itself where there is none.
	 */
	readonly name: string;
	/** the photo the page has now, or null. */
	readonly photoId: string | null;
	/** where a cropped photo is posted, answering `{ id }`; absent, the crop posts with the form. */
	readonly uploadUrl?: string | undefined;
	/** a refusal the server answered with, about the photo the form last posted. */
	readonly error?: string | undefined;
	/** told while a crop or an upload runs, so the form holds its submit until the photo is in. */
	readonly onWorking: (working: boolean) => void;
};

export function PhotoField({ id, name, photoId, uploadUrl, error, onWorking }: PhotoFieldProps) {
	const [stored, setStored] = useState(photoId);
	/** the preview address of a crop held to post with the form, or null. */
	const [held, setHeld] = useState<string | null>(null);
	const [cropping, setCropping] = useState<File | null>(null);
	const [working, setWorking] = useState(false);
	const [refused, setRefused] = useState<string | null>(null);
	const chooser = useRef<HTMLInputElement>(null);
	const press = useRef<HTMLButtonElement>(null);
	const posted = useRef<HTMLInputElement>(null);

	// a preview's address lives as long as the crop it draws.
	useEffect(() => (held === null ? undefined : () => URL.revokeObjectURL(held)), [held]);

	/* the crop goes into the posted file box's `files`, which a script can set only as a whole
	   `FileList` and only one a `DataTransfer` made: so the box holds exactly the crop, or nothing. */
	const hold = (file: File | null) => {
		const list = new DataTransfer();
		if (file !== null) list.items.add(file);
		if (posted.current !== null) posted.current.files = list.files;
		setHeld(file === null ? null : URL.createObjectURL(file));
	};

	useEffect(() => onWorking(working), [working, onWorking]);

	const choose = async (file: File) => {
		setRefused(null);
		if (!takesLogo(file)) {
			setRefused(LOGO_REFUSED['not-a-logo-type']);
			return;
		}
		const size = await measure(file);
		const refusal =
			size === null ? LOGO_REFUSED.unreadable : photoSourceRefusal(size.width, size.height);
		if (refusal !== null) setRefused(refusal);
		else setCropping(file);
	};

	const keep = async (file: File, frame: CropRect) => {
		setCropping(null);
		setWorking(true);
		const cropped = await cropImage(file, frame, 'photo.png', PHOTO_REFUSED);
		if (!cropped.ok) {
			setWorking(false);
			setRefused(cropped.refused);
			return;
		}
		// the resize steps a photo with any transparent pixel down in size to fit the byte cap, which
		// can take it under the width the server takes however wide the frame was kept.
		const kept = await measure(cropped.blob);
		if (kept !== null && kept.width < PHOTO_WIDTH_MIN) {
			setWorking(false);
			setRefused(PHOTO_REFUSED['too-large-after-resize']);
			return;
		}
		if (uploadUrl === undefined) {
			setWorking(false);
			hold(new File([cropped.blob], 'photo.png', { type: cropped.blob.type }));
			return;
		}
		const uploaded = await upload(uploadUrl, cropped.blob);
		setWorking(false);
		if ('id' in uploaded) setStored(uploaded.id);
		else setRefused(uploaded.refused);
	};

	const dropped = (event: DragEvent<HTMLElement>) => {
		event.preventDefault();
		const file = event.dataTransfer.files[0];
		if (file !== undefined) void choose(file);
	};

	// the server's refusal is about the photo it was sent, and goes once another is chosen.
	const shown = refused ?? (stored === photoId && held === null ? error : undefined);
	const src = held ?? (stored === null ? null : imageSrc(stored));
	return (
		<fieldset className="ds-field sa-fieldset">
			<legend className="ds-label">
				Photo <span className="sa-optional">(optional)</span>
			</legend>
			<p className="ds-field-hint" id={`${id}-hint`}>
				Shown at the top of your page. At least {PHOTO_WIDTH_MIN} pixels wide, as a PNG, JPEG or
				WebP.
			</p>
			{uploadUrl === undefined ? (
				<input ref={posted} type="file" name={name} hidden tabIndex={-1} />
			) : (
				<input type="hidden" name={name} value={stored ?? ''} />
			)}
			<div className="sa-photo">
				{src === null ? (
					// registry gap: no dropzone; the well takes a dropped file, and the press beside it is
					// the way in for a keyboard.
					<div
						className="sa-photo-frame sa-photo-well"
						aria-hidden="true"
						onDragOver={(event) => event.preventDefault()}
						onDrop={dropped}
					/>
				) : (
					<img className="sa-photo-frame" src={src} alt="" />
				)}
				<div className="sa-row">
					<button
						ref={press}
						type="button"
						id={id}
						className="ds-btn ds-btn-secondary ds-btn-sm"
						aria-describedby={[`${id}-hint`, shown ? `${id}-err` : null].filter(Boolean).join(' ')}
						aria-busy={working || undefined}
						onClick={() => {
							if (!working) chooser.current?.click();
						}}
					>
						<Mark name="image-up" />
						{working ? 'Adding your photo…' : src === null ? 'Add photo' : 'Replace photo'}
					</button>
					{src === null || working ? null : (
						<button
							type="button"
							className="ds-btn ds-btn-ghost ds-btn-sm"
							onClick={() => {
								if (held === null) setStored(null);
								else hold(null);
								// Remove leaves with its photo; the press that adds one stays.
								press.current?.focus();
							}}
						>
							<Mark name="trash" />
							Remove
						</button>
					)}
				</div>
				<Refusal id={id} error={shown} live />
			</div>
			<input
				ref={chooser}
				type="file"
				accept={LOGO_ACCEPT}
				hidden
				onChange={(event) => {
					const file = event.currentTarget.files?.[0];
					event.currentTarget.value = '';
					if (file !== undefined) void choose(file);
				}}
			/>
			{cropping === null ? null : (
				<PhotoCropDialog
					file={cropping}
					onSave={(frame) => void keep(cropping, frame)}
					onCancel={() => setCropping(null)}
					fallbackFocus={press}
				/>
			)}
		</fieldset>
	);
}
