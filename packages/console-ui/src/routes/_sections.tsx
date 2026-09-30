import { Button } from '@better-giving/operator/components/controls/Button';
import { AppShell, PanelRoute } from '@better-giving/operator/components/shell/AppShell';
import { BareShell } from '@better-giving/operator/components/shell/BareShell';
import { Column, Stack } from '@better-giving/operator/components/shell/Layout';
import { holdBar } from '@better-giving/operator/progress-bar';
import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { Link, Outlet, useFetcher, useLocation, useSearchParams } from 'react-router';
import chariotLogo from '../assets/processors/chariot.png';
import nowpaymentsLogo from '../assets/processors/nowpayments.png';
import paypalLogo from '../assets/processors/paypal.png';
import quickbooksLogo from '../assets/integrations/quickbooks.png';
import stripeLogo from '../assets/processors/stripe.png';
import github from '../assets/social/github.webp';
import { CloseConfirm, useClosed } from '../lib/close-confirm';
import type { CloudflareAccountPanelProps } from '../lib/cloudflare-account';
import { CloudflareAccountPanel, cloudflareAccount } from '../lib/cloudflare-account';
import { PLAN_FETCHER } from '../lib/cloudflare-plan';
import { railGroups } from '../lib/console-pages';
import { gatedBy, gatedPage, notReady, readConsole } from '../lib/console-reading';
import { CloudflareGateFace, ConsoleStopped, drawnAfterGate } from '../lib/deployment-states';
import { ACCOUNT_PARAM, CLOSE_PARAM, consoleRereads } from '../lib/dialog-params';
import { ConsoleHead, HeadNotes, machineNoted } from '../lib/head-strip';
import { heldValues } from '../lib/held-values';
import { keysTrouble } from '../lib/processor-screen';
import { PRODUCT_NAME, ProductFoot, SOURCE_URL, productLine } from '../lib/product-foot';
import { RailLabelsProvider, RouterLink } from '../lib/router-link';
import type { clientAction as shellAction } from './_index';
import { TITLE } from './_index';
import type { Route } from './+types/_sections';

// the shell every section page of a ready deployment stands in: the rail of pages and the foot naming
// the account and the release. no strip stands over a page and no page draws a title: the tab title
// and the marked rail cell name it to the eye, and a visually hidden `h1` here names it in the document.
//
// **there is no home page, and the rail is the overview.** every cell carries where its section
// stands (../lib/console-pages.ts), so a screen summarising the sections would be the rail read
// twice. `/` draws what stands before a deployment is ready, and sends a ready one here
// (./_index.tsx).
//
// **nothing here is read unless the deployment is ready.** where cloudflare would not say what the
// deployment holds, the page stands behind a gate drawn in place of the whole shell, rail and all
// (the error boundary below); any other face is `/`'s, which is where that face is drawn and where
// its way out is, so the loader sends it there before anything under it renders.
//
// **the account is the rail's foot, with the press that ends this console beside it.** it is the one
// thing true on every page, and the record naming the account is written at the terminal and left
// exactly as it is. its name opens the account panel, where the paid-plan answer is given, and is
// marked only where that answer slows a feed in use (../lib/cloudflare-account.tsx). the account and
// the close both stand in the narrow band too, where the foot is not drawn.
//
// **nothing on these pages deploys.** standing a deployment up and carrying newer code onto one are
// `better-giving start` in a terminal, which is what opens the one-way door the remote migration is;
// a press that runs for minutes behind a browser tab is one an operator can close. DEPLOY.md has what
// stands around it.
//
// **no press is answered here.** this route is pathless, so no address posts to it: each page answers
// its own presses, and the presses over every page — the close and the account panel's — are
// answered by `/` (../lib/close-confirm.tsx, ../lib/cloudflare-plan-block.tsx).
//
// **nothing on a page reaches cloudflare and nothing could**: cloudflare's API sends no cross-origin
// headers, and the credential it is reached with is held by the binary on this machine. what a press
// carries is what the operator typed and what they asked for; the account it is spent on, the worker
// it is addressed to and which names exist at all are read off this machine and never off a body.

