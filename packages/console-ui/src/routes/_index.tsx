import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Button } from '@better-giving/operator/components/controls/Button';
import { InlineCode } from '@better-giving/operator/components/data/CodeSlab';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { StatedValue } from '@better-giving/operator/components/forms/StatedValue';
import { PanelRoute } from '@better-giving/operator/components/shell/AppShell';
import { BareShell } from '@better-giving/operator/components/shell/BareShell';
import { Column } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { Mark } from '@better-giving/operator/components/status/Mark';
import { StatusLedger, StatusLine } from '@better-giving/operator/components/status/StatusLine';
import type { ReactNode } from 'react';
import { useCallback, useRef, useState } from 'react';
import { readOriginList } from '@better-giving/operator/origins';
import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { Form, Link, useNavigate, useNavigation, useSearchParams } from 'react-router';
import { saidClosing } from '../lib/close-answer';
import { CLOSE_PARAM, opensOrDropsDialog } from '../lib/dialog-params';
import { holdBar } from '../lib/progress-bar';
import { ConsoleStopped } from '../lib/deployment-states';
import { ConsoleHead } from '../lib/head-strip';
import type { OrgFoldProps } from '../lib/org-fold';
import { OrgFold } from '../lib/org-fold';
import { NOTIFICATIONS_INTENT, ORG_INTENT, orgEdits } from '../lib/org-fields';
import type { NotificationsFoldProps } from '../lib/notifications-fold';
import { NotificationsFold } from '../lib/notifications-fold';
import type { ProcessorRowsProps } from '../lib/processor-rows';
import { ProcessorRows } from '../lib/processor-rows';
import { processorLinks } from '../lib/processor-links';
import type { SmtpFoldProps } from '../lib/smtp-fold';
import { SmtpFold, TEST_EMAIL_INTENT } from '../lib/smtp-fold';
import { TEST_TO_FIELD } from '../lib/smtp-fold-state';
import type { PasswordFoldProps } from '../lib/password-fold';
import { PasswordFold } from '../lib/password-fold';
import { ProductFoot } from '../lib/product-foot';
import { Said } from '../lib/said';
import type { GroupReport } from '../lib/secret-group-form';
import { PAYPAL_GROUP, groupPosted, pressedNames } from '../lib/secret-groups';
import { heldValues } from '../lib/held-values';
import { FREE_INTENT } from '../lib/withheld-values';
import { UNREAD_ANSWER_TITLE } from '../lib/unread-answer';
import type { SitesFoldProps } from '../lib/sites-fold';
import { SitesFold } from '../lib/sites-fold';
import { SITES_INTENT, siteEdits } from '../lib/sites';
import { unreadHeld } from '../lib/unread-held';
import {
	closeConsole,
	connect,
	consoleVersion,
	freeWithheldVars,
	homeReading,
	homeShape,
	levelWallets,
	levelWidget,
	saveOrgProfile,
	saveSites,
	setVars,
	sendTestEmail
} from '../api/client';
import type {
	Blocked,
	NoReport,
	OrgWrite,
	VarsWritten,
	SitesPress,
	TestSend,
	WidgetLevel
} from '../api/types';
import type { HomeSection, SectionId } from '../lib/home-sections';
import { heldNames, readSections } from '../lib/home-sections';
import { orgBoxes } from '../lib/org-fields';
import { storedOrg } from '../lib/org-form';
import { secretEdits } from '../lib/secret-edits';
import type { Route } from './+types/_index';

