import type { RichTextDocument } from '../../rich-text/document';
import { RichText } from '../../rich-text/render';

// the page's story, as its rich text holds it. it carries no heading of its own.

export function Story({ doc }: { readonly doc: RichTextDocument }) {
	return (
		<div className="page-prose">
			<RichText doc={doc} />
		</div>
	);
}
