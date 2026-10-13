import { Fragment, type ReactNode } from 'react';
import type { RichTextDocument } from './document';

// a rich-text document drawn as the elements it names — `p`, `ul`, `ol`, `li`, `strong`, `em`, `a`
// — built as react elements from the parsed value, so no string of the document is ever read as
// markup. it wears no class: the operator's editor and the donor page's blocks each dress these
// elements from their own sheet, and the two design systems never meet (CLAUDE.md).
//
// a paragraph holding no text draws nothing: the editor's blank lines are how an operator spaces
// what they type, and the page reading this spaces its blocks itself.
//
// a link opens in a tab of its own and hands the page it reaches no referrer and no opener, and
// nothing it points at is vouched for by this site's ranking.

type Block = RichTextDocument['content'][number];
type Paragraph = Extract<Block, { type: 'paragraph' }>;
type Text = NonNullable<Paragraph['content']>[number];
type List = Exclude<Block, Paragraph>;

export function RichText({ doc }: { doc: RichTextDocument }) {
	return <>{blocks(doc.content)}</>;
}

function blocks(content: readonly Block[]): ReactNode[] {
	return content.map((block, index) =>
		block.type === 'paragraph' ? paragraph(block, index) : list(block, index)
	);
}

function paragraph(block: Paragraph, key: number) {
	const runs = block.content ?? [];
	if (runs.every(({ text }) => text.trim() === '')) return null;
	return <p key={key}>{inline(runs)}</p>;
}

function list(block: List, key: number) {
	const items = block.content.map((item, index) => <li key={index}>{blocks(item.content)}</li>);
	if (block.type === 'bulletList') return <ul key={key}>{items}</ul>;
	const start = block.attrs?.start;
	return (
		<ol key={key} start={start === undefined || start === 1 ? undefined : start}>
			{items}
		</ol>
	);
}

/** a paragraph's runs, with neighbouring runs under the same address drawn as one link. */
function inline(runs: readonly Text[]): ReactNode[] {
	const drawn: ReactNode[] = [];
	let index = 0;
	while (index < runs.length) {
		const href = hrefOf(runs[index]);
		if (href === undefined) {
			drawn.push(styled(runs[index], index));
			index += 1;
			continue;
		}
		const first = index;
		const linked: ReactNode[] = [];
		while (index < runs.length && hrefOf(runs[index]) === href) {
			linked.push(styled(runs[index], index));
			index += 1;
		}
		drawn.push(
			<a key={first} href={href} target="_blank" rel="noopener noreferrer nofollow">
				{linked}
			</a>
		);
	}
	return drawn;
}

function hrefOf(run: Text | undefined) {
	return run?.marks?.find((mark) => mark.type === 'link')?.attrs.href;
}

function styled(run: Text | undefined, key: number): ReactNode {
	if (run === undefined) return null;
	const marks = new Set(run.marks?.map(({ type }) => type));
	let node: ReactNode = run.text;
	if (marks.has('italic')) node = <em>{node}</em>;
	if (marks.has('bold')) node = <strong>{node}</strong>;
	return <Fragment key={key}>{node}</Fragment>;
}