// the console, which is this one page.
//
// **it has four faces and which one is drawn is decided by how far set-up has got.** the governing
// rule is that a screen depending on something unconfigured is not drawn at all: no ledger of jobs
// before there is a deployment, and no job's panel before this console can read the deployment it
// is about. so the operator is never handed a control over a thing that does not exist yet, and
// never has to work out which of two findings comes first. the binary decides which face
// (`packages/console/internal/deployment`); nothing about which face is on screen is decided here.
//
// **the page opens connected, and nothing on it signs in, chooses an account or finds a
// deployment.** `better-giving start` does all three, and connects, before it serves this page
// (`packages/console/cmd/better-giving/start.go`), so there is no face before the shell: the account
// is settled by the time anything here is read.
//
// **there is no rail and no status screen, and neither is coming back.** a rail of cells over the
// folds and a screen summarising them are two ways to read the same facts, and a folded row already
// reports where its job stands — so a page listing those reports would be this page read twice.
// what is left is the head, which goes nowhere, and the folds.
//
// **nothing on this page deploys.** standing a deployment up and carrying newer code onto one are
// the one terminal command of this binary — `better-giving start` — and it is what opens the
// one-way door the remote migration is; `better-giving update` installs the console binary and
// reaches no deployment at all. this page names the command and offers no press of its own: a press
// that runs for minutes behind a browser tab is one an operator can close, and a screen is the
// wrong place to stand in front of a door that does not close again. DEPLOY.md has what stands
// around it.
//
// **the head is the cloudflare account, and the account is everything on it.** it states the name
// this deployment lives under and the id cloudflare resolves that name by, with the press that ends
// this console standing beside them — the account itself is recorded at the terminal and no press
// here touches that record. everything the deployment is comes under it: the
// address it answers on heads the page, and the password for the one page on it a human signs in to
// is the first fold (../lib/password-fold.tsx). the account is the only thing true on every face of
// this console, which is what earns it the line the page is headed by.
//
// **the one connection state this page draws is the re-connect gate, and re-connecting is a press
// and never a page load.** a session that drops mid-use leaves the deployment unreadable, and
// writing the session secret again deploys a new version of the worker and replaces whatever session
// was on it — so a console that re-connected because a tab reloaded would revoke another operator's
// session with nobody having asked. `packages/console/internal/deployment/connect.go` holds the
// whole of it.
//
// **`BETTER_AUTH_URL` has no box and no press.** the app falls back to the origin a request arrived
// on when nothing is pinned (`packages/app/src/lib/server/auth/index.ts`), so a box would only
// create a way to be wrong and a press would be a full deploy of this repository for it; pinning
// one is the escape hatch DEPLOY.md documents.
//
// **a credential goes from the box it was typed in into one request body and nowhere else.** a
// group's boxes are read here in the browser (../lib/secret-edits.ts) and what they asked for is
// handed to the binary on the loopback address, which sends the one request to cloudflare — the
// address the value is deliberately absent from included. nothing about a press is written to disk
// or put in an argument list, and no answer to one carries a value: what comes back is a kind, what
// cloudflare said, and the names of any boxes it refused.
//
// **nothing on the page reaches cloudflare and nothing could**: cloudflare's API sends no
// cross-origin headers, and the credential it is reached with is held by the binary on this
// machine. what a press carries is what the operator typed and what they asked for; the account it is spent on, the worker it is addressed to and which names exist at all
// are read off this machine and never off a body.
//
// reads are the binary's and this `clientLoader`'s, writes are the presses below, and every
// failure is a value: nothing here throws, because a rejected promise in a loader is a 500 in place
// of the state that explains it.

/** what the re-connect press on the unreachable face posts. */
const CONNECT_INTENT = 'connect';

/** what the head's one control posts, from the confirm the control opens. */
const CLOSE_INTENT = 'close';

/** what the re-connect press is described by, which is what pressing it costs somebody else. */
const COLLEAGUE_COST = 'colleague-cost';

/**
 * what a browser tab says this is. the console is one page, so the page is the surface.
 *
 * exported for ../root.tsx, which draws the document's own waiting face: nothing here is served, so
 * the tab is titled by this page from the moment the bundle runs and by the root before that.
 */
export const TITLE = 'Console';

export function meta(): Route.MetaDescriptors {
	return [{ title: TITLE }];
}

/**
 * the whole page, off the binary.
 *
 * **nothing here is served, and there is no loader to serve it**: the sign-in, the account and
 * every reading of the deployment are the binary's, answered on the loopback address, so the
 * decision is made in the browser where all of them are in hand.
 *
 * the three reads are asked for at once, and all of them are awaited: the face is a function of the
 * slowest, and the bar under ../root.tsx is the one waiting face this console draws.
 *
 * **the bar over the screen being replaced is finished before this hands anything back.** the
 * document's bar stands while the app starts and ../root.tsx's stands over a page being left, and
 * every bar on this console completes and is seen complete before the screen it stands on is
 * replaced — so this flips that bar to its rush and waits for it to land (../lib/progress-bar.ts).
 * a re-read of this page with the page itself on the screen has no bar over it and returns at once.
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
	const bar = holdBar(new URL(request.url).pathname);
	const read = await readConsole();
	await bar.finish();
	return read;
}

/** every reading the page is a function of, which is the whole of what the loader above hands back. */
async function readConsole() {
	const [home, release, read] = await Promise.all([homeShape(), consoleVersion(), homeReading()]);

	const shell = {
		// the release, printed by the strip that stands under every screen (../lib/product-foot.tsx).
		version: release.version,
		account: home.account.name,
		// what cloudflare resolves that name by. the head states it beside the name because the name
		// is not unique and this is.
		accountId: home.account.id,
		remembered: home.remembered,
		notKept: home.notKept,
		workerName: home.workerName,
		databaseName: home.databaseName
	};

	const reading = {
		face: read.face,
		sections: readSections(read),
		// the seed both folds that edit the profile read.
		stored: orgBoxes(read.org),
		// the seventeen as cloudflare answered for them: the folds draw the rows and the boxes out of
		// the same answer the six rows above were read from.
		values: read.values,
		sites: read.sites,
		donatePage: read.donatePage,
		// the payments fold's rows, which read the held values and nothing about either account: what
		// each processor answers is read on its own screen (./payments_.stripe.tsx,
		// ./payments_.paypal.tsx).
		processors: processorLinks(heldNames(read.values.vars))
	};

	return {
		...shell,
		reading
	};
}