/**
 * the reading every page under this shell draws from, read once for the navigation and joined by any
 * page loader under it (../lib/console-reading.ts).
 *
 * **the bar over the screen being replaced is finished before this hands anything back**, the rule
 * every bar on this console follows (packages/operator/src/progress-bar.ts). a re-read of a page
 * already drawn has no bar over it and returns at once.
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
	const bar = holdBar(new URL(request.url).pathname);
	const read = await readConsole(request);
	if (read.reading.face.kind !== 'ready') {
		// a gate is drawn where this page was, so its bar is finished; a redirect's navigation takes it.
		if (gatedPage(read) !== null) await bar.finish();
		notReady(read);
	}
	await bar.finish();
	return { ...read, address: read.reading.face.address };
}

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
	return consoleRereads(args);
}

export default function Sections({ loaderData }: Route.ComponentProps) {
	const { pathname } = useLocation();
	const [params] = useSearchParams();
	const closed = useClosed();
	/* a read-again pressed on the gate this page stood behind took the press with the gate, so the
	   reader goes to the page's heading. keyed on the page drawing. */
	const title = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		if (drawnAfterGate(pathname)) title.current?.focus();
	}, [pathname]);
	if (closed) return null;

	const { reading } = loaderData;
	const groups = railGroups(
		reading.sections,
		reading.processors,
		{
			stripe: stripeLogo,
			paypal: paypalLogo,
			chariot: chariotLogo,
			nowpayments: nowpaymentsLogo
		},
		{ quickbooks: quickbooksLogo }
	);
	const here = groups
		.flatMap((group) => group.destinations)
		.find((destination) => destination.href === pathname);

	/* the one page on this deployment a human signs in to. a new tab, because a page here is one an
	   operator is working in: a press half-made is what following the link in place throws away. */
	const dashboard = `${loaderData.address}/admin`;

	/* a link and not a submit, because what it opens is the confirm, and that is a parameter on the
	   address. it is never held while another press is running: the binary waits for the press it is
	   holding to finish before it shuts anything down, so confirming over a save cuts nothing short.
	   the mark is the plug being pulled, and its label is the whole of its name. */
	const closeControl = (
		<Button
			as={Link}
			to={`${pathname}?${CLOSE_PARAM}`}
			preventScrollReset
			variant="quiet"
			size="sm"
			mark="unplug"
			className="adm-signout"
			aria-label="Close console"
		/>
	);

	// a ready deployment's values always read: an unread one stands behind the gate instead.
	const held = reading.values.vars.kind === 'read' ? heldValues(reading.values.vars.vars) : null;
	/* the account at both widths: the row in the rail's foot, and at phone width, where the foot is
	   not drawn, the same panel opened from the band beside the close, marked alike. */
	const account = cloudflareAccount({
		name: loaderData.account,
		values: held,
		feedsInUse: reading.feedsInUse,
		openHref: `${pathname}?${ACCOUNT_PARAM}`,
		closeControl
	});

	const foot = (
		<>
			{account.row}
			<div className="adm-footline">
				<span className="adm-rail__lead">
					{/* github's trademark, used to point at that repository and for nothing else. the
					    sheet draws it as a mask off `--_source-mark`, so the picture is set here, where the
					    asset is. */}
					<Button
						as="a" // full-load-ok: github's address, never this console's.
						href={SOURCE_URL}
						target="_blank"
						rel="noreferrer"
						variant="quiet"
						size="sm"
						aria-label="better.giving source on GitHub"
					>
						<span
							className="adm-footline__source"
							style={{ '--_source-mark': `url(${github})` } as CSSProperties}
						/>
					</Button>
				</span>
				<span className="adm-caption">{productLine(loaderData.version)}</span>
			</div>
		</>
	);

	return (
		<RailLabelsProvider groups={groups}>
			<AppShell
				// before the organisation's legal name is saved there is no name to show, so it says what
				// the software is rather than printing an empty band.
				org={reading.stored.legal_name === '' ? PRODUCT_NAME : reading.stored.legal_name}
				site={dashboard}
				groups={groups}
				link={RouterLink}
				current={here?.label}
				wayOut={
					<>
						{account.band}
						{closeControl}
					</>
				}
				foot={foot}
			>
				{here === undefined ? null : (
					// `-1` so a read-again that lands can send the reader here; never tabbed.
					<h1 className="adm-vh" ref={title} tabIndex={-1}>
						{here.label}
					</h1>
				)}
				<Stack>
					{/* the lines about this machine stand in the page's column, a step above the page. */}
					{machineNoted(loaderData) ? (
						<Column>
							<Stack tight>
								<HeadNotes
									remembered={loaderData.remembered}
									notKept={loaderData.notKept}
									inPanel
								/>
							</Stack>
						</Column>
					) : null}
					<Outlet />
				</Stack>
				{params.has(CLOSE_PARAM) ? <CloseConfirm back={pathname} /> : null}
				{held !== null && params.has(ACCOUNT_PARAM) ? (
					<AccountPanel
						name={loaderData.account}
						accountId={loaderData.accountId}
						values={held}
						feedsInUse={reading.feedsInUse}
						trouble={keysTrouble({
							workerName: loaderData.workerName,
							accountName: loaderData.account
						})}
						back={pathname}
					/>
				) : null}
			</AppShell>
		</RailLabelsProvider>
	);
}

