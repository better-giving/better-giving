import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseRichText, type RichTextDocument } from './document';
import { RichText } from './render';

// the read-only renderer: every node and mark the rule holds is drawn as its own element, and no
// string in a document is ever read as markup.

const draw = (doc: RichTextDocument) => renderToStaticMarkup(<RichText doc={doc} />);

function parsed(input: unknown): RichTextDocument {
	const result = parseRichText(input);
	if (!result.ok) throw new Error(result.message);
	return result.doc;
}

const text = (value: string, ...marks: object[]) =>
	marks.length === 0 ? { type: 'text', text: value } : { type: 'text', text: value, marks };
const para = (...content: object[]) => ({ type: 'paragraph', content });
const item = (...content: object[]) => ({ type: 'listItem', content });

describe('RichText', () => {
	it('draws every node and mark the rule holds as its own element', () => {
		const doc = parsed({
			type: 'doc',
			content: [
				para(
					text('Last winter, '),
					text('212 children', { type: 'bold' }),
					text(' came without a '),
					text('coat', { type: 'italic' }),
					text('.')
				),
				{
					type: 'bulletList',
					content: [
						item(para(text('Warm, new coats'))),
						item(para(text('Six schools')), {
							type: 'orderedList',
							content: [item(para(text('Riverbank Primary')))]
						})
					]
				},
				{
					type: 'orderedList',
					attrs: { start: 3 },
					content: [item(para(text('both', { type: 'bold' }, { type: 'italic' })))]
				}
			]
		});
		expect(draw(doc)).toBe(
			'<p>Last winter, <strong>212 children</strong> came without a <em>coat</em>.</p>' +
				'<ul><li><p>Warm, new coats</p></li>' +
				'<li><p>Six schools</p><ol><li><p>Riverbank Primary</p></li></ol></li></ul>' +
				'<ol start="3"><li><p><strong><em>both</em></strong></p></li></ol>'
		);
	});

	it('draws a link as one anchor across its runs, opening apart from the page', () => {
		const link = { type: 'link', attrs: { href: 'https://riverbanktrust.org/report' } };
		const doc = parsed({
			type: 'doc',
			content: [
				para(
					text('Read our '),
					text('annual ', link),
					text('report', link, { type: 'bold' }),
					text('.')
				)
			]
		});
		expect(draw(doc)).toBe(
			'<p>Read our <a href="https://riverbanktrust.org/report" target="_blank" rel="noopener noreferrer nofollow">annual <strong>report</strong></a>.</p>'
		);
	});

	it('draws markup inside a document as the words it is, never as elements', () => {
		const doc = parsed({
			type: 'doc',
			content: [para(text('<script>alert(1)</script><img src=x onerror=alert(1)>'))]
		});
		const holder = document.createElement('div');
		holder.innerHTML = draw(doc);
		expect(holder.querySelector('script, img')).toBeNull();
		expect(holder.textContent).toBe('<script>alert(1)</script><img src=x onerror=alert(1)>');
	});

	it('draws nothing for a paragraph with no words, the blank document included', () => {
		expect(draw(parsed({ type: 'doc', content: [{ type: 'paragraph' }] }))).toBe('');
		expect(draw(parsed({ type: 'doc', content: [para(text('  ')), para(text('Coats'))] }))).toBe(
			'<p>Coats</p>'
		);
	});
});
