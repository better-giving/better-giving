import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { type Resized, resizeImage } from '@better-giving/operator/images/resize';

export type PhotoPickerOptions =
	| {
			readonly onPicked?: ((file: File) => void) | undefined;
			readonly onResized: (result: Resized) => void;
			readonly onChosen?: undefined;
			readonly accept?: undefined;
	  }
	| {
			readonly onChosen: (file: File) => void;
			/** the file chooser's `accept`, the types the step after the pick takes. */
			readonly accept: string;
			readonly onPicked?: undefined;
			readonly onResized?: undefined;
	  };

/**
 * the device's own file picker behind a press, and the resize of whatever it hands back.
 * `field` is the hidden input the press opens and is rendered beside it; `open` is the press.
 *
 * `choosing` is up while the picker is open, and comes down when it hands back a file or is
 * cancelled. `resizing` is up from the pick until its result is reported. only the latest pick is
 * reported: a photo chosen while an earlier one is still resizing replaces it, and the earlier
 * result goes nowhere.
 *
 * with `onChosen` the file is handed over as chosen and nothing is resized here: the caller has a
 * step of its own between the pick and the resize (the logo's crop,
 * ./settings/logo-picker.tsx), and `resizing` stays down.
 */
export function usePhotoPicker(options: PhotoPickerOptions) {
	const input = useRef<HTMLInputElement>(null);
	const latest = useRef<File | null>(null);
	const [choosing, setChoosing] = useState(false);
	const [resizing, setResizing] = useState(false);

	// `cancel` is the picker closed with nothing chosen. react does not listen for it on an input.
	useEffect(() => {
		const element = input.current;
		if (element === null) return;
		const closed = () => setChoosing(false);
		element.addEventListener('cancel', closed);
		return () => element.removeEventListener('cancel', closed);
	}, []);

	const pick = async (event: ChangeEvent<HTMLInputElement>) => {
		setChoosing(false);
		const file = event.currentTarget.files?.[0];
		// cleared so choosing the same file again is still a change.
		event.currentTarget.value = '';
		if (file === undefined) return;
		if (options.onChosen !== undefined) {
			options.onChosen(file);
			return;
		}
		latest.current = file;
		setResizing(true);
		options.onPicked?.(file);
		const result = await resizeImage(file);
		if (latest.current !== file) return;
		setResizing(false);
		options.onResized(result);
	};

	const open = () => {
		setChoosing(true);
		input.current?.click();
	};

	const field = (
		<input ref={input} type="file" accept={options.accept ?? 'image/*'} hidden onChange={pick} />
	);

	return { field, open, choosing, resizing };
}