// every face is a browser fetch, so none of it is there when the document arrives: what stands
// until the first of them lands is ../root.tsx's own waiting face, which is where a client-rendered
// app is allowed to put one.

/**
 * how the profile write went, at the control it was made from.
 *
 * **which fold pressed rides in the body.** two folds edit the one profile — the identity and where
 * the deployment reaches the operator — and the answer is drawn under the button that was pressed,
 * so an answer carrying only the write would be drawn under both.
 */
const wrote = (at: 'organisation' | 'notifications', write: OrgWrite) => ({ write: { at, write } });

/**
 * how a credentials write went, at the group it was pressed in.
 *
 * `nothing` carries a code as the failures do, although no fold draws a sentence for it: it is a
 * press with nothing in the group to send, which the button gives no way to make in the first
 * place. what a 200 would cost is a confirmation over a deployment nothing was written to.
 */
/**
 * how the site-list press went, at the control it was made from.
 *
 * the answer carries the press and nothing else. the boxes are the form layer's and no answer
 * redraws them, so a refusal naming an address is read beside the box still holding it — which is
 * what lets this say only how the press went (../lib/sites-fold.tsx).
 */
const stored = (press: SitesPress) => ({ sites: press });

/**
 * every press on this page, and there is no other kind. each processor's presses are answered on
 * that processor's own screen (./payments_.stripe.tsx, ./payments_.paypal.tsx).
 *
 * **the binary owns all of them**, which is why nothing here is served: each is one call on the
 * loopback address, and what a press carries is what the operator typed and what they asked for.
 * the account it is spent on, the worker it is addressed to and the address it is written at are
 * read inside the binary and never posted — a name that travelled through a page is a value written
 * wherever that page said.
 *
 * **the session and the errands it carries are the binary's too.** re-connecting mints a
 * token, writes it onto the deployment and records it on this machine; the presses after it are
 * posted to the deployment's own console surface over that session, and every one of them answers
 * with what the deployment said, at the box its key names.
 */
