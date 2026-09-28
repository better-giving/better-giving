import type { Background } from '../../page/keys';

// what the hero and image blocks share: a stored photo, drawn by its id alone and cropped to the
// block's frame (./page.css sets each frame's ratio, so the photo's box holds its place before the
// bytes arrive).

/** a photo block's stored values. */
export type PhotoBlockValues<V extends string> = {
	readonly id: string;
	readonly variant: V;
	readonly background: Background;
	/** the stored image's id; null until a photo is placed, and the block leaves itself out. */
	readonly imageId: string | null;
	/** what the photo shows, for a reader who cannot see it; null is a decorative photo. */
	readonly alt: string | null;
};

export type PhotoBlockProps<V extends string> = {
	readonly block: PhotoBlockValues<V>;
	/** a stored image's address by its id: `imageSrc` in ../../page/image-src.ts. */
	readonly imageSrc: (imageId: string) => string;
};

export function Photo({
	imageId,
	alt,
	imageSrc,
	lead
}: {
	readonly imageId: string;
	readonly alt: string | null;
	readonly imageSrc: (imageId: string) => string;
	/** the page's opening photo is fetched first; any other waits until it nears the screen. */
	readonly lead: boolean;
}) {
	return (
		<img
			className="page-photo"
			src={imageSrc(imageId)}
			alt={alt ?? ''}
			fetchPriority={lead ? 'high' : undefined}
			loading={lead ? undefined : 'lazy'}
		/>
	);
}
