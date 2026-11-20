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
	OUTLOOK_MONO,
	OUTLOOK_SANS,
	PAGE_BG,
	PLANE_BG,
	RADIUS_PLANE,
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
// every value here comes from ../tokens.ts, which holds the operator design system as a client
// renders it — a hex triple, checked, and a pixel count, converted — because a mail resolves no
// custom property and no colour function. the type stacks come over whole, self-hosted first face
// included, and no web font is linked for it: a client that walks the list sets the platform's own
// face. Outlook for Windows reads the first name alone and would set Times New Roman, so the head
// carries an Outlook-only block naming Arial and Consolas (OUTLOOK_FONT_BLOCK below): two system
// faces, no web font, no link, and no other client reads it.

/**
 * the one `<style>` this shell carries, read by Outlook for Windows and no other client: the
 * conditional comment hides it from everything but Word's engine. that engine takes the first name
 * of an inline `font-family` list and sets Times New Roman when it is not installed, so the inline
 * list stays as it is for every other client and this block sets a system face over it, with
 * `!important` because an inline declaration outranks a sheet otherwise. the second rule is for
 * `<code>` and `<pre>`; a cell the templates set in the mono stack takes the sans face here, since
 * Word's selectors reach elements and not inline values. `mso-font-alt` states the same face for
 * Word's own substitution. it names two system faces and links nothing.
 */
const OUTLOOK_FONT_BLOCK =
	'<!--[if mso]><style>' +
	'body,table,td,th,p,h1,h2,h3,div,span,a,li{' +
	`font-family:${OUTLOOK_SANS} !important;mso-font-alt:Arial;}` +
	'code,pre{' +
	`font-family:${OUTLOOK_MONO} !important;mso-font-alt:'Courier New';}` +
	'</style><![endif]-->';

/** the text a node would escape, for the one string the head is written as. */
function escapeHtml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#x27;');
}

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
	padding: SPACE_6,
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

/**
 * the measure where a client reads `max-width`, and the full width of a phone narrower than it.
 * Outlook for Windows ignores `max-width`, and holds the measure from the table's `width` attribute.
 */
const FRAME_STYLE: CSSProperties = { width: '100%', maxWidth: MEASURE, margin: '0 auto' };

const FRAME_ROW_STYLE: CSSProperties = { width: '100%' };

/**
 * the plane the body is set on: one group, so one plane, a ground a step off the page with the
 * step-6 edge every operator plane draws and no shadow. a client that drops the radius draws it
 * square. a client that drops the background still draws the edge, and the blocks on the plane keep
 * their own grounds.
 *
 * the padding is the page gutter's step: no `<style>` reaches a mail, so a phone gets this inset too,
 * and it comes out of the body column on both sides.
 */
const PLANE_STYLE: CSSProperties = {
	padding: SPACE_6,
	backgroundColor: PLANE_BG,
	border: `${BORDER_WIDTH}px solid ${DIVIDER}`,
	borderRadius: RADIUS_PLANE
};

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
			{/* the head is a string because a conditional comment is not a node react can write. */}
			<head
				dangerouslySetInnerHTML={{
					__html:
						// the charset, the attribute that stops iOS resizing the type, and the viewport.
						'<meta content="text/html; charset=UTF-8" http-equiv="Content-Type"/>' +
						'<meta name="x-apple-disable-message-reformatting"/>' +
						'<meta name="viewport" content="width=device-width,initial-scale=1"/>' +
						`<title>${escapeHtml(title)}</title>` +
						OUTLOOK_FONT_BLOCK
				}}
			/>
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
 * the measure, as a centred presentation table, and the plane inside it.
 *
 * a table and not a `<div>` with a max-width: Outlook resolves neither `max-width` nor `margin:
 * auto` on a block. it does honour a table's `width` attribute and `align="center"`, so the measure
 * is stated twice: the attribute for Outlook, and the style, which outranks the attribute everywhere
 * else and lets the table shrink to a phone.
 */
function Frame({ children }: { readonly children: ReactNode }) {
	return (
		<table
			align="center"
			width={MEASURE}
			border={0}
			cellPadding="0"
			cellSpacing="0"
			role="presentation"
			style={FRAME_STYLE}
		>
			<tbody>
				<tr style={FRAME_ROW_STYLE}>
					<td style={PLANE_STYLE}>{children}</td>
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
