import { Button } from '@better-giving/operator/components/controls/Button';
import { InlineCode } from '@better-giving/operator/components/data/CodeSlab';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { StatedValue } from '@better-giving/operator/components/forms/StatedValue';
import { PanelRoute } from '@better-giving/operator/components/shell/AppShell';
import { BareShell } from '@better-giving/operator/components/shell/BareShell';
import { Column } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { holdBar } from '@better-giving/operator/progress-bar';
import type { ReactNode } from 'react';
import { useCallback, useRef } from 'react';
import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { Form, Link, redirect, useNavigation, useSearchParams } from 'react-router';
import { closeConsole, connect } from '../api/client';
import type { Blocked, NoReport } from '../api/types';
import { CHECK_INTENT, CLOSE_INTENT, CloseConfirm, useClosed } from '../lib/close-confirm';
import { firstUnfinishedPage } from '../lib/console-pages';
import { handOver, readConsole } from '../lib/console-reading';
import { ConsoleStopped } from '../lib/deployment-states';
import { CLOSE_PARAM, consoleRereads } from '../lib/dialog-params';
import { ConsoleHead } from '../lib/head-strip';
import { forgetReadings } from '../lib/processor-cache';
import { ProductFoot } from '../lib/product-foot';
import { Said } from '../lib/said';
import { UNREAD_ANSWER_TITLE } from '../lib/unread-answer';
import type { Route } from './+types/_index';

// `/` — what the console draws before a deployment is ready, and the way into one that is.
//
// **it has three faces, and a ready deployment is none of them.** the governing rule is that a
// screen depending on something unconfigured is not drawn at all: no section page before there is a
// deployment, and none before this console can read the deployment it is about. so the operator is
// never handed a control over a thing that does not exist yet. the binary decides which face
// (`packages/console/internal/deployment`); nothing about which face is on screen is decided here.
// a ready deployment is sent to the first section page with something left to do
// (../lib/console-pages.ts), where the sections shell stands (./_sections.tsx).
//
// **the page opens connected, and nothing on it signs in, chooses an account or finds a
// deployment.** `better-giving start` does all three, and connects, before it serves this page
// (`packages/console/cmd/better-giving/start.go`), so there is no face before the shell: the account
// is settled by the time anything here is read.
//
// **the head is the cloudflare account, and the account is everything on it.** it is the only thing
// true on every face, which is what earns it the line the page is headed by, with the press that
// ends this console beside it.
//
// **the one connection state this page draws is the re-connect gate, and re-connecting is a press
// and never a page load.** a session that drops mid-use leaves the deployment unreadable, and
// writing the session secret again deploys a new version of the worker and replaces whatever session
// was on it — so a console that re-connected because a tab reloaded would revoke another operator's
// session with nobody having asked. `packages/console/internal/deployment/connect.go` holds the
// whole of it.
//
// **nothing on this page deploys.** standing a deployment up and carrying newer code onto one are
// the one terminal command of this binary — `better-giving start` — and it is what opens the
// one-way door the remote migration is. this page names the command and offers no press of its own.
//
// **`BETTER_AUTH_URL` has no box and no press.** the app falls back to the origin a request arrived
// on when nothing is pinned (`packages/app/src/lib/server/auth/index.ts`), so a box would only
// create a way to be wrong and a press would be a full deploy of this repository for it; pinning
// one is the escape hatch DEPLOY.md documents.
//
// reads are the binary's and this `clientLoader`'s, writes are the presses below, and every
// failure is a value: nothing here throws, because a rejected promise in a loader is a 500 in place
// of the state that explains it.

/** what the re-connect press on the unreachable face posts. */
const CONNECT_INTENT = 'connect';

/** what the re-connect press is described by, which is what pressing it costs somebody else. */
const COLLEAGUE_COST = 'colleague-cost';

/**
 * what a browser tab says this is: the console's name, which every section page's title ends with.
 *
 * exported for ../root.tsx, which draws the document's own waiting face: nothing here is served, so
 * the tab is titled by the root before any route has read anything.
 */
export const TITLE = 'Console';

export function meta(): Route.MetaDescriptors {
	return [{ title: TITLE }];
}

