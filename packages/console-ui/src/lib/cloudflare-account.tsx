import { Modal } from '@better-giving/operator/behaviour/Dialog';
import type { AccountLinkProps } from '@better-giving/operator/components/shell/AccountRow';
import { AccountBand, AccountRow } from '@better-giving/operator/components/shell/AccountRow';
import { StatedValue } from '@better-giving/operator/components/forms/StatedValue';
import type { ReactNode } from 'react';
import { DialogLink, useLeaveDialog } from './dialog-params';

// the Cloudflare account this deployment runs on, as the rail's foot and the narrow band draw it,
// and the panel either opens: the account's name and the id cloudflare resolves it by.
//
// **the account carries no mark.** both faces are
// packages/operator/src/components/shell/AccountRow.jsx, whose `concern` is that component's own
// and is handed `null` here: nothing this console reads about the account is a thing an operator
// has to act on.
//
// **the panel opens off a parameter on the address** (`ACCOUNT_PARAM` in ./dialog-params.ts), the
// way ./close-confirm.tsx's confirm does, so Escape, its way out and the browser's back button
// answer it alike: the opener pushes an entry the way out steps back over (`leaveDialog` in
// ./dialog-params.ts).

export type CloudflareAccountProps = {
	/** the account's name, as cloudflare holds it. */
	name: string;
	/** the address that opens the account panel. */
	openHref: string;
	/** the press that ends this console, drawn at the row's far end as it is handed. */
	closeControl: ReactNode;
};

/** the panel's opener, moving within the page it was opened over rather than to the top of it. */
function PanelLink({ href, ...rest }: AccountLinkProps): ReactNode {
	return <DialogLink to={href} preventScrollReset {...rest} />;
}

/**
 * the account as the rail's foot draws it (`row`, holding the close) and as the band draws it at
 * phone width (`band`, which stands beside the close). the shell draws only one of the two at any
 * width; they are settled here together so the two cannot disagree.
 */
export function cloudflareAccount({ name, openHref, closeControl }: CloudflareAccountProps): {
	row: ReactNode;
	band: ReactNode;
} {
	const account = {
		name,
		brand: 'cloudflare',
		whose: 'Cloudflare account',
		concern: null,
		href: openHref,
		link: PanelLink
	} as const;
	return {
		row: <AccountRow {...account} out={closeControl} />,
		band: <AccountBand {...account} />
	};
}

export type CloudflareAccountPanelProps = {
	/** the account's name, which heads the panel. */
	name: string;
	/** the account's id, which is what cloudflare resolves the name by: the name is not unique. */
	accountId: string;
	/** the address the panel was opened over, without the parameter that opened it. */
	back: string;
};

/** the account panel, over whatever page it was opened on. */
export function CloudflareAccountPanel({
	name,
	accountId,
	back
}: CloudflareAccountPanelProps): ReactNode {
	const leave = useLeaveDialog();
	return (
		<Modal
			title={name}
			onDismiss={() => leave(back)}
			// the way out is the panel's only press, so it keeps the rank the dialog gives it.
			exitProps={{ type: 'button', onClick: () => leave(back) }}
		>
			{/* the id is stated here and on neither opener, where a hint would be read out on every
			    focus of the control. */}
			<StatedValue label="Account ID" value={accountId} code />
		</Modal>
	);
}
