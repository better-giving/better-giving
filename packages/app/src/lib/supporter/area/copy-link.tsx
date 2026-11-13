import { useEffect, useRef, useState } from 'react';
import { SETTLE_MS } from '$lib/donate/sections/share';
import { Mark, type MarkName } from './glyph';

// Copy link: the page's address to the clipboard, and the outcome said where it can be seen and
// heard. the press reads Copied with a tick, or Couldn’t copy, for `SETTLE_MS`, as the donor page's
// share press does ($lib/donate/sections/share.tsx), and a status region beside it, rendered empty
// from the first paint, says the same, so the words arriving in it are announced. a page on plain
// http has no clipboard, so every screen drawing this press also shows the address as text.

type Outcome = 'idle' | 'copied' | 'failed';

const FACE = {
	idle: { mark: 'copy', words: 'Copy link' },
	copied: { mark: 'tick', words: 'Copied' },
	failed: { mark: 'alert', words: 'Couldn’t copy' }
} as const satisfies Record<Outcome, { mark: MarkName; words: string }>;

export function CopyLink({ url, className }: { readonly url: string; readonly className: string }) {
	const [outcome, setOutcome] = useState<Outcome>('idle');
	const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(settle.current), []);
	const copy = async () => {
		let landed: Outcome;
		try {
			await navigator.clipboard.writeText(url);
			landed = 'copied';
		} catch {
			landed = 'failed';
		}
		setOutcome(landed);
		clearTimeout(settle.current);
		settle.current = setTimeout(() => setOutcome('idle'), SETTLE_MS);
	};
	return (
		<>
			<button type="button" className={className} onClick={copy}>
				<Mark name={FACE[outcome].mark} />
				{FACE[outcome].words}
			</button>
			<span className="vh" role="status">
				{outcome === 'copied'
					? 'Copied'
					: outcome === 'failed'
						? 'Couldn’t copy the link. Select the address and copy it.'
						: null}
			</span>
		</>
	);
}