export async function clientAction({ request }: Route.ClientActionArgs) {
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
	 * stores the organisation's profile, whole, from whichever of the two folds pressed.
	 *
	 * every box goes, including the empty ones: the endpoint reads a profile whole, so a field left
	 * out of the body is one it stores as cleared. each fold posts the boxes the other draws as
	 * hidden fields at what the deployment holds (../lib/org-fields.ts's `carriedBoxes`), which is
	 * why one reading of the body serves both.
	 */
	if (intent === ORG_INTENT || intent === NOTIFICATIONS_INTENT) {
		return wrote(
			intent === ORG_INTENT ? 'organisation' : 'notifications',
			await saveOrgProfile(orgEdits(posted))
		);
	}

	/**
	 * asks the deployment to send a test message to the address in the box beside the button.
	 *
	 * the only press on this page that reaches the deployment's own mail transport, and it is the
	 * deployment's because it has to be: the message goes out over its own SMTP credentials, which
	 * this console does not hold and must not acquire. the destination is the one thing posted with
	 * it, and it is the operator's — a mail host is only checked by an inbox somebody is watching.
	 * what an address may be is the deployment's rule and is not read here.
	 */
	if (intent === TEST_EMAIL_INTENT) {
		const to = posted.get(TEST_TO_FIELD);
		return { test: await sendTestEmail(typeof to === 'string' ? to : '') };
	}

	/**
	 * stores the site list on the deployment, and brings cloudflare's copy of it level behind that.
	 *
	 * **the rule is read here, in front of the press.** what a site may be is one module both ends
	 * read (`readOriginList` in `@better-giving/operator/origins`), and this is that one rule read
	 * early rather than a second opinion: the deployment parses every list it is sent whatever asked
	 * it to. what it buys is the press — a list turned down at the boxes rather than after the
	 * widget has been levelled against hosts this deployment will not serve. the sentence says each
	 * thing that is wrong with the list once and names no row, because the boxes it is about are on
	 * the screen above it.
	 *
	 * **the list is posted as it was typed, never as this console parsed it**: the trim, the
	 * blank-row skip and the dedupe are the deployment's to make over what it stores, and a console
	 * that sent its own reading would be storing a list nobody typed.
	 *
	 * **the widget is levelled only where the list landed**, and it is levelled to the list the
	 * deployment stored rather than to the boxes that were posted: the parse that decided what a
	 * site may be is the deployment's, and a row it dropped is not one the widget should cover.
	 * That order is the one whose failure costs least — a removal this way round leaves cloudflare
	 * covering a host nothing is served on, where the reverse would leave a host still served and no
	 * longer challengeable, and every gift from it would fail.
	 *
	 * **the wallet registrations are levelled last and on the same condition**, so a site added here
	 * draws Apple Pay, Google Pay and Link without a second press. it is last because the widget is
	 * what decides whether a gift from a new site can be made at all, and the wallets only which
	 * buttons it is offered on; nothing is posted with it — the hostnames are read on the deployment
	 * off the list it has just stored (../lib/wallets-press.ts).
	 */
	if (intent === SITES_INTENT) {
		const rows = siteEdits(posted);
		const { problem } = readOriginList(rows);
		if (problem !== null) {
			return stored({
				written: { kind: 'refused', message: problem, fix: null },
				widget: unasked,
				wallets: null
			});
		}

		const written = await saveSites(rows);
		if (written.kind !== 'saved') {
			return stored({ written, widget: unasked, wallets: null });
		}
		const widget = await levelWidget(written.sites);
		return stored({ written, widget, wallets: await levelWallets() });
	}

	/** runs the whole check again, which is what the gate's and the ready face's check press does. */
	if (intent === 'check') {
		// nothing is asked of the binary here: what the press does is send the page through its own
		// reading again, and that reading is where every one of those blockers is decided.
		return { checked: true };
	}

	/**
	 * ends the run this console is inside, and asks the browser for the tab back.
	 *
	 * nothing on cloudflare and nothing on the deployment changes: what stops is the process on this
	 * machine, and the account, the session and the seventeen values are exactly where they were.
	 *
	 * **`window.close()` is a request the browser is free to refuse**, and chrome refuses it on a tab
	 * no script opened — this one was opened by the binary. so the answer below is what the page is
	 * left holding, and what it draws from it is nothing at all: a blank page is the nearest thing to
	 * the closed tab this press promised, and what an operator has to type to come back was said in
	 * the confirm before they pressed it.
	 *
	 * no redirect: there is nothing left to load. `shouldRevalidate` below is what keeps the router
	 * from asking anyway.
	 */
	if (intent === CLOSE_INTENT) {
		await closeConsole();
		window.close();
		return { closing: true as const };
	}

	/**
	 * stores and clears a group of credentials, in one request to cloudflare.
	 *
	 * **the boxes are read here and the act is what crosses.** what an empty box means is decided by
	 * what the box was drawn holding, which is a fact about this page rather than about the account
	 * (../lib/secret-edits.ts) — so the press names what to store and what to remove, and the binary
	 * sends the one merge patch that does both. a name it does not name is left exactly as it was.
	 *
	 * **the group is the posted intent read back against the enumeration**, so a body naming no group
	 * reaches nothing and the names a payload may carry are the group's rather than the body's own
	 * keys. every group is answered rather than the ones this page's folds draw — a list of ids here
	 * would be a second enumeration to keep level with
	 * ../lib/secret-groups.ts, and the way that fails is a control that posts and is answered by
	 * nothing.
	 *
	 * **every group is read against its seeds, and they are asked of the account for this press
	 * rather than taken off the form.** a page claiming a name is stored would turn an empty box into
	 * a delete, and one claiming it is not would turn an untouched box into a save. a read that did
	 * not land is a press refused rather than a press guessed at.
	 *
	 * no lock: a write that loses a race here leaves a credential the rows in the block report
	 * exactly as it is.
	 *
	 * **PayPal's group is drawn and never pressed.** its three names arrive only through the set-up
	 * press on PayPal's screen (./payments_.paypal.tsx), which settles the listener its id names, and
	 * the binary refuses them on the values door (`packages/console/internal/server/values.go`).
	 */
	const group = groupPosted(intent);
	if (group !== null && group.id !== PAYPAL_GROUP) {
		const read = await homeReading();
		if (read.values.vars.kind !== 'read') {
			return { secrets: { group: group.id, written: unreadHeld(read.values.vars) } };
		}
		const seeds = heldValues(read.values.vars.vars).seeds;

		// the names the form carries a value for, and never the whole group: the mail form states the
		// port rather than drawing a box for it (../lib/secret-groups.ts), and the reading takes a name
		// arriving with no box behind it as an emptied one — which would delete the deployment's port
		// on every mail save, with the confirm having said nothing about it.
		const edits = secretEdits(pressedNames(group), posted, seeds);
		// nothing is sent and nothing is written: one press is one request, so a group holding a box
		// this console could not read as an act comes back whole, with what was typed still in it. the
		// boxes come back as names and sentences — what was typed in them is not in this answer.
		if (!edits.ok) return { secrets: { group: group.id, errors: edits.errors } };

		return { secrets: { group: group.id, written: await setVars(edits.payload) } };
	}

	/**
	 * takes every value this deployment is holding in a form nothing can read back off it, so the
	 * boxes beside the press can set them.
	 *
	 * **which names are freed is read inside the binary and never posted.** the press carries the
	 * intent alone, and what the binary reads is cloudflare's own answer — a name off a request body
	 * is a credential deleted wherever the page that sent it said. a read that answered nothing
	 * removes nothing, and comes back as the write that never happened; a read that came back with no
	 * withheld name is `nothing`, which is a page a moment out of date rather than a fault.
	 */
	if (intent === FREE_INTENT) return { freed: await freeWithheldVars() };

	// nothing on the page posts anything else, and every press on it names what it is. a body
	// naming nothing, or naming something no branch above runs, is answered rather than run, and no
	// face draws a state for it.
	return { unknown: true as const };
}

/**
 * every press re-reads this page, except the one that ends the process it would read — and no press
 * of a link that only opens a dialog does.
 *
 * the binary answers the close and then stops, so the read that follows it cannot land: it reaches
 * nothing, `clientLoader` rejects, and the operator meets the boundary that says the console
 * crashed in place of the panel saying they closed it. the answer carries the reading that stops it
 * (../lib/close-answer.ts), which is what the router's own docs put `actionResult` there for.
 *
 * **both confirms on this console are a parameter on the address, so opening one is a navigation**,
 * and the whole of this page's read is loopback round trips — a confirm that waited on one would
 * take a second or more to draw over a press that changes nothing this page reads
 * (../lib/dialog-params.ts, which is where the parameters that do that are enumerated).
 *
 * everything else is handed straight back: this is one route with one loader, so what the router
 * decides by default about a re-read is the whole of what any other press wants.
 */
export function shouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
	if (saidClosing(args.actionResult)) return false;
	if (opensOrDropsDialog(args)) return false;
	return args.defaultShouldRevalidate;
}

