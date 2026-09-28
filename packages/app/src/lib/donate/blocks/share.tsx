import { useState } from 'react';
import { SHARE_CHANNEL_LABELS, type ShareChannel, shareHref } from '../../page/share';
import { Glyph } from './glyph';
import type { BlockOf, PageSharing } from './types';

// the organisation's share channels, in its order. every channel but Copy link opens that channel's
// own share page in a tab of its own; Copy link writes the page's address to the clipboard and says
// so on itself, with a status region beside it saying the same out loud. `icons` draws every
// channel but Copy link as its mark alone, named for what it does.
//
// the networks' marks are lettered stand-ins: no set in this repository carries brand marks.

const STAND_INS: Record<Exclude<ShareChannel, 'email' | 'copy-link'>, string> = {
	facebook: 'f',
	whatsapp: 'w',
	linkedin: 'in',
	x: 'x'
};

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
	const icons = block.variant === 'icons';

	const copyLink = async () => {
		try {
			await navigator.clipboard.writeText(sharing.url);
			setCopy('copied');
		} catch {
			setCopy('failed');
		}
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
								<span className="page-share-mark page-share-stand-in" aria-hidden="true">
									{STAND_INS[channel]}
								</span>
							)}
							{icons ? null : <span>{SHARE_CHANNEL_LABELS[channel]}</span>}
						</a>
					)
				)}
			</div>
			<p className="vh" role="status">
				{copy === 'idle' ? '' : COPY_WORDS[copy]}
			</p>
		</div>
	);
}
