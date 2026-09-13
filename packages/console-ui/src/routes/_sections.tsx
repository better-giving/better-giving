import { Button } from '@better-giving/operator/components/controls/Button';
import { AppShell, PanelRoute } from '@better-giving/operator/components/shell/AppShell';
import { Brand } from '@better-giving/operator/components/status/Brand';
import { Column, Stack } from '@better-giving/operator/components/shell/Layout';
import { Mark } from '@better-giving/operator/components/status/Mark';
import type { CSSProperties, ReactNode } from 'react';
import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { Link, Outlet, redirect, useFetcher, useLocation, useSearchParams } from 'react-router';
import paypalLogo from '../assets/processors/paypal.png';
import stripeLogo from '../assets/processors/stripe.png';
import github from '../assets/social/github.webp';
import { CHECK_INTENT, CloseConfirm, SHELL_ACTION, useClosed } from '../lib/close-confirm';
import { railGroups } from '../lib/console-pages';
import { readConsole } from '../lib/console-reading';
import { ConsoleStopped } from '../lib/deployment-states';
import { CLOSE_PARAM, consoleRereads } from '../lib/dialog-params';
import { HeadNotes, machineNoted } from '../lib/head-strip';
import { PRODUCT_NAME, ProductFoot, SOURCE_URL, productLine } from '../lib/product-foot';
import { holdBar } from '../lib/progress-bar';
import { RailLabelsProvider, RouterLink } from '../lib/router-link';
import { usePress } from '../lib/use-press';
import { TITLE } from './_index';
import type { Route } from './+types/_sections';

// the shell every section page of a ready deployment stands in: the rail of pages, the strip over
// each one, and the foot naming the account and the release.
//
// **there is no home page, and the rail is the overview.** every cell carries where its section
// stands (../lib/console-pages.ts), so a screen summarising the sections would be the rail read
// twice. `/` draws what stands before a deployment is ready, and sends a ready one here
// (./_index.tsx).
//
// **nothing here is read unless the deployment is ready.** any other face is `/`'s, which is where
// that face is drawn and where its way out is, so the loader sends every other face there before
// anything under it renders.
//
// **the account is the rail's foot, with the press that ends this console beside it.** it is the one
// thing true on every page, and the record naming the account is written at the terminal and left
// exactly as it is. the same press stands in the narrow band, where the foot is not drawn.
//
// **nothing on these pages deploys.** standing a deployment up and carrying newer code onto one are
// `better-giving start` in a terminal, which is what opens the one-way door the remote migration is;
// a press that runs for minutes behind a browser tab is one an operator can close. DEPLOY.md has what
// stands around it.
//
// **no press is answered here.** this route is pathless, so no address posts to it: each page answers
// its own presses, and the two over every page — check again, and close — are answered by `/`
// (../lib/close-confirm.tsx).
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
 * every bar on this console follows (../lib/progress-bar.ts). a re-read of a page already drawn has
 * no bar over it and returns at once.
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
	const bar = holdBar(new URL(request.url).pathname);
	const read = await readConsole(request);
	if (read.reading.face.kind !== 'ready') throw redirect('/', 307);
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
	if (closed) return null;

	const { reading } = loaderData;
	const groups = railGroups(reading.sections, reading.processors, {
		stripe: stripeLogo,
		paypal: paypalLogo
	});
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

	const foot = (
		<>
			<div className="adm-footaccount">
				<div className="adm-footaccount__row">
					<span className="adm-footaccount__mark">
						<Brand name="cloudflare" label="Cloudflare" />
					</span>
					<span className="adm-footaccount__name">{loaderData.account}</span>
					<span className="adm-footaccount__out">{closeControl}</span>
				</div>
				{/* what cloudflare resolves that name by: the name is not unique and this is. */}
				<span className="adm-footaccount__id">{loaderData.accountId}</span>
			</div>
			<div className="adm-footline">
				<span className="adm-caption">{productLine(loaderData.version)}</span>
				{/* github's trademark, used to point at that repository and for nothing else. the
				    sheet draws it as a mask off `--_source-mark`, so the picture is set here, where the
				    asset is. */}
				<a
					className="adm-footline__source"
					href={SOURCE_URL}
					target="_blank"
					rel="noreferrer"
					style={{ '--_source-mark': `url(${github})` } as CSSProperties}
				>
					<span className="adm-vh">better.giving source on GitHub</span>
				</a>
			</div>
		</>
	);

	return (
		<RailLabelsProvider groups={groups}>
			<AppShell
				// before the organisation's legal name is saved there is no name to show, so it says what
				// the software is rather than printing an empty band.
				org={reading.stored.legal_name === '' ? PRODUCT_NAME : reading.stored.legal_name}
				under={
					<a className="adm-rail__address" href={dashboard} target="_blank" rel="noreferrer">
						<span>{dashboard}</span>
						<Mark name="external-link" />
					</a>
				}
				groups={groups}
				link={RouterLink}
				current={here?.label}
				wayOut={closeControl}
				foot={foot}
				head={
					<>
						<span className="adm-headstrip__title">{here?.label}</span>
						<CheckAgain key={pathname} />
					</>
				}
			>
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
			</AppShell>
		</RailLabelsProvider>
	);
}

/**
 * what another hand can change between loads — what cloudflare is holding for this deployment —
 * read again, from the strip over every page.
 *
 * the soft rank, because it re-reads the page it stands on and changes nothing on the deployment. it
 * posts through a fetcher (../lib/close-confirm.tsx says why), and the fetcher's answer is what says
 * the read was taken; keyed on the page by its caller, so the answer is the page's own and leaving
 * the page drops it.
 */
function CheckAgain(): ReactNode {
	const check = useFetcher();
	const { busy } = usePress();
	return (
		<check.Form className="adm-actions" method="post" action={SHELL_ACTION} preventScrollReset>
			<Button
				type="submit"
				name="intent"
				value={CHECK_INTENT}
				variant="soft"
				size="sm"
				disabled={busy}
				aria-busy={check.state !== 'idle'}
			>
				Check again
			</Button>
			{check.state === 'idle' && check.data !== undefined ? (
				<p className="adm-momentary">Checked just now.</p>
			) : null}
		</check.Form>
	);
}

// the one way a page learns the console has stopped: a request it cannot reach the local process
// with at all. drawn as the panel a route outside the shell is, because there is no reading to draw
// a shell from — the same words wherever it is met (../lib/deployment-states.tsx). the foot stands
// with no release in it: a boundary has no loader, so nothing here read what this binary is.
export function ErrorBoundary() {
	return (
		<PanelRoute foot={<ProductFoot version="" />}>
			<title>{TITLE}</title>
			<ConsoleStopped />
		</PanelRoute>
	);
}
