import { BrandMark } from '@better-giving/operator/components/status/BrandMark';
import { useEffect, useRef, useState } from 'react';
import { SHARE_CHANNEL_LABELS, SHARE_CHANNELS, shareHref } from '../../page/share';
import type { GlyphName } from '@better-giving/form/glyph';
import { Glyph } from './glyph';
import type { PageSharing } from './types';

// the share buttons every page offers, in their fixed order ($lib/page/share.ts), each a mark alone
// that carries its channel's label as its name. a network's press opens that network's share page
// in a new tab, and its name says so, as the footer's social marks do; Email opens a mail draft.
// Copy link writes the page's address to the clipboard and reports the outcome on one channel each.
// a copy is said in the press's own name, Link copied, with a tick for its mark, since a focused
// control's new name is spoken. a refusal keeps the name Copy link — the press still does what it
// says — and is said in a polite status region instead, rendered empty from the first paint so the
// words arriving in it are announced, with the alert mark in the refusal's red; naming the press
// for the refusal as well would be heard twice. it settles back after `SETTLE_MS`, so a later visit
// meets the press and not a past outcome.
//
// the heading carries `headingId`, the name of the section the caller stands this in.
//
// a network's mark is that network's own file (packages/operator's BrandMark.jsx), sized by its
// height and drawn in that network's colour; Email and Copy link draw the form's own glyphs.

type Copy = 'idle' | 'copied' | 'failed';

const COPY_MARK = { idle: 'link', copied: 'tick', failed: 'alert' } as const satisfies Record<
	Copy,
	GlyphName
>;

const COPY_NAME: Record<Copy, string> = {
	idle: SHARE_CHANNEL_LABELS['copy-link'],
	copied: 'Link copied',
	failed: SHARE_CHANNEL_LABELS['copy-link']
};

const REFUSED_WORDS = 'Couldn’t copy';

/** how long Copy link holds its outcome, as packages/operator's CopyControl.jsx holds its own. */
export const SETTLE_MS = 2000;

export function Share({
	sharing,
	heading,
	headingId
}: {
	readonly sharing: PageSharing;
	readonly heading: string;
	readonly headingId: string;
}) {
	const [copy, setCopy] = useState<Copy>('idle');
	const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(settle.current), []);

	const copyLink = async () => {
		let landed: Copy;
		try {
			await navigator.clipboard.writeText(sharing.url);
			landed = 'copied';
		} catch {
			landed = 'failed';
		}
		setCopy(landed);
		clearTimeout(settle.current);
		settle.current = setTimeout(() => setCopy('idle'), SETTLE_MS);
	};

	return (
		<div className="page-share">
			<h2 className="page-share-heading" id={headingId}>
				{heading}
			</h2>
			<div className="page-share-row">
				{SHARE_CHANNELS.map((channel) =>
					channel === 'copy-link' ? (
						<button
							key={channel}
							type="button"
							className="page-share-button"
							data-copy={copy}
							aria-label={COPY_NAME[copy]}
							title={COPY_NAME[copy]}
							onClick={copyLink}
						>
							<Glyph name={COPY_MARK[copy]} className="page-share-mark" />
						</button>
					) : channel === 'email' ? (
						<a
							key={channel}
							className="page-share-button"
							href={shareHref(channel, sharing)}
							aria-label={SHARE_CHANNEL_LABELS[channel]}
							title={SHARE_CHANNEL_LABELS[channel]}
						>
							<Glyph name="mail" className="page-share-mark" />
						</a>
					) : (
						<a
							key={channel}
							className="page-share-button"
							href={shareHref(channel, sharing)}
							target="_blank"
							rel="noopener noreferrer"
							aria-label={`${SHARE_CHANNEL_LABELS[channel]}, opens in a new tab`}
							title={SHARE_CHANNEL_LABELS[channel]}
						>
							<BrandMark platform={channel} className="page-share-brand" />
						</a>
					)
				)}
			</div>
			<p className="vh" role="status">
				{copy === 'failed' ? REFUSED_WORDS : ''}
			</p>
		</div>
	);
}
