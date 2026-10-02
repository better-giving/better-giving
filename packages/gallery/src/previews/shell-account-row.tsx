import { Button } from '@better-giving/operator/components/controls/Button';
import { AccountBand, AccountRow } from '@better-giving/operator/components/shell/AccountRow';

/*
 * the account a surface works in, as its two faces, out of the shell that places them: the row the
 * rail's foot holds at the wide width and the press the narrow band holds below it. each is drawn
 * marked and unmarked.
 *
 * out of the shell on purpose, as ./shell-destination-cell.tsx is: what the row does in the icon
 * rail — the name off the screen, the logo kept as the press, the mark a badge at its corner — is
 * written against `.adm-shell--collapsed`, which only the shell wears. ./shell-app-shell.tsx draws
 * both faces in place, unmarked as the console hands them, and its rail's toggle is where the icon
 * rail is seen.
 *
 * a concern's word is off the screen and read after the name; the band's press reads the whole
 * name out, since it shows the logo alone.
 */

const ACCOUNT = {
	name: "Riverside Shelter's Account",
	brand: 'cloudflare',
	whose: 'Cloudflare account',
	href: '#shell-account-row'
} as const;

const CONCERN = 'Needs attention';

const CLOSE = (
	<Button
		variant="quiet"
		size="sm"
		mark="unplug"
		className="adm-signout"
		aria-label="Close console"
	/>
);

export default function ShellAccountRowPreview() {
	return (
		<div className="adm-stack">
			<AccountRow {...ACCOUNT} concern={null} out={CLOSE} />
			<AccountRow {...ACCOUNT} concern={CONCERN} out={CLOSE} />
			<div className="adm-actions">
				<AccountBand {...ACCOUNT} concern={null} />
				<AccountBand {...ACCOUNT} concern={CONCERN} />
			</div>
		</div>
	);
}
