import { AnchoredNote } from '@better-giving/operator/behaviour/AnchoredCard';
import { SaveButton } from '@better-giving/operator/components/controls/SaveButton';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { RepeatingRows } from '@better-giving/operator/components/forms/RepeatingRows';
import type { RepeatingRow } from '@better-giving/operator/components/forms/RepeatingRows';
import { Section } from '@better-giving/operator/components/shell/Layout';
import { MarkedText } from '@better-giving/operator/marked-text.react';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Form } from 'react-router';
import { WhyNot } from './deployment-states';
import { useReseeded } from './reseed';
import { Said } from './said';
import type { SitesWrite } from '../api/types';
import type { SitesPress, WalletsLevel, WidgetLevel } from '../api/types';
import { SITES_BOX, SITES_FORM, SITES_INTENT, SITE_FIELD, siteSeed } from './sites';
import { useConsoleForm } from './use-console-form';
import { WALLET_LEAD, walletTrouble } from './wallet-level';
import { WIDGET_LEAD, widgetTrouble } from './widget-level';

// the sites this deployment's donation forms may be loaded on, edited inside one fold of the one
// page.
//
// **it is a component and not a screen.** every read it draws was taken by ../routes/_index.tsx's
// `loader` and the one press it makes is answered by that page's `action`; what this holds is the
// boxes, the press and the sentences each answer is said in. which fold this is — its label, its
// tone, the word beside it and what stands between it and its job — is decided in ./home-sections.ts
// with the others.
//
// **the spam widget has no standing panel here, and its levelling reports at the press.** the
// widget and both of its keys are made by the first deploy (`packages/console/internal/first`), so
// there is nothing here for an operator to set and a panel reporting the widget's state would be a
// finding with no control beside it. what a save does is a different thing: it stores the list on
// the deployment and brings cloudflare's copy of the hostnames level behind that
// (`packages/console/internal/widget`), which is two writes under one press. so where the second one did
// not happen it says so at the button that made it, in the same place a save reports itself
// everywhere else on these surfaces — an outcome belongs at the control that caused it, and a press
// that says only "saved" over a widget still carrying the old hostnames sends the operator to
// debug their donation form. ./widget-level.ts is what each arm of that says.
//
// **and the same press levels one more thing behind the list, for the same reason and reported the
// same way.** Apple Pay, Google Pay and Link are drawn only on a hostname registered on the Stripe
// account, so a site added here offers a donor none of them until it is
// (`packages/app/src/lib/server/payments/wallet-domains.ts`) — and a save that says only "saved"
// over a hostname the account holds nothing for is that same silence a second time. ./wallet-level.ts
// is what each arm of it says, and the press that repairs it stands on the payments fold rather than
// here: this fold draws none of those hostnames.
//
// **the deployment's own donation page is the first row of the list and no press can take it off.**
// every deployment serves one at its own address, and it is on no `site` row and on no form's
// `allowed_origins` because the deployment takes its own origin off each request (CLAUDE.md →
// Product surface). so the row is read-only and carries no name at all (`fixed` in
// `@better-giving/operator/components/forms/RepeatingRows`) — the list is stored whole, so a row
// with a Remove beside it would take the operator's own donation page down at the next save, and a
// row that reached the submission would be stored as a site the deployment never had. what stands
// where the Remove does says why, at the point an operator wonders. a deployment whose address
// reads nowhere draws no such row rather than an address nothing answers on, and the group opens on
// nothing but the Add.
//
// **every typed row is removable, the last one included, and the locked row is what makes that
// safe.** a group that drops to no editable row is not a dead end here: the donation page is still
// on the screen above the Add, so there is something to read and something to press. dropping the
// rows is also the whole of how the list is emptied — a box emptied instead is refused under itself
// (./sites.ts), so no press has two meanings. **a deployment holding no site opens on no editable
// box either**: a blank row nobody added is a Remove offered over nothing and a refusal waiting at
// the press, where the locked row above already says the fold is not empty.
//
// **arranging the boxes is not a press, and the only press is Save sites.** adding and dropping a
// row are the form's own list intents, applied in the browser and posted nowhere
// (./use-console-form.ts) — so a row an operator adds costs no round trip, takes nothing out of the
// boxes beside it and puts no answer on the screen.
//
// **so this fold mounts the form layer, and every rule it runs is the one both ends read.** what a
// site may be is `readOriginRows` in `@better-giving/operator/origins`, mounted through
// ./sites.ts's schema and the seam: at the press, each offending box earns its own sentence, under
// itself, in the words the deployment would have answered with — because they are the same words. a
// reading made here that the worker did not make would be a console turning down a value the worker
// accepts, which is why nothing about a site is decided in this file.
//
// **nothing is drawn under the group, and the two sentences that are about no box report at the
// press instead.** how many sites there may be is a fact about the list, and so is the deployment's
// own refusal of a press already made — a save blocked by a form still switched on for a site names
// sites rather than boxes. neither has a box to hang under, and a message under the fieldset is a
// press the operator cannot see answered: conform moves focus at a submit by walking the form's own
// controls for one whose `name` the error map holds (./use-console-form.ts), and a sentence keyed
// to the bare field names no control — so the press leaves the operator on the button with the
// answer rows away from it. drawn beside the button, the one place a press reports on these
// surfaces, both are where the press was made. they stay two readings rather than one for the
// reason ./use-console-form.ts's header argues: the client pass cannot re-derive a sentence only
// the deployment knows, so feeding one to the other would take it off the screen at the first
// keystroke while it was still true.
//
// **the press is read against the boxes the fold was drawn with.** a list that is already stored
// has nothing to save, so the button rests closed until a row differs from that seed
// (./use-console-form.ts) — a blank row included, because a row the form refuses blank has to be
// pressable to be refused, and a row added or dropped included, which is the whole of why that
// reading is the form layer's rather than a walk over the boxes. the
// press that stores an empty list is an operator moving domains, made by dropping every row, and
// the worker stores it: there is nothing to confirm, because the deployment goes on serving its own
// donation page whatever this list holds and the fold draws that page above the boxes.
//
// **the boxes go back to what the deployment holds on the reading that shows it, and the press is
// not over until they have.** conform reads a changed `defaultValue` at a reset and nowhere else —
// `onUpdate` in @conform-to/dom keeps the new one and rebuilds nothing from it — and this is the one
// fold whose seed decides how many boxes there are as well as what each holds. so a form put back on
// its own answer, which commits two router phases ahead of the reading (./reseed.ts), is put back to
// the list the press was made against and no reading after it reaches the boxes or the metadata
// counting them: a site just stored is counted by the fold's own row and drawn in no box at all.
//
// **no state about a sign-in.** a console whose cloudflare sign-in has gone draws a face of its own
// and never the folds (`blocked` in ../api/types.ts's `HomeFace`) — so a fold restating it
// would be a sentence about something the operator cannot be looking at. the deployment's own
// report is the same: this fold is drawn only where it landed, so the list it seeds the boxes from
// is always there.

