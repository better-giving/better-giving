import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { href, useFetcher, useSubmit } from 'react-router';
import { z } from 'zod';
import type { CrumbHandle } from '$lib/admin/crumbs';
import {
	type OlderMessages,
	type OlderStatus,
	type PressOutcome,
	type PressState,
	PublicMessages
} from '$lib/admin/messages/public-messages';
import { type AdminActionData, resultFor } from '$lib/admin/use-admin-form';
import { defineForm, WHICH_FORM } from '$lib/forms/definition';
import { invalid, type ParsedForm, parseForm, submittedForm } from '$lib/server/conform';
import { loadFailed } from '$lib/server/db/load-failure';
import { setNoteHidden } from '$lib/server/pages/messages';
import { readModeratedFirstPage } from '$lib/server/pages/moderated-pages';
import { screenTitle } from '$lib/admin/screen-title';
import { database } from '../context';
import type { Route } from './+types/_app.admin.donations.messages';
import type { loader as olderLoader } from './_app.admin.donations.messages.older';

// Public messages: the notes donors asked to show on the donate page, each with Hide or Show again.
// staff and members may both press either: it is moderation of what the page shows rather than
// configuration, so no `STAFF_USER_ID` gate.
//
// what is listed and what a press writes are `$lib/server/pages/messages.ts`. a press answers on
// this screen without navigating, so it suits a fetcher, one per row so a second press cancels no
// other row's: a landed press returns which way it went and the gift it named, and a refusal names
// the gift beside the form's error. the list past the first page is read by
// ./_app.admin.donations.messages.older.ts.

const SCREEN_TITLE = 'Public messages';

export const handle = {
	crumbs: ({ pathname }) => [
		{ href: href('/admin/donations'), label: 'Gifts' },
		{ href: pathname, label: SCREEN_TITLE }
	]
} satisfies CrumbHandle;

export function meta({ matches }: Route.MetaArgs): Route.MetaDescriptors {
	return [{ title: screenTitle(SCREEN_TITLE, matches) }];
}

export async function loader({ context }: Route.LoaderArgs) {
	try {
		return await readModeratedFirstPage(context.get(database));
	} catch (e) {
		console.error('listing public messages failed:', e);
		loadFailed('The public messages list');
	}
}

const HIDE_FORM_ID = 'message-hide';
const SHOW_FORM_ID = 'message-show';
const FORM_IDS = [HIDE_FORM_ID, SHOW_FORM_ID] as const;

/** the box a row's press names its gift in. */
const DONATION_ID = 'donation_id';
const ROW_PRESS = z.object({ [DONATION_ID]: z.string() });

const HIDE = defineForm({ id: HIDE_FORM_ID, schema: ROW_PRESS });
const SHOW = defineForm({ id: SHOW_FORM_ID, schema: ROW_PRESS });

const NOT_LISTED =
	'That message is no longer on this list. Reload to see the messages as they are now.';
const PRESS_FAILED = {
	[HIDE_FORM_ID]: 'Couldn’t hide this message. Try again.',
	[SHOW_FORM_ID]: 'Couldn’t show this message again. Try again.'
} as const;

export async function action({ context, request }: Route.ActionArgs) {
	const body = await request.formData();
	const db = context.get(database);
	switch (submittedForm(body, FORM_IDS)) {
		case HIDE_FORM_ID:
			return rowPress(HIDE_FORM_ID, parseForm(body, HIDE));
		case SHOW_FORM_ID:
			return rowPress(SHOW_FORM_ID, parseForm(body, SHOW));
	}

	async function rowPress(
		pressed: (typeof FORM_IDS)[number],
		submission: ParsedForm<z.output<typeof ROW_PRESS>>
	) {
		if (!submission.ok) return invalid(400, submission.reject());
		const donationId = submission.value[DONATION_ID];
		const hide = pressed === HIDE_FORM_ID;
		try {
			if (!(await setNoteHidden(db, donationId, hide, new Date()))) {
				return invalid(404, submission.reject({ formErrors: [NOT_LISTED] }), { donationId });
			}
		} catch (e) {
			console.error(`${pressed} on gift ${donationId} failed:`, e);
			return invalid(500, submission.reject({ formErrors: [PRESS_FAILED[pressed]] }), {
				donationId
			});
		}
		return { landed: hide ? ('hidden' as const) : ('shown' as const), donationId };
	}
}

/**
 * the action's answer as the screen takes it: which way a press landed, or the sentence it was
 * refused with on the row it named. a refusal naming no gift — a body nobody's press sends — is
 * no row's.
 */
