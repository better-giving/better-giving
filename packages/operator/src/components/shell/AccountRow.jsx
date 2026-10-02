import { Brand } from '../status/Brand.jsx';

/**
 * @import { ReactNode } from 'react'
 * @import { BrandName } from '../status/Brand.jsx'
 *
 * @typedef {object} AccountProps
 * @property {string} name the account's name, as the company holding it has it.
 * @property {BrandName} brand the company whose account it is, drawn as its logo.
 * @property {string} whose what is read before the name — `Cloudflare account` — so the logo is
 *   never the only thing saying whose account this is.
 *
 * @typedef {AccountProps & { out: ReactNode }} AccountRowProps the row adds the press that ends
 *   the session, drawn at its far end as it is handed.
 */

/* the account a surface is working in, as the two places the shell draws it: a row in the rail's
   foot at the wide width (`AccountRow`), and the logo in the narrow band where the foot is not
   drawn (`AccountBand`). both say the same thing, which is why they are one module.

   **neither face is a control.** the account is stated, never opened: no link, no button, nothing
   in the tab order, so a keyboard user meets nothing that does nothing. the row's one press is the
   `out` it is handed.

   **the logo stays in the icon rail and the name leaves the screen only** — `.adm-footaccount__name`
   beside the destinations' names under `.adm-shell--collapsed` in ../../styles/adm.css — so the row
   is read as `whose` and the name at every width. the logo takes `whose` as its label in the row,
   where the name beside it never says whose account it is (../status/Brand.jsx), and the whitespace
   between them is what keeps the two words apart when the row is read off its content. the band
   shows the logo alone, so its label is `whose` and the name whole. neither takes a `title`: a hint
   on an element nothing can focus reaches no keyboard and no touch. */

/** @param {AccountRowProps} props */
export function AccountRow({ name, brand, whose, out }) {
	return (
		<div className="adm-footaccount">
			<span className="adm-footaccount__label">
				<span className="adm-rail__lead">
					<Brand name={brand} label={whose} />
				</span>{' '}
				<span className="adm-footaccount__name">{name}</span>
			</span>
			<span className="adm-footaccount__out">{out}</span>
		</div>
	);
}

/* `.adm-signout` for what it does in the band: the logo keeps its size beside a name that takes the
   squeeze, as the close beside it does. */
/** @param {AccountProps} props */
export function AccountBand({ name, brand, whose }) {
	return <Brand name={brand} label={`${whose} ${name}`} className="adm-signout" />;
}
