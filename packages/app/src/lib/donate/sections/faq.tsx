import type { Page } from '../../page/catalog';
import { RichText } from '../../rich-text/render';
import { Glyph } from './glyph';

// questions a donor asks before giving. folded, one answer opens at a time, the first to begin
// with; open, every answer is stated under its question.

export function Faq({
	items,
	domId,
	folded
}: {
	readonly items: NonNullable<Page['faq']>;
	readonly domId: string;
	readonly folded: boolean;
}) {
	return (
		<div className="page-faq" data-folded={folded ? '' : undefined}>
			<h2 className="page-heading">Questions</h2>
			<div className="page-faq-items">
				{items.map((item, index) =>
					folded ? (
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
