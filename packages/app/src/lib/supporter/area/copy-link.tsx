import { useEffect, useRef, useState } from 'react';
import { SETTLE_MS } from '$lib/donate/sections/share';
import { Mark } from './glyph';

// Copy link: the page's address to the clipboard, and the outcome said where it can be seen and
// heard. the press reads Copied with a tick for `SETTLE_MS`, as the donor page's share press does
// ($lib/donate/sections/share.tsx), and a status region beside it, rendered empty from the first
// paint, says Copied or that it could not, so the words arriving in it are announced.

type Outcome = 'idle' | 'copied' | 'failed';

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
				<Mark name={outcome === 'copied' ? 'tick' : 'copy'} />
				{outcome === 'copied' ? 'Copied' : 'Copy link'}
			</button>
			<span className="vh" role="status">
				{outcome === 'copied' ? 'Copied' : outcome === 'failed' ? 'Couldn’t copy the link' : null}
			</span>
		</>
	);
}
