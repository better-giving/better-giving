/**
 * the text of the one step the markup leaves showing.
 *
 * the card draws every step and hides all but one, so the question a first paint answers is which
 * `section.step` arrives without `hidden` — not which headings appear anywhere in the html.
 */
export function shownStep(html: string): string {
	const open = [...html.matchAll(/<section class="step[^"]*"([^>]*)>/g)].filter(
		([, attributes]) => !/\shidden(=|\s|$)/.test(attributes ?? '')
	);
	const [shown] = open;
	if (shown === undefined || open.length !== 1) {
		throw new Error(`expected one shown step, found ${open.length}`);
	}
	const from = shown.index + shown[0].length;
	return html.slice(from, html.indexOf('</section>', from));
}
