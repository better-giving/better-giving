import type { Page } from '../../page/catalog';
import { Photo } from './photo';

// the photos beside the cover. the letter keeps each to its reading column; the feature stands
// them in a strip, which scrolls sideways on a phone.

export function Photos({
	photos,
	imageSrc,
	shape
}: {
	readonly photos: NonNullable<Page['photos']>;
	readonly imageSrc: (imageId: string) => string;
	readonly shape: 'column' | 'strip';
}) {
	return (
		<div className="page-photos" data-shape={shape}>
			{photos.map((photo, index) => (
				<div className="page-photos-item" key={`${index}-${photo.imageId}`}>
					<Photo imageId={photo.imageId} alt={photo.alt} imageSrc={imageSrc} lead={false} />
				</div>
			))}
		</div>
	);
}
