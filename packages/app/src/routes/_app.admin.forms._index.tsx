import { elementSnippet, runtimeSnippet } from '@better-giving/form/embed/snippet';
import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { CodeSlab, InlineCode } from '@better-giving/operator/components/data/CodeSlab';
import { CreateCard } from '@better-giving/operator/components/data/CreateCard';
import { Press } from '@better-giving/operator/components/data/Press';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import {
	type RowControl,
	RepeatingRows
} from '@better-giving/operator/components/forms/RepeatingRows';
import { Column, List } from '@better-giving/operator/components/shell/Layout';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { Mark } from '@better-giving/operator/components/status/Mark';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import { readOriginRows } from '@better-giving/operator/origins';
import { useSaveState } from '@better-giving/operator/save-state.react';
import { getFormProps } from '@conform-to/react';
import { FORM_STATUS_TONES } from '$lib/admin/status-tones';
import { useEffect, useRef } from 'react';
import { data, Form, href, Link, useFormAction, useNavigate, useNavigation } from 'react-router';
import { z } from 'zod';
import { buttonState } from '$lib/admin/save-button-state';
import { screenTitle } from '$lib/admin/screen-title';
import {
	type AdminActionData,
	boxProps,
	insertWhenValid,
	listPress,
	useAdminForm,
	useHydrated,
	whichForm
} from '$lib/admin/use-admin-form';
import { defineForm, WHICH_FORM } from '$lib/forms/definition';
import { FORM_STATUS_LABELS } from '$lib/forms/statuses';
import { STAFF_USER_ID } from '$lib/server/auth';
import { invalid, parseForm, submittedForm } from '$lib/server/conform';
import { walletHosts } from '$lib/server/console/wallet-hosts';
import { loadFailed, notFound } from '$lib/server/db/load-failure';
import { CREATED_FLASH, redirectWithFlash, SAVED_FLASH, takeFlash } from '$lib/server/flash';
import { readForms } from '$lib/server/forms/queries';
import { createPaymentProviders } from '$lib/server/payments/factory';
import { levelWalletDomains } from '$lib/server/payments/wallet-domains';
import { readSites, readSitesInUse, replaceSites } from '$lib/server/sites/queries';
import { parseSites } from '$lib/server/sites/site-input';
import { database, platform, staff } from '../context';
import type { Route } from './+types/_app.admin.forms._index';

// the forms a deployment has, the snippet an operator pastes into their own site, and the list of
// sites those forms may go on. nothing about a form is written here — that is the screens under
// `new` and `[id]` — and the one write this route's action makes is the site list, from the card
// after the forms.
//
// **every form on this list gets its snippet, and none is withheld over what this deployment can
// charge.** a snippet is markup naming a form id; whether the key behind it can take a card is a
// fact about the deployment, and that is read once, at the console, in the press that stores the
// keys — `stripeKeyEdits` in `packages/console-ui/src/lib/stripe-edits.ts` refuses a `whsec_`
// or a publishable key in the secret slot, a value that is not a Stripe key at all, and a live key
// paired with a test one, each at the box it was pasted into, and the screen names the Stripe
// account back. checking once where the mistake is made beats checking forever on screens that
// cannot repair it: a screen here could only ever withhold the snippet and point somewhere else,
// and the pointer is the half that goes stale.
//
// the residue is accepted rather than overlooked. a deployment whose payments are misconfigured
// hands out a snippet that looks right and says nothing on the org's own site — which is the cost
// of the split throughout: a broken deployment is quiet on the live site, and the console is where
// you find out.
//
// what stands between this deployment and a donor giving is not read here, and that is a decision
// rather than an omission: the status ledger is rendered on the screens that write — the create,
// which refuses to make a form while a blocker stands, and the editor, which refuses to publish one
// — and a second telling on a screen that writes no form would be a second place to read the same
// thing. `$lib/server/forms/readiness.ts` is where it lives and those two routes are its callers.
// the organisation's own details go with it, for the same reason: the card that leads the list is a
// link that never gates, so nothing here asks whether they are saved.
//
// this file is deliberately thin. what reaches the database lives in
// `$lib/server/forms/queries.ts`; the only job here is a projection. neither the database's
// type (`Db` in $lib/server/db/client.ts) nor the `form` table object is named anywhere in this
// route, and neither may be.

/** the screen's name in the document title. ./_app.tsx names the page in a hidden `h1`. */
const SCREEN_TITLE = 'Donation forms';

/** the address this screen answers on, which is also where its own question is asked and dropped. */
const SCREEN = href('/admin/forms');

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