/**
 * where the connect control is, from inside the panel.
 *
 * the deployment not answering is a state whose next reading draws the connect press in place of
 * these folds (../routes/_index.tsx), so the way out is this page read again rather than a link to
 * a section of itself.
 */
const RECONNECT_HERE: ReactNode = <>after reloading this page</>;

/**
 * the locked row's box.
 *
 * named for what it holds rather than by a position, because it is in no position: the typed rows
 * are named by the list field they belong to and this row is not one of them — it posts nothing and
 * no Remove points at it.
 */
const DONATE_PAGE_ROW = `${SITES_BOX}-donate-page`;

export type SitesFoldProps = {
	/** the list the deployment holds, which is what the boxes are seeded from. */
	sites: readonly string[];
	/**
	 * where this deployment's own donation page answers, which is the list's first row and is
	 * locked, or `''` where it answers nowhere the console could read — which draws no such row.
	 */
	donatePage: string;
	/** how the last list press went, or `null` where none has been made. */
	list: SitesPress | null;
	/** something else on the page is writing, which holds every control on it closed. */
	busy: boolean;
	/** which intent is in flight, or `null` where none is. */
	pending: string | null;
};

export function SitesFold({ sites, donatePage, list, busy, pending }: SitesFoldProps): ReactNode {
	/** whether the last press left the deployment holding a list, which is what a save reports. */
	const landed = list?.written.kind === 'saved';

	/* the boxes go back to what the deployment holds on the reading that lands after this press, and
	   not on the answer that arrives ahead of it (./reseed.ts). the reading is the `sites` prop the
	   boxes are seeded through and never the seed composed off it below: that object is new at every
	   render, and the prop is the deployment answered once per re-read. */
	const spent = useReseeded({ landed, pending: pending === SITES_INTENT, reading: sites });

	/**
	 * this press from end to end, which is what the boxes are closed for and what the button reports.
	 *
	 * the request is the shorter half: it ends while the console is still finding out what the list
	 * now is, and a form back on `Save sites` over boxes it is about to put back is a press an
	 * operator makes twice. a row left editable across the second half is one whose contents are
	 * taken away by that reading landing, which is what ../closed-while-writing.spec.ts is over.
	 */
	const underway = pending === SITES_INTENT || (landed && !spent);

	const form = useConsoleForm(SITES_FORM, {
		report: list,
		landed,
		spent,
		/* the list the deployment is holding on the reading that stands, and nothing where it holds
		   none. conform reads this at the mount and again at a reset, and every draw between the two
		   is the boxes as the operator left them — so `spent` above is what carries a stored list
		   into them. */
		defaultValue: { [SITE_FIELD]: siteSeed(sites) },
		busy,
		pending: underway
	});

	const field = form.fields[SITE_FIELD];
	const rows = field.getFieldList();
	const controls = form.list(field.name);

	/* a fold put away is a fold at rest: the boxes back to what the deployment holds. the element is
	   found rather than handed down — what shuts is several components above this one, and a flag
	   threaded through each of them would be a prop every fold states and nothing else reads.
	   ./payments-fold.tsx and ./smtp-fold.tsx answer the same thing the same way. */
	const element = form.mount.ref;
	const { reset } = form;
	useEffect(() => {
		const fold = element.current === null ? null : element.current.closest('details');
		if (fold === null) return;
		const shut = () => {
			if (fold.open) return;
			reset();
		};
		fold.addEventListener('toggle', shut);
		return () => fold.removeEventListener('toggle', shut);
	}, [element, reset]);

	/* the client pass's own sentence about the list, which is the cap on how many sites there may
	   be. it is keyed to the bare field and so belongs to no box: this fold's header says why that
	   makes the button the one place it can be read. */
	const capError = field.errors?.[0];

	/* one row: the box the seam bound, the identity conform minted for it, and the sentence about
	   the address in it. the control that drops it is the form's own intent for that position, and
	   every row carries one — dropping the last of them is how the list is emptied, and the locked
	   row above is what keeps the group from becoming an Add button over nothing. */
	const asRow = (bound: (typeof rows)[number], at: number): RepeatingRow => {
		const box = form.box(bound);
		return {
			id: box.id,
			key: bound.key,
			name: box.name,
			defaultValue: box.defaultValue,
			inputMode: 'url',
			error: box.error === undefined ? undefined : <MarkedText text={box.error} />,
			remove: controls.remove(at)
		};
	};

	return (
		<Section>
			{/* no heading and no opening line: the fold's own row names this list on the way in
			    (./home-sections.ts), and either one here would say a second time what an operator has
			    just read. the naming is the row's, so nothing stands over the boxes at all. */}
			<Form {...form.mount} className="adm-stack" method="post" preventScrollReset>
				<RepeatingRows
					id={SITES_BOX}
					// stated and not drawn. the fold's own row above already names this list
					// (./home-sections.ts) and the boxes show they want an address, so a mark here would
					// say what the operator has just read on the way in. dropping it is a different thing
					// and not this one: every box and every Remove takes its name from it.
					legend="Site"
					legendHidden
					addLabel="Add a site"
					placeholder="https://example.org"
					code
					// the rows and both of the group's presses, closed while anything on the page is
					// writing: the save reads this list once, and a row added or dropped behind a press
					// in flight is a list the operator can no longer see the whole of. and closed for
					// the whole of this fold's own press rather than for the request alone, because the
					// reading that ends it is what puts these boxes back.
					disabled={busy || underway}
					// no `error`: every sentence this fold draws stands under the box it is about, and
					// the two that are about no box report at the press instead (this file's header).
					//
					// the press that puts an empty row at the end, as the form states it: a list intent
					// applied in the browser, so it costs no round trip and takes nothing out of the
					// boxes beside it.
					add={controls.add}
					// the deployment's own donation page, in the list and out of the submission. what stands
					// where the other rows offer a Remove is a status and not a control — the mark and the
					// word go over bare and the group sets them as one — and the sentence it carries is one
					// press away rather than standing over every box.
					fixed={
						donatePage === ''
							? undefined
							: {
									id: DONATE_PAGE_ROW,
									label: 'Your donation page',
									value: donatePage,
									aside: (
										<>
											<AnchoredNote mark="info" label="Why your donation page is always listed">
												<p>
													This deployment serves a donation page at its own address, and every form
													loads there whatever else is listed.
												</p>
												<p>
													It is not one of the sites you type here, so nothing on this list can take
													it down.
												</p>
											</AnchoredNote>
											Default
										</>
									)
								}
					}
					rows={rows.map(asRow)}
				/>

				<div className="adm-actions">
					<SaveButton
						name="intent"
						value={SITES_INTENT}
						state={form.state}
						label="Save sites"
						doneLabel="Saved"
					/>
				</div>

				{/* the one thing the client pass turns a press down for that belongs to no box, said
				    where the press was made. conform leaves focus on the button for it — the walk it makes
				    at a submit finds no control carrying that name (this file's header) — so this is what
				    the operator is looking at when nothing else on the screen has moved. */}
				{capError === undefined ? null : (
					<FieldMessage>
						<MarkedText text={capError} />
					</FieldMessage>
				)}

				{/* what the press did, said once its boxes hold what it left behind: an outcome under a
				    button still drawing `Saving`, over rows about to be replaced by the reading that
				    ends the press, is a report of a press the screen is still making. */}
				{busy || underway || list === null ? null : (
					<>
						<SitesOutcome written={list.written} />
						{/* said once and ahead of whichever levelling has trouble to report, rather than
						    inside each: the two share this clause and a reader of both alerts would
						    otherwise hear it twice for one press (./widget-level.ts, ./wallet-level.ts). */}
						{widgetTrouble(list.widget) === null && walletTrouble(list.wallets) === null ? null : (
							<p className="adm-prose">Your sites were saved.</p>
						)}
						<WidgetOutcome level={list.widget} />
						<WalletsOutcome level={list.wallets} />
					</>
				)}
			</Form>
		</Section>
	);
}

