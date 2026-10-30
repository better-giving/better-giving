import { render } from '@react-email/render';
import { describe, expect, it } from 'vitest';
import { MEASURE, PAGE_BG, PLANE_BG, RADIUS_PLANE, SPACE_6 } from '../tokens';
import { Layout, Paragraph } from './layout';

function rendered() {
	return render(
		<Layout title="A subject">
			<Paragraph>The body.</Paragraph>
		</Layout>
	);
}

/** the opening tag of the measure's table: the one element in the shell that states a max-width. */
function frameTable(html: string): string {
	const open = html.lastIndexOf('<table', html.indexOf(`max-width:${MEASURE}px`));
	return html.slice(open, html.indexOf('>', open) + 1);
}

/** the plane: the first cell inside the measure's table, however the body nests under it. */
function bodyCell(html: string): string {
	const open = html.indexOf('<td', html.indexOf(`max-width:${MEASURE}px`));
	return html.slice(open, html.indexOf('>', open) + 1);
}

describe('Layout', () => {
	/**
	 * the operator system groups by ground, not by line: one group is one plane, a ground a rung off
	 * the page with no edge of its own and the plane's corner. a mail's body is that one group,
	 * and without the plane every block in it is set on the page's own rung and vanishes.
	 */
	it('sets the body on one plane: a ground a rung off the page, no edge, the plane corner', async () => {
		const html = await rendered();
		const cell = bodyCell(html);
		// --admin-surface is --admin-neutral-2 in packages/operator/src/styles/tokens.css, converted.
		expect(PLANE_BG).toBe('#f9fbfc');
		expect(PLANE_BG).not.toBe(PAGE_BG);
		expect(html.indexOf(cell)).toBeLessThan(html.indexOf('The body.'));
		expect(cell).toContain(`background-color:${PLANE_BG}`);
		expect(cell).toContain(`border-radius:${RADIUS_PLANE}px`);
		expect(cell).not.toMatch(/border(-[a-z]+)?:[^;"]*solid/);
	});

	/**
	 * Outlook for Windows ignores `max-width`, so a table sized by the style alone fills its reading
	 * pane. the width attribute is what it honours; every other client caps on the style and still
	 * shrinks to a phone, since `width:100%` in the style outranks the attribute.
	 */
	it('holds the measure as a width attribute and still shrinks on a phone', async () => {
		const table = frameTable(await rendered());
		expect(MEASURE).toBe(544);
		expect(table).toContain(`width="${MEASURE}"`);
		expect(table).toContain('width:100%');
		expect(table).toContain(`max-width:${MEASURE}px`);
	});

	/**
	 * no `<style>` reaches a mail, so the plane's inset is the one value a phone gets too: on a 360px
	 * screen the page gutter and the plane's padding are both taken out of the body column twice.
	 */
	it('insets the plane by the page gutter, not more', async () => {
		const cell = bodyCell(await rendered());
		expect(SPACE_6).toBe(16);
		expect(cell).toMatch(new RegExp(`padding:${SPACE_6}px[;"]`));
	});
});
