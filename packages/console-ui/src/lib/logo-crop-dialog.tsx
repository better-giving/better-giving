import { ImageCropper, useImageCropper } from '@ark-ui/react/image-cropper';
import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import {
	type MouseEvent,
	type ReactNode,
	type RefObject,
	useEffect,
	useEffectEvent,
	useRef,
	useState
} from 'react';
import { centredSquare, cropRefusal, naturalSquare, type Size, shownMinimum } from './logo-crop';
import {
	type CropSquare,
	LOGO_CROP_SIZE,
	LOGO_CROP_X,
	LOGO_CROP_Y,
	LOGO_FROM_FILE,
	LOGO_FROM_STORED,
	LOGO_SOURCE
} from './org-fields';
import { LOGO_REFUSED, type LogoRefusal } from './org-logo';

// the square an operator keeps of a logo, chosen before anything is sent: a file just chosen or
// dropped on the logo, or the logo stored now, cropped again. ./org-fold.tsx opens it and its logo
// form is what a save submits.
//
// **the dialog is the operator `Modal` and the crop is ark's image cropper, each left to do its own
// job.** the card's lift, its focus on opening and the focus handed back on closing are
// `@better-giving/operator/behaviour/Dialog`'s; the square's drag, its handles, its arrow keys and
// what it says to a reader are the machine's. what is written here is the shape of the square —
// one to one, opening on the largest centred one, and never under `LOGO_CROP_MIN` of the image's
// own pixels — and what a save posts.
//
// **a save posts the square, never the image.** the boxes are `LOGO_SOURCE` and the three
// `LOGO_CROP_*` (./org-fields.ts), drawn here and owned by the logo form through their `form`
// attribute, so the card can stand in the top layer outside that form; the file a crop of a chosen
// one needs is the form's own file box. the crop itself is made in the browser at the press
// (`putLogo` in ./org-logo.ts), which re-reads the stored logo for a crop of it — so this draws the
// stored logo and keeps nothing of it.
//
// **an image the square cannot keep a logo from opens anyway, with the save closed and the sentence
// the press would refuse it with.** a file that is no image and an image too small say so here,
// before anything is sent, in `LOGO_REFUSED`'s own words.

export const CROP_TITLE = 'Crop the logo';
export const SAVE_LOGO = 'Save logo';
export const CANCEL_CROP = 'Cancel';

/** the image a crop is of: a file the operator chose or dropped, or the logo stored now. */
export type CropImage =
	| { readonly from: typeof LOGO_FROM_FILE; readonly file: File }
	| { readonly from: typeof LOGO_FROM_STORED; readonly url: string };

export type LogoCropDialogProps = {
	readonly image: CropImage;
	/** the id of the logo form a save submits. */
	readonly form: string;
	/** Cancel, Escape and a press on the ground: close with nothing posted. */
	readonly onCancel: () => void;
	/** where focus lands when nothing pressed opened the card — a file dropped on the logo. */
	readonly fallbackFocus?: RefObject<HTMLElement | null> | undefined;
};

/** whether a measured box has been laid out: the machine reports zeros until it has. */
const measured = (size: Size): boolean => size.width > 0 && size.height > 0;

/**
 * what an image that would not open is refused as, in the words the press would use: a file typed
 * as something other than an image, or typed as nothing, is no image, and one typed as an image
 * could not be read (`decoded` in ./org-logo.ts).
 */
const unopened = (image: CropImage): LogoRefusal =>
	image.from === LOGO_FROM_FILE && !image.file.type.startsWith('image/')
		? 'not-an-image'
		: 'unreadable';

/** the address an image is drawn from: a file's own object url for as long as the card is up. */
function useImageSource(image: CropImage): string | null {
	const file = image.from === LOGO_FROM_FILE ? image.file : null;
	const [made, setMade] = useState<string | null>(null);
	useEffect(() => {
		if (file === null) return;
		const url = URL.createObjectURL(file);
		setMade(url);
		return () => URL.revokeObjectURL(url);
	}, [file]);
	return image.from === LOGO_FROM_STORED ? image.url : made;
}

