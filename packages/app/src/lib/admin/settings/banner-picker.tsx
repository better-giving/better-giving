import { useState } from 'react';
import { ReplacePhotoControl } from '../page-edit/replace-photo';
import { BannerCropDialog } from './banner-crop-dialog';
import { cropBanner } from './banner-image';
import type { CropRect, Cropped } from './crop-image';
import { LOGO_ACCEPT } from './logo-crop';

export type BannerPickerProps = {
	/** the banner as it is served; absent while none is stored. */
	readonly src: string | undefined;
	/**
	 * `uploading` while the route posts the band; `removing` while it takes the banner off; or the
	 * sentence of the last refusal, under the press.
	 */
	readonly state?: 'uploading' | 'removing' | { readonly refused: string } | undefined;
	/** a saved crop, cropped and resized, or refused. the route posts `blob` and moves `state`. */
	readonly onCropped: (cropped: Cropped) => void;
	readonly onRemove: () => void;
};

/**
 * the donation page's banner: the replace press over its 4:1 preview, and between a pick and its
 * upload the crop card the operator keeps a band of the file in — the logo's picker
 * (./logo-picker.tsx) at the banner's shape. Cancel posts nothing; Save crops the file to the band
 * and resizes it here (./banner-image.ts), and hands the result to the route.
 */
export function BannerPicker({ src, state, onCropped, onRemove }: BannerPickerProps) {
	const [chosen, setChosen] = useState<File | null>(null);
	const [cropping, setCropping] = useState(false);

	// the press stays closed while `cropping` is up, so no second save starts under this one.
	const save = async (file: File, band: CropRect) => {
		setChosen(null);
		setCropping(true);
		const cropped = await cropBanner(file, band);
		setCropping(false);
		onCropped(cropped);
	};

	return (
		<>
			<ReplacePhotoControl
				noun="banner"
				imageSrc={src}
				describe={false}
				frame="banner"
				accept={LOGO_ACCEPT}
				onChosen={setChosen}
				state={cropping ? 'resizing' : state}
				onRemove={onRemove}
			/>
			{chosen === null ? null : (
				<BannerCropDialog
					file={chosen}
					onSave={(band) => save(chosen, band)}
					onCancel={() => setChosen(null)}
					onSwap={setChosen}
				/>
			)}
		</>
	);
}
