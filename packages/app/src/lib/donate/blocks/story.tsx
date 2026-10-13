import { isEmptyDocument, type RichTextDocument } from '../../rich-text/document';
import { RichText } from '../../rich-text/render';
import type { BlockOf } from './types';

// the page's story. `lede` draws its first paragraph at lede size; `split` stands that first
// paragraph in a column of its own beside the rest, since a story carries no heading of its own.

export function StoryBlock({ block }: { readonly block: BlockOf<'story'> }) {
	if (block.variant !== 'split') {
		return (
			<div className="page-story" data-variant={block.variant}>
				<div className="page-prose">
					<RichText doc={block.body} />
				</div>
			</div>
		);
	}
	const content = block.body.content;
	const at = content.findIndex((part) => !isEmptyDocument(doc([part])));
	return (
		<div className="page-story" data-variant="split">
			<div className="page-story-lead">
				<RichText doc={doc(content.slice(at, at + 1))} />
			</div>
			<div className="page-prose">
				<RichText doc={doc(content.slice(at + 1))} />
			</div>
		</div>
	);
}

const doc = (content: RichTextDocument['content']): RichTextDocument => ({ type: 'doc', content });