export function LogoCropDialog({
	image,
	form,
	onCancel,
	fallbackFocus
}: LogoCropDialogProps): ReactNode {
	const src = useImageSource(image);
	const [failed, setFailed] = useState<LogoRefusal | null>(null);
	/* the two measures the square's limits are stated from, as the last render's machine reported
	   them: the limits are props of the machine, so they are read from a render before its own. */
	const [measures, setMeasures] = useState<{ shown: Size; natural: Size } | null>(null);

	const cropper = useImageCropper({
		aspectRatio: 1,
		// the image is drawn whole and at its own scale, which is what ./logo-crop.ts converts by.
		minZoom: 1,
		maxZoom: 1,
		...(measures === null
			? {}
			: {
					minWidth: shownMinimum(measures.shown, measures.natural),
					minHeight: shownMinimum(measures.shown, measures.natural),
					initialCrop: centredSquare(measures.shown)
				})
	});

	/* the box the image is drawn in, and the image's own size, once the machine has measured both. */
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

	/* the square the crop opens on is the largest centred one, put there once the limits are stated
	   from the box it is drawn in: the machine's own opening square is a share of the box, and the
	   reset is what reads `initialCrop` again. keyed to the image whose limits landed, which a card
	   holds one of. */
	const centredOn = useRef<string | null>(null);
	const centre = useEffectEvent(() => cropper.reset());
	useEffect(() => {
		if (src === null || measures === null || centredOn.current === src) return;
		centredOn.current = src;
		centre();
	}, [src, measures]);

	const square =
		shown !== null && natural !== null && measured(cropper.crop)
			? naturalSquare(cropper.crop, shown, natural)
			: null;

	return (
		<LogoCropCard
			source={image.from}
			form={form}
			square={square}
			refusal={cropRefusal(natural, failed)}
			onCancel={onCancel}
			fallbackFocus={fallbackFocus}
		>
			{src === null || failed !== null ? null : (
				<ImageCropper.RootProvider value={cropper} className="adm-cropper">
					<ImageCropper.Viewport className="adm-cropper__viewport">
						<ImageCropper.Image
							className="adm-cropper__image"
							src={src}
							alt=""
							onError={() => setFailed(unopened(image))}
						/>
						<ImageCropper.Selection className="adm-cropper__selection">
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
			)}
		</LogoCropCard>
	);
}

export type LogoCropCardProps = Omit<LogoCropDialogProps, 'image'> & {
	readonly source: CropImage['from'];
	/** the square kept, in the image's own pixels, or `null` until the image has been measured. */
	readonly square: CropSquare | null;
	/** why this image cannot be saved as the logo, or `null` where it can. */
	readonly refusal: LogoRefusal | null;
	/** the cropper, drawn over the image. */
	readonly children?: ReactNode;
};

/** the card in one state, which is the whole of what the dialog draws. */
export function LogoCropCard({
	source,
	form,
	square,
	refusal,
	onCancel,
	fallbackFocus,
	children
}: LogoCropCardProps): ReactNode {
	const said = `${form}-crop-err`;
	/* closed by `aria-disabled`, so a reader standing on it keeps the focus, and turned away in its
	   own handler: over an image it cannot save, and until there is a square to post. */
	const closed = refusal !== null || square === null;
	return (
		<Modal
			title={CROP_TITLE}
			onDismiss={onCancel}
			fallbackFocus={fallbackFocus}
			commit={SAVE_LOGO}
			commitProps={{
				type: 'submit',
				form,
				'aria-disabled': closed || undefined,
				'aria-describedby': refusal === null ? undefined : said,
				onClick: (event: MouseEvent<HTMLButtonElement>) => {
					if (closed) event.preventDefault();
				}
			}}
			cancel={CANCEL_CROP}
			cancelProps={{ type: 'button', onClick: onCancel }}
		>
			{children}
			{refusal === null ? null : (
				<FieldMessage id={said}>
					<MarkedText text={LOGO_REFUSED[refusal]} />
				</FieldMessage>
			)}
			<input type="hidden" form={form} name={LOGO_SOURCE} value={source} readOnly />
			{square === null ? null : (
				<>
					<input type="hidden" form={form} name={LOGO_CROP_X} value={square.x} readOnly />
					<input type="hidden" form={form} name={LOGO_CROP_Y} value={square.y} readOnly />
					<input type="hidden" form={form} name={LOGO_CROP_SIZE} value={square.size} readOnly />
				</>
			)}
		</Modal>
	);
}