/**
 * what one press of Save sites ended as.
 *
 * every refusal this fold hand-draws announces, and the live region is written at its site rather
 * than taken from the shared parts, because what came back is about a press and those parts draw a
 * region only under the boxes they label. this fold's own row editor is handed no group message at
 * all (the caller above), so a sentence about the press has nowhere else to be announced from:
 * without a region here it answers into a paragraph nothing reads out, and the operator is left
 * with a button that did nothing they were told about.
 *
 * a save that landed says nothing here: the button it was pressed from is what reports it.
 */
function SitesOutcome({ written }: { written: SitesWrite }): ReactNode {
	if (written.kind === 'refused') {
		// the whole sentence, here rather than under the boxes: it is keyed to no box — the far end
		// answers a refused list with one message and marks no row of it — so drawn over the group it
		// would be a press answered rows away from where it was made.
		return (
			<>
				<FieldMessage>
					<MarkedText text={written.message} />
				</FieldMessage>
				{written.fix === null ? null : (
					<p className="adm-hint">
						<MarkedText text={written.fix} />
					</p>
				)}
			</>
		);
	}

	if (written.kind === 'blocked') {
		return (
			<>
				<FieldMessage>
					Nothing was saved. {written.inUse.length === 1 ? 'A site' : 'Sites'} you removed{' '}
					{written.inUse.length === 1 ? 'is' : 'are'} still switched on for a donation form:
				</FieldMessage>
				<ul className="adm-list">
					{written.inUse.map((entry) => (
						<li key={entry.site}>
							<code className="adm-chip">{entry.site}</code>: {formNames(entry)}
						</li>
					))}
				</ul>
				{written.fix === null ? null : (
					<p className="adm-hint">
						<MarkedText text={written.fix} />
					</p>
				)}
			</>
		);
	}

	if (written.kind === 'unwritten') {
		return <WhyNot answer={written.read} what="nothing was saved" where={RECONNECT_HERE} />;
	}

	return null;
}