/**
 * the levelling that was never asked for, because the deployment stored nothing.
 *
 * every field the binary writes on every answer, empty: the shape is one the fold reads uniformly,
 * so the one arm the page produces itself is written the way the binary writes the rest.
 */
const unasked: WidgetLevel = {
	kind: 'unasked',
	domains: [],
	sitekeys: [],
	read: null,
	detail: ''
};

export default function Console({ loaderData, actionData }: Route.ComponentProps) {
	const navigation = useNavigation();
	const posted = navigation.formData?.get('intent');
	const intent = typeof posted === 'string' ? posted : null;
	/* the router has this press's answer and is re-reading the page over it, which is the one thing
	   the posted intent cannot say: it is carried through the re-read as well as through the request
	   (`getLoadingNavigation` in the installed `react-router`), so during a press's own request what
	   the page is holding is still the press before it. the password fold reads it: its box stays open
	   over the re-read of its own refusal (../lib/secret-group-form.tsx). */
	const revalidating = navigation.state === 'loading';
	const busy = intent !== null;

	/* whether the confirm over the close press is up. it is a parameter on the address rather than
	   state, which is what makes the way out of it a link: a GET back to this page drops it, and that
	   is what Escape answers with too — `Modal` hands the request back rather than closing the
	   element, so the address and what is on the screen cannot disagree (../lib/dialog-params.ts). */
	const [params] = useSearchParams();
	const navigate = useNavigate();
	const asking = params.has(CLOSE_PARAM);

	/* the console was asked to stop, and this page draws nothing from here on. the branch is what
	   keeps a shell off a binary that is gone — every reading either a shell or a strip would be
	   built from is one nothing can take again — and what stands in its place is nothing at all.

	   **a blank page is the outcome.** the tab closes where the browser allows it and stays open
	   where it does not, and an empty page is the nearest that refusal gets to the tab that was
	   asked for. what an operator needs — that the run ends, and what to type to come back — is
	   stated in the confirm below, before the press, and the confirm promises nothing about the tab
	   for this reason. a page saying it again afterwards is a page restating a press the operator
	   just made. */
	if (saidClosing(actionData)) return null;

	/* the same strip under every screen below, settled once so no face can be the one that forgets
	   it. what stands in it turns on nothing any of them read (../lib/product-foot.tsx). */
	const foot = <ProductFoot version={loaderData.version} />;

	/* the press at the head's trailing end, which stands opposite the account rather than acting on
	   it: it ends the run this console is, and the record naming the account is written at the
	   terminal and left exactly as it is. the mark is the plug being pulled: the set closes over no
	   power glyph (packages/operator/src/components/status/glyphs.js), and a plug pulled reads for a
	   press that ends a run.

	   **the mark is the whole of it and the label is the whole of its name.** the head carries one
	   press and never two, so there is nothing on the strip for a word to tell it apart from — and
	   what the press costs is the dialog's below, which is where the cost of a press belongs.

	   it is a link and not a submit, because what it opens is that confirm and that is a parameter
	   on the address.

	   **it is never held while another press is running**, which is why no `busy` reaches it: the
	   binary waits for the press it is holding to finish before it shuts anything down, so
	   confirming over a save cuts nothing short. */
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

	/* what the press costs, which is the whole reason it asks: the run ends, and the way back is a
	   command in a terminal rather than anything on this page.

	   **the tab is not promised.** the action asks for it (`window.close()` above) and chrome refuses
	   it on a tab no script opened, so a sentence saying the tab closes is one the operator watches
	   fail. what is stated is what is true on both paths: the console stops, and `start` opens it
	   again.

	   the `<form>` stands around the whole dialog rather than around the control that submits it,
	   which is the rule `Dialog` states: the actions row holds controls, and a submit belongs to the
	   form enclosing it whether or not the element has been lifted into the top layer. the way out is
	   a link, so it posts nothing and the form around it is inert for that press.

	   it takes the `danger` slot rather than the exit one: that slot draws the confirm ahead of the
	   way out, and this is the consequential control on the card. */
	const confirm = (
		<Form method="post">
			<Modal
				title="Close this console?"
				onDismiss={() => navigate('/')}
				danger="Close console"
				dangerProps={{
					type: 'submit',
					name: 'intent',
					value: CLOSE_INTENT,
					'aria-busy': intent === CLOSE_INTENT
				}}
				cancel="Back"
				cancelProps={{ as: Link, to: '/' }}
			>
				<p className="adm-prose">
					The console stops. Type <InlineCode>better-giving start</InlineCode> to open it again.
				</p>
			</Modal>
		</Form>
	);

	/* the same head on every face under it, because what it states is true on all of them: the
	   account is settled by the time any of them is drawn, and the way out of it is the same press
	   wherever the operator is standing. everything about the deployment is under the head rather
	   than on it — the address heads the ready face and is a literal in the gate, which is where
	   each of them belongs. what this machine could not write down stands under the strip for the
	   same reason — the choice it could not record, the renewed sign-in it could not keep — because
	   each is true on every face and for as long as this console is open, and neither is about
	   anything on the screen (../lib/head-strip.tsx).

	   the control rides with it rather than being the caller's: what it ends is this console and not
	   anything one face is in the middle of, so it is the same offer wherever the operator is
	   standing. */
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
	/* the last profile press and which of the two folds made it. the answer is drawn under the
	   button that was pressed, so each fold is handed it only where it is the fold named. */
	const profile = actionData && 'write' in actionData ? actionData.write : null;
	const wroteOrg: OrgWrite | null = profile?.at === 'organisation' ? profile.write : null;
	const wroteNotifications: OrgWrite | null =
		profile?.at === 'notifications' ? profile.write : null;
	const secrets: GroupReport | null =
		actionData && 'secrets' in actionData ? actionData.secrets : null;
	const test: TestSend | null = actionData && 'test' in actionData ? actionData.test : null;
	/* how the press that frees a value held in a form nothing can read back went. one press frees
	   every such name at once (`FreeWithheldVars` in `packages/console/internal/deployment`), so it
	   is one answer handed to each fold that draws boxes: only a failure is drawn, and a press that
	   landed takes the block off every one of them. */
	const freed: VarsWritten | null = actionData && 'freed' in actionData ? actionData.freed : null;
	const list = actionData && 'sites' in actionData ? actionData.sites : null;
	const checked = actionData !== undefined && 'checked' in actionData;

	const read = loaderData.reading;
	const home = read.face;
	/* what the two folds that edit the profile are seeded from, and what the test send reads its
	   destination off. taken from the press's own answer from the moment one stores a profile — the
	   reading is taken again after every press, but it commits a render later than the answer does,
	   and a landed write puts the boxes back to whatever they were seeded with at that moment
	   (../lib/org-form.ts). */
	const stored = storedOrg(read.stored, profile?.write ?? null);

	/* the gate stands in the middle of the space under the head rather than at the top of a column:
	   one question and one way out is not a page anybody reads from the top. the card face is not
	   the shell either: everything a deployment is read over is still nothing there, so what stands
	   is one sentence, centred. */
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
					{home.kind === 'blocked' ? (
						<BlockedFace
							why={home.why}
							account={loaderData.account}
							workerName={loaderData.workerName}
						/>
					) : (
						<ReadyFace
							address={home.address}
							sections={read.sections}
							busy={busy}
							intent={intent}
							checked={checked}
							organisation={{
								stored,
								write: wroteOrg,
								busy,
								pending: intent === ORG_INTENT
							}}
							password={{
								values: read.values,
								secrets,
								freed,
								workerName: loaderData.workerName,
								accountName: loaderData.account,
								busy,
								pending: intent,
								revalidating
							}}
							payments={{ rows: read.processors }}
							sites={{
								sites: read.sites,
								donatePage: read.donatePage,
								list,
								busy,
								pending: intent
							}}
							smtp={{
								values: read.values,
								workerName: loaderData.workerName,
								accountName: loaderData.account,
								// the profile, because the test send is seeded from the notification
								// address rather than from a value of its own.
								stored,
								secrets,
								freed,
								test,
								pending: intent
							}}
							notifications={{
								stored,
								write: wroteNotifications,
								busy,
								pending: intent === NOTIFICATIONS_INTENT
							}}
						/>
					)}
				</Column>
			</BareShell>
		);

	/* the confirm stands beside the face rather than inside any one: the press that opens it is on
	   the head, which every face draws, and a copy per face is how two of them come to ask
	   differently. */
	return (
		<>
			{face}
			{asking ? confirm : null}
		</>
	);
}

