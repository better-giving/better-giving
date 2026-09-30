import { useEffect, useState } from 'react';

// words a screen arrives already holding — an add or a delete pressed on another page, carried
// over by a flash — written into a status line only once that line has been painted empty. a live
// region announces what changes inside it; one whose words land in the same frame it mounts in can
// be taken as born holding them, and announced by nobody.
//
// two frames: a callback of the first runs before the paint that first draws the line, and the
// second runs after it.

/** `words`, withheld as null until the line they go in has been through one painted frame. */
export function useAfterPaint(words: string | null): string | null {
	const [said, say] = useState<string | null>(null);
	useEffect(() => {
		let second = 0;
		const first = requestAnimationFrame(() => {
			second = requestAnimationFrame(() => say(words));
		});
		return () => {
			cancelAnimationFrame(first);
			cancelAnimationFrame(second);
		};
	}, [words]);
	return said;
}
