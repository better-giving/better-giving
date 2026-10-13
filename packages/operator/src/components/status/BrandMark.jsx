import { SOCIAL_PLATFORMS } from '../../console/org';
import facebook from './brand-marks/facebook.svg';
import instagram from './brand-marks/instagram.svg';
import linkedin from './brand-marks/linkedin.png';
import tiktok from './brand-marks/tiktok.svg';
import whatsapp from './brand-marks/whatsapp.svg';
import x from './brand-marks/x.svg';
import youtube from './brand-marks/youtube.svg';

/**
 * @import { SocialPlatform } from '../../console/org'
 */

/**
 * every network a mark is drawn for: an organisation's platforms, and WhatsApp, which a donor page
 * offers as a share channel and no organisation lists as a profile.
 *
 * @typedef {SocialPlatform | 'whatsapp'} BrandMarkPlatform
 */

/**
 * @typedef {object} BrandMarkProps
 * @property {BrandMarkPlatform} platform
 * @property {string} className the rule that sizes the mark, which is the surface's own: the donor
 *   page is dressed from the form's token file and an operator screen from this package's, and the
 *   two never meet (CLAUDE.md). the rule states a block size and nothing else, so the width follows
 *   the file — YouTube's, TikTok's and X's are not square.
 */

/* a network's own mark, drawn from that network's official file in its own colours.

   the files are in ./brand-marks/, one per network, each as the network publishes it: nothing here
   redraws, recolours or crops one, and a mark is never tinted to the text beside it. that is what
   sets this apart from ./Mark.jsx, which draws this system's glyphs in this system's ink. each is
   that network's trademark and names that network's own page and nothing else.

   each is an `<img>`, so the file is its own document: an svg inlined into a page shares that
   page's ids and styles, and instagram's clip path is an id. the files are imported here, and each
   surface's bundler resolves one to a url or a `data:` uri, because the donor page draws these and
   links no operator sheet — so the url cannot live in a sheet the way ./Brand.jsx's logos' do.

   it always stands where something else names the network — a link's own name, a channel's label
   — so the empty `alt` takes it out of the reading and `aria-hidden` says the same to the tree. */
const FILES = /** @type {const} */ ({
	facebook,
	instagram,
	youtube,
	linkedin,
	tiktok,
	x,
	whatsapp
});

/** every platform a mark is drawn for, in `SOCIAL_PLATFORMS`'s order with WhatsApp last. */
export const BRAND_MARK_PLATFORMS = /** @type {readonly BrandMarkPlatform[]} */ ([
	...SOCIAL_PLATFORMS,
	'whatsapp'
]);

/** @param {BrandMarkProps} props */
export function BrandMark({ platform, className }) {
	return <img className={className} src={FILES[platform]} alt="" aria-hidden="true" />;
}
