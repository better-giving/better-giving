import { CodeChip } from '@better-giving/operator/components/data/CodeSlab';
import { CheckboxGroup } from '@better-giving/operator/components/forms/CheckboxGroup';
import { type ReactNode, useId } from 'react';
import { FORM_FIELD_LABELS } from '$lib/forms/fields';
import { unlistedSites } from '$lib/forms/input-schema';
import { MarkedText } from '@better-giving/operator/marked-text.react';

// where a donation form may be used: one tick box per site this deployment has listed, with this
// form's own set ticked.
//
// the ticked sites are the whole of where a form loads. a form is for pasting into a site and has
// no page of its own — the deployment's donation page at `/donate` draws its donation box from the
// page's own settings row, not from any form — so a form with nothing ticked loads nowhere, and the
// group says so.
//
// one of the group components — see ./name-fields.tsx for why each takes its own boxes rather than
// a form.
//
// a form screen carries only what that form decides, and which sites exist is not one of those
// things: the list is the deployment's and is typed on the console. so nothing here adds,
// removes or edits an address — there is no Add, no Remove and no round trip, and a browser submits
// the ticked boxes and nothing else. a group with nothing ticked submits no key at all, which
// `.prefault([])` in `$lib/forms/input-schema.ts` is what stands in for.
//
// nothing here is a per-box message, and there is no per-box field to key one to. the rules live in
// `@better-giving/operator/origins` and `$lib/forms/input-schema.ts` and their sentence comes out
// of the schema, under the group — so what a refused save shows is one message for the group,
// whether the schema pushed it or an action keyed it onto `allowed_origins`. that is exactly what
// the library's `CheckboxGroup` draws: one message for the group, every box marked refused by it,
// and every box pointed at it.
//
// the hint under the group says where a missing site is added, and nothing ever takes its place.
// with nothing ticked it leads with that fact and, where there is a box to tick, what to do about
// it. an empty state rather than a warning: a form made ahead of the site it goes on is ordinary.
// it reads what the form holds, as the boxes are seeded, so a box ticked since is not reflected
// until the save.
//
// what each box names is built from what is on the screen, because an `aria-describedby` naming a
// hint that was not rendered describes nothing.
//
// that sentence is not a link, and may not be. a form screen names the console's Sites fold
// (packages/console-ui/src/lib/sites-fold.tsx) as the place a site is listed and stops: it is not on
// this deployment at all, so there is no address here to link to.
//
// the fieldset is this file's and the group inside it is the library's: the legend is written here
// and `CheckboxGroup` is mounted without one, which is the shape that component states for a group
// already named by where it sits.

const NOT_ON_ANY_SITE = 'Not on any site yet.';
const TICK_THE_SITES = 'Tick the sites you’ll paste this form on.';
const WHERE_A_SITE_COMES_FROM = 'A site that is not here is listed on the console.';

type OriginsBox = {
	/** the group's own id, which the message under it is named from. */
	readonly id: string;
	/** the name every tick box carries, which is what the browser repeats per ticked value. */
	readonly name: string;
	/** whatever the last save refused the group with. one sentence for the whole group. */
	readonly errors?: string[] | undefined;
	/** the sites this form is on, as the form holds them. */
	readonly ticked: readonly string[];
};

type FormOriginsFieldsProps = {
	/** the sites box, which is a group of controls rather than one. */
	readonly box: OriginsBox;
	/**
	 * every site this deployment has listed, in the operator's own order, as the loader read it.
	 *
	 * the whole list rather than the ticked ones: an operator adding a site to this form has to see
	 * the ones it is not on, and an empty list is a state this group says something about.
	 */
	readonly sites: readonly string[];
	/**
	 * the group's own submit, at the foot of the group it saves. absent on the create screen, which
	 * has one submit for all four groups.
	 */
	readonly footer?: ReactNode;
};

export function FormOriginsFields({ box, sites, footer }: FormOriginsFieldsProps) {
	const originsError = box.errors?.[0];

	// what makes a dropped site's box distinct from the listed box of the same address, and what
	// names its second line. stated from `useId` rather than written down: this group is mounted
	// once per screen today and a second mount would otherwise give two boxes one id, which names
	// the wrong note.
	const uid = useId();

	/**
	 * the sites this form holds that the deployment no longer lists.
	 *
	 * a real state rather than a guard: both invariants over these two lists are read-then-write and
	 * D1 has no interactive transaction, so a site can leave the shared list between this page being
	 * drawn and its save being pressed. the residue is benign on the public path — `corsHeaders` in
	 * `$lib/server/api/cors.ts` reads the form's own column — and has to be visible and clearable.
	 *
	 * read off the form's own values rather than kept in state, and the seeding is what makes that
	 * safe: conform re-renders the boxes from what was submitted, so a value arriving on a rejected
	 * save has a box of its own — one the form holds with nothing to untick it with is a save
	 * refused forever with nothing on the screen to act on.
	 */
	const orphans = unlistedSites(box.ticked, sites);

	// one box per site, plus one per site the deployment has dropped.
	//
	// keyed by the address, which is what a box is: the value is what the browser submits, what the
	// form holds and what `site_origin_idx` makes unique. the visible text is the address and
	// nothing else — a name for it would be a second vocabulary for one string, and the string is
	// what a browser sends in its `Origin` header, so it is what an operator checks their own site
	// against.
	//
	// a dropped site's box carries the note as its second line. the library is what keeps the note
	// out of the box's own name and points the box at it instead: wrapped into the label, the
	// accessible name would be the address followed by a sentence about it, and a voice user cannot
	// say a control whose name is a sentence.
	//
	// the note says what is true of this box and nothing about what to do. the two ways out are in
	// the refusal under the group, which is where they are worth reading, and a sentence repeating
	// them on every orphan would be the same instruction as many times as the deployment dropped a
	// site.
	const items = [
		...sites.map((site) => ({
			id: site,
			label: <CodeChip>{site}</CodeChip>,
			value: site,
			defaultChecked: box.ticked.includes(site)
		})),
		...orphans.map((orphan) => ({
			id: `${uid}-${orphan}`,
			label: <CodeChip>{orphan}</CodeChip>,
			note: 'No longer listed.',
			value: orphan,
			defaultChecked: true
		}))
	];

	const onNoSite = box.ticked.length === 0;
	const hint = [
		onNoSite ? NOT_ON_ANY_SITE : null,
		onNoSite && sites.length > 0 ? TICK_THE_SITES : null,
		WHERE_A_SITE_COMES_FROM
	]
		.filter(Boolean)
		.join(' ');

	return (
		<>
			<h2>Where it may be used</h2>

			<fieldset className="adm-fieldset">
				<legend className="adm-fieldset__legend">{FORM_FIELD_LABELS.allowed_origins}</legend>

				{/* the group without its own legend, because the fieldset above already names it and a
				    group nested in a group tells a reader there are two. the hint, the refusal and
				    every `aria-describedby` between them are the library's, named from the id handed
				    over here.

				    where a site comes from is owed here and is not owed everywhere: an operator who
				    reads it comes back to this group and ticks something. a block that only states a
				    value gets none — a note under every block is a screen of forwarding addresses.

				    it is drawn with no box under it too, where it is the only thing saying a site is
				    something this deployment can have. */}
				<CheckboxGroup
					id={box.id}
					name={box.name}
					items={items}
					hint={hint}
					error={originsError === undefined ? undefined : <MarkedText text={originsError} />}
				/>
			</fieldset>

			{footer ? <div className="adm-actions">{footer}</div> : null}
		</>
	);
}
