import { Breadcrumbs } from '@better-giving/operator/components/controls/Breadcrumbs';
import { Button } from '@better-giving/operator/components/controls/Button';
import { BareShell } from '@better-giving/operator/components/shell/BareShell';
import { Column } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import type { ReactNode } from 'react';
import type { LinkProps } from 'react-router';
import { Link } from 'react-router';
import { type CrumbHandle, useCrumbs } from './crumbs';
import { CLOSE_PARAM } from './dialog-params';
import { ConsoleHead } from './head-strip';
import { ProductFoot } from './product-foot';
import { opening } from './progress-bar';
import type { RouterLinkProps } from './router-link';
import { RouterLink } from './router-link';

// the frame a processor screen stands in: the head and the strip every screen of this console
// stands, and a column headed by the trail up to the page that lists the processors.
//
// **the head is the home page's head**, for the reason ../routes/_index.tsx states over its own: the
// account is true on every screen. its one press is the same link to the close confirm, which is the
// home page's to draw — so pressing it here goes to `/` with that confirm up.

/** what the bar says over both ways off this screen, which both land on the home page. */
const HOME = opening('Back to your deployment');

/** the trail a processor screen's `handle` states: home, then the processor by its heading. */
export function processorHandle(title: string): CrumbHandle {
	return {
		crumbs: ({ pathname }) => [
			{ href: '/', label: 'Your deployment' },
			{ href: pathname, label: title }
		]
	};
}

/** a crumb's anchor, which is only ever home: `Breadcrumbs` hands it an address and a class. */
function CrumbHome(props: RouterLinkProps): ReactNode {
	return <RouterLink {...props} state={HOME} />;
}

/** the close press's anchor: `Button` spends a `state` prop of its own, so the link carries this one. */
function LinkHome(props: LinkProps): ReactNode {
	return <Link {...props} state={HOME} />;
}

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
	const crumbs = useCrumbs();
	const head = (
		<ConsoleHead
			account={account}
			accountId={accountId}
			control={
				<Button
					as={LinkHome}
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
				<PageHeader title={title} crumbs={<Breadcrumbs items={crumbs} link={CrumbHome} />} />
				{children}
			</Column>
		</BareShell>
	);
}
