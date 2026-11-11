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
// (`cropImage` in $lib/admin/settings/crop-image.ts) and posts it to `uploadUrl`, whose answer's
// `id` is what the form posts as `photo_id`. a refusal, the server's included, is said under the
// press and describes it.

/** what `uploadUrl` answers: the stored photo's id, or why it was not stored. */
type UploadAnswer = { readonly id: string } | { readonly error: string };

const PHOTO_REFUSED: Readonly<Record<CropRefusal, string>> = {
	'not-an-image': LOGO_REFUSED['not-an-image'],
	unreadable: LOGO_REFUSED.unreadable,
	'too-large-after-resize': LOGO_REFUSED['too-large-after-resize'],
	'crop-outside': 'That frame runs past the edge of the photo. Move it inside the photo.'
};

/** the photo's own size, or null where the browser cannot open it. */
async function measure(file: File): Promise<{ width: number; height: number } | null> {
	try {
		const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
		const size = { width: bitmap.width, height: bitmap.height };
		bitmap.close();
		return size;
	} catch {
		return null;
	}
}

async function upload(uploadUrl: string, blob: Blob): Promise<string | null> {
	const body = new FormData();
	body.set('file', blob, 'photo.png');
	try {
		const answer = await fetch(uploadUrl, { method: 'POST', body });
		if (!answer.ok) return null;
		const read = (await answer.json()) as UploadAnswer;
		return 'id' in read && typeof read.id === 'string' ? read.id : null;
	} catch {
		return null;
	}
}

export type PhotoFieldProps = {
	/** the box's id; `${id}-hint` and `${id}-err` describe the press. */
	readonly id: string;
	/** the hidden box the stored photo's id posts under. */
	readonly name: string;
	/** the photo the page has now, or null. */
	readonly photoId: string | null;
	/** where a cropped photo is posted; it answers `{ id }`. */
	readonly uploadUrl: string;
	/** a refusal the server answered with, such as a photo id no stored image carries. */
	readonly error?: string | undefined;
	/** told while a crop or an upload runs, so the form holds its submit until the id is in. */
	readonly onWorking: (working: boolean) => void;
};

export function PhotoField({ id, name, photoId, uploadUrl, error, onWorking }: PhotoFieldProps) {
	const [stored, setStored] = useState(photoId);
	const [cropping, setCropping] = useState<File | null>(null);
	const [working, setWorking] = useState(false);
	const [refused, setRefused] = useState<string | null>(null);
	const chooser = useRef<HTMLInputElement>(null);

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
		const storedId = cropped.ok ? await upload(uploadUrl, cropped.blob) : null;
		setWorking(false);
		if (storedId !== null) setStored(storedId);
		else setRefused(cropped.ok ? PHOTO_NOT_STORED : cropped.refused);
	};

	const dropped = (event: DragEvent<HTMLElement>) => {
		event.preventDefault();
		const file = event.dataTransfer.files[0];
		if (file !== undefined) void choose(file);
	};

	// the server's refusal is about the photo it was sent, and goes once another is chosen.
	const shown = refused ?? (stored === photoId ? error : undefined);
	return (
		<fieldset className="ds-field sa-fieldset">
			<legend className="ds-label">
				Photo <span className="sa-optional">(optional)</span>
			</legend>
			<p className="ds-field-hint" id={`${id}-hint`}>
				Shown at the top of your page. At least {PHOTO_WIDTH_MIN} pixels wide, as a PNG, JPEG or
				WebP.
			</p>
			<input type="hidden" name={name} value={stored ?? ''} />
			<div className="sa-photo">
				{stored === null ? (
					// registry gap: no dropzone; the well takes a dropped file, and the press beside it is
					// the way in for a keyboard.
					<div
						className="sa-photo-frame sa-photo-well"
						aria-hidden="true"
						onDragOver={(event) => event.preventDefault()}
						onDrop={dropped}
					/>
				) : (
					<img className="sa-photo-frame" src={imageSrc(stored)} alt="" />
				)}
				<div className="sa-row">
					<button
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
						{working ? 'Adding your photo…' : stored === null ? 'Add photo' : 'Replace photo'}
					</button>
					{stored === null || working ? null : (
						<button
							type="button"
							className="ds-btn ds-btn-ghost ds-btn-sm"
							onClick={() => setStored(null)}
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
				/>
			)}
		</fieldset>
	);
}
