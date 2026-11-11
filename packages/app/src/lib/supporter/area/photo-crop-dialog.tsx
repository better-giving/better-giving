import {
	ImageCropper,
	type UseImageCropperProps,
	useImageCropper
} from '@ark-ui/react/image-cropper';
import { type ReactNode, useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import type { CropRect } from '$lib/admin/settings/crop-image';
import { NUDGE, resizeCorner, type Size, squareResize } from '$lib/admin/settings/logo-crop';
import { useImageSource } from '$lib/admin/settings/logo-crop-dialog';
import { Modal } from './modal';
import {
	centredFrame,
	frameResizeDelta,
	naturalFrame,
	PHOTO_RATIO,
	shownFrameMinimum
} from './photo-crop';

// the 16:9 frame a supporter keeps of a photo for their page, chosen before anything is sent: the
// Settings banner's crop card ($lib/admin/settings/banner-crop-dialog.tsx) at a page photo's shape,
// on a supporter's page rather than /admin. ark's cropper draws the photo whole at no zoom; arrows
// move the frame and Alt with an arrow resizes it as a whole (`squareResize`, `resizeCorner`). the
// photo reached here is already one a page takes (./photo-field.tsx turns down the rest), so Save
// is closed only until the frame is measured.

const TITLE = 'Crop your photo';
const HINT =
	'Move the frame to choose what shows at the top of your page. It keeps a 16 to 9 shape.';

const CROP_WORDS: NonNullable<UseImageCropperProps['translations']> = {
	rootLabel: 'Your photo',
	previewLoading: 'Loading the photo',
	previewDescription: () => 'The frame over the photo is the part kept for your page.',
	selectionLabel: () => 'Frame kept for your page',
	selectionInstructions:
		'Move the frame with the arrow keys. Hold Alt (Option on a Mac) with the right or down arrow to make it larger, left or up to make it smaller.'
};

const measured = (size: Size): boolean => size.width > 0 && size.height > 0;

export type PhotoCropDialogProps = {
	readonly file: File;
	readonly onSave: (frame: CropRect) => void;
	readonly onCancel: () => void;
};

export function PhotoCropDialog({ file, onSave, onCancel }: PhotoCropDialogProps): ReactNode {
	const { id, src } = useImageSource(file);
	const [frame, setFrame] = useState<{ readonly id: string; readonly rect: CropRect } | null>(null);
	const kept = frame?.id === id ? frame.rect : null;
	const title = `${useId()}-title`;
	const cancel = useRef<HTMLButtonElement>(null);
	return (
		<Modal role="dialog" labelledBy={title} onDismiss={onCancel} initialFocus={cancel}>
			<h2 className="sa-dialog-title" id={title}>
				{TITLE}
			</h2>
			<p className="sa-quiet">{HINT}</p>
			{src === null ? null : (
				<PhotoCropper key={id} src={src} onRead={(rect) => setFrame({ id, rect })} />
			)}
			<div className="sa-dialog-actions">
				<button ref={cancel} type="button" className="ds-btn ds-btn-secondary" onClick={onCancel}>
					Cancel
				</button>
				<button
					type="button"
					className="ds-btn ds-btn-primary"
					aria-disabled={kept === null || undefined}
					onClick={() => {
						if (kept !== null) onSave(kept);
					}}
				>
					Use this photo
				</button>
			</div>
		</Modal>
	);
}

function PhotoCropper({
	src,
	onRead
}: {
	readonly src: string;
	readonly onRead: (frame: CropRect) => void;
}) {
	const [measures, setMeasures] = useState<{ shown: Size; natural: Size } | null>(null);
	const minimum = measures === null ? null : shownFrameMinimum(measures.shown, measures.natural);
	const cropper = useImageCropper({
		aspectRatio: PHOTO_RATIO,
		minZoom: 1,
		maxZoom: 1,
		nudgeStep: NUDGE.step,
		nudgeStepShift: NUDGE.shift,
		nudgeStepCtrl: NUDGE.ctrl,
		translations: CROP_WORDS,
		...(measures === null || minimum === null
			? {}
			: {
					minWidth: minimum.width,
					minHeight: minimum.height,
					initialCrop: centredFrame(measures.shown)
				})
	});

	const shown = measured(cropper.viewportRect) ? cropper.viewportRect : null;
	const natural = measured(cropper.naturalSize) ? cropper.naturalSize : null;
	const [shownWide, shownTall] = [shown?.width ?? 0, shown?.height ?? 0];
	const [naturalWide, naturalTall] = [natural?.width ?? 0, natural?.height ?? 0];
	useEffect(() => {
		if (shownWide === 0 || naturalWide === 0) return;
		setMeasures({
			shown: { width: shownWide, height: shownTall },
			natural: { width: naturalWide, height: naturalTall }
		});
	}, [shownWide, shownTall, naturalWide, naturalTall]);

	// the frame opens centred once its limits are stated from the box it is drawn in.
	const centred = measures !== null;
	const centre = useEffectEvent(() => cropper.reset());
	useEffect(() => {
		if (centred) centre();
	}, [centred]);

	const rect =
		shown !== null && natural !== null && measured(cropper.crop)
			? naturalFrame(cropper.crop, shown, natural)
			: null;
	const read = useEffectEvent(onRead);
	const [x, y, width, height] = [rect?.x, rect?.y, rect?.width, rect?.height];
	useEffect(() => {
		if (x === undefined || y === undefined || width === undefined || height === undefined) return;
		read({ x, y, width, height });
	}, [x, y, width, height]);

	return (
		<ImageCropper.RootProvider value={cropper} className="sa-cropper">
			<ImageCropper.Viewport className="sa-cropper-viewport">
				<ImageCropper.Image className="sa-cropper-image" src={src} alt="" />
				<ImageCropper.Selection
					className="sa-cropper-frame"
					onKeyDown={(event) => {
						const change = squareResize(event);
						if (change === null) return;
						event.preventDefault();
						cropper.resize(
							resizeCorner(cropper.crop, cropper.viewportRect, change, PHOTO_RATIO),
							frameResizeDelta(change)
						);
					}}
				>
					{ImageCropper.handles.map((position) => (
						<ImageCropper.Handle key={position} position={position} className="sa-cropper-handle" />
					))}
				</ImageCropper.Selection>
			</ImageCropper.Viewport>
		</ImageCropper.RootProvider>
	);
}
