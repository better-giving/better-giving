import {
	ImageCropper,
	type UseImageCropperProps,
	useImageCropper
} from '@ark-ui/react/image-cropper';
import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import {
	type ReactNode,
	type RefObject,
	useEffect,
	useEffectEvent,
	useId,
	useRef,
	useState
} from 'react';
import { BANNER_RATIO, bannerSourceRefusal } from '$lib/org/banner';
import {
	BANNER_REFUSED,
	bandResizeDelta,
	centredBanner,
	naturalBanner,
	shownBannerMinimum
} from './banner-crop';
import type { CropRect } from './crop-image';
import { NUDGE, resizeCorner, type Size, squareResize, takesLogo } from './logo-crop';
import { useDropsOnCard, useImageSource } from './logo-crop-dialog';

// the 4:1 band an operator keeps of a photo for the donation page's banner, chosen before anything
// is sent: a file just chosen with the banner's press. ./banner-picker.tsx opens it, and Save hands
// the band back to it to crop and post.
//
// **it is the logo's crop card (./logo-crop-dialog.tsx) at the banner's shape**: the operator
// `Modal`, ark's image cropper drawing the photo whole at no zoom, the same arrow steps, the same
// drop to swap the photo, and the same Alt+arrow resize turned into a change of the whole band
// (`squareResize`, `resizeCorner` in ./logo-crop.ts, `bandResizeDelta` in ./banner-crop.ts), which
// the cropper's own press would make to one side alone. what differs is the shape — locked at `BANNER_RATIO`, opening on the widest
// centred band, never under `BANNER_WIDTH_MIN` of the photo's own pixels — the dashed guide over
// the middle 3:1 a phone shows, and the rule a photo is turned down by (`bannerSourceRefusal` in
// $lib/org/banner.ts), said in `role="alert"` with Save banner closed.

const CROP_TITLE = 'Crop the banner';
const SAVE_BANNER = 'Save banner';
const CANCEL_CROP = 'Cancel';
const CROP_HINT =
	'Move the frame to choose what stays. It keeps a 4 to 1 band. The dashed lines mark the middle 3 to 1 a phone shows.';

export type BannerCropDialogProps = {
	/** the file the operator chose or dropped. */
	readonly file: File;
	/** Save: the band kept, in the photo's own pixels. */
	readonly onSave: (band: CropRect) => void;
	/** Cancel, Escape and a press on the ground: close with nothing posted. */
	readonly onCancel: () => void;
	/** a file of a type a banner is taken in, dropped on the open card: crop it in this one's place. */
	readonly onSwap: (file: File) => void;
	/** where focus lands when the press that opened the card is gone. */
	readonly fallbackFocus?: RefObject<HTMLElement | null> | undefined;
};

/** whether a measured box has been laid out: the machine reports zeros until it has. */
const measured = (size: Size): boolean => size.width > 0 && size.height > 0;

/** what the cropper says to a reader: a band, moved with the arrow keys and never zoomed. */
const CROP_WORDS: NonNullable<UseImageCropperProps['translations']> = {
	rootLabel: 'Banner image',
	previewLoading: 'Loading the image',
	previewDescription: () => 'The band over the image is the part kept as the banner.',
	selectionLabel: () => 'Band kept as the banner',
	selectionInstructions:
		'Move the band with the arrow keys. Hold Alt (Option on a Mac) with the right or down arrow to make it larger, left or up to make it smaller.'
};

/** where the band stands, in the photo's own pixels: what a save posts. */
const bandWords = (band: CropRect | null): string =>
	band === null
		? 'Loading the image'
		: `${band.width} pixels across, ${band.x} from the left and ${band.y} from the top`;

/** what a cropper has measured of its photo: the band kept, and the photo's own size. */
type CropReading = {
	/** the file the reading is of (`ImageSource`'s `id`). */
	readonly id: string;
	readonly band: CropRect | null;
	readonly natural: Size | null;
};

export function BannerCropDialog({
	file,
	onSave,
	onCancel,
	onSwap,
	fallbackFocus
}: BannerCropDialogProps): ReactNode {
	const { id, src, unreadable } = useImageSource(file);
	const [failed, setFailed] = useState<{ readonly file: File } | null>(null);
	/* a failure is the file's that failed: a file swapped in by a drop is tried afresh. */
	const refused: string | null = !takesLogo(file)
		? BANNER_REFUSED['not-a-logo-type']
		: unreadable || failed?.file === file
			? BANNER_REFUSED.unreadable
			: null;
	/* a reading is the image's it was taken from, so a dropped image states nothing until its own
	   cropper has measured it. */
	const [reading, setReading] = useState<CropReading | null>(null);
	const current = reading?.id === id ? reading : null;
	const natural = current?.natural ?? null;

	return (
		<BannerCropCard
			band={current?.band ?? null}
			refusal={
				refused ?? (natural === null ? null : bannerSourceRefusal(natural.width, natural.height))
			}
			onSave={onSave}
			onCancel={onCancel}
			onSwap={onSwap}
			fallbackFocus={fallbackFocus}
		>
			{src === null || refused !== null ? null : (
				<BannerCropper
					key={id}
					id={id}
					src={src}
					onRead={setReading}
					onError={() => setFailed({ file })}
				/>
			)}
		</BannerCropCard>
	);
}

