import { type ResizeRefusal, resizeImage } from '@better-giving/operator/images/resize';
import { logoRefused, uploadOrgLogo } from '../api/client';
import type { OrgWrite } from '../api/types';

// what the logo press does with the file the operator chose: resized here, in the browser, by the
// resize the dashboard's photo picks run (`@better-giving/operator/images/resize`), then uploaded.
// the deployment's intake judges the photo again whatever arrives
// (`packages/app/src/lib/server/images/`), so the resize is what keeps a phone's twelve-megapixel
// photo under its cap rather than a rule.

/** what a photo the resize turned down says at the logo. */
export const LOGO_REFUSED: Readonly<Record<ResizeRefusal, string>> = {
	'not-an-image': 'That file isn’t an image. Choose a PNG, JPEG or WebP.',
	unreadable:
		'That image couldn’t be opened here. Save it as a PNG, JPEG or WebP and choose it again.',
	'too-large-after-resize': 'That image is too large even after resizing. Choose a smaller one.'
};

/**
 * the chosen file resized and put on as the logo, or the refusal at the logo that stopped it.
 *
 * a press with no file chosen posts an empty one, which the resize turns down as no image; an entry
 * that is not a file at all is read the same way.
 */
export async function putLogo(chosen: FormDataEntryValue | null): Promise<OrgWrite> {
	if (!(chosen instanceof File)) return logoRefused(LOGO_REFUSED['not-an-image']);
	const resized = await resizeImage(chosen);
	if (!resized.ok) return logoRefused(LOGO_REFUSED[resized.reason]);
	return uploadOrgLogo(resized.blob);
}
