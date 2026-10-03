import { Button } from '@better-giving/operator/components/controls/Button';
import { AccountBand, AccountRow } from '@better-giving/operator/components/shell/AccountRow';

/*
 * the account a surface works in, as its two faces, out of the shell that places them: the row the
 * rail's foot holds at the wide width and the logo the narrow band holds below it. neither opens
 * anything.
 *
 * out of the shell on purpose, as ./shell-destination-cell.tsx is: what the row does in the icon
 * rail — the name off the screen, the logo kept — is written against `.adm-shell--collapsed`, which
 * only the shell wears. ./shell-app-shell.tsx draws both faces in place, and its rail's toggle is
 * where the icon rail is seen.
 *
 * the band's logo reads the whole name out, since it shows the logo alone.
 */

const ACCOUNT = {
	name: "Riverside Shelter's Account",
	brand: 'cloudflare',
	whose: 'Cloudflare account'
} as const;

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
			<AccountRow {...ACCOUNT} out={CLOSE} />
			<div className="adm-actions">
				<AccountBand {...ACCOUNT} />
			</div>
		</div>
	);
}