/**
 * why nothing under the head can be drawn.
 *
 * no ledger and no press: every reading below a blocker is scoped to something the console could
 * not find out, and a row drawn over a read that never landed is a finding about cloudflare
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
		/* the deployment is up and answering, and one of the two doors its seventeen values come
		   through is not (`packages/console/internal/deployment/values.go`). every fold below reads
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
 * deployed, and this console cannot read it: the gate standing in front of every fold.
 *
 * **the account stays on the head and everything the gate makes unreadable comes off** — the
 * ledger, the folds, and the heading that names the address they are all read over. what is left is
 * one question and one press, which is what a gate is.
 *
 * **it is the one connection state this page draws.** `better-giving start` connects before the page
 * is served, so no session and a session turned away are both a session that dropped mid-use — the
 * other operator's press on their own console, or twelve hours running out.
 *
 * **the address is a literal here and a link on the ready face.** there it is a destination and an
 * operator working on the deployment follows it; here it is the thing being named, and a link out
 * of a gate is an invitation to leave through it.
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
				value="check"
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

/**
 * the deployment, the way into it, and the six folds under it.
 *
 * the order the folds are read in is ../lib/home-sections.ts's, along with every row's tone, word and
 * sentence: the dashboard password first, then the five a gift needs in the order they have to be
 * true. what is decided here is only which panel a fold holds.
 *
 * every fold rests closed, because the ledger is read before it is worked through — the state below
 * is what leaves a save's own fold standing open, which is where its answer is drawn. `details` is
 * the whole mechanism: it is keyboard-operable and announces its own expanded state with nothing
 * written for it, which is why no ARIA attribute and no key handler appears here.
 *
 * **the address the deployment answers on is the heading, and the heading is a link.** it is the
 * one thing this whole page is about, and the one page on the deployment a human opens is a press
 * from it.
 *
 * **it stays a link while the folds under it are unfinished, and takes the attention tone
 * instead.** the deployment turns down what it cannot yet do, whoever asks — so an operator who
 * wants to go and look is owed the way there and the warning together, where a control that refused
 * to be pressed would give them neither and explain nothing. the tone is what the folds under it
 * already read in, so the heading and the ledger are one reading rather than two.
 *
 * **the press that reads everything again is the page's and stands beside its heading.** it posts
 * the `check` intent, which re-runs this whole `loader` — every fold's reads and not one fold's —
 * so a copy of it inside a panel would be a control over the other five panels drawn under one of
 * them.
 */
