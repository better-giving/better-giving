import { elementSnippet, runtimeSnippet } from '@better-giving/form/embed/snippet';
import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Button } from '@better-giving/operator/components/controls/Button';
import { CodeChip, CodeSlab, InlineCode } from '@better-giving/operator/components/data/CodeSlab';
import { EmptyState } from '@better-giving/operator/components/data/EmptyState';
import { Column, List } from '@better-giving/operator/components/shell/Layout';
import { PageHeader } from '@better-giving/operator/components/shell/PageHeader';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { StatusWord } from '@better-giving/operator/components/status/StatusWord';
import { useEffect, useRef } from 'react';
import { data, href, Link, useNavigate } from 'react-router';
import { screenTitle } from '$lib/admin/screen-title';
import { FORM_STATUS_LABELS } from '$lib/forms/statuses';
import { loadFailed } from '$lib/server/db/load-failure';
import { CREATED_FLASH, takeFlash } from '$lib/server/flash';
import { readForms } from '$lib/server/forms/queries';
import { database } from '../context';
import type { Route } from './+types/_app.admin.forms._index';

// the forms a deployment has and the snippet an operator pastes into their own site. read as a
// loader and nothing else: this route has no action, because everything about a form is written on
// the screens under `new` and `[id]`.
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
// — and a second telling on a screen that writes nothing would be a second place to read the same
// thing. `$lib/server/forms/readiness.ts` is where it lives and those two routes are its callers.
// the organisation's own details go with it, for the same reason: the control in this page's header
// is a link that never gates, so nothing here asks whether they are saved.
//
// this file is deliberately thin. what reaches the database lives in
// `$lib/server/forms/queries.ts`; the only job here is a projection. neither `D1Database` nor the
// `form` table object is named anywhere in this route, and neither may be.

/** the screen's name, rendered as the document title and as the heading. */
const SCREEN_TITLE = 'Donation forms';

/** the address this screen answers on, which is also where its own question is asked and dropped. */
const SCREEN = href('/admin/forms');

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context, request, url }: Route.LoaderArgs) {
	// one read, and it is the only one this page makes. the cause itself is logged, and the
	// diagnostic is about the database rather than about the table, because what a fresh deployment
	// actually hits here is a schema that was never migrated.
	let forms: Awaited<ReturnType<typeof readForms>>;
	try {
		forms = await readForms(context.get(database));
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

	return data(
		{
			// the outcome of the create next door: the new form's name, so the banner names it. `null`
			// on a plain visit. the name only — the record below is what says everything else about
			// it.
			created: created && { id: created.id, name: created.name },
			// what the embed card is drawn from: the name it is titled with, the id the link out of it
			// points at, and the two placements the card hands over — the row itself, so the card and
			// the list can only ever agree about the form they are both naming.
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
				element: elementSnippet(embedded.id)
			},
			forms: listed
		},
		// the header that burns the marker rides on the response that publishes it, so a reload of
		// this list announces nothing. a `Set-Cookie` from a loader is sent without this route
		// exporting `headers` — react router preserves that one header on its own
		// (react-router/docs/how-to/headers.md).
		landed === null ? {} : { headers: { 'Set-Cookie': landed.clear } }
	);
}

