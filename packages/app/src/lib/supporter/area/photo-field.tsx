import { type DragEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { type CropRect, type CropRefusal, cropImage } from '$lib/admin/settings/crop-image';
import { LOGO_ACCEPT, LOGO_REFUSED, takesLogo } from '$lib/admin/settings/logo-crop';
import { imageSrc } from '$lib/page/image-src';
import { PHOTO_NOT_STORED } from './copy';
import { Mark } from './glyph';
import { PhotoCropDialog } from './photo-crop-dialog';
import { PHOTO_WIDTH_MIN, photoSourceRefusal } from './photo-crop';

// a page's photo, in the registry's dropzone (file-dropzone-css.usage.md): the area a photo is
// pressed for or dropped on, the file's row while it is cropped and stored, then the 16:9 preview
// with Replace photo and Remove. a chosen file is measured first, and one too small for a page is
// turned down under the area without a crop; the rest open the crop card (./photo-crop-dialog.tsx),
// and Use this photo crops and resizes the frame here (`cropImage` in
// $lib/admin/settings/crop-image.ts). given an `uploadUrl`, the crop is posted there and its
// answer's `id` is what the form posts under `name`; given none, the crop is the file the form
// posts under `name` itself, which a form doing so sends as `multipart/form-data`. a refusal, the
// server's included, is said under the area or the preview and describes the control that holds
// focus.

/** what `uploadUrl` answers: the stored photo's id, or why it was not stored. */
type UploadAnswer = { readonly id: string } | { readonly error: string };

const ONE_AT_A_TIME = 'Drop one file at a time.';

const PHOTO_REFUSED: Readonly<Record<CropRefusal, string>> = {
	'not-an-image': LOGO_REFUSED['not-an-image'],
	unreadable: LOGO_REFUSED.unreadable,
	'too-large-after-resize': LOGO_REFUSED['too-large-after-resize'],
	'crop-outside': 'That frame runs past the edge of the photo. Move it inside the photo.'
};

const FILE_SIZE = new Intl.NumberFormat('en-US', {
	style: 'unit',
	unit: 'megabyte',
	maximumFractionDigits: 1
});

/** a file's size as its row says it: `2.4 MB`. */
const sizeOf = (bytes: number): string => FILE_SIZE.format(bytes / 1_000_000);

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
	/**
	 * the id of the control that takes focus, the area or Replace photo; `${id}-err` and `${id}-hint`
	 * describe it, and `${id}-label` names the area.
	 */
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

/** the chosen file a crop and an upload are running for, as its row names it. */
type Pending = { readonly name: string; readonly size: number };

export function PhotoField({ id, name, photoId, uploadUrl, error, onWorking }: PhotoFieldProps) {
	const [stored, setStored] = useState(photoId);
	/** the preview address of a crop held to post with the form, or null. */
	const [held, setHeld] = useState<string | null>(null);
	const [cropping, setCropping] = useState<File | null>(null);
	const [pending, setPending] = useState<Pending | null>(null);
	const [dragging, setDragging] = useState(false);
	/** our refusal, and how many have been said: a new one replaces the alert, so a repeat is read. */
	const [refused, setRefused] = useState<{ readonly text: string; readonly n: number } | null>(
		null
	);
	const [said, setSaid] = useState('');
	/** set where the control that held focus went with the screen it stood on. */
	const [landing, setLanding] = useState<object | null>(null);
	const chooser = useRef<HTMLInputElement>(null);
	const area = useRef<HTMLDivElement>(null);
	const replace = useRef<HTMLButtonElement>(null);
	const posted = useRef<HTMLInputElement>(null);
	const working = pending !== null;

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

	// the area and the preview replace each other, so focus that fell to the body with the one that
	// went lands on whichever stands now: Replace photo, or the empty area. focus the supporter moved
	// elsewhere stays where they put it.
	useEffect(() => {
		if (landing === null || document.activeElement !== document.body) return;
		(replace.current ?? area.current)?.focus();
	}, [landing]);

	const refuse = (text: string) => setRefused((last) => ({ text, n: (last?.n ?? 0) + 1 }));

	const choose = async (file: File) => {
		setRefused(null);
		if (!takesLogo(file)) {
			refuse(LOGO_REFUSED['not-a-logo-type']);
			return;
		}
		const size = await measure(file);
		const refusal =
			size === null ? LOGO_REFUSED.unreadable : photoSourceRefusal(size.width, size.height);
		if (refusal !== null) refuse(refusal);
		else setCropping(file);
	};

	const settle = (outcome: { readonly refused: string } | null) => {
		setPending(null);
		setLanding({});
		if (outcome === null) {
			setSaid('Photo added.');
			return;
		}
		setSaid('');
		refuse(outcome.refused);
	};

	const keep = async (file: File, frame: CropRect) => {
		setCropping(null);
		setPending({ name: file.name, size: file.size });
		setSaid('Adding your photo…');
		const cropped = await cropImage(file, frame, 'photo.png', PHOTO_REFUSED);
		if (!cropped.ok) {
			settle({ refused: cropped.refused });
			return;
		}
		// the resize steps a photo with any transparent pixel down in size to fit the byte cap, which
		// can take it under the width the server takes however wide the frame was kept.
		const kept = await measure(cropped.blob);
		if (kept !== null && kept.width < PHOTO_WIDTH_MIN) {
			settle({ refused: PHOTO_REFUSED['too-large-after-resize'] });
			return;
		}
		if (uploadUrl === undefined) {
			hold(new File([cropped.blob], 'photo.png', { type: cropped.blob.type }));
			settle(null);
			return;
		}
		const uploaded = await upload(uploadUrl, cropped.blob);
		if ('id' in uploaded) setStored(uploaded.id);
		settle('id' in uploaded ? null : uploaded);
	};

	const pick = () => chooser.current?.click();

	const pressed = (event: KeyboardEvent<HTMLElement>) => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		pick();
	};

	const heldOver = (event: DragEvent<HTMLElement>) => {
		event.preventDefault();
		setDragging(true);
	};

	const dropped = (event: DragEvent<HTMLElement>) => {
		event.preventDefault();
		setDragging(false);
		const { files } = event.dataTransfer;
		if (files.length > 1) refuse(ONE_AT_A_TIME);
		else if (files[0] !== undefined) void choose(files[0]);
	};

	// the server's refusal is about the photo it was sent, and goes once another is chosen.
	const shown = refused?.text ?? (stored === photoId && held === null ? error : undefined);
	const src = held ?? (stored === null ? null : imageSrc(stored));
	const describedBy = `${id}-err ${id}-hint`;
	return (
		<div className="ds-field">
			<span className="ds-label" id={`${id}-label`}>
				Photo <span className="sa-optional">(optional)</span>
			</span>
			{uploadUrl === undefined ? (
				<input ref={posted} type="file" name={name} hidden tabIndex={-1} />
			) : (
				<input type="hidden" name={name} value={stored ?? ''} />
			)}
			{/* the busy area and the empty one stand in one place as one element type, so the node, and
			    focus on it, carries from the one to the other. the preview is keyed apart: the busy
			    node it would take over can't hold focus, so focus on it falls to the body and lands. */}
			{pending !== null ? (
				// biome-ignore lint/a11y/useSemanticElements: the busy area is the empty one's own node, and a `<fieldset>` would replace it.
				<div
					ref={area}
					id={id}
					className="ds-dropzone"
					role="group"
					tabIndex={-1}
					aria-labelledby={`${id}-label`}
					aria-describedby={describedBy}
					aria-busy="true"
				>
					<div className="ds-dropzone-file">
						<Mark name="image-up" />
						<span className="ds-dropzone-name">
							<b>{pending.name}</b>
							<span>{sizeOf(pending.size)} · Adding your photo…</span>
						</span>
					</div>
				</div>
			) : src === null ? (
				// biome-ignore lint/a11y/useSemanticElements: the area is a `div` holding the touch prompt's `ds-btn` span (file-dropzone-css.usage.md), and the busy area takes over its node.
				<div
					ref={area}
					id={id}
					className="ds-dropzone"
					role="button"
					tabIndex={0}
					aria-labelledby={`${id}-label`}
					aria-describedby={describedBy}
					aria-invalid={shown ? 'true' : undefined}
					data-dragging={dragging || undefined}
					onClick={pick}
					onKeyDown={pressed}
					onDragEnter={heldOver}
					onDragOver={heldOver}
					onDragLeave={(event) => {
						if (!event.currentTarget.contains(event.relatedTarget as Node | null))
							setDragging(false);
					}}
					onDrop={dropped}
				>
					<Mark name="image-up" />
					<span className="ds-dropzone-title">
						{dragging ? (
							'Drop the photo to upload'
						) : (
							<>
								Drop a photo here, or <span className="ds-dropzone-link">choose a file</span>
							</>
						)}
					</span>
					<span className="ds-dropzone-touch ds-btn ds-btn-secondary ds-btn-sm">
						<Mark name="image-up" />
						Add photo
					</span>
				</div>
			) : (
				<div key="preview" className="ds-dropzone-preview">
					<div className="ds-dropzone-img">
						<img src={src} alt="" />
					</div>
					<div className="ds-dropzone-actions">
						<button
							ref={replace}
							type="button"
							id={id}
							className="ds-btn ds-btn-secondary ds-btn-sm"
							aria-describedby={describedBy}
							onClick={pick}
						>
							<Mark name="image-up" />
							Replace photo
						</button>
						<button
							type="button"
							className="ds-btn ds-btn-ghost ds-btn-sm"
							onClick={() => {
								if (held === null) setStored(null);
								else hold(null);
								setSaid('Photo removed.');
								setLanding({});
							}}
						>
							<Mark name="trash" />
							Remove
						</button>
					</div>
				</div>
			)}
			<input
				ref={chooser}
				type="file"
				accept={LOGO_ACCEPT}
				hidden
				tabIndex={-1}
				aria-hidden="true"
				onChange={(event) => {
					const file = event.currentTarget.files?.[0];
					event.currentTarget.value = '';
					if (file !== undefined) void choose(file);
				}}
			/>
			<p key={refused?.n ?? 0} className="ds-field-err" id={`${id}-err`} role="alert">
				{shown}
			</p>
			<p className="ds-sr-only" role="status">
				{said}
			</p>
			<p className="ds-dropzone-hint" id={`${id}-hint`}>
				Shown at the top of your page. At least {PHOTO_WIDTH_MIN} pixels wide, as a PNG, JPEG or
				WebP.
			</p>
			{cropping === null ? null : (
				<PhotoCropDialog
					file={cropping}
					onSave={(frame) => void keep(cropping, frame)}
					onCancel={() => setCropping(null)}
					fallbackFocus={area}
				/>
			)}
		</div>
	);
}
