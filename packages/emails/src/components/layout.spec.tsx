import { render } from '@react-email/render';
import { describe, expect, it } from 'vitest';
import { PAGE_BG, PLANE_BG, RADIUS_PLANE } from '../tokens';
import { Layout, Paragraph } from './layout';

/** the cell that holds a template's body, cut out by the paragraph inside it. */
function bodyCell(html: string): string {
	const at = html.indexOf('The body.');
	const open = html.lastIndexOf('<td', at);
	return html.slice(open, html.indexOf('>', open) + 1);
}

describe('Layout', () => {
	/**
	 * the operator system groups by ground, not by line: one group is one plane, a lighter ground
	 * on the page with no edge of its own and the plane's corner. a mail's body is that one group,
	 * and without the plane every block in it is set on the page's own rung and vanishes.
	 */
	it('sets the body on one plane: a ground lighter than the page, no edge, the plane corner', async () => {
		const html = await render(
			<Layout title="A subject">
				<Paragraph>The body.</Paragraph>
			</Layout>
		);
		const cell = bodyCell(html);
		expect(PLANE_BG).not.toBe(PAGE_BG);
		expect(cell).toContain(`background-color:${PLANE_BG}`);
		expect(cell).toContain(`border-radius:${RADIUS_PLANE}px`);
		expect(cell).not.toMatch(/border(-[a-z]+)?:[^;"]*solid/);
	});
});