/**
 * what the same press did to cloudflare's copy of the list, where it did not bring it level.
 *
 * drawn beside the save and never as a standing panel, for the reason this file's header argues:
 * this is an outcome of a press somebody just made rather than a reading of the widget, and a fold
 * with no control over the widget has no business holding the second.
 *
 * a levelling that landed says nothing at all. the button's own confirmation is what reports the
 * press, and a second sentence saying the other half worked too is a line read once and then read
 * past on every save afterwards — by which time it is the one press that says something different
 * that goes unnoticed.
 *
 * it announces, and the region is written here rather than taken from the shared parts, for the
 * reason {@link SitesOutcome} states about its own: those parts draw a region only under the box
 * they label, and what this answers is a submit with no box to hang one off.
 *
 * `WIDGET_LEAD` carries no "your sites were saved" of its own — the caller draws that once, ahead
 * of this and {@link WalletsOutcome} alike, for ./widget-level.ts's reason.
 */
function WidgetOutcome({ level }: { level: WidgetLevel }): ReactNode {
	const trouble = widgetTrouble(level);
	if (trouble === null) return null;
	return (
		<>
			<FieldMessage>
				{WIDGET_LEAD} {trouble.said}
			</FieldMessage>
			{trouble.detail === null ? null : <Said answer={{ detail: trouble.detail }} />}
		</>
	);
}

