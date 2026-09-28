import { data } from 'react-router';
import { z } from 'zod';
import { isTimeZone } from '$lib/page/end-date';
import { draftTurn, MESSAGE_MAX, readChat, TURN_IMAGES_MAX } from '$lib/server/pages/draft';
import { database, platform } from '../context';
import type { Route } from './+types/_app.admin.pages.$pageId.chat';

// a page's chat — the Donation page's and each campaign's alike: a `loader` answering its turns and
// an `action` taking the next one, with no component, so the editors ask it by fetcher. under the
// protected layout by its name, so anyone signed in may draft; `published` is never touched here,
// and what a turn does is $lib/server/pages/draft.ts's.
//
// a turn posts three boxes, each required: `message`, `imageIds` (a JSON array of stored image ids,
// `[]` for none) and `timeZone` (the browser's IANA zone, which an end date is a day in). a turn the
// edge refuses is a 400 whose `error` names the box.
//
// two answers carry a `reason` beside `error` for the editor to word its own line from: `stale`
// on the 409 a save made while the model answered earns, and `failed` on the 500 a turn that threw
// is caught into — caught, because a fetcher's thrown error lands on the editor's error boundary
// and takes the editor with it.

export async function loader({ context, params }: Route.LoaderArgs) {
	const turns = await readChat(context.get(database), params.pageId);
	if (turns === null) throw data({ error: `no page has the id "${params.pageId}"` }, 404);
	return { turns };
}

const turnInput = z
	.object({
		message: z
			.string({ error: 'message is required; send "" with a photo and no words' })
			.trim()
			.max(MESSAGE_MAX, { error: `message holds at most ${MESSAGE_MAX} characters` }),
		imageIds: z
			.array(z.string().min(1, { error: 'imageIds holds image ids, and one is blank' }), {
				error: 'imageIds is a JSON array of image ids, "[]" for none'
			})
			.max(TURN_IMAGES_MAX, { error: `imageIds holds at most ${TURN_IMAGES_MAX} photos` }),
		timeZone: z
			.string({ error: 'timeZone is required: the browser’s IANA time zone' })
			.refine(isTimeZone, {
				error: (issue) => `timeZone "${String(issue.input)}" is not an IANA time zone`
			})
	})
	.refine(({ message, imageIds }) => message !== '' || imageIds.length > 0, {
		error: 'message is blank and no photo is attached; a turn carries words or a photo'
	});

export async function action({ context, params, request }: Route.ActionArgs) {
	const body = await request.formData();
	const parsed = turnInput.safeParse({
		message: body.get('message') ?? undefined,
		imageIds: jsonOf(body.get('imageIds')),
		timeZone: body.get('timeZone') ?? undefined
	});
	if (!parsed.success) {
		return data({ error: parsed.error.issues[0]?.message ?? 'the turn is malformed' }, 400);
	}

	let result: Awaited<ReturnType<typeof draftTurn>>;
	try {
		result = await draftTurn(context.get(database), context.get(platform).env, {
			pageId: params.pageId,
			...parsed.data,
			now: Date.now()
		});
	} catch (e) {
		console.error(`a chat turn on page ${params.pageId} failed:`, e);
		return data(
			{ error: `the turn on page "${params.pageId}" failed; send it again`, reason: 'failed' },
			500
		);
	}
	if (result.ok) return { outcome: result.outcome, turns: result.turns };
	switch (result.reason) {
		case 'not_found':
			return data({ error: `no page has the id "${params.pageId}"` }, 404);
		case 'unknown_image':
			return data({ error: `imageIds names "${result.imageId}", which is no stored image` }, 400);
		case 'stale':
			return data(
				{
					error:
						'the page was saved while the reply was being written, so nothing changed; send the message again',
					reason: 'stale'
				},
				409
			);
	}
}

/** a box's JSON, or the box itself where it holds none, for the schema to refuse by name. */
function jsonOf(value: FormDataEntryValue | null): unknown {
	if (typeof value !== 'string') return value ?? undefined;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}