/** the sites card's form, as the literal a body names itself with. */
const SITES_FORM_ID = 'forms-sites';
const SCREEN_FORMS = [SITES_FORM_ID] as const;

/** the list field every row of the sites card belongs to, each row indexed under it. */
const SITE_FIELD = 'sites';

/** what a box left blank is told, under the box: the group's legend already names it. */
const REQUIRED = 'required';

/**
 * the deployment's list of sites, as the card states it.
 *
 * the rules are `readOriginRows` in `@better-giving/operator/origins` and none is stated here: the
 * trim, the dedupe, the count cap and the repair are the same ones `parseSites` stores by. what this
 * adds is the shape conform reads them through — a row's sentence keyed to that row's own box, and
 * the cap keyed to the bare field because it is about no one row.
 *
 * the one rule of its own is that a box holds something. conform drops an empty string before the
 * schema sees it, so a row nobody typed into arrives as `undefined` and is refused here rather than
 * quietly skipped. an emptied editor submits no key at all, and `.prefault([])` reads that as the
 * empty list it is (AGENTS.md → Forms).
 */
const SITES_FORM = defineForm({
	id: SITES_FORM_ID,
	schema: z.object({
		[SITE_FIELD]: z
			.array(z.string().optional())
			.prefault([])
			.superRefine((rows, ctx) => {
				const lines = rows.map((row) => row ?? '');
				lines.forEach((line, at) => {
					if (line.trim().length === 0)
						ctx.addIssue({ code: 'custom', message: REQUIRED, path: [at] });
				});
				const read = readOriginRows(lines);
				if (read.problem !== null) {
					ctx.addIssue({ code: 'custom', message: read.problem });
					return;
				}
				read.rows.forEach((problem, at) => {
					if (problem !== null) ctx.addIssue({ code: 'custom', message: problem, path: [at] });
				});
			})
	})
});

/**
 * the two ways a save can land, as the marker its redirect carries.
 *
 * `wallets_pending` is a list that saved while Stripe did not register every hostname on it, so the
 * card says the second half did not happen. a deployment holding no Stripe key lands on `saved`:
 * it draws no wallet button anywhere, so there is nothing for a new site to be short of.
 */
const SITES_OUTCOMES = ['saved', 'wallets_pending'] as const;
type SitesOutcome = (typeof SITES_OUTCOMES)[number];

/** the body of a member's not-found. the panel ../root.tsx draws does not show it; an agent reads it. */
const NOT_HERE =
	`No write at ${SCREEN} for a member’s session. The list of sites is changed from the ` +
	'deployer’s session: sign in with `ADMIN_PASSWORD` at /login.';