type BannerCropperProps = {
	/** the file the photo is read from (`ImageSource`'s `id`). */
	readonly id: string;
	readonly src: string;
	/** the band kept and the photo's own size, each time either changes. */
	readonly onRead: (reading: CropReading) => void;
	/** the image would not open. */
	readonly onError: () => void;
};

/** ark's cropper over one photo, opening on its widest centred band. */
function BannerCropper({ id, src, onRead, onError }: BannerCropperProps): ReactNode {
	/* the two measures the band's limits are stated from, as the last render's machine reported
	   them: the limits are props of the machine, so they are read from a render before its own. */
	const [measures, setMeasures] = useState<{ shown: Size; natural: Size } | null>(null);
	const minimum = measures === null ? null : shownBannerMinimum(measures.shown, measures.natural);

	const cropper = useImageCropper({
		aspectRatio: BANNER_RATIO,
		// the photo is drawn whole and at its own scale, which is what ./banner-crop.ts converts by.
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
					initialCrop: centredBanner(measures.shown)
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

	/* the band the crop opens on is the widest centred one, put there once the limits are stated
	   from the box it is drawn in; keyed to the image whose limits landed. */
	const centredOn = useRef<string | null>(null);
	const centre = useEffectEvent(() => cropper.reset());
	useEffect(() => {
		if (measures === null || centredOn.current === id) return;
		centredOn.current = id;
		centre();
	}, [id, measures]);

	const band =
		shown !== null && natural !== null && measured(cropper.crop)
			? naturalBanner(cropper.crop, shown, natural)
			: null;
	const [bandX, bandY, bandWidth, bandHeight] = [band?.x, band?.y, band?.width, band?.height];
	const read = useEffectEvent(onRead);
	useEffect(() => {
		read({
			id,
			band:
				bandX === undefined ||
				bandY === undefined ||
				bandWidth === undefined ||
				bandHeight === undefined
					? null
					: { x: bandX, y: bandY, width: bandWidth, height: bandHeight },
			natural: naturalWide === 0 ? null : { width: naturalWide, height: naturalTall }
		});
	}, [id, bandX, bandY, bandWidth, bandHeight, naturalWide, naturalTall]);

	return (
		<ImageCropper.RootProvider value={cropper} className="adm-cropper">
			<ImageCropper.Viewport className="adm-cropper__viewport">
				<ImageCropper.Image className="adm-cropper__image" src={src} alt="" onError={onError} />
				<ImageCropper.Selection
					className="adm-cropper__selection"
					aria-valuetext={bandWords(band)}
					// runs before the machine's own handler, which passes over a press already taken.
					onKeyDown={(event) => {
						const change = squareResize(event);
						if (change === null) return;
						event.preventDefault();
						cropper.resize(
							resizeCorner(cropper.crop, cropper.viewportRect, change, BANNER_RATIO),
							bandResizeDelta(change)
						);
					}}
				>
					<span className="adm-cropper__guide" aria-hidden="true" />
					{ImageCropper.handles.map((position) => (
						<ImageCropper.Handle
							key={position}
							position={position}
							className="adm-cropper__handle"
						/>
					))}
				</ImageCropper.Selection>
			</ImageCropper.Viewport>
		</ImageCropper.RootProvider>
	);
}

type BannerCropCardProps = Omit<BannerCropDialogProps, 'file'> & {
	/** the band kept, in the photo's own pixels, or `null` until the photo has been measured. */
	readonly band: CropRect | null;
	/** why this photo cannot be saved as the banner, or `null` where it can. */
	readonly refusal: string | null;
	/** the cropper, drawn over the photo. */
	readonly children?: ReactNode;
};

/** the card in one state, which is the whole of what the dialog draws. */
function BannerCropCard({
	band,
	refusal,
	onSave,
	onCancel,
	onSwap,
	fallbackFocus,
	children
}: BannerCropCardProps): ReactNode {
	const said = `${useId()}-crop-err`;
	const inside = useRef<HTMLSpanElement>(null);
	useDropsOnCard(inside, onSwap);
	/* closed by `aria-disabled`, so a reader standing on it keeps the focus, and turned away in its
	   own handler: over a photo it cannot save, and until there is a band to hand back. */
	const closed = refusal !== null || band === null;
	return (
		<Modal
			title={CROP_TITLE}
			onDismiss={onCancel}
			fallbackFocus={fallbackFocus}
			commit={SAVE_BANNER}
			commitProps={{
				type: 'button',
				'aria-disabled': closed || undefined,
				'aria-describedby': refusal === null ? undefined : said,
				onClick: () => {
					if (band !== null && refusal === null) onSave(band);
				}
			}}
			cancel={CANCEL_CROP}
			cancelProps={{ type: 'button', onClick: onCancel }}
		>
			<p className="adm-hint">{CROP_HINT}</p>
			{children}
			{refusal === null ? (
				band === null ? null : (
					<p className="adm-hint">{bandWords(band)}</p>
				)
			) : (
				<FieldMessage id={said}>{refusal}</FieldMessage>
			)}
			{/* nothing to see: the element the card is found from (`useDropsOnCard`). */}
			<span ref={inside} hidden />
		</Modal>
	);
}