function ReadyFace({
	address,
	sections,
	busy,
	intent,
	checked,
	password,
	organisation,
	payments,
	sites,
	smtp,
	notifications
}: {
	/** where the deployment answers, which is what the heading names and links into. */
	address: string;
	sections: readonly HomeSection[];
	busy: boolean;
	/** which intent is in flight, or `null` where none is. */
	intent: string | null;
	/** whether the last press was the one that re-runs every read. */
	checked: boolean;
	/** each fold's panel whole, assembled by the page that took every read in it. */
	password: PasswordFoldProps;
	organisation: OrgFoldProps;
	payments: ProcessorRowsProps;
	sites: SitesFoldProps;
	smtp: SmtpFoldProps;
	notifications: NotificationsFoldProps;
}): ReactNode {
	/* every fold rests closed on arrival: the ledger is read before it is worked through. the state
	   is what leaves a save's own fold open, which is where its answer is drawn. */
	const [open, setOpen] = useState<ReadonlySet<SectionId>>(() => new Set<SectionId>());
	const toggle = (id: SectionId, is: boolean) =>
		setOpen((was) => {
			const next = new Set(was);
			if (is) next.add(id);
			else next.delete(id);
			return next;
		});

	/* the one page on this deployment a human signs in to, which is where the heading lands. */
	const dashboard = `${address}/admin`;
	/* a fold this console read and found undone. a fold it could not read is not one of them
	   (../lib/home-sections.ts): that row says so in its own word, and a heading that took a warning
	   from it would be reporting a finding nobody made. */
	const unfinished = sections.some((section) => section.state === 'todo');

	return (
		<>
			<PageHeader
				title="Your deployment"
				standfirst={
					/* the address stands under the heading rather than beside it: it is the longest run of
					   characters on the page and, set on the heading's own line, it is what the eye lands
					   on first — a heading qualified by a link twice its length reads as the link being
					   the heading. the slot under it is where a line qualifying the title goes.

					   a new tab, because this page is one an operator is working in: a press half-made and
					   a fold open are what following the link in place would throw away. the whole
					   destination is the visible word, so there is nothing to take on trust about where it
					   goes and nothing said twice. */
					<a
						className={unfinished ? 'adm-link--attention' : undefined}
						href={dashboard}
						target="_blank"
						rel="noreferrer"
					>
						{dashboard} <Mark name="external-link" />
					</a>
				}
				pageAction={
					/* what another hand can change between loads — what cloudflare is holding for this
					   deployment — read again. it acts on the page rather than on anything in it, which is
					   the slot it is in. */
					<Form className="adm-actions" method="post" preventScrollReset>
						{/* the soft rank, because this press re-reads the page it stands on and changes
						    nothing on the deployment. an outlined control beside the heading reads as
						    what the page is asking to be done, and what this page asks for is the folds
						    under it. the same press on the panels that report an unreachable deployment
						    keeps its box: there it is the one thing left to try. */}
						<Button
							type="submit"
							name="intent"
							value="check"
							variant="soft"
							disabled={busy}
							aria-busy={intent === 'check'}
						>
							Check again
						</Button>
						{checked ? <p className="adm-momentary">Checked just now.</p> : null}
					</Form>
				}
			/>
			<StatusLedger sections>
				{sections.map((section) => (
					<StatusLine
						key={section.id}
						labelAs="h2"
						label={section.label}
						word={section.word ?? undefined}
						tone={section.tone}
						mark={section.mark}
						note={section.note}
						open={open.has(section.id)}
						onToggle={(is) => toggle(section.id, is)}
						beneath={
							section.id === 'password' ? (
								<PasswordFold {...password} />
							) : section.id === 'organisation' ? (
								<OrgFold {...organisation} />
							) : section.id === 'payments' ? (
								<ProcessorRows {...payments} />
							) : section.id === 'sites' ? (
								<SitesFold {...sites} />
							) : section.id === 'smtp' ? (
								<SmtpFold {...smtp} />
							) : (
								<NotificationsFold {...notifications} />
							)
						}
					/>
				))}
			</StatusLedger>
		</>
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