export async function loader({ context, request, url }: Route.LoaderArgs) {
	// the forms and the deployment's sites, the only two reads this page makes. the cause itself is
	// logged, and the diagnostic is about the database rather than about the table, because what a
	// fresh deployment actually hits here is a schema that was never migrated.
	const db = context.get(database);
	let forms: Awaited<ReturnType<typeof readForms>>;
	let sites: string[];
	try {
		[forms, sites] = await Promise.all([readForms(db), readSites(db)]);
	} catch (e) {
		console.error('loading the donation forms page failed:', e);
		loadFailed('This page');
	}

	// the form made by the redirect that landed here, if any — the one ./_app.admin.forms.new.tsx
	// sends after a successful write, so the outcome survives its POST-redirect-GET. it arrives as a
	// one-shot marker rather than in the address, and the header that comes back with it is what
	// clears it: this banner is drawn on the response that lands and on no reload after it.
	//
	// taken after the read above rather than before it, so a loader that could not reach the
	// database does not burn a marker no screen ever drew.
	//
	// matched against the list rather than rendered, so the id itself never reaches the page: an id
	// no row answers to puts no text of its own on the screen. a form that has since been archived
	// is off this list and reports nothing for the same reason.
	const landed = await takeFlash(request, CREATED_FLASH);
	const created = landed === null ? null : (forms.find((f) => f.id === landed.marker) ?? null);

	// the site-list save this page's own action redirected from, burned the same way. the marker is
	// one of the two outcomes the action writes and is matched rather than rendered, so a cookie
	// naming anything else reports nothing.
	const savedSites = await takeFlash(request, SAVED_FLASH);
	const saved = SITES_OUTCOMES.find((outcome) => outcome === savedSites?.marker) ?? null;
	const burned = new Headers();
	for (const flash of [landed, savedSites]) {
		if (flash !== null) burned.append('Set-Cookie', flash.clear);
	}

	const origin = new URL(request.url).origin;

	// an explicit projection rather than the rows. `revenue_account_id`, the timestamps and the two
	// other JSON columns are none of this page's business — the screen that edits one reads those.
	const listed = forms.map((form) => ({
		id: form.id,
		name: form.name,
		// the value, not a word: `FORM_STATUS_LABELS` in `$lib/forms/statuses.ts` is importable by a
		// component, so the page puts words to it and there is one copy of them.
		//
		// the status is shown and the embed is not gated on it. a form is born `draft`, so
		// `status === 'live'` as a condition on the Embed control would render nothing at all on a
		// deployment whose forms are all new — which is the step this page exists to deliver.
		status: form.status,
		// neither what a donor may pay by nor how often a gift may repeat is on this list, and
		// neither is a fact about a form: every form offers whatever `offeredRails` in
		// `$lib/server/forms/offered-rails.ts` and `offeredCadences` beside it read off the
		// processor's account, so a per-form answer here would be a column read back as a decision
		// nobody made.
		origins: form.allowedOrigins
	}));

	// the form whose snippet the operator has asked to see, if any. the question is on the address
	// because a card an operator reloads, shares and backs out of belongs there — the same shape
	// ./_app.admin.members.tsx's removal asks its own question in.
	//
	// picked out of the projection above rather than read a second time, and matched the way the
	// marker is: an id no row answers to, a form archived since the address was copied and no
	// parameter at all all leave this `null`, so the card is never drawn over a form this screen is
	// not showing.
	const asked = url.searchParams.get('embed');
	const embedded = listed.find((form) => form.id === asked) ?? null;

	// the site that form's card is aimed at, named by the press the operator made at the foot of the
	// record. kept only when the matched form's own origins hold that exact string: the address is
	// anybody's to type, and a card naming a site the form does not list would be telling an operator
	// to paste into a page the served config refuses.
	//
	// taken off the row already in hand rather than read again, and the exact string rather than a
	// parsed host — what the served config matches an `Origin` against is the stored string.
	const aimed = url.searchParams.get('site');
	const site = embedded?.origins.find((origin) => origin === aimed) ?? null;

	return data(
		{
			// the outcome of the create next door: the new form's name, so the banner names it. `null`
			// on a plain visit. the name only — the record below is what says everything else about
			// it.
			created: created && { id: created.id, name: created.name },
			// what the embed card is drawn from: the name it is titled with, the id the link out of it
			// points at, the two placements the card hands over and the site it is aimed at — the row
			// itself, so the card and the list can only ever agree about the form they are both naming.
			//
			// built here rather than on the projection above, because the card is drawn over one form
			// and a string on every row is a string the browser is sent once per form to draw none of.
			// both halves come from `@better-giving/form/embed/snippet` and neither is spelled here:
			// what is pasted into an org's own HTML is a permanent contract, and a second spelling of
			// either half is where the surfaces that agree on it start to disagree.
			embedding: embedded && {
				id: embedded.id,
				name: embedded.name,
				runtime: runtimeSnippet(origin),
				element: elementSnippet(embedded.id),
				// the one site the card names in its closing sentence, or `null` for the sentence that
				// names the form's list instead.
				site
			},
			forms: listed,
			// the card after the list. the deployer edits it and a member reads it, and the
			// predicate is the one the action refuses a member's POST by.
			sites: {
				// the donation page this deployment serves at its own address, which is on no `site`
				// row and which no save can take away (AGENTS.md → Product surface).
				donatePage: new URL(href('/donate'), request.url).href,
				listed: sites,
				mayEdit: context.get(staff).id === STAFF_USER_ID,
				saved
			}
		},
		// the headers that burn the markers ride on the response that publishes them, so a reload of
		// this list announces nothing. a `Set-Cookie` from a loader is sent without this route
		// exporting `headers` — react router preserves that one header on its own
		// (react-router/docs/how-to/headers.md).
		{ headers: burned }
	);
}

/**
 * the one write this screen takes: the deployment's list of sites, replaced whole.
 *
 * **the deployer's session and no other**, the predicate the integrations screens gate on
 * (./_app.admin.integrations.api.tsx). a member is drawn the list with no control on it, so a POST
 * from one is a body this app's markup could not have sent, and it gets the not-found those
 * screens answer with rather than a refusal naming a box. it is read before the body, so a member's
 * POST costs no parse.
 *
 * **the request body is read exactly once, here**, and the arm below is declared inside the action
 * for ./_app.admin.members.tsx's reason: react router strips `action` from the browser bundle and
 * nothing else, so a module-scope helper reaching `$lib/server/**` would ship it.
 */
