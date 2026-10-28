import type { FetcherWithComponents } from 'react-router';

// a resized photo posted to the images route (src/routes/_app.admin.images.ts), as a placed photo's
// replace press posts it. the post revalidates nothing: a stored photo is on no page until a save
// names its id, and that write is what reads the screen again.

/** what the images route answers: the photo stored, or why it was not. */
export type UploadAnswer =
	| { readonly id: string; readonly width: number; readonly height: number }
	| { readonly error: string; readonly reason?: 'failed' };

export function postPhoto(fetcher: FetcherWithComponents<UploadAnswer>, blob: Blob) {
	const body = new FormData();
	body.set('file', blob);
	return fetcher.submit(body, {
		method: 'post',
		action: '/admin/images',
		encType: 'multipart/form-data',
		defaultShouldRevalidate: false
	});
}
