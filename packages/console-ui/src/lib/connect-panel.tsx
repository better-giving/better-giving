import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Button } from '@better-giving/operator/components/controls/Button';
import { CodeSlab, InlineCode } from '@better-giving/operator/components/data/CodeSlab';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { PanelRoute } from '@better-giving/operator/components/shell/AppShell';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { Brand } from '@better-giving/operator/components/status/Brand';
import type { ReactNode } from 'react';
import { useCallback, useRef } from 'react';
import { Form, Link, useNavigate, useSearchParams } from 'react-router';
import type { Face } from './connect-face';
import { SIGNIN_PARAM } from './dialog-params';
import { HeadIdentity } from './head-strip';
import { ProductFoot } from './product-foot';

// the page before there is a page: one centred panel, and no shell at all. `signed-out` is the one
// face that draws no panel either — it is a single press, and a box around one control draws a
// boundary around nothing. `bare` in
// packages/operator/src/components/shell/AppShell.jsx states what qualifies.
//
// **the foot is drawn on every face**, and it is ./product-foot.tsx's — the same strip every screen
// this console draws stands, on the terms that module states.
//
// **the head is drawn on `unchosen` and `account-gone` alone**, because what it carries is a
// cloudflare identity: who this machine is signed in as at one end, and the way out of that sign-in
// at the other. no face above those two has one to name: a sign-in that never finished, one
// cloudflare turned down and a read that would not land are all states with nobody signed in. every
// other fact the console holds is scoped to an account as well — the database, the worker, the
// address, the session and everything read over it — so a strip carrying one of those would be a
// strip with nothing true on it, and a ledger under this panel would be a run of readings nobody
// made. all of them wait for the shell, which arrives with the account.
//
// **all seven of ./connect-face.ts's faces that are not `connected` land here**, and each is the
// same panel with its own words. they are one composition rather than seven screens for the reason
// that module states: the operator's whole task on this screen is getting this machine signed in,
// and a url change between each state of that would be a step in a wizard the console is not.
//
// **which account this deployment belongs to is recorded at the terminal and not here**, so the two
// faces about that account state it and name `better-giving login`. no chooser stands on this
// panel: a list of accounts with a press under it is a second way to make the one choice that
// cannot be unmade, and two ways to make it is two places it can be made differently.
//
// no press here reaches cloudflare from the browser and none could: cloudflare's API sends no
// cross-origin headers, and this deployment's authority is the sign-in the binary holds. what the
// browser posts is intent — a press and nothing else.
//
// **the way out of a wrong cloudflare identity is here and on no other face.** an operator signed
// in as the wrong person meets it on the two faces about the account, which is `unchosen` and
// `account-gone` and nothing above them: there is no sign-in to leave on `signed-out`, `waiting`
// and `unfinished`, the way out of `expired` is signing in again, and the three that never reached
// cloudflare are about this repo and this machine. it is quiet and stands in the head across from
// the identity it leaves, because what it acts on is that identity and not the account under it.
//
// pending is `aria-busy`, and the shared button draws the dots.

export type ConnectPanelProps = {
	face: Exclude<Face, { kind: 'connected' }>;
	/** the release this binary was built as, handed straight to ./product-foot.tsx's own prop. */
	version: string;
	/** the intent in flight, or `null`. one value because only ever one of these is submitting. */
	pending: string | null;
	/** a second sign-in was asked for while one is already open in a browser. */
	alreadySigningIn: boolean;
};

