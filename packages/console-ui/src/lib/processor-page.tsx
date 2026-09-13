import { Button } from '@better-giving/operator/components/controls/Button';
import { BackLink } from '@better-giving/operator/components/controls/BackLink';
import { BareShell } from '@better-giving/operator/components/shell/BareShell';
import { Column } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CLOSE_PARAM } from './dialog-params';
import { ConsoleHead } from './head-strip';
import { ProductFoot } from './product-foot';
import { RouterLink } from './router-link';

// the frame a processor screen stands in: the head and the strip every screen of this console
// stands, and a column headed by the way back to the page that lists the processors.
//
// **the head is the home page's head**, for the reason ../routes/_index.tsx states over its own: the
// account is true on every screen. its one press is the same link to the close confirm, which is the
// home page's to draw — so pressing it here goes to `/` with that confirm up.

export type ProcessorPageProps = {
	/** the processor's name, which is the whole heading. */
	title: string;
	version: string;
	account: string;
	accountId: string;
	remembered: boolean;
	notKept: string | null;
	children: ReactNode;
};

export function ProcessorPage({
	title,
	version,
	account,
	accountId,
	remembered,
	notKept,
	children
}: ProcessorPageProps): ReactNode {
	const head = (
		<ConsoleHead
			account={account}
			accountId={accountId}
			control={
				<Button
					as={Link}
					to={`/?${CLOSE_PARAM}`}
					variant="soft"
					size="sm"
					mark="unplug"
					aria-label="Close console"
				/>
			}
			remembered={remembered}
			notKept={notKept}
		/>
	);
	return (
		<BareShell head={head} foot={<ProductFoot version={version} />}>
			<Column>
				<PageHeader
					title={title}
					back={
						<BackLink href="/" link={RouterLink}>
							Your deployment
						</BackLink>
					}
				/>
				{children}
			</Column>
		</BareShell>
	);
}
