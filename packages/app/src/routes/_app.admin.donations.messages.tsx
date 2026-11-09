import { useMemo } from 'react';
import { href, useFetcher } from 'react-router';
import { z } from 'zod';
import type { CrumbHandle } from '$lib/admin/crumbs';
import { type PressOutcome, PublicMessages } from '$lib/admin/messages/public-messages';
import { type AdminActionData, resultFor } from '$lib/admin/use-admin-form';
import { defineForm, WHICH_FORM } from '$lib/forms/definition';
import { invalid, type ParsedForm, parseForm, submittedForm } from '$lib/server/conform';
import { loadFailed } from '$lib/server/db/load-failure';
import {
	MODERATED_MESSAGE_LIMIT,
	readModeratedMessages,
	setNoteHidden
} from '$lib/server/pages/messages';
import { screenTitle } from '$lib/admin/screen-title';
import { database } from '../context';
import type { Route } from './+types/_app.admin.donations.messages';

// Public messages: the notes donors asked to show on the donate page, each with Hide or Show again.
// staff and members may both press either: it is moderation of what the page shows rather than
// configuration, so no `STAFF_USER_ID` gate.
//
// what is listed and what a press writes are `$lib/server/pages/messages.ts`. a press answers on
// this screen without navigating, so it suits a fetcher: a landed press returns which way it went
// and the gift it named, and a refusal names the gift beside the form's error.

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
	let read: Awaited<ReturnType<typeof readModeratedMessages>>;
	try {
		read = await readModeratedMessages(context.get(database));
	} catch (e) {
		console.error('listing public messages failed:', e);
		loadFailed('The public messages list');
	}
	return {
		messages: read.messages.map((m) => ({
			id: m.id,
			name: m.name,
			note: m.note,
			receivedAt: m.receivedAt.toISOString(),
			hidden: m.hidden
		})),
		total: read.total,
		// so the page can say the list is capped where `total` is past it.
		limit: MODERATED_MESSAGE_LIMIT
	};
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

export default function PublicMessagesScreen({ loaderData }: Route.ComponentProps) {
	const fetcher = useFetcher<AdminActionData>();
	const pressed = fetcher.formData?.get(DONATION_ID);
	// memoized on the answer itself: the screen tells one outcome from the next by identity, so a
	// fresh object per render would replay the last landing on every one.
	const answered = useMemo(() => pressOutcome(fetcher.data), [fetcher.data]);
	const press = (form: typeof HIDE_FORM_ID | typeof SHOW_FORM_ID) => (donationId: string) =>
		fetcher.submit({ [WHICH_FORM]: form, [DONATION_ID]: donationId }, { method: 'post' });
	return (
		<PublicMessages
			messages={loaderData.messages}
			total={loaderData.total}
			limit={loaderData.limit}
			pending={typeof pressed === 'string' ? { donationId: pressed } : null}
			// held back until the re-read has landed, so a landed press is drawn over its new row.
			outcome={fetcher.state === 'idle' ? answered : null}
			onHide={press(HIDE_FORM_ID)}
			onShow={press(SHOW_FORM_ID)}
		/>
	);
}
