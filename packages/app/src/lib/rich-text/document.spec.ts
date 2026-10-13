import { describe, expect, it } from 'vitest';
import {
	isEmptyDocument,
	LIST_DEPTH_MAX,
	parseRichText,
	plainText,
	type RichTextDocument,
	TEXT_MAX
} from './document';

// node pool, no database: a document is JSON in, JSON out.

// what Tiptap 3.31.3's `editor.getJSON()` emits with the document, paragraph, text, bold, italic,
// list and link extensions at their defaults — link marks carry target/rel/class/title, an ordered
// list carries `type: null`.
const fromEditor = {
	type: 'doc',
	content: [
		{
			type: 'paragraph',
			content: [
				{ type: 'text', text: 'We plant ' },
				{ type: 'text', marks: [{ type: 'bold' }], text: 'trees' },
				{ type: 'text', text: ' in ' },
				{ type: 'text', marks: [{ type: 'italic' }, { type: 'bold' }], text: 'cities' },
				{ type: 'text', text: '. Read ' },
				{
					type: 'text',
					marks: [
						{
							type: 'link',
							attrs: {
								href: 'https://example.org/report',
								target: '_blank',
								rel: 'noopener noreferrer nofollow',
								class: null,
								title: null
							}
						}
					],
					text: 'the report'
				}
			]
		},
		{ type: 'paragraph' },
		{
			type: 'bulletList',
			content: [
				{
					type: 'listItem',
					content: [{ type: 'paragraph', content: [{ type: 'text', text: 'shade' }] }]
				},
				{
					type: 'listItem',
					content: [
						{ type: 'paragraph', content: [{ type: 'text', text: 'water' }] },
						{
							type: 'orderedList',
							attrs: { start: 3, type: null },
							content: [
								{
									type: 'listItem',
									content: [{ type: 'paragraph', content: [{ type: 'text', text: 'rain' }] }]
								}
							]
						}
					]
				}
			]
		}
	]
};

describe('parseRichText — what a stored document may hold', () => {
	it('passes paragraphs, bold, italic, both lists and an http(s) link', () => {
		const result = parseRichText(fromEditor);
		expect(result).toMatchObject({
			ok: true,
			doc: { content: [{ type: 'paragraph' }, { type: 'paragraph' }, { type: 'bulletList' }] }
		});
	});

	it('keeps a link to its href and an ordered list to its start, dropping what the editor adds', () => {
		// target/rel/class/title are the editor's defaults, not the operator's choice; the page
		// that renders the link sets its own.
		const result = parseRichText(fromEditor);
		if (!result.ok) throw new Error(result.message);
		const [opening, , list] = result.doc.content;
		expect(opening).toMatchObject({ type: 'paragraph' });
		expect(opening?.type === 'paragraph' && opening.content?.[5]?.marks).toEqual([
			{ type: 'link', attrs: { href: 'https://example.org/report' } }
		]);
		expect(list?.type === 'bulletList' && list.content[1]?.content[1]).toEqual({
			type: 'orderedList',
			attrs: { start: 3 },
			content: [
				{
					type: 'listItem',
					content: [{ type: 'paragraph', content: [{ type: 'text', text: 'rain' }] }]
				}
			]
		});
	});
});

const withBlock = (block: unknown) => ({
	type: 'doc',
	content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Our story' }] }, block]
});

describe('parseRichText — what it refuses, and naming it', () => {
	it('refuses a heading, naming it and where it sits', () => {
		const result = parseRichText(withBlock({ type: 'heading', attrs: { level: 2 }, content: [] }));
		expect(result).toMatchObject({
			ok: false,
			refused: 'node',
			type: 'heading',
			path: ['content', 1]
		});
		expect(!result.ok && result.message).toMatch(/heading/);
	});

	it('refuses an image inside a paragraph, naming it', () => {
		const result = parseRichText(
			withBlock({
				type: 'paragraph',
				content: [{ type: 'image', attrs: { src: 'https://example.org/a.png' } }]
			})
		);
		expect(result).toMatchObject({
			ok: false,
			refused: 'node',
			type: 'image',
			path: ['content', 1, 'content', 0]
		});
	});

	it('refuses a list item that does not open with a paragraph, as the editor would', () => {
		const result = parseRichText(
			withBlock({
				type: 'bulletList',
				content: [{ type: 'listItem', content: [{ type: 'bulletList', content: [] }] }]
			})
		);
		expect(result).toMatchObject({
			ok: false,
			type: 'bulletList',
			path: ['content', 1, 'content', 0, 'content', 0]
		});
		expect(!result.ok && result.message).toMatch(/opens with a paragraph/);
	});

	it('refuses an HTML string, whole or in place of a node', () => {
		const whole = parseRichText('<p>Our story</p>');
		expect(whole).toMatchObject({ ok: false, refused: 'node', type: null, path: [] });
		expect(!whole.ok && whole.message).toMatch(/string/);

		const inPlace = parseRichText(withBlock('<h2>Our story</h2>'));
		expect(inPlace).toMatchObject({ ok: false, type: 'doc', path: ['content', 1] });
		expect(!inPlace.ok && inPlace.message).toMatch(/string/);
	});

	it('refuses a javascript: link, naming the mark', () => {
		const result = parseRichText(
			withBlock({
				type: 'paragraph',
				content: [
					{
						type: 'text',
						text: 'click',
						marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]
					}
				]
			})
		);
		expect(result).toMatchObject({
			ok: false,
			refused: 'mark',
			type: 'link',
			path: ['content', 1, 'content', 0, 'marks', 0, 'attrs', 'href']
		});
	});

	it.each([
		' javascript:alert(1)',
		'JAVASCRIPT:alert(1)',
		'data:text/html,<script>alert(1)</script>',
		'mailto:info@example.org',
		'/about',
		'example.org'
	])('refuses a link to %j', (href) => {
		const result = parseRichText(
			withBlock({
				type: 'paragraph',
				content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href } }] }]
			})
		);
		expect(result).toMatchObject({ ok: false, refused: 'mark', type: 'link' });
	});
});