export async function action(args: Route.ActionArgs) {
	if (args.context.get(staff).id !== STAFF_USER_ID) notFound(NOT_HERE);

	const body = await args.request.formData();
	switch (submittedForm(body, SCREEN_FORMS)) {
		case SITES_FORM_ID:
			return saveSites(args, body);
	}

	/**
	 * store the list, then bring Stripe's wallet registrations level behind it.
	 *
	 * the whole list, never one row: `replaceSites` deletes and inserts in one `batch()`, so a
	 * removal cannot half-happen, and two saves at once is a lost write settled by saving again —
	 * the bargain ./console.sites.ts states.
	 *
	 * **a site still ticked on a form is not removed**, and the refusal names every form in the way.
	 * asked in front of the write rather than inside it, because `replaceSites` deliberately does not
	 * ask; an archived form never blocks, because `readSitesInUse` reads through `readForms`, which
	 * leaves one out.
	 */
	async function saveSites({ context, request }: Route.ActionArgs, body: FormData) {
		const submission = parseForm(body, SITES_FORM);
		if (!submission.ok) return invalid(400, submission.reject());

		// the parse that brands the list for `replaceSites`. the schema ran the same rules, so a
		// refusal here is the cap or a row read differently by a later release of those rules, and
		// both are about the list rather than a box.
		const listed = parseSites(submission.value[SITE_FIELD].map((row) => row ?? ''));
		if (!listed.ok) {
			return invalid(400, submission.reject({ fieldErrors: { [SITE_FIELD]: [listed.problem] } }));
		}

		const db = context.get(database);
		const removals = (await readSites(db)).filter((site) => !listed.value.sites.includes(site));
		const inUse = await readSitesInUse(db, removals);
		if (inUse.length > 0) {
			const one = inUse.length === 1;
			const named = inUse
				.map((entry) => `\`${entry.site}\` (${entry.forms.map((form) => form.name).join(', ')})`)
				.join('; ');
			return invalid(
				409,
				submission.reject({
					formErrors: [
						`Nothing was saved. ${one ? 'A site you removed is' : 'Sites you removed are'} still ` +
							`switched on for a donation form: ${named}. Untick ${one ? 'it' : 'each one'} on ` +
							'the forms named, then save the list again.'
					]
				})
			);
		}

		await replaceSites(db, listed.value);

		// POST-redirect-GET, so a reload does not save the list twice. the marker says how the wallet
		// half went, and the loader turns it back into the card's outcome.
		return redirectWithFlash(request, SAVED_FLASH, SCREEN, await levelWallets(context, request));
	}

	/**
	 * register every hostname this deployment serves on Stripe, so a donor on a site just added is
	 * offered Apple Pay, Google Pay and Link.
	 *
	 * after the write and never in front of it: the list is saved whatever Stripe says, and what did
	 * not land is reported on the card rather than undoing the save. the hostnames are the request's
	 * own and the rows just stored, never anything the body named — `walletHosts` in
	 * $lib/server/console/wallet-hosts.ts argues why — and `levelWalletDomains` leaves a finished
	 * hostname untouched, so a save that changed nothing spends one read of the account.
	 */
	async function levelWallets(
		context: Route.ActionArgs['context'],
		request: Request
	): Promise<SitesOutcome> {
		const processors = createPaymentProviders(context.get(platform).env);
		if (!processors.configured.includes('stripe')) return 'saved';

		const asked = await walletHosts(context.get(database), request.url);
		const levelled = await levelWalletDomains(processors.for('stripe'), asked.hosts);
		if (levelled.state === 'unreadable') {
			console.error('the site list saved and Stripe could not be read:', levelled.detail);
			return 'wallets_pending';
		}

		const short = levelled.hosts.filter(
			(host) => !(host.standing.state === 'registered' && host.standing.complete)
		);
		if (short.length === 0) return 'saved';
		// the card names no hostname, so each one short and the port's own sentence about it go to
		// the logs for the operator reading them.
		for (const host of short) {
			console.warn(
				`\`${host.standing.host}\` draws no wallet yet:`,
				host.detail ?? host.standing.state
			);
		}
		return 'wallets_pending';
	}
}

/* the shape a form takes on this list, drawn hidden inside the create card so that card stands as
   tall as a record whether or not the deployment has one yet. it carries no link and no heading:
   the card is one press, and either would be a focusable node inside an `aria-hidden` subtree —
   `CreateCard`'s `ghost` prop says the rest. the presses in it are plain elements wearing the
   press's classes for that same reason. */
