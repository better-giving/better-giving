// the one address a page's photo has: the deployment's own image route, by the photo's id
// (src/routes/image.$id.ts). a photo block is handed an id and never a URL, so nothing a draft or
// an AI reply carries can point a donor's browser at another host.
//
// pure and not under `$lib/server/**`: the route that renders a page and the editor's preview
// build the same address.

/** where the deployment serves a stored image's bytes. */
export const imageSrc = (imageId: string) => `/image/${encodeURIComponent(imageId)}`;
