import { data } from 'react-router';
import { z } from 'zod';
import { isTimeZone } from '$lib/page/end-date';
import {
	answerTurn,
	draftTurn,
	MESSAGE_MAX,
	openTurn,
	readChat,
	TURN_IMAGES_MAX,
	type TurnResult
} from '$lib/server/pages/draft';
import { database, platform } from '../context';
import type { Route } from './+types/_app.admin.pages.$pageId.chat';

// a page's chat — the Donation page's and each campaign's alike: a `loader` answering its turns and
// an `action` taking the next one, with no component, so the editors ask it by fetcher. under the
// protected layout by its name, so anyone signed in may draft; `published` is never touched here,
// and what a turn does is $lib/server/pages/draft.ts's.
//
// a turn posts an `intent` box, and the boxes that intent takes, each required:
// - `message`, or no `intent`: `message`, `imageIds` (a JSON array of stored image ids, `[]` for
//   none) and `timeZone` (the browser's IANA zone, which an end date is a day in).
// - `answers`: `answers`, a JSON array of `{ id, value }` answering the questions the chat's last
//   turn asked, `[]` to skip them all, and `timeZone`.
// - `open`: `timeZone`. the editor posts it on opening a page; a chat with any turn is answered as
//   it stands, outcome `unchanged`, and nothing is written.
// a turn the edge refuses is a 400 whose `error` names the box, an answer by its index.
//
// these answers carry a `reason` beside `error` for the editor to word its own line from: `stale` on
// the 409 a save made while the model answered earns, `answered` on the 409 for answers to a chat
// whose last turn asks nothing — its questions answered, or followed by a message — and `failed` on
// the 500 a turn that threw is caught into — caught, because a fetcher's thrown error lands on the
// editor's error boundary and takes the editor with it. answers whose reply could not land write no
// turn, so the questions stay asked and the same answers can be sent again: `unanswered` on the 503
// where no model answered, `refused` on the 422 where the reply was refused, and `refused_again` on
// the 422 where a reply to answers asked and the one asked again in its place was refused too, each
// `error` the line the turn would have said.

export async function loader({ context, params }: Route.LoaderArgs) {
	const turns = await readChat(context.get(database), params.pageId);
	if (turns === null) throw data({ error: `no page has the id "${params.pageId}"` }, 404);
	return { turns };
}

const timeZone = z
	.string({ error: 'timeZone is required: the browser’s IANA time zone' })
	.refine(isTimeZone, {
		error: (issue) => `timeZone "${String(issue.input)}" is not an IANA time zone`
	});

const messageInput = z
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
		timeZone
	})
	.refine(({ message, imageIds }) => message !== '' || imageIds.length > 0, {
		error: 'message is blank and no photo is attached; a turn carries words or a photo'
	});

// what each answer holds is read against the questions asked, in $lib/server/pages/draft.ts.
const answersInput = z.object({
	answers: z.array(z.unknown(), {
		error: 'answers is a JSON array of {id, value}, "[]" for none'
	}),
	timeZone
});

const openInput = z.object({ timeZone });

export async function action({ context, params, request }: Route.ActionArgs) {
	const body = await request.formData();
	const db = context.get(database);
	const { env } = context.get(platform);
	const pageId = params.pageId;
	const zone = body.get('timeZone') ?? undefined;
	const intent = body.get('intent') ?? 'message';
	const origin = new URL(request.url).origin;

	let turn: () => Promise<TurnResult>;
	let resend = 'the message';
	if (intent === 'message') {
		const parsed = messageInput.safeParse({
			message: body.get('message') ?? undefined,
			imageIds: jsonOf(body.get('imageIds')),
			timeZone: zone
		});
		if (!parsed.success) return refused(parsed.error);
		turn = () => draftTurn(db, env, { pageId, ...parsed.data, now: Date.now() });
	} else if (intent === 'answers') {
		const parsed = answersInput.safeParse({ answers: jsonOf(body.get('answers')), timeZone: zone });
		if (!parsed.success) return refused(parsed.error);
		turn = () => answerTurn(db, env, { pageId, ...parsed.data, now: Date.now(), origin });
		resend = 'the answers';
	} else if (intent === 'open') {
		const parsed = openInput.safeParse({ timeZone: zone });
		if (!parsed.success) return refused(parsed.error);
		turn = () => openTurn(db, env, { pageId, ...parsed.data, now: Date.now(), origin });
	} else {
		return data({ error: `intent is message, answers or open, not "${String(intent)}"` }, 400);
	}

	let result: TurnResult;
	try {
		result = await turn();
	} catch (e) {
		console.error(`a chat turn on page ${pageId} failed:`, e);
		return data(
			{ error: `the turn on page "${pageId}" failed; send it again`, reason: 'failed' },
			500
		);
	}
	if (result.ok) return { outcome: result.outcome, turns: result.turns };
	switch (result.reason) {
		case 'not_found':
			return data({ error: `no page has the id "${pageId}"` }, 404);
		case 'unknown_image':
			return data({ error: `imageIds names "${result.imageId}", which is no stored image` }, 400);
		case 'invalid_answers':
			return data({ error: result.error }, 400);
		case 'answered':
			return data(
				{
					error: `the questions on page "${pageId}" are no longer the chat’s last turn; reload the chat to see where it stands`,
					reason: 'answered'
				},
				409
			);
		case 'stale':
			return data(
				{
					error: `the page was saved while the reply was being written, so nothing changed; send ${resend} again`,
					reason: 'stale'
				},
				409
			);
		case 'unanswered':
			return data({ error: result.text, reason: 'unanswered' }, 503);
		case 'refused':
		case 'refused_again':
			return data({ error: result.text, reason: result.reason }, 422);
	}
}

function refused(error: z.ZodError) {
	return data({ error: error.issues[0]?.message ?? 'the turn is malformed' }, 400);
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
