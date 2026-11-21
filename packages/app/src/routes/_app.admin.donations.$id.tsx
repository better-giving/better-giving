import { href } from 'react-router';
import type { CrumbHandle } from '$lib/admin/crumbs';
import { GiftDetail, type MatchHistoryRow } from '$lib/admin/donations/gift-detail';
import { screenTitle } from '$lib/admin/screen-title';
import { defineForm, type FormRejection } from '$lib/forms/definition';
import { REQUIRED } from '$lib/forms/input-schema';
import {
	MARK_FILED_INPUT,
	MARK_MATCHED_INPUT,
	MATCH_FORMS,
	VOID_MATCH_INPUT
} from '$lib/matching/forms';
import type { MatchStatus } from '$lib/matching/status';
import { STAFF_USER_ID } from '$lib/server/auth';
import { invalid, parseForm, type RejectionReasons, submittedForm } from '$lib/server/conform';
import { loadFailed, notFound } from '$lib/server/db/load-failure';
import { isDatedByDay, RAIL_LABELS } from '$lib/server/donations/rails';
import { markFiled, markMatched, voidMatch } from '$lib/server/matching/match';
import { type MatchActor, readStaffMatch, readStaffNames } from '$lib/server/matching/views';
import { database, staff } from '../context';
import type { Route } from './+types/_app.admin.donations.$id';

// one gift at /admin/donations/{id}, and its employer match: the read `readStaffMatch` in
// `$lib/server/matching/views.ts` answers, mapped into `GiftDetail`'s props, and the three presses
// staff run the match with.
//
// any member may press them: the nonprofit's own staff run the match, so unlike Settings these
// writes do not gate on `STAFF_USER_ID`. each press is stamped with the id of whoever made it, and
// the history names that person rather than the id.
//
// a press answers in place with the component's `result` and never redirects: the router
// revalidates the loader after a 2xx action, so the card is read again beneath the banner. a refusal
// is a 4xx or a 5xx through `invalid()`, with the pressed form's rejection and the `error` sentence
// the screen reports; the router does not revalidate on one, so the sentence says to reload.

/** what to say when there is no such gift, wherever it is asked. */
const NO_SUCH_GIFT =
	'No gift here has that address. It may have been opened from an old link. Go back to Gifts and pick it from the list.';

/** the section this screen sits under, named first in the trail and in the tab. */
const SECTION = 'Gifts';

export const handle = {
	crumbs: ({ loaderData, pathname }) => [
		{ href: href('/admin/donations'), label: SECTION },
		{ href: pathname, label: loaderData?.gift.donorName ?? SECTION }
	]
} satisfies CrumbHandle<Route.ComponentProps['loaderData']>;

export function meta({ loaderData, matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(loaderData?.gift.donorName ?? SECTION, matches) }];
}

/**
 * who set a stamp, as the history says it. a member removed since is named by a plain word: the id
 * is never what a screen shows.
 */
function whoSaid(actor: MatchActor, names: ReadonlyMap<string, string>): string {
	if (actor.kind === 'donor') return 'the donor';
	if (actor.kind === 'system') return 'system';
	return names.get(actor.userId) ?? 'a former member';
}

export async function loader({ context, params }: Route.LoaderArgs) {
	const db = context.get(database);

	let view: Awaited<ReturnType<typeof readStaffMatch>>;
	let names: Awaited<ReturnType<typeof readStaffNames>>;
	try {
		view = await readStaffMatch(db, params.id);
		names = await readStaffNames(db, view?.match?.history ?? []);
	} catch (e) {
		console.error('reading a gift failed:', e);
		loadFailed('This gift');
	}
	// a gift recorded before matching has no match row and still renders, as the gift alone: the
	// list links every donor's name here.
	if (view === null) notFound(NO_SUCH_GIFT);

	const { gift, match } = view;
	return {
		gift: {
			donorName: gift.donorName,
			donorEmail: gift.donorEmail,
			amountMinor: gift.amountMinor,
			currency: gift.currency,
			// money arriving in hand, or a pledge marked received, is stored as the day typed, at that
			// day's UTC midnight (`isDatedByDay`), so its day
			// is UTC's and crosses as the ISO day — the gifts list's reading of the same column.
			...(isDatedByDay(gift.method)
				? { receivedOn: gift.receivedAt.toISOString().slice(0, 10) }
				: { receivedAt: gift.receivedAt.toISOString() }),
			paidWith: gift.method === null ? null : RAIL_LABELS[gift.method],
			status: gift.status,
			receiptSentAt: gift.receiptSentAt === null ? null : gift.receiptSentAt.toISOString()
		},
		match:
			match === null
				? null
				: {
						status: match.status,
						employer: match.employer,
						history: match.history.map(
							(row): MatchHistoryRow => ({
								event: row.event,
								who: whoSaid(row.who, names),
								at: row.at.toISOString(),
								...(row.reason === undefined ? {} : { reason: row.reason })
							})
						)
					},
		mailingAddressMissing: view.mailingAddressMissing,
		// Settings gates its loader on the deployer ($lib/admin/destinations.ts marks it so), and a
		// member is told who can open it instead of being sent to a not-found.
		canOpenSettings: context.get(staff).id === STAFF_USER_ID
	};
}

