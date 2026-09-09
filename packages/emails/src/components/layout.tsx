import type { CSSProperties, ReactNode } from 'react';
import {
	box,
	DIVIDER,
	FONT_SANS,
	INK,
	INK_MUTED,
	LH_BODY,
	LH_HEADING,
	MEASURE,
	PAGE_BG,
	SPACE_6,
	SPACE_8,
	TEXT_BODY,
	TEXT_HEADING,
	TEXT_SMALL,
	BORDER_WIDTH
} from '../tokens';

// the html shell every template puts its body inside.
//
// one shell so the mails cannot drift, and so the decisions that are about email rather
// than about content live in one file: everything inline, nothing external, no class
// attributes. an HTML mail is rendered by clients with no `<style>` support, no external
// fetching and a `<head>` that is frequently discarded — Gmail strips the document wrapper
// outright — so a stylesheet is not a stylesheet here, it is a set of attributes that
// happens to be spelled the same way.
//
// no images, no tracking pixel, no web font, no link to this deployment. a receipt is a
// record somebody keeps for years, and every one of those is a thing that breaks, leaks a
// read, or stops resolving long before the document stops mattering. a class-based stylesheet, a
// web font, an image and a hidden preview line are the four this shell may not grow: the first
// turns styling into classes, the next two are the fetches above, and the last is a line of copy
// only the inbox list ever shows.
//
// every value here comes from ../tokens.ts, which is the operator design system converted into what
// a client renders — a hex triple and a pixel count, because a mail resolves no custom property and
// no `oklch()`. the type stacks come over whole, self-hosted first face included: a mail client
// fetches nothing, so that face is never found and the stack falls through to the platform's own,
// which is how these mails are set in the system's stack without the web font this shell may not
// grow.

/**
 * the base type styling.
 *
 * it does not all go on the `<body>` element: the background stays there and everything else sits
 * on a full-width `<td>` wrapped around the children, which is the treatment Outlook needs because
 * it drops body margins outright. so the type styling is inherited from a cell rather than from the
 * document, and it survives further for it.
 */
const BODY_STYLE: CSSProperties = {
	margin: 0,
	padding: SPACE_8,
	backgroundColor: PAGE_BG,
	color: INK,
	fontFamily: FONT_SANS,
	fontSize: TEXT_BODY,
	lineHeight: LH_BODY
};

/** what is left on the element itself: the background, and the box the cell took over zeroed. */
const DOCUMENT_STYLE: CSSProperties = {
	backgroundColor: BODY_STYLE.backgroundColor,
	margin: 0,
	padding: 0
};

/** a readable measure on a desktop client, and harmless on a phone. */
const FRAME_STYLE: CSSProperties = { maxWidth: MEASURE, margin: '0 auto' };

const FRAME_ROW_STYLE: CSSProperties = { width: '100%' };

const PARAGRAPH_STYLE: CSSProperties = { margin: box(0, 0, SPACE_6) };

const HEADING_STYLE: CSSProperties = {
	margin: box(0, 0, SPACE_6),
	fontSize: TEXT_HEADING,
	lineHeight: LH_HEADING
};

const SMALL_PRINT_STYLE: CSSProperties = {
	margin: 0,
	color: INK_MUTED,
	fontSize: TEXT_SMALL,
	lineHeight: LH_BODY
};

const DIVIDER_STYLE: CSSProperties = {
	border: 'none',
	borderTop: `${BORDER_WIDTH}px solid ${DIVIDER}`,
	margin: box(SPACE_8, 0)
};

export interface LayoutProps {
	/** the document title, which is a template's subject line — nothing else may set it. */
	readonly title: string;
	readonly children: ReactNode;
}

/** wraps a template's body in a complete document. */
export function Layout({ title, children }: LayoutProps) {
	return (
		<html dir="ltr" lang="en">
			<head>
				{/* the charset, the attribute that stops iOS resizing the type, and the viewport. */}
				<meta content="text/html; charset=UTF-8" httpEquiv="Content-Type" />
				<meta name="x-apple-disable-message-reformatting" />
				<meta name="viewport" content="width=device-width,initial-scale=1" />
				<title>{title}</title>
			</head>
			<body style={DOCUMENT_STYLE}>
				<table
					border={0}
					width="100%"
					cellPadding="0"
					cellSpacing="0"
					role="presentation"
					align="center"
				>
					<tbody>
						<tr>
							<td style={BODY_STYLE}>
								<Frame>{children}</Frame>
							</td>
						</tr>
					</tbody>
				</table>
			</body>
		</html>
	);
}

/**
 * the measure, as a centred presentation table.
 *
 * a table and not a `<div>` with a max-width: Outlook resolves neither `max-width` nor `margin:
 * auto` on a block, and a table with `align="center"` is the one centring every client agrees on.
 */
function Frame({ children }: { readonly children: ReactNode }) {
	return (
		<table
			align="center"
			width="100%"
			border={0}
			cellPadding="0"
			cellSpacing="0"
			role="presentation"
			style={FRAME_STYLE}
		>
			<tbody>
				<tr style={FRAME_ROW_STYLE}>
					<td>{children}</td>
				</tr>
			</tbody>
		</table>
	);
}

/** a paragraph of a template's body. */
export function Paragraph({ children }: { readonly children: ReactNode }) {
	return <p style={PARAGRAPH_STYLE}>{children}</p>;
}

/**
 * the line a message opens with, which is its subject over again.
 *
 * a notice states at the top what it is about, and the receipt has none: the block it prints is
 * what identifies it, and ../templates/receipt.tsx argues that absence from its own side.
 */
export function Heading({ children }: { readonly children: ReactNode }) {
	return <h1 style={HEADING_STYLE}>{children}</h1>;
}

/**
 * the small print under the rule — a closing note, or who sent the message.
 *
 * one treatment for both, because they sit in the same place on the page and a reader takes them
 * the same way: the part of the document that is not what the document is about.
 */
export function SmallPrint({ children }: { readonly children: ReactNode }) {
	return <p style={SMALL_PRINT_STYLE}>{children}</p>;
}

/** the horizontal rule the templates use to close the body off from the identity block. */
export function Divider() {
	return <hr style={DIVIDER_STYLE} />;
}