export function ConnectPanel({
	face,
	version,
	pending,
	alreadySigningIn
}: ConnectPanelProps): ReactNode {
	// where each face puts the operator, so that a transition which removes the control they were
	// standing on puts them somewhere rather than nowhere: without this a keyboard operator who
	// pressed `Sign in to Cloudflare` is left on a button that no longer exists.
	//
	// **it is the face's heading everywhere but `signed-out`, which draws none and takes its own
	// press instead.** that face is the sign-in button alone, and its heading is a run of words with
	// no box on the screen (`.adm-vh`) — landing focus there would put a sighted keyboard operator
	// on nothing they can see, so it lands on the one control the face has.
	//
	// **what it holds is the face it last landed on, and it takes focus only where the face landing
	// is a different one.** the first paint therefore takes none — nothing was on screen for the
	// operator to be moved off — which is the whole of what the guard is for: focus belongs wherever
	// the browser put it until a transition takes it away.
	//
	// it is the face and not a count of landings, because react attaches a ref twice over one mount
	// under `<StrictMode>` — this package writes no `entry.client.tsx`, so the one react router
	// supplies is what hydrates the tree and it wraps it in one — and a count reads that second
	// attach as a second face. reading the face instead makes a repeated attach of the same mount
	// indistinguishable from no attach at all. exactly one element per face carries this, so "a
	// different face landed" is the whole of the question, whichever element the face put it on.
	const landed = useRef<ConnectPanelProps['face']['kind'] | null>(null);
	const landing = useCallback(
		(node: HTMLElement | null) => {
			if (node === null) return;
			if (landed.current !== null && landed.current !== face.kind) node.focus();
			landed.current = face.kind;
		},
		[face.kind]
	);

	// the dialog is a parameter on the address, which is what makes the way out of it a link: a GET
	// back to this page drops the parameter, and that is what Escape answers with too — `Modal` hands
	// the request back rather than closing the element, so the address and what is on the screen
	// cannot disagree.
	const [params] = useSearchParams();
	const navigate = useNavigate();

	const title = (words: string) => (
		<h1 key={face.kind} tabIndex={-1} ref={landing}>
			{words}
		</h1>
	);

	/* the press that hands the operator to cloudflare, drawn as the sign-in with a provider it is:
	   the company's own logo on the line, and the company named in the words beside it.

	   **the logo is decoration here and carries no label.** the word `Cloudflare` stands in the
	   button's own text, so a labelled logo is the company announced twice inside one control —
	   which is the case `Brand` documents as the one that leaves the name off. it is the same
	   component either way rather than a span written here, because the closed `BrandName` is what
	   keeps a second company's logo a decision somebody reads.

	   the secondary rank rather than the primary one, and the face is what settles that: this is the
	   only control on the screen, so there is nothing for a rank to be louder than, and a provider
	   press is read by its logo rather than by its fill. it is centred for the same reason — a row
	   of actions reads from the same edge as what it acts on, and there is nothing above this one.

	   `claims` is the `signed-out` face taking the focus its heading takes everywhere else. */
	const signInControl = (claims = false) => (
		<Form className="adm-actions adm-actions--centred" method="post" preventScrollReset>
			<Button
				key={face.kind}
				ref={claims ? landing : undefined}
				type="submit"
				name="intent"
				value="signIn"
				aria-busy={pending === 'signIn'}
			>
				<Brand name="cloudflare" />
				Connect to Cloudflare
			</Button>
			{alreadySigningIn ? (
				// reported at the control that was pressed, because that is where it happened. the row is
				// the shared one and stands on its own: what this is about is a press, and `Field` draws
				// its rows under the box it labels — there is no box here to hang one off.
				<FieldMessage>
					A sign-in is already open in your browser. Finish that one, or stop waiting first.
				</FieldMessage>
			) : null}
		</Form>
	);

	/* who this machine is signed in to cloudflare as, and the way out of it — the head strip's two
	   ends, which is what ./head-strip.tsx holds to on both of this console's screens.

	   an api token has no way out here and must not get one: `CLOUDFLARE_API_TOKEN` is what the
	   console is using while it is set, whatever this machine has stored, so the way out of a wrong
	   token is the terminal the console was started from. what the strip carries on that branch is
	   the words, because a strip naming the identity has to name that one too — and it is a sentence
	   rather than an identity, so it is the caption it reads as rather than a name with nothing
	   under it.

	   the address is named where cloudflare gives one, because what is being left is a sign-in and
	   the operator has to see which. a browser sign-in cloudflare names no email for is a sign-in
	   with nobody to name, so the leading end stands empty rather than holding a line with a hole in
	   it.

	   **the press is the mark alone and its name is what states the company.** nothing on the screen
	   spells it out, so a bare `Sign out` would be a press an operator cannot place — this console
	   has no session to end, `signOut` in packages/operator/src/components/shell/AppShell.jsx being
	   `null` on every screen it draws — and the label is where that is answered. what the press
	   costs is the dialog's, which is where the cost of a press belongs. */
	const identity = (token: boolean, email: string | null) =>
		token ? (
			<span className="adm-caption">Using this machine's API token</span>
		) : (
			<HeadIdentity
				name={email}
				control={
					<Button
						as={Link}
						to={`/?${SIGNIN_PARAM}`}
						variant="soft"
						size="sm"
						mark="log-out"
						aria-label="Sign out of Cloudflare"
					/>
				}
			/>
		);

	const recheck = (
		<Form className="adm-actions" method="post" preventScrollReset>
			<Button type="submit" name="intent" value="check" aria-busy={pending === 'check'}>
				Check again
			</Button>
		</Form>
	);

	/* what records which cloudflare account this deployment is in, which the console does not do and
	   must not: the choice cannot be unmade, and a press here would be a second place to make it. it
	   is `better-giving login` in a terminal, and the sentence says so in those words — the operator
	   reading this is in a browser, so a bare command name is one they have nowhere to put.

	   it is the same command on both faces it is drawn on, because it is the same errand: sign in if
	   the sign-in is the thing that is wrong, and record an account either way. */
	const chooseCommand = (
		<>
			Run <InlineCode>better-giving login</InlineCode> in the terminal you start the console from
		</>
	);

	/* the parameter is honoured only where the control that sets it is drawn: an address typed with
	   it on any other face would open a dialog about a sign-in that face has no way to leave. */
	const leaving =
		params.has(SIGNIN_PARAM) &&
		(face.kind === 'unchosen' || face.kind === 'account-gone') &&
		!face.token;

	return (
		<PanelRoute
			bare={face.kind === 'signed-out'}
			bar={
				face.kind === 'unchosen' || face.kind === 'account-gone'
					? identity(face.token, face.email)
					: undefined
			}
			foot={<ProductFoot version={version} />}
		>
			{face.kind === 'unreachable' ? (
				<>
					{title("Can't reach Cloudflare")}
					<p className="adm-prose">
						Your accounts didn't load. Check this machine's internet connection, then check again.
					</p>
					{recheck}
				</>
			) : face.kind === 'signed-out' ? (
				<>
					{/* the press and nothing else, standing on the page's own ground: the browser page it
					    opens is announced by the waiting face, and a sign-in that lands with no account
					    recorded meets the face that names the command — both are said where they happen
					    rather than predicted here, and a heading over one button names what the button
					    already says. it is the one face here the route draws no panel around, for the
					    reason `bare` at the top of this file states.

					    the page still has a heading, out of the flow rather than off the document
					    (`.adm-vh` in packages/operator/src/styles/base.css): a route with no `h1` at all is
					    a page a screen reader can find no top of. */}
					<h1 className="adm-vh">Connect Cloudflare</h1>
					{signInControl(true)}
				</>
			) : face.kind === 'waiting' ? (
				<>
					{/* polite rather than assertive: what it announces is that a browser tab opened, and
					    later that it resolved. neither interrupts anything worth interrupting.

					    **the region holds the news and nothing an operator can press.** `role="status"` is
					    atomic, so any change inside it is the whole of it read out again: the press below
					    turning busy would report the wait as resolved to the operator who pressed to leave
					    it, and the copy control below would read the whole wait back over a press that put
					    a line on the clipboard. both stand under the region for that one reason, and
					    nothing that changes may move into it. */}
					<div role="status" className="adm-stack">
						{title('Waiting for Cloudflare')}
						<p className="adm-prose">
							A Cloudflare page has opened in your browser. Allow the access it asks for, then come
							back to this tab.
						</p>
					</div>
					{face.address ? (
						<div className="adm-stack">
							<p className="adm-hint">Nothing opened? Open this address yourself:</p>
							{/* a literal to copy rather than a link to follow: the address carries the state of
							    a sign-in already in flight, and the operator is being sent to the browser they
							    already have open rather than to a second tab of this one — so what it needs is a
							    way onto the clipboard and never an anchor.

							    it carries no caption: the line above already names the address and says why
							    it is here, and a caption under it would be the same thing said twice. the
							    control keeps the bare Copy a lone slab is given
							    (packages/operator/src/components/data/CodeSlab.jsx) — this face is the whole
							    page and there is one thing on it to take.

							    the one-line form for the same reason it is the address: one unbroken literal
							    nobody reads, wider than any panel, and here to be copied. */}
							<CodeSlab oneline content={face.address} copyable />
						</div>
					) : (
						<p className="adm-hint">Nothing opened? Press Stop waiting, then sign in again.</p>
					)}
					<Form className="adm-actions" method="post" preventScrollReset>
						<Button
							type="submit"
							name="intent"
							value="stopSignIn"
							aria-busy={pending === 'stopSignIn'}
						>
							Stop waiting
						</Button>
					</Form>
				</>
			) : face.kind === 'unfinished' ? (
				<>
					{title("Sign-in didn't finish")}
					<p className="adm-prose">
						{face.why === 'refused' ? (
							<>
								Cloudflare turned the request down. Until it's approved, the console can't do
								anything in your account.
							</>
						) : face.why === 'timed-out' ? (
							// the console gives up after two minutes, so this is not "the page was closed" and
							// must not be worded as it: an operator who was simply slow would go looking for a
							// tab they never shut.
							<>
								Cloudflare didn't hear back within the two minutes the console waits. Signing in
								again opens a fresh page.
							</>
						) : face.why === 'not-kept' ? (
							// the credential is only ever read back from the record the console writes, so a
							// write that failed is a sign-in this machine does not hold rather than one it
							// holds and did not save.
							<>
								Cloudflare approved the sign-in and the console couldn't write it down. Until{' '}
								<InlineCode>{face.detail}</InlineCode> can be written to, signing in again lands
								here.
							</>
						) : (
							<>
								Cloudflare sent nothing back. The page may have been closed before it was approved.
							</>
						)}
					</p>
					{signInControl()}
				</>
			) : face.kind === 'expired' ? (
				face.token ? (
					<>
						{/* a browser sign-in changes nothing while CLOUDFLARE_API_TOKEN is set: the console
						    uses that token whatever this machine has stored, so this state offers no sign-in
						    control and names the variable instead. */}
						{title("Cloudflare turned down this machine's API token")}
						<p className="adm-prose">
							<InlineCode>CLOUDFLARE_API_TOKEN</InlineCode> is set on this machine and Cloudflare no
							longer accepts it. Replace it in the terminal you start the console from, then check
							again.
						</p>
						{recheck}
					</>
				) : (
					<>
						{title('Your Cloudflare sign-in has expired')}
						<p className="adm-prose">
							Cloudflare no longer accepts the sign-in saved on this machine. Signing in again
							replaces it.
						</p>
						{signInControl()}
					</>
				)
			) : face.kind === 'account-gone' ? (
				<>
					{title("That account isn't on your Cloudflare sign-in")}
					<Banner tone="blocker" word="Nothing about this deployment can be read">
						This deployment was connected to {face.account.name} (
						<InlineCode>{face.account.id}</InlineCode>), and your Cloudflare sign-in no longer
						carries it. Anything already in {face.account.name} stays there.
					</Banner>
					<p className="adm-prose">
						{chooseCommand} to sign in with an account that reaches it, or to record a different
						one.
					</p>
				</>
			) : (
				<>
					{title('No Cloudflare account chosen')}
					{face.token ? (
						<Banner tone="note" word="Signed in with an API token">
							<InlineCode>CLOUDFLARE_API_TOKEN</InlineCode> is set on this machine, so the console
							uses it instead of a browser sign-in. The account this deployment is in has to be one
							that token reaches.
						</Banner>
					) : null}
					<p className="adm-prose">
						This machine hasn&rsquo;t recorded which Cloudflare account this deployment belongs to.{' '}
						{chooseCommand} to choose one.
					</p>
				</>
			)}

			{leaving ? (
				// the `<form>` stands around the whole dialog rather than around the control that submits
				// it, which is the rule `Dialog` states: the actions row holds controls, and a submit
				// belongs to the form enclosing it whether or not the element has been lifted into the
				// top layer. the way out is a link, so it posts nothing and the form around it is inert
				// for that press.
				<Form method="post">
					<Modal
						title="Sign out of Cloudflare on this computer?"
						onDismiss={() => navigate('/')}
						danger="Sign out and sign in again"
						dangerProps={{
							type: 'submit',
							name: 'intent',
							value: 'signOut',
							'aria-busy': pending === 'signOut'
						}}
						cancel="Stay signed in"
						cancelProps={{ as: Link, to: '/' }}
					>
						<p className="adm-prose">
							Cloudflare stops accepting the sign-in this computer holds, and the console asks for
							one again the next time it needs Cloudflare.
						</p>
					</Modal>
				</Form>
			) : null}
		</PanelRoute>
	);
}
