import { Photo, type PhotoBlockProps } from './photo';

// a photo further down the page. `column` keeps to the column with the card's corner; `wide` runs
// edge to edge on a phone and stands out past the column on a wide page.

export type ImageVariant = 'column' | 'wide';

export type ImageBlockProps = PhotoBlockProps<ImageVariant>;

export function ImageBlock({ block, imageSrc }: ImageBlockProps) {
	if (block.imageId === null) return null;
	return (
		<div className="page-image" data-variant={block.variant}>
			<Photo imageId={block.imageId} alt={block.alt} imageSrc={imageSrc} lead={false} />
		</div>
	);
}
