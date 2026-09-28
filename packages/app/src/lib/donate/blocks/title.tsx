import type { BlockOf } from './types';

// the page's name and what it is for, at display size.

/** a centred lede longer than this reads as a ragged paragraph, so the block draws left instead. */
export const CENTRED_LEDE_MAX = 120;

export function TitleBlock({
	block,
	heading,
	first
}: {
	readonly block: BlockOf<'title'>;
	/** the heading to draw: the stored one, or the page's own name when that is empty. */
	readonly heading: string;
	/** the page's first title is its `h1`; any later one is a section heading. */
	readonly first: boolean;
}) {
	const lede = block.lede ?? '';
	const variant =
		block.variant === 'center' && lede.length > CENTRED_LEDE_MAX ? 'left' : block.variant;
	const Heading = first ? 'h1' : 'h2';
	return (
		<div className="page-title" data-variant={variant}>
			<Heading className="page-title-heading">{heading}</Heading>
			{lede === '' ? null : <p className="page-title-lede">{lede}</p>}
		</div>
	);
}
