import { RichText } from '../../rich-text/render';
import { Glyph } from './glyph';
import type { BlockOf } from './types';

// questions a donor asks before giving. `accordion` opens one answer at a time, the first to begin
// with; `open` states them all.

export function FaqBlock({
	block,
	domId
}: {
	readonly block: BlockOf<'faq'>;
	readonly domId: string;
}) {
	return (
		<div className="page-faq" data-variant={block.variant}>
			<h2 className="page-heading">Questions</h2>
			<div className="page-faq-items">
				{block.items.map((item, index) =>
					block.variant === 'accordion' ? (
						<details className="page-faq-item" name={`${domId}-faq`} open={index === 0} key={index}>
							<summary className="page-faq-question">
								<span>{item.question}</span>
								<Glyph name="chevron" className="page-faq-mark" />
							</summary>
							<div className="page-faq-answer">
								<RichText doc={item.answer} />
							</div>
						</details>
					) : (
						<div className="page-faq-item" key={index}>
							<h3 className="page-faq-question">{item.question}</h3>
							<div className="page-faq-answer">
								<RichText doc={item.answer} />
							</div>
						</div>
					)
				)}
			</div>
		</div>
	);
}