/**
 * which face to draw, off the binary — or which page a ready deployment opens on.
 *
 * **nothing here is served, and there is no loader to serve it**: the sign-in, the account and
 * every reading of the deployment are the binary's, answered on the loopback address, so the
 * decision is made in the browser where all of them are in hand.
 *
 * **a ready deployment's reading is handed over to the redirect**, which is a navigation of its own:
 * the sections shell it lands in would otherwise read everything again a moment after this did
 * (../lib/console-reading.ts).
 *
 * **the bar over the screen being replaced is finished before a face is handed back**
 * (packages/operator/src/progress-bar.ts). a redirect finishes nothing: the navigation it starts
 * takes the bar.
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
	const bar = holdBar(new URL(request.url).pathname);
	const read = await readConsole(request);
	const face = read.reading.face;
	if (face.kind === 'ready') {
		handOver(read);
		throw redirect(firstUnfinishedPage(read.reading.sections));
	}
	await bar.finish();
	return {
		version: read.version,
		account: read.account,
		accountId: read.accountId,
		remembered: read.remembered,
		notKept: read.notKept,
		workerName: read.workerName,
		face
	};
}

/**
 * the presses answered here: the re-connect on this page's gate, and the two that stand over every
 * screen of this console, which post here wherever they are pressed (../lib/close-confirm.tsx).
 *
 * **the binary owns all of them**: each is one call on the loopback address, and what a press
 * carries is what the operator asked for. the account it is spent on, the worker it is addressed to
 * and the address it is written at are read inside the binary and never posted — a name that
 * travelled through a page is a value written wherever that page said.
 */
export async function clientAction({ request }: Route.ClientActionArgs) {
	await forgetReadings();
	const posted = await request.formData();
	const intent = posted.get('intent');

	/**
	 * mints a session and writes it to the deployment, from the gate a dropped session leaves.
	 *
	 * the address it is written at is read inside the binary and never posted: a host that travelled
	 * through a page is a credential written wherever that page said. one press at a time — a second
	 * while one is in flight joins the first's outcome rather than minting a second session.
	 */
	if (intent === CONNECT_INTENT) return { connect: await connect() };

	/**
	 * runs the whole check again. nothing is asked of the binary here: what the press does is send
	 * the screen it was pressed on through its own reading again, and that reading is where every
	 * finding is decided.
	 */
	if (intent === CHECK_INTENT) return { checked: true };

	/**
	 * ends the run this console is inside, and asks the browser for the tab back.
	 *
	 * nothing on cloudflare and nothing on the deployment changes: what stops is the process on this
	 * machine, and the account, the session and the twenty-one values are exactly where they were.
	 *
	 * **`window.close()` is a request the browser is free to refuse**, and chrome refuses it on a tab
	 * no script opened — this one was opened by the binary. so the answer below is what the screen is
	 * left holding, and what it draws from it is nothing at all (`useClosed` in
	 * ../lib/close-confirm.tsx).
	 *
	 * no redirect: there is nothing left to load. `consoleRereads` is what keeps the router from
	 * asking anyway.
	 */
	if (intent === CLOSE_INTENT) {
		await closeConsole();
		window.close();
		return { closing: true as const };
	}

	// nothing posts anything else here. a body naming nothing, or naming a press drawn on a section
	// page, is answered rather than run.
	return { unknown: true as const };
}

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
	return consoleRereads(args);
}