const item = (...nested: unknown[]) => ({
	type: 'listItem',
	content: [{ type: 'paragraph', content: [{ type: 'text', text: 'level' }] }, ...nested]
});
const nestedLists = (depth: number): unknown => ({
	type: 'bulletList',
	content: [depth > 1 ? item(nestedLists(depth - 1)) : item()]
});

describe('parseRichText — how large a document may grow', () => {
	it(`holds lists nested ${LIST_DEPTH_MAX} deep`, () => {
		expect(LIST_DEPTH_MAX).toBe(3);
		expect(parseRichText(withBlock(nestedLists(LIST_DEPTH_MAX))).ok).toBe(true);
	});

	it('refuses one level deeper, naming the list and the limit', () => {
		const result = parseRichText(withBlock(nestedLists(LIST_DEPTH_MAX + 1)));
		expect(result).toMatchObject({
			ok: false,
			refused: 'node',
			type: 'bulletList',
			path: [
				'content',
				1,
				'content',
				0,
				'content',
				1,
				'content',
				0,
				'content',
				1,
				'content',
				0,
				'content',
				1
			]
		});
		expect(!result.ok && result.message).toMatch(/3 deep/);
	});

	const paragraphOf = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

	it(`holds ${TEXT_MAX} characters of text`, () => {
		expect(TEXT_MAX).toBe(10_000);
		const doc = { type: 'doc', content: [paragraphOf('a'.repeat(TEXT_MAX))] };
		expect(parseRichText(doc).ok).toBe(true);
	});

	it('refuses the text that carries it past that, naming it', () => {
		const doc = {
			type: 'doc',
			content: [paragraphOf('a'.repeat(TEXT_MAX - 5)), paragraphOf('bbbbbb')]
		};
		const result = parseRichText(doc);
		expect(result).toMatchObject({
			ok: false,
			refused: 'node',
			type: 'text',
			path: ['content', 1, 'content', 0]
		});
		expect(!result.ok && result.message).toMatch(/10000 characters/);
	});

	it('counts each paragraph break, so empty paragraphs cannot pile up', () => {
		const doc = {
			type: 'doc',
			content: Array.from({ length: TEXT_MAX + 2 }, () => ({ type: 'paragraph' }))
		};
		expect(parseRichText(doc)).toMatchObject({
			ok: false,
			type: 'paragraph',
			path: ['content', TEXT_MAX + 1]
		});
	});
});

const parsed = (input: unknown): RichTextDocument => {
	const result = parseRichText(input);
	if (!result.ok) throw new Error(result.message);
	return result.doc;
};

describe('isEmptyDocument', () => {
	it("reads the editor's blank document as empty", () => {
		expect(isEmptyDocument(parsed({ type: 'doc', content: [{ type: 'paragraph' }] }))).toBe(true);
	});

	it('reads whitespace, in a paragraph or a list, as empty', () => {
		const doc = parsed({
			type: 'doc',
			content: [
				{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] },
				{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }
			]
		});
		expect(isEmptyDocument(doc)).toBe(true);
	});

	it('reads a single word inside a list as not empty', () => {
		const doc = parsed({
			type: 'doc',
			content: [
				{ type: 'paragraph' },
				{
					type: 'bulletList',
					content: [
						{
							type: 'listItem',
							content: [{ type: 'paragraph', content: [{ type: 'text', text: 'trees' }] }]
						}
					]
				}
			]
		});
		expect(isEmptyDocument(doc)).toBe(false);
	});
});

describe('plainText', () => {
	it('drops the marks, spaces the blocks, and marks list items as a reader would type them', () => {
		expect(plainText(parsed(fromEditor))).toBe(
			['We plant trees in cities. Read the report', '', '- shade', '- water', '  3. rain'].join(
				'\n'
			)
		);
	});

	it("keeps a list item's later paragraphs under it, and leaves out empty ones", () => {
		const doc = parsed({
			type: 'doc',
			content: [
				{ type: 'paragraph' },
				{
					type: 'orderedList',
					content: [
						{
							type: 'listItem',
							content: [
								{ type: 'paragraph', content: [{ type: 'text', text: 'dig' }] },
								{ type: 'paragraph' },
								{ type: 'paragraph', content: [{ type: 'text', text: 'deep' }] }
							]
						},
						{
							type: 'listItem',
							content: [{ type: 'paragraph', content: [{ type: 'text', text: 'plant' }] }]
						}
					]
				},
				{ type: 'paragraph', content: [{ type: 'text', text: 'Thank you.' }] }
			]
		});
		expect(plainText(doc)).toBe(['1. dig', '   deep', '2. plant', '', 'Thank you.'].join('\n'));
	});
});
