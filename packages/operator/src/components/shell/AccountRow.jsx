import { Button } from '../controls/Button.jsx';
import { Brand } from '../status/Brand.jsx';
import { Mark } from '../status/Mark.jsx';

/**
 * @import { ComponentType, ReactNode } from 'react'
 * @import { BrandName } from '../status/Brand.jsx'
 *
 * what either face hands whatever it is drawn as: the address, the class list the sheet draws off,
 * and the name where the face states one.
 *
 * @typedef {{
 *   href: string;
 *   className: string;
 *   'aria-label'?: string | undefined;
 *   children?: ReactNode | undefined;
 * }} AccountLinkProps
 *
 * @typedef {object} AccountProps
 * @property {string} name the account's name, as the company holding it has it.
 * @property {BrandName} brand the company whose account it is, drawn as its logo.
 * @property {string} whose what is read before the name — `Cloudflare account` — so the logo is
 *   never the only thing saying whose account this is.
 * @property {string | null} concern the word read after the name where the account wants the
 *   operator's look, drawn as a warning mark; `null` where it does not, and nothing is marked.
 * @property {string} href the address that opens the account's panel.
 * @property {ComponentType<AccountLinkProps> | undefined} [link] what the opener is drawn as.
 *   unstated, a plain `<a>`, for the reason ./DestinationCell.jsx's `link` gives: this package
 *   declares no router, so a mounted surface hands its own.
 *
 * @typedef {AccountProps & { out: ReactNode }} AccountRowProps the row adds the press that ends
 *   the session, drawn at its far end as it is handed.
 */

/* the account a surface is working in, as the two places the shell draws it: a row in the rail's
   foot at the wide width (`AccountRow`), and a small press in the narrow band where the foot is not
   drawn (`AccountBand`). both open the same panel and say the same thing, which is why they are one
   module: the concern is settled once by the caller and drawn here twice.

   **the opener is the whole row, logo included.** the icon rail takes the name off the screen and
   keeps the logo, so the panel stays one press away however the rail is drawn, marked or not
   (`.adm-shell--collapsed .adm-footaccount__open` in ../../styles/adm.css).

   **the mark wears `.adm-accountmark` at both faces**, which is what tones it: the class says what
   the mark is, so no rule has to infer it from where the mark stands.

   the concern's word is `.adm-vh` and outside the mark, read after the name the way a rail cell's
   status is (./DestinationCell.jsx); its comma separates the two in the accessible name. the logo
   takes `whose` as its label in the row, where the name beside it never says whose account it is
   (../status/Brand.jsx), and the whitespace between them is what keeps the two words apart when the
   name is read off the content. the band's press shows the logo alone, so its name is stated
   whole. neither takes a `title`: a hint on a focusable control is read out as its description on
   every focus. */

/** the opener where no link is handed. @param {AccountLinkProps} props */
function Anchor(props) {
	return <a {...props} />;
}

/** @param {AccountRowProps} props */
export function AccountRow({ name, brand, whose, concern, href, link, out }) {
	const Opens = link ?? Anchor;
	return (
		<div className="adm-footaccount">
			<Opens className="adm-footaccount__open" href={href}>
				<span className="adm-rail__lead">
					<Brand name={brand} label={whose} />
				</span>{' '}
				<span className="adm-footaccount__name">{name}</span>
				{concern === null ? null : (
					<>
						<span className="adm-accountmark">
							<Mark name="triangle-alert" />
						</span>
						<span className="adm-vh">, {concern}</span>
					</>
				)}
			</Opens>
			<span className="adm-footaccount__out">{out}</span>
		</div>
	);
}

/* `.adm-signout` for what it does in the band: the press keeps its size beside a name that takes
   the squeeze, as the close beside it does. */
/** @param {AccountProps} props */
export function AccountBand({ name, brand, whose, concern, href, link }) {
	const Opens = link ?? Anchor;
	return (
		<Button
			as={Opens}
			href={href}
			variant="quiet"
			size="sm"
			className="adm-signout"
			aria-label={concern === null ? `${whose} ${name}` : `${whose} ${name}, ${concern}`}
		>
			<Brand name={brand} />
			{concern === null ? null : (
				<span className="adm-accountmark">
					<Mark name="triangle-alert" />
				</span>
			)}
		</Button>
	);
}