export default function Console({ loaderData, actionData }: Route.ComponentProps) {
	const navigation = useNavigation();
	const posted = navigation.formData?.get('intent');
	const intent = typeof posted === 'string' ? posted : null;
	const busy = intent !== null;

	/* whether the confirm over the close press is up. it is a parameter on the address rather than
	   state, which is what makes the way out of it a link: a GET back to this page drops it, and that
	   is what Escape answers with too — `Modal` hands the request back rather than closing the
	   element, so the address and what is on the screen cannot disagree (../lib/dialog-params.ts). */
	const [params] = useSearchParams();
	const closed = useClosed();
	if (closed) return null;

	/* the same strip under every face below, settled once so no face can be the one that forgets it. */
	const foot = <ProductFoot version={loaderData.version} />;

	/* the press at the head's trailing end, which stands opposite the account rather than acting on
	   it: it ends the run this console is, and the record naming the account is written at the
	   terminal and left exactly as it is. the mark is the plug being pulled: the set closes over no
	   power glyph (packages/operator/src/components/status/glyphs.js), and a plug pulled reads for a
	   press that ends a run. its label is the whole of its name. a link and not a submit, because what
	   it opens is the confirm. it is never held while another press is running, which is why no
	   `busy` reaches it: the binary waits for the press it is holding to finish before it shuts
	   anything down, so confirming over a save cuts nothing short. */
	const closeControl = (
		<Button
			as={Link}
			to={`/?${CLOSE_PARAM}`}
			variant="soft"
			size="sm"
			mark="unplug"
			aria-label="Close console"
		/>
	);

	/* the same head on every face under it, because what it states is true on all of them. what this
	   machine could not write down stands under the strip for the same reason (../lib/head-strip.tsx). */
	const head = (
		<ConsoleHead
			account={loaderData.account}
			accountId={loaderData.accountId}
			control={closeControl}
			remembered={loaderData.remembered}
			notKept={loaderData.notKept}
		/>
	);

	const connected = actionData && 'connect' in actionData ? actionData.connect : null;
	const home = loaderData.face;

	/* the gate stands in the middle of the space under the head rather than at the top of a column:
	   one question and one way out is not a page anybody reads from the top. */
	const face =
		home.kind === 'deploy' ? (
			<NotDeployedFace foot={foot} head={head} />
		) : home.kind === 'unreachable' ? (
			<BareShell head={head} foot={foot} centred>
				<UnreachableFace
					read={home.read}
					address={home.address}
					workerName={loaderData.workerName}
					accountName={loaderData.account}
					busy={busy}
					intent={intent}
					connected={connected}
				/>
			</BareShell>
		) : (
			<BareShell head={head} foot={foot}>
				<Column>
					<BlockedFace
						why={home.why}
						account={loaderData.account}
						workerName={loaderData.workerName}
					/>
				</Column>
			</BareShell>
		);

	/* the confirm stands beside the face rather than inside any one: the press that opens it is on
	   the head, which every face draws, and a copy per face is how two of them come to ask
	   differently. */
	return (
		<>
			{face}
			{params.has(CLOSE_PARAM) ? <CloseConfirm back="/" /> : null}
		</>
	);
}

/**
 * why nothing under the head can be drawn.
 *
 * no section page and no press: every reading below a blocker is scoped to something the console
 * could not find out, and a row drawn over a read that never landed is a finding about cloudflare
 * reported as a finding about this deployment.
 */
