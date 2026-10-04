import { useEffect, useRef, useState } from 'react';
import { SHARE_CHANNEL_LABELS, type ShareChannel, shareHref } from '../../page/share';
import { BrandMark } from './brand-mark';
import { Glyph } from './glyph';
import type { BlockOf, PageSharing } from './types';

// the organisation's share channels, in its order. every channel but Copy link opens that channel's
// own share page in a tab of its own; Copy link writes the page's address to the clipboard and says
// so on itself, with a status region beside it saying the same out loud. `icons` draws every channel
// but Copy link as its mark alone, named for what it does.
//
// the region is cleared and written a task apart, as packages/operator's CopyControl.jsx does: a
// second press puts back the words the region already holds, and a region handed what it holds is
// announced by nobody.
//
// a network's mark is ./brand-mark.tsx's; Email and Copy link draw the form's own glyphs.

const ACTIONS: Record<Exclude<ShareChannel, 'copy-link'>, string> = {
	facebook: 'Share on Facebook',
	whatsapp: 'Share on WhatsApp',
	email: 'Share by email',
	linkedin: 'Share on LinkedIn',
	x: 'Share on X'
};

type Copy = 'idle' | 'copied' | 'failed';

const COPY_WORDS: Record<Copy, string> = {
	idle: SHARE_CHANNEL_LABELS['copy-link'],
	copied: 'Link copied',
	failed: 'Couldn’t copy'
};

export function ShareBlock({
	block,
	sharing,
	heading
}: {
	readonly block: BlockOf<'share'>;
	readonly sharing: PageSharing;
	readonly heading: string;
}) {
	const [copy, setCopy] = useState<Copy>('idle');
	const [said, setSaid] = useState('');
	const say = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(say.current), []);
	const icons = block.variant === 'icons';

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
		<div>
			<h2 className="page-subheading">{heading}</h2>
			<div className="page-share-row">
				{sharing.channels.map((channel) =>
					channel === 'copy-link' ? (
						<button
							key={channel}
							type="button"
							className="page-share-button"
							data-state={copy}
							onClick={copyLink}
						>
							<Glyph name={copy === 'copied' ? 'tick' : 'link'} className="page-share-mark" />
							{/* every wording in one cell, the current one shown, so the press keeps its width */}
							<span className="page-share-words">
								{(Object.keys(COPY_WORDS) as Copy[]).map((state) => (
									<span key={state} data-shown={state === copy ? '' : undefined}>
										{COPY_WORDS[state]}
									</span>
								))}
							</span>
						</button>
					) : (
						<a
							key={channel}
							className="page-share-button"
							data-shape={icons ? 'icon' : undefined}
							href={shareHref(channel, sharing)}
							target={channel === 'email' ? undefined : '_blank'}
							rel={channel === 'email' ? undefined : 'noopener noreferrer'}
							aria-label={icons ? ACTIONS[channel] : undefined}
						>
							{channel === 'email' ? (
								<Glyph name="mail" className="page-share-mark" />
							) : (
								<BrandMark brand={channel} className="page-share-mark" />
							)}
							{icons ? null : <span>{SHARE_CHANNEL_LABELS[channel]}</span>}
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
