import type { CSSProperties } from 'react';
import {
	box,
	FONT_MONO,
	PANEL_BG,
	RADIUS_PLANE,
	SPACE_2,
	SPACE_4,
	SPACE_6,
	SPACE_8
} from '../tokens';

// the labelled block a mail states a record in — the receipt's gift, the match pack's filing
// details — so two mails about one gift set their figures the same way.

/** one line of the block: a label, and a value already spelled. */
export interface RecordRow {
	readonly label: string;
	readonly value: string;
}

/**
 * the ground the block sits on, carrying no border at all. ../templates/receipt.tsx keeps the
 * heavy treatment — a border, and a heading over it — for its statutory disclosure alone, and a
 * second block matching that rule would be two blocks competing for the same eye.
 */
const PANEL_STYLE: CSSProperties = {
	margin: box(0, 0, SPACE_6),
	padding: SPACE_6,
	background: PANEL_BG,
	borderRadius: RADIUS_PLANE
};

const LEAD_STYLE: CSSProperties = { margin: box(0, 0, SPACE_4) };
const TABLE_STYLE: CSSProperties = { margin: 0, borderCollapse: 'collapse' };
const LABEL_CELL_STYLE: CSSProperties = { padding: box(0, SPACE_8, SPACE_2, 0) };
/* the values are set in the system's monospace stack, so the column reads down. the labels do not
   take it: a label set like a figure reads as another figure. a value with no space in it breaks
   inside the cell rather than widening the table past a phone; `word-break: break-word` is the
   same break for a client that predates `overflow-wrap: anywhere`. */
const VALUE_CELL_STYLE: CSSProperties = {
	padding: box(0, 0, SPACE_2),
	fontFamily: FONT_MONO,
	overflowWrap: 'anywhere',
	wordBreak: 'break-word'
};

/**
 * the block in the HTML arm: a label and its value, one row each, in the order they were decided,
 * on a tinted panel.
 *
 * a table inside the panel rather than the panel doing the work, because a background is among the
 * first things a client drops and a `<td>` is not — which is the state ./layout.tsx says an email
 * arrives in. stripped of every style this is still labelled rows; a block leaning on CSS to
 * separate them collapses into one line, where it reads as a single wrong number.
 * `role="presentation"` because it is a layout, not data with headers.
 *
 * `emphasised` is matched on the label rather than on the position, so the emphasis follows the
 * row wherever the order is edited.
 */
export function RecordPanel({
	lead,
	rows,
	emphasised
}: {
	/** a line over the rows, inside the panel, or `null` for none. */
	readonly lead: string | null;
	readonly rows: readonly RecordRow[];
	/** the labels whose values are set in bold. */
	readonly emphasised: readonly string[];
}) {
	return (
		<div style={PANEL_STYLE}>
			{lead === null ? null : <p style={LEAD_STYLE}>{lead}</p>}
			<table role="presentation" cellPadding="0" cellSpacing="0" border={0} style={TABLE_STYLE}>
				<tbody>
					{rows.map(({ label, value }) => (
						<tr key={label}>
							<td style={LABEL_CELL_STYLE}>{label}</td>
							<td style={VALUE_CELL_STYLE}>
								{emphasised.includes(label) ? <strong>{value}</strong> : value}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/**
 * the block in the text arm: one line per row, the labels padded to `width`, because this arm is
 * what gets pasted into a spreadsheet and read down, so the values have to line up when it is.
 */
export function recordLines(rows: readonly RecordRow[], width: number): string[] {
	return rows.map(({ label, value }) => `${label.padEnd(width)}${value}`);
}
