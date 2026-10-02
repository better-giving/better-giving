import { AccountBand, AccountRow } from '@better-giving/operator/components/shell/AccountRow';
import type { ReactNode } from 'react';

// the Cloudflare account this deployment runs on, as the rail's foot and the narrow band draw it:
// the logo and the account's name, stated and never opened.
//
// **the account opens nothing.** both faces are
// packages/operator/src/components/shell/AccountRow.jsx, a label at either width, so the only
// press on the row is the close it is handed. the account's id is stated where an operator picks
// the account — the `/` screen's head strip (`HeadIdentity` in ./head-strip.tsx) and the terminal's
// picker — and nowhere on these pages.

export type CloudflareAccountProps = {
	/** the account's name, as cloudflare holds it. */
	name: string;
	/** the press that ends this console, drawn at the row's far end as it is handed. */
	closeControl: ReactNode;
};

/**
 * the account as the rail's foot draws it (`row`, holding the close) and as the band draws it at
 * phone width (`band`, which stands beside the close). the shell draws only one of the two at any
 * width; they are settled here together so the two cannot disagree.
 */
export function cloudflareAccount({ name, closeControl }: CloudflareAccountProps): {
	row: ReactNode;
	band: ReactNode;
} {
	const account = { name, brand: 'cloudflare', whose: 'Cloudflare account' } as const;
	return {
		row: <AccountRow {...account} out={closeControl} />,
		band: <AccountBand {...account} />
	};
}
