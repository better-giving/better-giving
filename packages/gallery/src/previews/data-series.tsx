import { Series } from '@better-giving/operator/components/data/Series';
import { StatedValue } from '@better-giving/operator/components/forms/StatedValue';

/*
 * a year of a count, drawn as a shape, in the three runs whose shapes differ.
 *
 * the first is the ordinary one: a run with a clear tallest month, and every other column its share
 * of that month. the second is the one to check — a run with empty months in it keeps their tracks
 * and hides only the bands, so the gap is a month with nothing in it rather than a column the
 * screen failed to draw. the third is a year with no gifts at all: twelve empty tracks, which is
 * an answer, where an absent shape reads as a screen that broke.
 *
 * the fourth specimen is the arrangement rather than the part: `.adm-summary` on a record card, the
 * two figures and the series side by side, which is what an /admin screen composes. it turns to one
 * column below 44rem, so narrowing the window is the state to look at.
 */

const YEAR = [4, 6, 3, 9, 12, 7, 5, 24, 11, 8, 6, 10];
const PATCHY = [0, 0, 2, 0, 5, 1, 0, 3, 0, 0, 4, 1];
const FLAT = Array<number>(12).fill(0);

export default function DataSeriesPreview() {
	return (
		<div className="adm-stack">
			<Series label="New donors, last 12 months" points={YEAR} first="Oct 2025" last="Sep 2026" />
			<Series
				label="A year with months nobody gave in"
				points={PATCHY}
				first="Oct 2025"
				last="Sep 2026"
			/>
			<Series label="A year with no gifts at all" points={FLAT} first="Oct 2025" last="Sep 2026" />
			<div className="adm-record adm-summary">
				<StatedValue label="Total donors" value="1,284" />
				<StatedValue label="New this month" value="37" />
				<Series label="New donors, last 12 months" points={YEAR} first="Oct 2025" last="Sep 2026" />
			</div>
		</div>
	);
}
