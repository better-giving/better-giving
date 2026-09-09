import { render } from '@react-email/render';
import { describe, expect, it } from 'vitest';

// proves the pool: a template is jsx, rendered to a string by react-dom's server renderer, and
// nothing here needs a document to do it. the check that the render path itself — jsx in, html and
// plain text out — resolves under this package's own tsconfig and vitest pool, with nothing a
// template says in the way.
describe('render', () => {
	const element = (
		<html lang="en">
			<body>
				<p>hi</p>
			</body>
		</html>
	);

	it('renders to html', async () => {
		const html = await render(element);
		expect(html).toContain('hi');
	});

	it('renders to plain text', async () => {
		const text = await render(element, { plainText: true });
		expect(text.trim()).toBe('hi');
	});
});
