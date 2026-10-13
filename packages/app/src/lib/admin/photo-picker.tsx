import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { type Resized, resizeImage } from '@better-giving/operator/images/resize';

/**
 * the device's own file picker behind a press, and the resize of whatever it hands back.
 * `field` is the hidden input the press opens and is rendered beside it; `open` is the press.
 *
 * `choosing` is up while the picker is open, and comes down when it hands back a file or is
 * cancelled. `resizing` is up from the pick until its result is reported. only the latest pick is
 * reported: a photo chosen while an earlier one is still resizing replaces it, and the earlier
 * result goes nowhere.
 */
export function usePhotoPicker({
	onPicked,
	onResized
}: {
	onPicked?: ((file: File) => void) | undefined;
	onResized: (result: Resized) => void;
}) {
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
		latest.current = file;
		setResizing(true);
		onPicked?.(file);
		const result = await resizeImage(file);
		if (latest.current !== file) return;
		setResizing(false);
		onResized(result);
	};

	const open = () => {
		setChoosing(true);
		input.current?.click();
	};

	const field = <input ref={input} type="file" accept="image/*" hidden onChange={pick} />;

	return { field, open, choosing, resizing };
}