function BlockedFace({
	why,
	account,
	workerName
}: {
	why: Blocked;
	account: string;
	workerName: string;
}): ReactNode {
	if (why.kind === 'no-credential') {
		return (
			<>
				<PageHeader title="This machine isn't signed in to Cloudflare" />
				<Banner tone="blocker" word="Nothing in this account was read">
					The console is holding no Cloudflare sign-in for this machine. Close the console and run{' '}
					<InlineCode>better-giving start</InlineCode> again to sign in.
				</Banner>
				{why.detail === '' ? null : (
					<p className="adm-hint">
						<InlineCode>{why.detail}</InlineCode>
					</p>
				)}
			</>
		);
	}
	if (why.kind === 'refused') {
		return (
			<>
				<PageHeader title="Cloudflare turned this sign-in down" />
				<Banner tone="blocker" word="Nothing in this account was read">
					Cloudflare won't tell this sign-in what {account} is holding. Ask an administrator of that
					account for administrator access, or run <InlineCode>better-giving login</InlineCode> in
					the terminal you start the console from to record a different one.
				</Banner>
			</>
		);
	}
	if (why.kind === 'unreachable') {
		return (
			<>
				<PageHeader title="Can't reach Cloudflare" />
				<Banner tone="blocker" word="Nothing in this account was read">
					Check this machine's internet connection, then reload.
				</Banner>
			</>
		);
	}
	if (why.kind === 'two-databases') {
		return (
			<>
				<PageHeader title="Two databases of one name" />
				{/* the one thing about the database the press cannot repair: every remote path resolves
				    it by name, so a deploy would bind to one of these without saying which. */}
				<Banner tone="blocker" word="A deploy would pick one without saying which">
					{why.count} databases in {account} are called <InlineCode>better-giving</InlineCode>.
					Delete or rename the ones that aren't this deployment's at{' '}
					<a href={DASHBOARD} target="_blank" rel="noreferrer">
						dash.cloudflare.com
					</a>{' '}
					&rarr; Storage &amp; Databases &rarr; D1, then reload.
				</Banner>
			</>
		);
	}
	if (why.kind === 'no-values') {
		/* the deployment is up and answering, and one of the two doors its twenty-one values come
		   through is not (`packages/console/internal/deployment/values.go`). every section page reads
		   them, so there is nothing to draw — and nothing here to repair by hand either: the way out
		   is the read taken again, which is what a reload is.

		   this face carries no press of its own, unlike the deployment-side one beside it: what
		   failed is a Cloudflare read taken while the page was being built, so the control that
		   would ask again is the page. */
		return (
			<>
				<PageHeader title="Cloudflare won't say what this deployment is holding" />
				<Banner tone="blocker" word="Nothing about this deployment was read">
					{workerName} is deployed and answering this console, and Cloudflare won't say what it was
					set up with. Nothing about mail, payments or your sites can be shown until it does.
					Reload.
				</Banner>
				{why.detail === '' ? null : (
					<p className="adm-hint">
						<InlineCode>{why.detail}</InlineCode>
					</p>
				)}
			</>
		);
	}
	return (
		<>
			<PageHeader title="It answers on no address" />
			<Banner tone="blocker" word="Nothing outside Cloudflare can reach it">
				{why.why === 'unregistered'
					? 'This account has never registered a workers.dev subdomain.'
					: why.why === 'turned-off'
						? 'Its workers.dev address is turned off.'
						: 'It answers on a workers.dev address this account would not name.'}{' '}
				Turn workers.dev on, or attach a domain, at{' '}
				<a href={DASHBOARD} target="_blank" rel="noreferrer">
					dash.cloudflare.com
				</a>{' '}
				&rarr; Compute (Workers), then reload.
			</Banner>
		</>
	);
}

/** where the cloudflare dashboard is, for the states repaired over there. */
const DASHBOARD = 'https://dash.cloudflare.com';

/**
 * no worker of this deployment's name is in the account, and the command that puts one there.
 *
 * **it is a card and not a page**: one finding, one way out, centred in the window. a shell, a bar
 * and a page header around a single sentence is furniture standing in for content, and every fact a
 * bar would carry is read over a deployment that does not exist yet.
 *
 * **it carries no press, because standing a deployment up is `better-giving start` in a terminal.**
 * that chain makes a database, applies a remote migration and uploads a worker — minutes behind a
 * door that does not close again — and a browser tab is the wrong thing for an operator to have to
 * keep open across it. the sentence says where the command is typed, because the reader is in a
 * browser and a bare command name is one they have nowhere to put.
 *
 * **the heading says what is missing and the sentence says what to do**, which is the whole of the
 * card. cloudflare's own name is nowhere on it either: the head over it already states the account.
 */
function NotDeployedFace({
	foot,
	head
}: {
	/** the strip every screen of this console stands, handed down rather than built again here. */
	foot: ReactNode;
	/* the head, handed down rather than built again here, the way `foot` above is: what it states is
	   true on every face of this console, so a face building its own is how two of them come to
	   state it differently. */
	head: ReactNode;
}): ReactNode {
	return (
		<BareShell head={head} foot={foot} centred>
			<div className="adm-panel">
				<h1>No deployment found</h1>
				<p className="adm-prose">
					Run <InlineCode>better-giving start</InlineCode> in the terminal you start the console
					from to create it.
				</p>
			</div>
		</BareShell>
	);
}

