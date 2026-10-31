import { BrandMark } from '@better-giving/operator/components/status/BrandMark';
import { useEffect, useRef, useState } from 'react';
import { SHARE_CHANNEL_LABELS, SHARE_CHANNELS, shareHref } from '../../page/share';
import { Glyph } from './glyph';
import type { PageSharing } from './types';

// the share buttons every page offers, in their fixed order ($lib/page/share.ts), each a mark alone
// that carries its channel's label as its name. every one but Copy link opens that channel's own
// share page in a tab of its own; Copy link writes the page's address to the clipboard and says so
// in its name and its mark, with a status region beside it saying the same out loud.
//
// the region is cleared and written a task apart, as packages/operator's CopyControl.jsx does: a
// second press puts back the words the region already holds, and a region handed what it holds is
// announced by nobody.
//
// a network's mark is that network's own file (packages/operator's BrandMark.jsx), sized by its
// height and drawn in that network's colour; Email and Copy link draw the form's own glyphs.

type Copy = 'idle' | 'copied' | 'failed';

const COPY_WORDS: Record<Copy, string> = {
	idle: SHARE_CHANNEL_LABELS['copy-link'],
	copied: 'Link copied',
	failed: 'Couldn’t copy'
};

export function Share({
	sharing,
	heading
}: {
	readonly sharing: PageSharing;
	readonly heading: string;
}) {
	const [copy, setCopy] = useState<Copy>('idle');
	const [said, setSaid] = useState('');
	const say = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(say.current), []);

	const copyLink = async () => {
		let landed: Copy;
		try {
			await navigator.clipboard.writeText(sharing.url);
			landed = 'copied';
		} catch {
			landed = 'failed';
		}
		setCopy(landed);
		setSaid('');
		clearTimeout(say.current);
		say.current = setTimeout(() => setSaid(COPY_WORDS[landed]), 0);
	};

	return (
		<div className="page-share">
			<h2 className="page-share-heading">{heading}</h2>
			<div className="page-share-row">
				{SHARE_CHANNELS.map((channel) =>
					channel === 'copy-link' ? (
						<button
							key={channel}
							type="button"
							className="page-share-button"
							aria-label={COPY_WORDS[copy]}
							title={COPY_WORDS[copy]}
							onClick={copyLink}
						>
							<Glyph name={copy === 'copied' ? 'tick' : 'link'} className="page-share-mark" />
						</button>
					) : (
						<a
							key={channel}
							className="page-share-button"
							href={shareHref(channel, sharing)}
							target={channel === 'email' ? undefined : '_blank'}
							rel={channel === 'email' ? undefined : 'noopener noreferrer'}
							aria-label={SHARE_CHANNEL_LABELS[channel]}
							title={SHARE_CHANNEL_LABELS[channel]}
						>
							{channel === 'email' ? (
								<Glyph name="mail" className="page-share-mark" />
							) : (
								<BrandMark platform={channel} className="page-share-brand" />
							)}
						</a>
					)
				)}
			</div>
			<p className="vh" role="status">
				{said}
			</p>
		</div>
	);
}