const SAMPLE = (
	<div className="adm-record">
		<div className="adm-record__head adm-record__head--marked">
			<span className="adm-record__mark">
				<Mark name="form" />
			</span>
			<span className="adm-record__title">Year-end appeal</span>
			<StatusWord tone="done">Live</StatusWord>
		</div>
		<ul className="adm-record__origins adm-record__foot">
			<li>
				<span className="adm-chip adm-press">riverside-shelter.org</span>
			</li>
		</ul>
	</div>
);

// what this page owes is the forms this deployment has, the snippet an operator pastes into their
// own site, and a way to reach the screen that configures one. it writes no form: every change to a
// form happens on its own page. the sites card after the list is the deployment's, and
// `SitesCard` below says what it owes.
//
// each record ends in the sites an operator has ticked for that form, and every one of them is a
// press. a site's press opens the embed card aimed at that site, because what an operator came for
// is the block to paste into that page rather than a list of where the form is allowed. what the
// card hands over is two placements rather than one block — the runtime, once per page, and the
// element, wherever the form appears — because that is the instruction an integrator is following,
// and both are a value somebody takes away rather than one they read down a list.
//
// because it writes no form, it gates nothing and reports nothing about the deployment's own state.
// the status ledger is on the screens under `new` and `[id]`, which are the ones that refuse a
// write while a blocker stands, and the card that leads the list is a plain link that is never
// switched off — a second telling here would be a second place to read the same thing, and the
// place an operator would have to act is the console's Organisation details fold either way
// (`packages/console-ui/src/lib/org-fold.tsx`), which is not on this deployment at all.
//
// that reaches the wording of a value as well as the presence of a block, and it is the rule a
// record here is written to: a value a form has not been given is stated as a fact about that form
// and never as a warning about it. a form nobody has ticked a site on has no foot and no sentence
// about it, because a line that reads as a blocker on the one screen that cannot act on
// one sends an operator looking for the button that clears it.
export default function DonationForms({ loaderData, actionData }: Route.ComponentProps) {
	const { created, embedding, forms, sites } = loaderData;

	// the notice arrives already holding its text, and a live region that arrives carrying its own
	// text is one insertion rather than a change: no reader announces it, and focus is still on
	// `<body>` after the press made next door. so a reader is moved to it, which reads it out on
	// arrival and puts them at the head of the list the new form is now on (WCAG 4.1.3).
	//
	// the attributes are on a block around the banner because `Banner` states its own role from its
	// tone and takes neither a ref nor a `tabIndex`. the block is what focus lands on and the
	// `role="status"` it wraps is what is read from it.
	//
	// keyed to the flag rather than to mount: the marker is one-shot, so it is true on the GET the
	// create redirected to and false on every visit after, and a revalidation that clears it moves
	// nobody.
	const announcing = created !== null;
	const notice = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (announcing) notice.current?.focus();
	}, [announcing]);

	return (
		// one column and the column is what spaces it: every block below carries no margin of its
		// own, so one that is not rendered leaves no space behind it.
		<Column>
			{/* the outcome of the create next door, which redirected here with the new form's id. it
			    is the only outcome about a form this page reports and the only one it can: this page
			    writes no form, so every other thing that happens to one is reported on the screen
			    that did it.

			    one word and one name: what is worth saying about a form that has just been made is
			    that it is made and which one it is. the record below says everything else.

			    no guard against a rejected write sitting under it, and none is needed: the one write
			    this route takes is the site list's, and its refusal is drawn in that card. */}
			{created ? (
				<div ref={notice} tabIndex={-1}>
					<Banner tone="done" word="Added">
						{created.name}.
					</Banner>
				</div>
			) : null}

			{/* no opening sentence, and the page is not missing one: what a snippet is for is said
			    where one is handed over — on the form's own page, over that form's slab, and in the
			    card a site's press opens — so an instruction here would be the same instruction read
			    before there is anything to act on. */}

			<List>
				{/* the way to add a form leads the list rather than standing over it, so an empty
				    deployment meets the same screen a full one does with one card fewer on it. the word
				    names what is created; `Add` stays the verb for the act, on the screen this opens
				    and in the banner that reports the write. */}
				<CreateCard as={Link} to={href('/admin/forms/new')} ghost={SAMPLE}>
					Create donation form
				</CreateCard>

				{forms.map((form) => (
					// a form is a record rather than a run of paragraphs: its name and its status on one
					// baseline, then the places it is used, each one a press.
					//
					// the record is written out of the classes packages/operator/src/styles/adm.css
					// already draws rather than mounted from the library's `RecordCard`, which draws all
					// of this: the level is the caller's, the status word takes its tone, the mark is a
					// name from the closed set, and the origins are a foot of presses. adopting it is a
					// screen's change rather than a part's.
					//
					// the id is not a value on the card and must not become one. every press is already
					// built from it — the name links to the form's own page, and the foot carries it in
					// the addresses it points at — so a row printing it would be one string said again
					// with no job.
					<section className="adm-record" key={form.id}>
						<div className="adm-record__head adm-record__head--marked">
							{/* the glyph the rail carries for Donation forms ($lib/admin/destinations.ts),
							    so a card and the destination that reached it agree on sight. */}
							<span className="adm-record__mark">
								<Mark name="form" />
							</span>
							{/* the name is a plain link and takes the title's own type role, rather than
							    arriving at a button's and being pushed back out of it.

							    level 2, because a record on this list stands directly under the page's
							    `<h1>`, which the frame draws hidden, and nothing sits between them. how
							    loud the words are is `.adm-record__title`'s to say. */}
							<h2 className="adm-record__title">
								<Link to={href('/admin/forms/:id', { id: form.id })}>{form.name}</Link>
							</h2>
							{/* the tone is what tells the two apart down a list: Live is the accent and
							    Draft is the ochre of a form still waiting on somebody. there are only ever
							    those two here — `readForms` leaves an archived form out of the list
							    entirely — and $lib/admin/status-tones.ts maps all three. */}
							<StatusWord tone={FORM_STATUS_TONES[form.status]}>
								{FORM_STATUS_LABELS[form.status]}
							</StatusWord>
						</div>

						{/* the foot: the sites an operator ticked, in the form's own order.

						    `Press` draws its own `<li>`, so the items are the part's and a screen
						    assembling them itself is a screen that can drop the element a browser reports
						    the run by.

						    every press is drawn on a draft as well. a draft's pasted snippet loads nothing —
						    the served config refuses a draft — and that is not a state this screen can
						    repair: publishing is a press on the form's own page.

						    the role is stated for the reason `RecordCard` states it on the foot it draws:
						    no marker and a flex row, either of which stops a browser reporting this as a
						    list. removing the attribute re-opens the defect. */}
						{form.origins.length === 0 ? null : (
							// biome-ignore lint/a11y/noRedundantRoles: no marker and a flex row, as above.
							<ul role="list" className="adm-record__origins adm-record__foot">
								{form.origins.map((origin) => (
									// the site is what is pressed and the card it opens is aimed at it, so the
									// snippet an operator is about to paste names the page it is going into.
									//
									// named for the record it acts on, for the reason the members list names its
									// per-row control: a screenful of presses all reading as the same act is a
									// list a reader has to walk to reach the one they came for. the site is in
									// the name as well as in the press, so what is read out holds what is seen.
									<Press
										key={origin}
										as={Link}
										to={`${SCREEN}?embed=${encodeURIComponent(form.id)}&site=${encodeURIComponent(origin)}`}
										aria-label={`Embed ${form.name} on ${origin}`}
									>
										{origin}
									</Press>
								))}
							</ul>
						)}
					</section>
				))}
			</List>

			{/* after the forms rather than over them: the list is what an operator comes here for, and
			    the sites are the deployment's, set once and revisited when a site is added. */}
			{sites.mayEdit ? (
				<SitesEditor sites={sites} actionData={actionData} />
			) : (
				<SitesRead sites={sites} />
			)}

			{embedding ? <EmbedCard form={embedding} /> : null}
		</Column>
	);
}

