import { data } from 'react-router';
import { z } from 'zod';
import { TEXT_MAX } from '$lib/rich-text/document';
import { type SuggestResult, SUGGEST_REFUSED, suggestText } from '$lib/server/pages/suggest';
import { database, platform } from '../context';
import type { Route } from './+types/_app.admin.pages.$pageId.suggest';

// one box of a page's editors written by the AI — the Donation page's and each campaign's alike: an
// `action` and no component, so the editors ask it by fetcher. under the protected layout by its
// name, so anyone signed in may ask; nothing is written, and what the words are held to is
// $lib/server/pages/suggest.ts's. no bucket bounds how often one operator asks, as none bounds the
// chat beside it (./_app.admin.pages.$pageId.chat.ts).
//
// a POST carries three boxes, each required:
// - `block`: the block's id in the page's draft, or `page` for the page's own boxes.
// - `field`: the box's name as its form posts it — `heading`, `lede`, `body`, `tier_buys[0]`,
//   `question[1]`, `answer[1]` or `alt` of a block, `name` or `share_message` of the page. which
//   block takes which is $lib/page/suggest-fields.ts's.
// - `current`: the box's words now, `""` for an empty box; a rich-text box's as paragraphs a blank
//   line apart.
//
// it answers 200 `{ ok: true, text }`: a plain box's words on one line, and a rich-text box's as
// paragraphs a blank line apart, which `richTextOf` in $lib/page/suggest-fields.ts makes its
// document. words that could not be written are `{ ok: false, reason, text }`, `text` the line
// the operator is shown: `unanswered` on the 503 where no model answered, `refused` on the 422
// where the words were refused twice, and `failed` on the 500 a suggestion that threw is caught into —
// caught, because a fetcher's thrown error lands on the editor's error boundary and takes the
// editor with it. a request naming no such page is a 404, and a box missing, or a block or field
// that is no text box of the draft, a 400; each `{ error }` names the value.

const input = z.object({
	block: z
		.string({ error: 'block is required: a block’s id in the draft, or "page"' })
		.min(1, { error: 'block is blank: send a block’s id in the draft, or "page"' }),
	field: z
		.string({ error: 'field is required: the box’s name as its form posts it' })
		.min(1, { error: 'field is blank: send the box’s name as its form posts it' }),
	current: z
		.string({ error: 'current is required: the box’s words now, "" for an empty box' })
		.max(TEXT_MAX, { error: `current holds at most ${TEXT_MAX} characters` })
});

export async function action({ context, params, request }: Route.ActionArgs) {
	const body = await request.formData();
	const parsed = input.safeParse({
		block: body.get('block') ?? undefined,
		field: body.get('field') ?? undefined,
		current: body.get('current') ?? undefined
	});
	if (!parsed.success) {
		return data({ error: parsed.error.issues[0]?.message ?? 'the request is malformed' }, 400);
	}
	const pageId = params.pageId;

	let result: SuggestResult;
	try {
		result = await suggestText(context.get(database), context.get(platform).env, {
			pageId,
			...parsed.data
		});
	} catch (e) {
		console.error(`a suggestion on page ${pageId} failed:`, e);
		return data({ ok: false, reason: 'failed', text: SUGGEST_REFUSED } as const, 500);
	}
	if (result.ok) return result;
	switch (result.reason) {
		case 'not_found':
			return data({ error: `no page has the id "${pageId}"` }, 404);
		case 'no_box':
			return data({ error: result.error }, 400);
		case 'unanswered':
			return data({ ok: false, reason: 'unanswered', text: result.text } as const, 503);
		case 'refused':
			return data({ ok: false, reason: 'refused', text: result.text } as const, 422);
	}
}
