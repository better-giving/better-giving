import { useState } from 'react';
import { ReplacePhotoControl } from '../editor/replace-photo';
import { type CropSquare, LOGO_ACCEPT } from './logo-crop';
import { LogoCropDialog } from './logo-crop-dialog';
import { type Squared, squareLogo } from './logo-square';

export type LogoPickerProps = {
	/** the logo as it is served; absent while none is stored. */
	readonly src: string | undefined;
	/**
	 * `uploading` while the route posts the square; `removing` while it takes the logo off; or the
	 * sentence of the last refusal, under the press.
	 */
	readonly state?: 'uploading' | 'removing' | { readonly refused: string } | undefined;
	/** a saved crop, cropped and resized, or refused. the route posts `blob` and moves `state`. */
	readonly onSquared: (squared: Squared) => void;
	readonly onRemove: () => void;
};

/**
 * the organisation's logo: the replace press, and between a pick and its upload the crop card the
 * operator keeps a square of the file in. Cancel posts nothing; Save crops the file to the square
 * and resizes it here (./logo-square.ts), and hands the result to the route.
 */
export function LogoPicker({ src, state, onSquared, onRemove }: LogoPickerProps) {
	const [chosen, setChosen] = useState<File | null>(null);
	const [squaring, setSquaring] = useState(false);

	// the press stays closed while `squaring` is up, so no second save starts under this one.
	const save = async (file: File, square: CropSquare) => {
		setChosen(null);
		setSquaring(true);
		const squared = await squareLogo(file, square);
		setSquaring(false);
		onSquared(squared);
	};

	return (
		<>
			<ReplacePhotoControl
				noun="logo"
				imageSrc={src}
				describe={false}
				frame="square"
				accept={LOGO_ACCEPT}
				onChosen={setChosen}
				state={squaring ? 'resizing' : state}
				onRemove={onRemove}
			/>
			{chosen === null ? null : (
				<LogoCropDialog
					file={chosen}
					onSave={(square) => save(chosen, square)}
					onCancel={() => setChosen(null)}
					onSwap={setChosen}
				/>
			)}
		</>
	);
}