/**
 * one form's embed, in the top layer, drawn because the address says so.
 *
 * it is the first thing on this dashboard to spend the top layer on something that destroys
 * nothing: the operator asked for it and can leave it with a key, and what it holds is two values
 * to take away plus the one requirement they carry. ./_app.admin.members.tsx's removal is what the
 * layer is otherwise spent on.
 *
 * two numbered steps, one slab each, because the two halves go in different places: the runtime once
 * per page and the element wherever the form is to appear. a page already carrying the runtime — a
 * second form further down, a site-wide template — needs only the second, and one slab holding both
 * hid that.
 *
 * the numbers are text inside the sentences rather than an `<ol>`, so the card stays one flat stack
 * of prose and slabs under the dialog's own spacing. `.adm-steps` in
 * packages/operator/src/styles/adm.css is the ordered list an operator screen draws markers on, and
 * taking it here would put each slab inside a list item and the closing sentence — which is no step
 * — outside them.
 *
 * neither string is spelled on this screen. both are built in the loader from `runtimeSnippet` and
 * `elementSnippet` in `@better-giving/form/embed/snippet`, which is where the pasted block lives
 * because it is a permanent contract three surfaces agree on.
 *
 * no `<form>` around it — nothing in this card posts, and the way out is a link back to the
 * address the card was opened from.
 *
 * the requirement is stated rather than checked: the snippet loads on the sites the form lists, and
 * this card writes nothing, so the sentence points at the page that does.
 *
 * the site is named in that sentence when the press that opened the card carried one, and the
 * loader keeps it only when the form lists it: a card telling an operator to paste into a page the
 * served config refuses would be worse than one naming no page at all.
 */
