import type { Page } from '../../page/catalog';
import { Photo } from './photo';

// the photos beside the cover. the letter keeps each to its reading column; the feature stands
// them in a strip, which scrolls sideways on a phone. each photo is its own section in the editor's
// preview, `photo-${index}` ($lib/page/content-edit.ts), so a click on one opens that photo.

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
				<div
					className="page-photos-item"
					data-section={`photo-${index}`}
					key={`${index}-${photo.imageId}`}
				>
					<Photo imageId={photo.imageId} alt={photo.alt} imageSrc={imageSrc} lead={false} />
				</div>
			))}
		</div>
	);
}
