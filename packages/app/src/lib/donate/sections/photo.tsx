// a stored photo, drawn by its id alone and cropped to its frame (../page.css sets each frame's
// ratio, so the photo's box holds its place before the bytes arrive).

export function Photo({
	imageId,
	alt,
	imageSrc,
	lead
}: {
	readonly imageId: string;
	/** what the photo shows, for a reader who cannot see it; null is a decorative photo. */
	readonly alt: string | null;
	/** a stored image's address by its id: `imageSrc` in ../../page/image-src.ts. */
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
