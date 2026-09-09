/**
 * @import { ReactNode } from 'react'
 */

/**
 * @typedef {object} SeriesProps
 * @property {ReactNode} label what the run is a count of. it is drawn as a stated value's label
 *   because that is what it is — a series is a stated figure whose value is a shape.
 * @property {readonly number[]} points one count per period, oldest first. a caller draws twelve
 *   months of one; nothing here says twelve, and the shape is whatever it was handed.
 * @property {string} first the label under the first column, already formatted — 'Oct 2025'. never
 *   a `Date`: which month a count belongs to is settled where the count is read, and a screen that
 *   formats one has a second answer to what month it is.
 * @property {string} last the label under the last column, on the same terms.
 */

/* a filled band per month, which is what ../../styles/adm.css draws it as. only the
   two ends of the run are labelled: a number over every bar is the figure repeated twelve times,
   and the stated values standing beside this in a summary card are where a number is read. */
/** @param {SeriesProps} props */
export function Series({ label, points, first, last }) {
	// the tallest month is the whole plot and every other is its share of that month, so the shape
	// is the counts against each other rather than against a figure stated anywhere. a floor of one
	// is what a year with no gifts in it divides by: every share is then nought, which draws the
	// flat run the tracks below are there for.
	const top = Math.max(...points, 1);
	return (
		<div className="adm-series">
			<span className="adm-stated__label">{label}</span>
			<div className="adm-series__plot">
				{points.map((count, month) => (
					// a month's place in the run is its identity — the third column is the third
					// month whatever the count in it — so the index is the key rather than a stand-in
					// for one.
					<div className="adm-series__col" key={month}>
						{/* the track stays and the band inside it goes: a column dropped for an empty
						    month is a gap in the run, and the run is what says which month is which. */}
						<div
							className="adm-series__fill"
							style={{ blockSize: `${Math.round((count / top) * 100)}%` }}
							hidden={count === 0}
						/>
					</div>
				))}
			</div>
			<div className="adm-series__months">
				<span className="adm-caption">{first}</span>
				<span className="adm-caption">{last}</span>
			</div>
		</div>
	);
}
