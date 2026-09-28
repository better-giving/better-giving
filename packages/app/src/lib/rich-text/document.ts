// the one rule for a rich-text document: the Tiptap JSON an operator's editor emits, parsed on
// the way into the database and again on the way out, so a stored document is never trusted for
// having been written by us.
//
// what a document may hold: paragraphs of text marked bold, italic or linked, and bulleted and
// numbered lists of those paragraphs. nothing else — no heading, no image, no HTML. node and mark
// names are Tiptap 3's own (`@tiptap/extension-list`'s `bulletList`, `orderedList`, `listItem`),
// because the stored JSON is what the editor loads back.
//
// not under `$lib/server/**`, because a component may import it: the type it infers is the one a
// renderer walks. it imports nothing but zod.
//
// what the parse keeps is the parsed value, never the input. attrs the editor adds of its own
// accord — a link's target, rel, class and title, an ordered list's `type` — are stripped, and
// whatever renders a link sets its own. a link's href is an absolute http or https address, read by
// `URL` rather than by pattern, so a `javascript:` or `data:` address is refused however it is
// spelled.
//
// the body behind this is whatever anyone posts, so its size is bounded twice: lists nest at most
// `LIST_DEPTH_MAX` deep, built level by level below so a deeper body is refused by its shape
// rather than walked, and the text is capped at `TEXT_MAX` with each paragraph break counting as a
// character, so a pile of empty paragraphs is bounded too.
import { z } from 'zod';

export const LIST_DEPTH_MAX = 3;
export const TEXT_MAX = 10_000;

const bold = z.object({ type: z.literal('bold') });
const italic = z.object({ type: z.literal('italic') });
const link = z.object({
	type: z.literal('link'),
	attrs: z.object({
		href: z.string().refine(isWebAddress, 'a link goes to an http or https address')
	})
});
const mark = z.discriminatedUnion('type', [bold, italic, link], {
	error: notAllowed('as a mark', 'bold, italic and link are')
});

const text = z.object({
	type: z.literal('text'),
	text: z.string().min(1),
	marks: z.array(mark).optional()
});

const paragraph = z.object({
	type: z.literal('paragraph'),
	content: z
		.array(
			z.discriminatedUnion('type', [text], {
				error: notAllowed('in a paragraph', 'it holds text only')
			})
		)
		.optional()
});

// a list item opens with a paragraph, as Tiptap's own `listItem` content expression requires.
function listsHolding<Child extends z.ZodType>(child: Child) {
	const opening = z.discriminatedUnion('type', [paragraph], {
		error: notAllowed('first in a list item', 'a list item opens with a paragraph')
	});
	const listItem = z.object({ type: z.literal('listItem'), content: z.tuple([opening], child) });
	const items = z
		.array(
			z.discriminatedUnion('type', [listItem], {
				error: notAllowed('in a list', 'it holds list items')
			})
		)
		.min(1);
	return [
		z.object({ type: z.literal('bulletList'), content: items }),
		z.object({
			type: z.literal('orderedList'),
			attrs: z.object({ start: z.int().positive().optional() }).optional(),
			content: items
		})
	] as const;
}

// `LIST_DEPTH_MAX` levels, innermost first.
const deepest = listsHolding(
	z.discriminatedUnion('type', [paragraph], {
		error: (issue) =>
			isTyped(issue.input) && isListType(issue.input.type)
				? `lists nest at most ${LIST_DEPTH_MAX} deep`
				: notAllowed('in a list item', 'it holds paragraphs')(issue)
	})
);
const inListItem = notAllowed(
	'in a list item',
	'it holds paragraphs, bulleted lists and numbered lists'
);
const middle = listsHolding(
	z.discriminatedUnion('type', [paragraph, ...deepest], { error: inListItem })
);
const top = listsHolding(
	z.discriminatedUnion('type', [paragraph, ...middle], { error: inListItem })
);

export const richTextDocument = z
	.object(
		{
			type: z.literal('doc'),
			content: z
				.array(
					z.discriminatedUnion('type', [paragraph, ...top], {
						error: notAllowed(
							'in a document',
							'it holds paragraphs, bulleted lists and numbered lists'
						)
					})
				)
				.min(1)
		},
		{
			error: (issue) =>
				`a document is Tiptap JSON, an object of type "doc", not ${describe(issue.input)}`
		}
	)
	.check((ctx) => {
		let length = 0;
		let paragraphs = 0;
		const over = (path: Path) => {
			ctx.issues.push({
				code: 'custom',
				message: `a document holds at most ${TEXT_MAX} characters, a paragraph break counting as one`,
				input: ctx.value,
				path
			});
		};
		for (const { paragraph, path } of paragraphsIn(ctx.value.content, ['content'])) {
			if (paragraphs++ > 0) length += 1;
			if (length > TEXT_MAX) return over(path);
			for (const [index, { text }] of (paragraph.content ?? []).entries()) {
				length += text.length;
				if (length > TEXT_MAX) return over([...path, 'content', index]);
			}
		}
	});

