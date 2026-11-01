import type { Cover as CoverSource } from '../../page/shape';
import { Photo } from './photo';

// the campaign's cover: its own photo, or the organisation's logo on a ground of the brand colour
// where it has none ($lib/page/shape.ts picks which). the logo stands for the organisation the
// masthead already names, so it says nothing of its own.

export function Cover({
	cover,
	imageSrc
}: {
	readonly cover: NonNullable<CoverSource>;
	readonly imageSrc: (imageId: string) => string;
}) {
	if (cover.source === 'photo') {
		return (
			<div className="page-cover">
				<Photo imageId={cover.imageId} alt={cover.alt} imageSrc={imageSrc} lead />
			</div>
		);
	}
	return (
		<div className="page-cover" data-source="logo">
			<img className="page-cover-logo" src={imageSrc(cover.imageId)} alt="" />
		</div>
	);
}