function EmbedCard({
	form
}: {
	readonly form: NonNullable<Route.ComponentProps['loaderData']['embedding']>;
}) {
	const navigate = useNavigate();

	const ownPage = (
		<Link to={href('/admin/forms/:id', { id: form.id })}>the form&rsquo;s own page</Link>
	);

	// the site the press carried, said back: an operator with three sites reads where this paste is
	// going rather than checking the address bar for it. with no site — the address typed, the card
	// reloaded off a bookmark — the sentence names what the form is allowed on and where to widen
	// that.
	const closing =
		form.site === null ? (
			<>It loads only on the sites this form lists. Add the site on {ownPage}.</>
		) : (
			<>
				Paste this into <InlineCode>{form.site}</InlineCode>. It loads only on the sites this form
				lists. Add another on {ownPage}.
			</>
		);

	return (
		<Modal
			// the form is the card's subject, so its name is the whole title; the numbered steps under
			// it say what the card is for.
			title={form.name}
			// a `Link` rather than an anchor, so leaving the card is a navigation the router handles
			// rather than a full document load.
			exitProps={{ as: Link, to: SCREEN }}
			// Escape and a press on the ground mean what the way out means, and the state they are
			// dismissing is on the address rather than in this component.
			onDismiss={() => navigate(SCREEN)}
		>
			<p className="adm-prose">
				1. Add this once per page, just before <InlineCode>&lt;/body&gt;</InlineCode>.
			</p>
			{/* the two slabs are told apart by what each takes rather than by the record they are both
			    under: `CodeSlab` names its copy control `Copy the {label} for {record}`, so the caption
			    is what a reader meeting either control out of context has to go on. */}
			<CodeSlab label="script" record={form.name} content={form.runtime} copyable />
			<p className="adm-prose">2. Put this where the form should appear.</p>
			<CodeSlab label="element" record={form.name} content={form.element} copyable />
			<p className="adm-prose">{closing}</p>
		</Modal>
	);
}

/** the card's name, which is also how the form editor's hint names where a site is added. */
const SITES_TITLE = 'Which sites your forms go on';

/** the card's id, which the form editor's hint links to as `/admin/forms#sites`. */
const SITES_ID = 'sites';
const SITES_HEADING_ID = 'sites-heading';

/** what the list is for, said once under the card's name. */
const SITES_LEAD =
	'A form loads only on the sites listed here, and Apple Pay and Google Pay show only on them.';

/** why a member is drawn the list with nothing to press. */
const DEPLOYER_ONLY = 'Only the person who deployed this site can change the list.';

/**
 * what a save says when the list landed and Stripe did not register every hostname on it,
 * `WALLET_LEAD` in packages/console-ui/src/lib/wallet-level.ts. it names the consequence rather than
 * the mechanism: an operator who has just pressed Save sites is not thinking about a registration.
 */
const WALLETS_PENDING =
	'Stripe draws Apple Pay, Google Pay and Link only on sites registered on your account, so a ' +
	'donor on a site you have just added is offered none of them until it is registered.';

type Sites = Route.ComponentProps['loaderData']['sites'];

/** a row press as conform states it: its four attributes, and the guard `insertWhenValid` adds. */
type RowPress = RowControl & { readonly form: string; readonly formNoValidate: boolean };

/**
 * the deployment's list of sites, as the deployer edits it.
 *
 * the donation page leads and is read-only: it is served at this deployment's own address and is
 * on no `site` row, so nothing on this list can take it down and the row posts nothing (`fixed` in
 * `@better-giving/operator/components/forms/RepeatingRows`). every site under it carries a Remove,
 * the last one included — emptying the list is a save like any other, and the donation page is what
 * keeps the group from being an Add over nothing.
 *
 * adding and dropping a row are the form's own list intents, applied in the browser and posted
 * nowhere; Save sites is the one press that writes. its outcome is reported at the press: the tick on
 * the button for a save that landed, the banner under it for one whose wallet half did not, and the
 * sentence under it for one that was refused.
 */