// what this page owes is the forms this deployment has, the snippet an operator pastes into their
// own site, and a way to reach the screen that configures one. it writes nothing: every change to a
// form happens on its own page.
//
// each record ends with the two ways out of it, and they are the two places a form is actually
// used: the deployment's own donation page for that form, and the embed, in a card the address asks
// for. what the card hands over is two placements rather than one block — the runtime, once per
// page, and the element, wherever the form appears — because that is the instruction an integrator
// is following. either is a value somebody takes away rather than one they read down a list, so
// both are one press away and the record stays the height of what it says.
//
// because it writes nothing, it gates nothing and reports nothing about the deployment's own state.
// the status ledger is on the screens under `new` and `[id]`, which are the ones that refuse a
// write while a blocker stands, and the action in this page's header is a plain link that is never
// switched off — a second telling here would be a second place to read the same thing, and the
// place an operator would have to act is the console's Organisation fold either way
// (`packages/console-ui/src/lib/org-fold.tsx`), which is not on this deployment at all.
//
// that reaches the wording of a value as well as the presence of a block, and it is the rule a
// record here is written to: a value a form has not been given is stated as a fact about that form
// and never as a warning about it. no mark, no tone, no position of its own — the ink is the empty
// sentence's and nothing else — because a line that reads as a blocker on the one screen that
// cannot act on one sends an operator looking for the button that clears it.
export default function DonationForms({ loaderData }: Route.ComponentProps) {
	const { created, embedding, forms } = loaderData;

	// whether the note about drafts is owed at all. it is one fact about every draft on the list
	// rather than a fact about any one of them, so a reader meets it once above the records instead
	// of once per card — the same sentence repeated down a list is read as a different sentence each
	// time and then as none of them.
	const anyDraft = forms.some((form) => form.status === 'draft');

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
			<PageHeader
				title={SCREEN_TITLE}
				pageAction={
					// a link dressed as a button, and it stays a link: this navigates, it does not write,
					// and the markup is where that difference should be readable.
					//
					// it is never switched off. whatever would block adding a form — an organisation
					// with no registered name and no EIN saved, keys that cannot charge — is a
					// gate on the screen that adds one, which is the screen that writes and the screen
					// carrying the ledger that says which blocker stands. a control disabled here would
					// be a second answer to a question this page never asks.
					//
					// "Add" is the dashboard's one word for bringing a record into being, here and on the
					// donors list, and it is the word on the button, the page it opens and the banner
					// that reports the write.
					<Button as={Link} to={href('/admin/forms/new')}>
						Add donation form
					</Button>
				}
			/>

			{/* the outcome of the create next door, which redirected here with the new form's id. it
			    is the only outcome this page reports and the only one it can: this page writes
			    nothing, so every other thing that happens to a form is reported on the screen that
			    did it.

			    one word and one name: what is worth saying about a form that has just been made is
			    that it is made and which one it is. the record below says everything else.

			    no guard against a rejected write sitting under it, and none is needed: this route has
			    no action, so nothing on this page can come back refused on top of the banner. */}
			{created ? (
				<div ref={notice} tabIndex={-1}>
					<Banner tone="done" word="Added">
						{created.name}.
					</Banner>
				</div>
			) : null}

			{/* no opening sentence, and the page is not missing one: what a snippet is for is said
			    where one is handed over — on the form's own page, over that form's slab, and in the
			    card the Embed control opens — so an instruction here would be the same instruction
			    read before there is anything to act on. */}

			{forms.length === 0 ? (
				<EmptyState>No donation forms yet.</EmptyState>
			) : (
				<>
					{/* what a draft on this list answers with, said once for every draft on it. both
					    controls under a draft's record lead somewhere that refuses — the donation page
					    draws a notice and the pasted snippet loads nothing, because the served config
					    refuses a draft — and this is where that is said, rather than at each control
					    that would then say it twice.

					    it stands above the records rather than inside one because it is the same fact
					    about each of them, and it is a hint rather than a standfirst: it qualifies the
					    list under it rather than naming the page. a live record is not what it is about
					    and a list with no draft on it never draws it. */}
					{anyDraft ? (
						<p className="adm-hint">
							A draft takes no gifts: its donation page and its snippet both refuse until you
							publish it.
						</p>
					) : null}

					<List>
						{forms.map((form) => (
							// a form is a record rather than a run of paragraphs: its name and its status on
							// one baseline, then the one fact a list of forms is scanned for — where it may
							// be used — as a labelled value, then what an operator takes away from it.
							//
							// the record is written out of the classes packages/operator/src/styles/adm.css
							// already draws rather than mounted from the library's `RecordCard`, which now
							// draws all of this: the level is the caller's, the status word takes its
							// register, and the origins are a labelled list. adopting it is the one change
							// left here and is a screen's change rather than a part's. nothing new is drawn
							// and no value is stated.
							//
							// the id is not one of those labelled values and must not become one. every
							// control on the card is already built from it — the name links to the form's
							// own page, and the two below carry it in the addresses they point at — so a row
							// printing it as a value is one string said again with no job.
							<section className="adm-record" key={form.id}>
								<div className="adm-record__head">
									{/* the name is a plain link and takes the title's own type role, rather
									    than arriving at a button's and being pushed back out of it.

									    level 2, because a record on this list stands directly under the
									    page's own `<h1>` and nothing sits between them. how loud the words
									    are is `.adm-record__title`'s to say. */}
									<h2 className="adm-record__title">
										<Link to={href('/admin/forms/:id', { id: form.id })}>{form.name}</Link>
									</h2>
									{/* Live is the word somebody scanning this list is looking for, so it is
									    the one at full weight and Draft is the quieter of the two. there are
									    only ever those two here: `readForms` leaves an archived form out of
									    the list entirely. */}
									<StatusWord secondary={form.status !== 'live'}>
										{FORM_STATUS_LABELS[form.status]}
									</StatusWord>
								</div>

								<dl>
									<div className="adm-setting">
										<dt className="adm-setting__label">Sites</dt>
										{/* a form with nothing ticked is still served somewhere, so the empty
										    value says where rather than saying none: this deployment's own
										    donation page is on no `site` row and on no form's
										    `allowed_origins`, and is accepted off the request instead
										    (./$formId.tsx). it states what the form is, not what an operator
										    should do about it — this screen writes nothing and reports no
										    blocker, so it is set as a caption rather than as a value somebody
										    has to act on. */}
										{form.origins.length === 0 ? (
											<dd className="adm-setting__value adm-caption">Your donation page only.</dd>
										) : (
											// a list and never the joined text, however few there are: an
											// origin is an identifier, and a comma between two of them reads
											// as part of one.
											<dd className="adm-setting__value">
												<ul className="adm-record__origins">
													{form.origins.map((origin) => (
														<li key={origin}>
															<CodeChip>{origin}</CodeChip>
														</li>
													))}
												</ul>
											</dd>
										)}
									</div>
								</dl>

								{/* last, because it is what an operator takes away from the record rather
								    than part of what the record says.

								    both navigate and neither writes, so both are links wearing a button and
								    neither states a `variant`: they are one rank, and the record they act on
								    is what tells them apart rather than a tone.

								    both are drawn on a draft as well. a draft's donation page answers with a
								    notice rather than the form and its snippet fails the same way — the
								    served config refuses a draft — and neither is a state this screen can
								    repair: publishing is a press on the form's own page, and the hint above
								    the list is where that is said once. */}
								<div className="adm-actions">
									<Button as={Link} size="sm" to={href('/:formId', { formId: form.id })}>
										View donation page
									</Button>
									{/* named for the record it acts on, for the reason the members list names
									    its per-row control: twenty controls all called Embed is a list a
									    reader has to walk to reach the one they came for. */}
									<Button
										as={Link}
										size="sm"
										to={`${SCREEN}?embed=${encodeURIComponent(form.id)}`}
										aria-label={`Embed ${form.name}`}
									>
										Embed
									</Button>
								</div>
							</section>
						))}
					</List>
				</>
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
 * no `<form>` around it — nothing on this screen posts, and the way out is a link back to the
 * address the card was opened from.
 *
 * the requirement is stated rather than checked: the snippet loads on the sites the form lists, and
 * this screen writes nothing, so the sentence points at the page that does. the deployment's own
 * donation page is not on that list and never has to be — it is accepted off the request instead
 * (./$formId.tsx).
 */
function EmbedCard({
	form
}: {
	readonly form: NonNullable<Route.ComponentProps['loaderData']['embedding']>;
}) {
	const navigate = useNavigate();

	return (
		<Modal
			// the quotes are the seam between the verb and the name: `Embed General Fund` reads as one
			// run-on phrase with nothing marking where the name starts.
			title={<>Embed &ldquo;{form.name}&rdquo;</>}
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
			<p className="adm-prose">
				It loads only on the sites this form lists. Add the site on{' '}
				<Link to={href('/admin/forms/:id', { id: form.id })}>the form&rsquo;s own page</Link>.
			</p>
		</Modal>
	);
}