function pressOutcome(answer: AdminActionData): PressOutcome | null {
	const donationId = answer?.donationId;
	if (typeof donationId !== 'string') return null;
	const landed = answer?.landed;
	if (landed === 'hidden' || landed === 'shown') return { donationId, landed };
	const pressed = answer?.form?.id === HIDE_FORM_ID ? HIDE : SHOW;
	const refused = resultFor(pressed, answer)?.error?.['']?.at(-1);
	return refused === undefined ? null : { donationId, refused };
}

/** the fetcher a row's presses go through, one per gift, so a press on one row cancels no other's. */
const pressKey = (donationId: string) => `message-press-${donationId}`;

export default function PublicMessagesScreen({ loaderData }: Route.ComponentProps) {
	const submit = useSubmit();
	// every row pressed so far, in the order first pressed: each holds its own fetcher below.
	const [pressed, setPressed] = useState<readonly string[]>([]);
	const [presses, setPresses] = useState<Readonly<Record<string, PressState>>>({});
	const record = useCallback((donationId: string, state: PressState) => {
		setPresses((all) => {
			const was = all[donationId];
			if (was?.pending === state.pending && was.outcome === state.outcome) return all;
			return { ...all, [donationId]: state };
		});
	}, []);
	const press = (form: typeof HIDE_FORM_ID | typeof SHOW_FORM_ID) => (donationId: string) => {
		setPressed((ids) => (ids.includes(donationId) ? ids : [...ids, donationId]));
		submit(
			{ [WHICH_FORM]: form, [DONATION_ID]: donationId },
			{ method: 'post', navigate: false, fetcherKey: pressKey(donationId) }
		);
	};
	const older = useOlderMessages(loaderData.messages, loaderData.next);
	return (
		<>
			{pressed.map((donationId) => (
				<RowPress key={donationId} donationId={donationId} onState={record} />
			))}
			<PublicMessages
				messages={older.messages}
				total={loaderData.total}
				presses={presses}
				onHide={press(HIDE_FORM_ID)}
				onShow={press(SHOW_FORM_ID)}
				older={older.wiring}
			/>
		</>
	);
}

/**
 * one pressed row's fetcher, which draws nothing and hands the screen where that row's press
 * stands: a hook cannot be called once per row of a list that grows. handed up in a layout effect,
 * so the screen redraws with it before the browser paints the state it replaces.
 */
function RowPress({
	donationId,
	onState
}: {
	readonly donationId: string;
	readonly onState: (donationId: string, state: PressState) => void;
}) {
	const fetcher = useFetcher<AdminActionData>({ key: pressKey(donationId) });
	// memoized on the answer itself: the screen tells one outcome from the next by identity, so a
	// fresh object per render would replay the last landing on every one.
	const outcome = useMemo(() => pressOutcome(fetcher.data), [fetcher.data]);
	// pending through the re-read, so a landed press is drawn over its new row.
	const pending = fetcher.state !== 'idle';
	useLayoutEffect(
		() => onState(donationId, { pending, outcome }),
		[donationId, onState, pending, outcome]
	);
	return null;
}

type Row = Route.ComponentProps['loaderData']['messages'][number];

/**
 * the rows past the first page, read by one fetcher from the cursor the first page ended on when
 * Show older messages was first pressed. each press asks for one page more than it holds, every
 * held page with it, and the re-read after a press asks for the same again, so an older row is
 * drawn as the press left it. a refused read keeps the rows it already had.
 */
function useOlderMessages(first: readonly Row[], firstNext: string | null) {
	const fetcher = useFetcher<typeof olderLoader>();
	const [from, setFrom] = useState<string | null>(null);
	const [asked, setAsked] = useState(0);
	const [kept, setKept] = useState<{
		readonly answer: Extract<typeof fetcher.data, { kind: 'messages' }>;
		readonly pages: number;
	} | null>(null);
	if (fetcher.data?.kind === 'messages' && fetcher.data !== kept?.answer) {
		setKept({ answer: fetcher.data, pages: asked });
	}
	const status: OlderStatus =
		fetcher.state !== 'idle' && asked > (kept?.pages ?? 0)
			? 'loading'
			: fetcher.state === 'idle' && fetcher.data?.kind === 'refused'
				? 'error'
				: 'idle';
	// a row on both, where the list changed between the first page's read and the older one's, is
	// listed once, where it is newest.
	const listed = new Set(first.map((m) => m.id));
	return {
		messages:
			kept === null ? first : [...first, ...kept.answer.messages.filter((m) => !listed.has(m.id))],
		wiring: {
			next: kept === null ? firstNext : kept.answer.next,
			status,
			onShowOlder: (after: string) => {
				const start = from ?? after;
				const pages = (kept?.pages ?? 0) + 1;
				setFrom(start);
				setAsked(pages);
				fetcher.load(
					`${href('/admin/donations/messages/older')}?${new URLSearchParams({ after: start, pages: String(pages) })}`
				);
			}
		} satisfies OlderMessages
	};
}
