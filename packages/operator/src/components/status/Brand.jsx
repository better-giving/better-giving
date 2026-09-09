/**
 * every brand an operator surface may draw. one member, and that is the point of the type: a screen
 * cannot reach for a second brand without this name gaining one, which is a diff somebody reads.
 *
 * @typedef {'cloudflare'} BrandName
 */

/**
 * @typedef {object} BrandProps
 * @property {BrandName} name
 * @property {string | undefined} [label] the accessible name. without one the logo is out of the
 *   tree, and the bar for leaving it out is higher here than on ./Mark.jsx's: a mark is a shape and
 *   a logo is a name, so a logo standing where the company's name would have stood is never
 *   decoration and always takes one. what may leave it out is a logo standing *beside the company's
 *   own name* in the text it is drawn with — the console's press reading `Connect to Cloudflare` is
 *   the case — where a label is the company announced twice in one control. standing beside text
 *   that names something else is not that and takes a label: the console's head sets this logo in
 *   front of the account an operator is working in, and `Riverside Shelter` never says whose account
 *   it is.
 * @property {string | undefined} [className]
 */

/* a company's own mark, drawn from an image.

   the file is packages/operator/src/styles/brand/cloudflare.png, taken from Cloudflare's brand
   download at https://www.cloudflare.com/logo/. it is Cloudflare's trademark and is used here to
   name a Cloudflare account and nothing else — not as decoration, not as a tone, and not to say
   that anything on these screens is Cloudflare's.

   it is not a ./Mark.jsx and could not be one. a mark takes its ink from the text it stands with
   and belongs to a tone ladder; this is two colours of the company's own that answer to neither, so
   it takes no `color` and appears on no ladder. it is drawn from css — ../../styles/base.css holds
   the url, the way ../../styles/fonts.css holds its faces' — so every surface's bundler resolves
   one relative url and nothing here imports a binary.

   a second brand is a decision made out loud: a name added to `BrandName`, a rule added to the
   sheet, and a member added to each of the two maps below. dropping a file into that folder does
   nothing at all. */
/** @param {BrandProps} props */
export function Brand({ name, label, className = '' }) {
	/* one node per brand, chosen by name rather than assembled into a class. the class list has to
	   be spelled at the element for the reason ./Mark.jsx spells its own twice — a name interpolated
	   from `name` is a name packages/app/src/lib/admin/styles/conformance.spec.ts cannot see — and
	   here it also carries the image: a modifier nothing wears paints no logo, and a bare
	   `.adm-brand` is a box with nothing in it that fails on no gate and shows nothing on screen.

	   two maps rather than one with everything conditional, for the reason ./Mark.jsx keeps two
	   returns: written as one node the role would be an expression, `aria-label` would stand beside
	   it unconditionally, and what a reader meets on the decorative one is a bare `span` carrying a
	   property no role of its supports. */
	const named = {
		cloudflare: (
			<span
				className={`adm-brand adm-brand--cloudflare ${className}`}
				role="img"
				aria-label={label}
			/>
		)
	};
	const decoration = {
		cloudflare: (
			<span className={`adm-brand adm-brand--cloudflare ${className}`} aria-hidden="true" />
		)
	};
	return label ? named[name] : decoration[name];
}