/**
 * deployed, and this console cannot read it: the gate standing in front of every section page.
 *
 * **the account stays on the head and everything the gate makes unreadable comes off** — the rail,
 * the section pages, and the address they are all read over. what is left is one question and one
 * press, which is what a gate is.
 *
 * **it is the one connection state this page draws.** `better-giving start` connects before the page
 * is served, so no session and a session turned away are both a session that dropped mid-use — the
 * other operator's press on their own console, or twelve hours running out.
 *
 * **the address is a literal here and a link in the sections shell's rail.** there it is a
 * destination and an operator working on the deployment follows it; here it is the thing being
 * named, and a link out of a gate is an invitation to leave through it.
 *
 * **which deployment stands before what pressing costs.** the consequence is about this one, and a
 * reader who has not yet seen its name and its address has nothing to weigh it against.
 *
 * **one consequence over the button, and it is the one nobody in the room can see.** connecting
 * replaces whatever session the Worker holds, so a colleague's console stops at that moment — they
 * are not here, the press cannot be undone for them, and nobody would guess it
 * (`packages/console/internal/deployment/connect.go`). that it cuts a new version of the Worker is
 * not said: what
 * that costs the operator is a few seconds, which the dots on the press already carry, and a fear
 * stated over a button is one the next sentence has to relieve. the twelve hours stands under the
 * control rather than over it, because it decides nothing — it earns a place at all only because no
 * other screen on this console says when a connection ends.
 *
 * **two of the four states are not connected to; they are updated.** a `no-surface` connect would
 * write this deployment's credential to a Worker that is not it, and an out-of-step one would mint
 * a session against a surface that answered in a shape this console could not read — so neither
 * offers the session press, and what both name instead is the command that repairs them.
 */