/**
 * what the same press left on the Stripe account, where it did not leave every hostname drawing.
 *
 * drawn under {@link WidgetOutcome} and never in its place: they are two different levellings with
 * two different consequences — one turns a donor away and one takes a button off the form — and a
 * press that failed at both has both to say.
 *
 * a registration that landed says nothing at all, for {@link WidgetOutcome}'s reason. what it names
 * instead is the fold the one repair press stands on, because this fold has none (./wallet-level.ts).
 *
 * it announces, and the region is written here rather than taken from the shared parts, for the
 * reason {@link SitesOutcome} states about its own.
 *
 * **the detail is marked and never quoted through {@link Said}.** {@link WidgetOutcome}'s detail is
 * Cloudflare's own words, which ./said.tsx prints raw for the reason its header states — but the
 * wallet levelling's detail is this deployment's own sentence about the hostname to fix
 * (`packages/app/src/lib/server/payments/wallet-domains.ts`), the same field `payments-fold.tsx`
 * draws through `MarkedText`, so a backtick in it is a mark and not a character to print.
 */
function WalletsOutcome({ level }: { level: WalletsLevel | null }): ReactNode {
	const trouble = walletTrouble(level);
	if (trouble === null) return null;
	return (
		<>
			<FieldMessage>
				{WALLET_LEAD} {trouble.said}
			</FieldMessage>
			{trouble.detail === null ? null : (
				<p className="adm-prose">
					<MarkedText text={trouble.detail} />
				</p>
			)}
		</>
	);
}

/** the forms holding one site, named. */
const formNames = (entry: { forms: readonly { name: string }[] }): string =>
	entry.forms.length === 0
		? 'a donation form this console could not read the name of'
		: entry.forms.map((form) => form.name).join(', ');