function SitesEditor({
	sites,
	actionData
}: {
	readonly sites: Sites;
	readonly actionData: AdminActionData;
}) {
	const [form, fields] = useAdminForm(SITES_FORM, actionData, {
		defaultValue: { [SITE_FIELD]: sites.listed }
	});
	const hydrated = useHydrated();

	// held from the press until the redirect it answers with has rendered, so the button cannot be
	// pressed again across the revalidation that follows the write.
	const navigation = useNavigation();
	const here = useFormAction();
	const saving =
		navigation.state !== 'idle' &&
		navigation.formAction === here &&
		navigation.formData?.get(WHICH_FORM) === SITES_FORM.id;

	// `!actionData` for the reason ./_app.admin.members.tsx gives: a refused save is answered with a
	// rejection rather than a redirect, so a tick over it would be two answers to one press.
	const save = useSaveState({
		landed: sites.saved !== null && !actionData,
		changed: form.dirty,
		pending: saving
	});

	const field = fields[SITE_FIELD];
	const rows = field.getFieldList();
	// what the press was refused for that belongs to no row: the cap on how many sites there may be,
	// and a site still switched on for a form. conform's focus move finds no box for either, so both
	// are said where the press was made.
	const refusal = field.errors?.[0] ?? form.errors?.[0];

	const drawn = (press: RowPress) => {
		const as = listPress(press, hydrated);
		return as.type === 'submit' ? { ...press, type: as.type } : { ...press, ...as };
	};

	return (
		<Form method="post" preventScrollReset {...getFormProps(form)}>
			<input {...whichForm(SITES_FORM.id)} />
			<section id={SITES_ID} className="adm-card" aria-labelledby={SITES_HEADING_ID}>
				<h2 id={SITES_HEADING_ID}>{SITES_TITLE}</h2>
				<p className="adm-hint">{SITES_LEAD}</p>
				<RepeatingRows
					id={field.id}
					// stated and not drawn: the card's heading names the list, and every box and every
					// Remove takes its accessible name from this.
					legend="Site"
					legendHidden
					addLabel="Add a site"
					placeholder="https://example.org"
					code
					add={drawn(insertWhenValid(form, SITES_FORM, field.name))}
					fixed={{
						id: `${field.id}-donate-page`,
						label: 'Your donation page',
						value: sites.donatePage,
						aside: 'Default'
					}}
					rows={rows.map((row, at) => ({
						...boxProps(row),
						key: row.key,
						inputMode: 'url',
						error: row.errors?.[0] === undefined ? undefined : <MarkedText text={row.errors[0]} />,
						remove: drawn(form.remove.getButtonProps({ name: field.name, index: at }))
					}))}
				/>
				<div className="adm-actions">
					<SaveButton label="Save sites" doneLabel="Saved" state={buttonState(save)} />
				</div>
				{refusal === undefined ? null : (
					<FieldMessage>
						<MarkedText text={refusal} />
					</FieldMessage>
				)}
				{sites.saved === 'wallets_pending' && !actionData && !saving ? (
					<Banner tone="attention">Your sites were saved. {WALLETS_PENDING}</Banner>
				) : null}
			</section>
		</Form>
	);
}

/**
 * the same list as a member reads it: every row the deployer's card draws, and nothing to press.
 *
 * the action refuses a member's POST, so a box or a button here would be a control with one answer.
 * the sentence under the name says whose list it is instead.
 */
function SitesRead({ sites }: { readonly sites: Sites }) {
	return (
		<section id={SITES_ID} className="adm-card" aria-labelledby={SITES_HEADING_ID}>
			<h2 id={SITES_HEADING_ID}>{SITES_TITLE}</h2>
			<p className="adm-hint">
				{SITES_LEAD} {DEPLOYER_ONLY}
			</p>
			{/* biome-ignore lint/a11y/noRedundantRoles: base.css takes the marker off every list, which
			    stops a browser reporting one as a list. */}
			<ul role="list" className="adm-stack adm-stack--tight">
				<li>
					<code className="adm-chip">{sites.donatePage}</code>{' '}
					<StatusWord secondary>Default</StatusWord>
				</li>
				{sites.listed.map((site) => (
					<li key={site}>
						<code className="adm-chip">{site}</code>
					</li>
				))}
			</ul>
		</section>
	);
}