function UnreachableFace({
	read,
	address,
	workerName,
	accountName,
	busy,
	intent,
	connected
}: {
	read: NoReport;
	/** where the deployment answers, named as a literal to recognise and never as a destination. */
	address: string;
	workerName: string;
	accountName: string;
	busy: boolean;
	intent: string | null;
	connected: Awaited<ReturnType<typeof connect>> | null;
}): ReactNode {
	// each state's own heading, so that a press which removes the control the operator was standing
	// on leaves them somewhere rather than nowhere.
	//
	// what is held is the state last drawn and not a count of draws: a ref callback runs again
	// whenever the heading is attached again, and a count reads that as a state change and takes
	// focus nobody asked for. a state that has not changed cannot be a press's outcome however many
	// times it is drawn.
	const drawn = useRef<NoReport['kind'] | null>(null);
	const heading = useCallback(
		(node: HTMLElement | null) => {
			if (node === null) return;
			const before = drawn.current;
			drawn.current = read.kind;
			if (before !== null && before !== read.kind) node.focus();
		},
		[read.kind]
	);

	const title = (words: string) => (
		<h1 key={read.kind} tabIndex={-1} ref={heading}>
			{words}
		</h1>
	);

	/* which deployment this is about, in the face an operator checks an address character for
	   character in. two rows and no more: the account is on the head, and everything else this
	   console could say is read over the session that is missing.

	   the label stands over its value rather than beside it, which is what the panel has room for:
	   `.adm-setting`'s two-column reflow gives the label a 20rem track from 44rem up
	   (packages/operator/src/styles/adm.css), and inside a panel measured at 26rem that leaves the
	   address a column a character wide. */
	const rows = (
		<div>
			<StatedValue label="Name" value={workerName} code />
			<StatedValue label="Address" value={address} code />
		</div>
	);

	/* the way out of the two states nothing else on this gate repairs, drawn under the rows for the
	   reason the connect press is: which deployment this is about stands before what is to be done
	   about it. it is a command and not a press: carrying newer code across applies a remote
	   migration, which is a door that does not close again, and a run of minutes behind a browser
	   tab is one an operator can close. */
	const applying = (
		<p className="adm-prose">
			Run <InlineCode>better-giving start</InlineCode> in the terminal you start the console from to
			carry this console&rsquo;s code onto it.
		</p>
	);

	const recheck = (
		<Form className="adm-actions" method="post" preventScrollReset>
			<Button
				type="submit"
				name="intent"
				value={CHECK_INTENT}
				disabled={busy}
				aria-busy={intent === 'check'}
			>
				Check again
			</Button>
		</Form>
	);

	if (read.kind === 'no-surface') {
		return (
			<div className="adm-panel">
				{title('Something else is at that address')}
				<p className="adm-prose">
					Whatever is answering there isn't this deployment, or it's older than this console.
				</p>
				{rows}
				{applying}
			</div>
		);
	}

	if (read.kind === 'unreachable') {
		return (
			<div className="adm-panel">
				{title("Can't reach this deployment")}
				<p className="adm-prose">
					Nothing answered at that address. A deployment set up in the last few minutes can take a
					little longer to start answering. If it's older than that, check this machine's internet
					connection.
				</p>
				{rows}
				{recheck}
			</div>
		);
	}

	if (read.kind === 'unreadable') {
		return (
			<div className="adm-panel">
				{title(UNREAD_ANSWER_TITLE)}
				<p className="adm-prose">
					A deployment older than this console answers this way, and so does one that failed while
					answering. The command below brings the first up to date.
				</p>
				{rows}
				{/* the deployment's own words, which are the only thing on this screen that says which
				    of the two is behind — read before the press rather than under it, because it is what
				    decides whether the press is the right one. */}
				<Said answer={read} />
				{applying}
			</div>
		);
	}

	// no session of ours, or one the deployment turned away: one press answers both, and neither is
	// worth two faces of a gate that asks one question.
	const pending = intent === CONNECT_INTENT;
	return (
		<div className="adm-panel">
			{title('Connect to your deployment')}
			<p className="adm-prose">Nothing about it can be shown until you do.</p>
			{rows}
			{/* a paragraph the button points at rather than a hint under it: it is a third party's cost
			    that a fast reader skips. */}
			<p className="adm-prose" id={COLLEAGUE_COST}>
				If a colleague has this console open on the same deployment, connecting here stops theirs
				and they'll need to connect again.
			</p>
			<Form className="adm-actions" method="post" preventScrollReset>
				<Button
					type="submit"
					name="intent"
					value={CONNECT_INTENT}
					variant="primary"
					disabled={busy}
					aria-describedby={COLLEAGUE_COST}
					aria-busy={pending}
				>
					Connect
				</Button>
				{connected === null || connected.kind === 'connected' ? null : (
					// reported at the control that was pressed. the row stands on its own rather than
					// under a box: what this is about is a press, and `Field` draws its rows under the
					// box it labels — there is no box here to hang one off.
					<FieldMessage>
						{connected.kind === 'nowhere' ? (
							// the same words ../lib/smtp-fold.tsx says this in, because it is the same
							// fact: the deployment answers nowhere, and the way out is over at cloudflare.
							<>
								This deployment answers on no address, so there's nowhere to connect to. Turn its{' '}
								<InlineCode>workers.dev</InlineCode> address back on, or attach a domain, at{' '}
								<a href={DASHBOARD} target="_blank" rel="noreferrer">
									dash.cloudflare.com
								</a>{' '}
								&rarr; Compute (Workers), then try again.
							</>
						) : connected.kind === 'refused' ? (
							<>
								Cloudflare won't let this sign-in change <InlineCode>{workerName}</InlineCode> in{' '}
								{accountName}. Nothing was connected. Ask an administrator of that account for
								administrator access, or switch account.
							</>
						) : connected.kind === 'unreachable' ? (
							// this machine's own call failing, so it is kept off cloudflare's name: what
							// the slab under it carries is a fetch that never landed and no sentence
							// cloudflare sent (../lib/secret-trouble.tsx).
							<>
								This console couldn't reach Cloudflare, so nothing was connected. Check this
								machine's connection, then try again.
							</>
						) : (
							'Nothing was connected. This is what Cloudflare said:'
						)}
					</FieldMessage>
				)}
				{connected?.kind === 'refused' ||
				connected?.kind === 'unreachable' ||
				connected?.kind === 'failed' ? (
					<Said answer={connected} />
				) : null}
			</Form>
			<p className="adm-hint">A connection lasts twelve hours.</p>
		</div>
	);
}

// the one way this page learns the console has stopped: a request it cannot reach the local process
// with at all. drawn as the panel a route outside the shell is, because there is no reading to draw
// a shell from — the same words wherever it is met (../lib/deployment-states.tsx).
//
// it stands the same foot as every other screen, with no release in it: a boundary has no loader,
// so nothing here read what this binary is and that end of the strip stands empty.
export function ErrorBoundary() {
	return (
		<PanelRoute foot={<ProductFoot version="" />}>
			<title>{TITLE}</title>
			<ConsoleStopped />
		</PanelRoute>
	);
}