export type RichTextDocument = z.infer<typeof richTextDocument>;
type Block = RichTextDocument['content'][number];
type Paragraph = Extract<Block, { type: 'paragraph' }>;
type Path = (string | number)[];

export type RichTextRefusal = {
	ok: false;
	refused: 'node' | 'mark';
	/** the refused node's or mark's own `type`; null where the refused value is not a node at all */
	type: string | null;
	/** where in the input the refusal lands, as keys and indexes from the document's root */
	path: Path;
	message: string;
};

export function parseRichText(
	input: unknown
): { ok: true; doc: RichTextDocument } | RichTextRefusal {
	const result = richTextDocument.safeParse(input);
	if (result.success) return { ok: true, doc: result.data };
	const issue = result.error.issues[0];
	if (issue === undefined) throw result.error;
	const path = issue.path.filter((key): key is string | number => typeof key !== 'symbol');
	// a discriminated union files an unknown `type` under the key itself; the refusal is the node
	if (path.at(-1) === 'type') path.pop();
	const owner = nearestTyped(input, path);
	return {
		ok: false,
		refused: owner.isMark ? 'mark' : 'node',
		type: owner.type,
		path,
		message: issue.message
	};
}

/**
 * words typed into a plain box, as a document: each line holding words a paragraph of its own, in
 * order, its text untouched. what `plainText` gives back for it is what was typed, where paragraphs
 * were a blank line apart. the length is unchecked — `parseRichText` is what bounds it.
 */
export function textDocument(text: string): RichTextDocument {
	const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
	return {
		type: 'doc',
		content:
			lines.length === 0
				? [{ type: 'paragraph' }]
				: lines.map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] }))
	};
}

/** true when no text in the document holds anything but whitespace — the editor's blank state included */
export function isEmptyDocument(doc: RichTextDocument): boolean {
	for (const { paragraph } of paragraphsIn(doc.content, [])) {
		if (paragraph.content?.some(({ text }) => text.trim() !== '')) return false;
	}
	return true;
}

/**
 * the words alone, for a prompt or a share: blocks a blank line apart, a list item on a line of its
 * own under `- ` or its number, and an empty paragraph or item left out.
 */
export function plainText(doc: RichTextDocument): string {
	return doc.content
		.map((block) => linesOf(block, '').join('\n'))
		.filter((text) => text !== '')
		.join('\n\n');
}

function linesOf(block: Block, indent: string): string[] {
	if (block.type === 'paragraph') {
		const text = (block.content ?? []).map(({ text }) => text).join('');
		return text.trim() === '' ? [] : [indent + text];
	}
	const start = block.type === 'orderedList' ? (block.attrs?.start ?? 1) : 1;
	return block.content.flatMap((item, index) => {
		const marker = block.type === 'orderedList' ? `${start + index}. ` : '- ';
		const under = indent + ' '.repeat(marker.length);
		const [first, ...rest] = item.content.flatMap((child) => linesOf(child, under));
		return first === undefined ? [] : [indent + marker + first.slice(under.length), ...rest];
	});
}

function* paragraphsIn(
	blocks: readonly Block[],
	path: Path
): Generator<{ paragraph: Paragraph; path: Path }> {
	for (const [index, block] of blocks.entries()) {
		if (block.type === 'paragraph') {
			yield { paragraph: block, path: [...path, index] };
			continue;
		}
		for (const [itemIndex, item] of block.content.entries()) {
			yield* paragraphsIn(item.content, [...path, index, 'content', itemIndex, 'content']);
		}
	}
}

function nearestTyped(input: unknown, path: Path) {
	let owner: { type: string | null; isMark: boolean } = { type: null, isMark: false };
	let value = input;
	for (let depth = 0; ; depth++) {
		if (isTyped(value)) owner = { type: value.type, isMark: path[depth - 2] === 'marks' };
		const key = path[depth];
		if (key === undefined || value === null || typeof value !== 'object') return owner;
		value = (value as Record<string | number, unknown>)[key];
	}
}

function isWebAddress(href: string) {
	if (!URL.canParse(href)) return false;
	const { protocol } = new URL(href);
	return protocol === 'http:' || protocol === 'https:';
}

function isListType(type: string) {
	return type === 'bulletList' || type === 'orderedList';
}

function isTyped(value: unknown): value is { type: string } {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { type?: unknown }).type === 'string'
	);
}

function describe(input: unknown) {
	if (typeof input === 'string') return 'a string, and HTML is refused';
	if (input === null) return 'null';
	if (Array.isArray(input)) return 'an array';
	return typeof input === 'object' ? 'an object' : `a ${typeof input}`;
}

function notAllowed(where: string, allowed: string) {
	return (issue: { input?: unknown }) =>
		isTyped(issue.input)
			? `"${issue.input.type}" is not allowed ${where}; ${allowed}`
			: `expected a node ${where}, not ${describe(issue.input)}`;
}