/** the sentence for a press that changed nothing, by where the match already stands. */
function unchanged(status: MatchStatus | null): string {
	const reload = 'Reload the page to see how it stands.';
	switch (status) {
		case 'voided':
			return `This match was already voided, so nothing changed. ${reload}`;
		case 'matched':
			return `This match was already marked matched, so nothing changed. ${reload}`;
		case 'filed':
			return `This match was already marked filed, so nothing changed. ${reload}`;
		default:
			return `This match changed since the page was drawn, so nothing changed. ${reload}`;
	}
}

const WRITE_FAILED = 'This was not saved. Reload the page and try again.';

const MARK_FILED_FORM = defineForm({ id: MATCH_FORMS.filed, schema: MARK_FILED_INPUT });
const MARK_MATCHED_FORM = defineForm({ id: MATCH_FORMS.matched, schema: MARK_MATCHED_INPUT });
const VOID_MATCH_FORM = defineForm({ id: MATCH_FORMS.void, schema: VOID_MATCH_INPUT });

const SCREEN_FORMS = [MATCH_FORMS.filed, MATCH_FORMS.matched, MATCH_FORMS.void] as const;

/**
 * the three presses on the match. **the request body is read exactly once, here** — `parseForm`
 * reads what it returns and nothing above this route may.
 */
export async function action({ context, params, request }: Route.ActionArgs) {
	const db = context.get(database);
	const by = context.get(staff).id;
	const key = { donationId: params.id };
	const now = new Date();
	const body = await request.formData();

	// the arms are declared inside the action: react router strips a route's `action` from the bundle
	// it ships and nothing else, so a module-scope helper reaching `$lib/server/**` would ship it
	// (../routes.spec.ts holds that over the module graph).
	async function written(
		write: () => ReturnType<typeof markFiled>,
		done: 'filed' | 'matched' | 'void',
		reject: (reasons?: RejectionReasons) => FormRejection
	) {
		let answer: Awaited<ReturnType<typeof markFiled>>;
		try {
			answer = await write();
		} catch (e) {
			console.error(`the match's ${done} press failed:`, e);
			return invalid(500, reject(), { error: WRITE_FAILED });
		}
		if (!answer.ok) {
			if (answer.reason === 'not_found') notFound(NO_SUCH_GIFT);
			// `voidMatch` refuses a blank reason as the schema does, and it goes under the box the same.
			return invalid(400, reject({ fieldErrors: { reason: [REQUIRED] } }));
		}
		if (!answer.changed) {
			return invalid(409, reject(), { error: unchanged(answer.state.status) });
		}
		return { done };
	}

	// `submittedForm` refuses a body naming none of the three, so what is left after two is the void.
	const which = submittedForm(body, SCREEN_FORMS);
	if (which === MATCH_FORMS.filed) {
		const parsed = parseForm(body, MARK_FILED_FORM);
		if (!parsed.ok) return invalid(400, parsed.reject());
		return written(() => markFiled(db, key, by, now), 'filed', parsed.reject);
	}
	if (which === MATCH_FORMS.matched) {
		const parsed = parseForm(body, MARK_MATCHED_FORM);
		if (!parsed.ok) return invalid(400, parsed.reject());
		return written(() => markMatched(db, key, by, now), 'matched', parsed.reject);
	}
	const parsed = parseForm(body, VOID_MATCH_FORM);
	if (!parsed.ok) return invalid(400, parsed.reject());
	const { reason } = parsed.value;
	return written(() => voidMatch(db, key, by, reason, now), 'void', parsed.reject);
}

export default function GiftDetailScreen({ loaderData, actionData }: Route.ComponentProps) {
	return <GiftDetail {...loaderData} result={actionData} />;
}