/**
 * the account panel, over whatever page it was opened on, with its presses read off the fetcher
 * they post through (`PLAN_FETCHER` in ../lib/cloudflare-plan.ts) — `/` answers them, the way it
 * answers the close. mounted only while the panel is open, so a press answered and put away is not
 * reported again the next time it opens.
 */
function AccountPanel(
	props: Omit<CloudflareAccountPanelProps, 'written' | 'freed' | 'busy' | 'pending'>
): ReactNode {
	const press = useFetcher<typeof shellAction>({ key: PLAN_FETCHER });
	const posted = press.formData?.get('intent');
	const pending = typeof posted === 'string' ? posted : null;
	const answer = press.data;
	return (
		<CloudflareAccountPanel
			{...props}
			written={answer && 'plan' in answer ? answer.plan : null}
			freed={answer && 'freed' in answer ? answer.freed : null}
			busy={pending !== null}
			pending={pending}
		/>
	);
}

/**
 * a page standing behind a gate, or the console stopped.
 *
 * **the gate is the page's whole screen**: the head keeps the account and the close press, which
 * are true whatever cloudflare said, and the rail goes, since every destination on it is read over
 * the answer that did not land (../lib/cloudflare-gate.ts).
 *
 * the console stopped is the one other thing a page meets here: a request it cannot reach the local
 * process with at all. drawn as the panel a route outside the shell is, because there is no reading
 * to draw a shell from — the same words wherever it is met (../lib/deployment-states.tsx). the foot
 * stands with no release in it, because nothing here read what this binary is.
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	/* the confirm opens from state here rather than off `?close` as it does over a page: the layout
	   threw, so it holds no reading, and the router re-runs a loader with nothing kept whatever
	   `shouldRevalidate` says — a navigation to open the confirm would ask cloudflare again first. */
	const [closing, setClosing] = useState(false);
	const closed = useClosed();
	const gated = gatedBy(error);
	if (closed) return null;
	if (gated === null) {
		return (
			<PanelRoute foot={<ProductFoot version="" />}>
				<title>{TITLE}</title>
				<ConsoleStopped />
			</PanelRoute>
		);
	}
	return (
		<>
			<BareShell
				head={
					<ConsoleHead
						account={gated.account}
						accountId={gated.accountId}
						control={
							<Button
								type="button"
								onClick={() => setClosing(true)}
								variant="soft"
								size="sm"
								mark="unplug"
								aria-label="Close console"
							/>
						}
						remembered={gated.remembered}
						notKept={gated.notKept}
					/>
				}
				foot={<ProductFoot version={gated.version} />}
				centred
			>
				<title>{TITLE}</title>
				<CloudflareGateFace gate={gated.gate} />
			</BareShell>
			{closing ? <CloseConfirm back={() => setClosing(false)} /> : null}
		</>
	);
}
