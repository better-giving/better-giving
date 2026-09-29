import type { ReactNode } from 'react';
import { IllustrationCaption, Photo, type PhotoBlockProps } from './photo';

// the page's opening photo. `wide` runs edge to edge on a phone and across a flow's full width on
// a wide page; `framed` keeps to the column with the card's corner. under the cover layout the
// hero is the cover whatever its stored variant: the photo edge to edge with the page's first
// title laid over its lower edge on `--page-scrim`. an AI illustration's hero is captioned so in
// every variant, the cover's included (./photo.tsx).

export type HeroVariant = 'wide' | 'framed';

export type HeroBlockProps = PhotoBlockProps<HeroVariant> & {
	/** the cover layout's title, drawn over the photo; the renderer stands this hero outside a `.page-in`. */
	readonly over?: ReactNode;
};

export function HeroBlock({ block, imageSrc, over }: HeroBlockProps) {
	if (block.imageId === null) return null;
	const illustration = block.illustration === true;
	const photo = <Photo imageId={block.imageId} alt={block.alt} imageSrc={imageSrc} lead />;
	const Frame = illustration ? 'figure' : 'div';
	const caption = illustration ? <IllustrationCaption /> : null;
	if (over === undefined) {
		return (
			<Frame className="page-hero" data-variant={block.variant}>
				{photo}
				{caption}
			</Frame>
		);
	}
	return (
		<Frame className="page-hero" data-variant="cover">
			{photo}
			<div className="page-hero-over">
				<div className="page-in">{over}</div>
			</div>
			{caption}
		</Frame>
	);
}
