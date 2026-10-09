import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { acceptReply, readReply } from '../../page/accept-reply';
import { draftFromPage } from '../../page/ai-catalog';
import { CAMPAIGN_TYPE_DETAILS } from '../../page/campaign-types';
import type { Page } from '../../page/catalog';
import { richTextOf, type SuggestBox, suggestBox } from '../../page/suggest-fields';
import { formatMinorBrief } from '../../donations/money';
import { FORM_CURRENCY } from '../../forms/amounts';
import { type ChatMessage, generate } from '../ai/generate';
import type { Db } from '../db/client';
import { type Page as PageRow, page } from '../db/schema';
import { readOrgProfile } from '../org/queries';
import { readableDraft } from './document';
import { readChat } from './draft';

// one box of a page's editors written by the model, for the operator to take or undo in the box
// itself: which boxes there are, and where each one's words go, is ../../page/suggest-fields.ts's.
// nothing is written — not the draft, not the chat — so the box is saved when its block is.
//
// the model is told the page as it stands (`draftFromPage` of the stored draft, hand edits and
// all), whether it is the Donation page or a campaign and a campaign's type, the organisation's
// name, mission and vision, the box and its bound, and the box's words now, to improve where it
// holds any. it answers `{ "text": ... }`.
//
// the words are held to every rule a chat reply's would be by putting them where they go and
// handing that reply to `acceptReply` (../../page/accept-reply.ts): the box's length, a figure only
// where the operator stated it or the page already shows it, what an amount does only where the
// operator said so, and a share message's web address only where the page already links it. the
// operator's statements are their chat messages and answers, and the box's words now. a tier
// `acceptReply` would drop refuses the words here, since the box would come back without them.
// markup — a `<` or `>` — refuses them too. a plain box's words are made one line first, and a rich
// box's paragraphs are each made one line.
//
// words refused are asked for once more, the model told why; refused again, the caller hears
// `refused`. no model answering is `unanswered`, with the words the chat says it in.

/** what a suggestion is answered with when its words are refused twice. */
export const SUGGEST_REFUSED = 'Couldn’t write that box. Try again.';

export type SuggestRequest = {
	pageId: string;
	/** a block's id in the draft, or `PAGE_BLOCK` for the page's own boxes. */
	block: string;
	/** the box's name, as its form posts it. */
	field: string;
	/** the box's words now, `''` for none. */
	current: string;
};

export type SuggestResult =
	| { ok: true; text: string }
	| { ok: false; reason: 'not_found' }
	/** `error` names the block or the field that is no text box, and the ones there are. */
	| { ok: false; reason: 'no_box'; error: string }
	| { ok: false; reason: 'unanswered' | 'refused'; text: string };

const replySchema = z.strictObject({ text: z.string() });
const REPLY_JSON_SCHEMA = z.toJSONSchema(replySchema, { io: 'input' });

const MARKUP = /[<>]/;

export async function suggestText(
	db: Db,
	env: unknown,
	request: SuggestRequest
): Promise<SuggestResult> {
	const [row] = await db.select().from(page).where(eq(page.id, request.pageId));
	if (!row) return { ok: false, reason: 'not_found' };
	const current = readableDraft(row);
	const resolved = suggestBox(current, row.type, request.block, request.field);
	if (!resolved.ok) return { ok: false, reason: 'no_box', error: resolved.error };
	const { box } = resolved;
	const [profile, chat] = await Promise.all([readOrgProfile(db), readChat(db, row.id)]);
	const stated = [
		...(chat ?? []).flatMap(({ role, text, answers }) =>
			role !== 'operator'
				? []
				: [answers === undefined ? text : answers.map(({ words }) => words).join('\n')]
		),
		request.current
	];
	const system = systemPrompt(row, current, {
		name: profile?.legalName ?? null,
		mission: profile?.mission ?? null,
		vision: profile?.vision ?? null
	});
	const messages: ChatMessage[] = [{ role: 'user', content: boxRequest(box, request.current) }];

	for (let attempt = 1; ; attempt += 1) {
		const answer = await generate(env, { system, messages, jsonSchema: REPLY_JSON_SCHEMA });
		if (!answer.ok) {
			return {
				ok: false,
				reason: 'unanswered',
				text: `No model answered, so nothing changed. ${answer.operatorFix ?? 'Try again in a moment.'}`
			};
		}
		const held = holdWords(answer.text, box, row, current, stated);
		if (held.ok) return { ok: true, text: held.text };
		if (attempt === 2) {
			console.error(
				`the words for "${request.field}" of "${request.block}" on page ${row.id} were refused twice:`,
				held.problem
			);
			return { ok: false, reason: 'refused', text: SUGGEST_REFUSED };
		}
		messages.push(
			{ role: 'assistant', content: answer.text },
			{
				role: 'user',
				content: `Those words were refused: ${held.problem}. Write the box again, keeping to its rules.`
			}
		);
	}
}

type Held = { ok: true; text: string } | { ok: false; problem: string };

/** the model's answer as the box's words, where every rule the box's words answer to holds. */
function holdWords(
	answer: string,
	box: SuggestBox,
	row: PageRow,
	current: Page,
	stated: readonly string[]
): Held {
	const read = readReply(answer);
	if (!read.ok) return { ok: false, problem: read.reason };
	const parsed = replySchema.safeParse(read.json);
	if (!parsed.success) return { ok: false, problem: 'the answer is not {"text": ...}' };
	const text =
		box.kind === 'plain'
			? oneLine(parsed.data.text)
			: parsed.data.text
					.split(/\n\s*\n/)
					.map(oneLine)
					.filter((one) => one !== '')
					.join('\n\n');
	if (text === '') return { ok: false, problem: 'text holds no words' };
	if (MARKUP.test(text)) {
		return { ok: false, problem: 'text holds "<" or ">"; the box is plain text, with no markup' };
	}

	const say = 'Wrote one box.';
	const reply =
		box.target.in === 'set'
			? { say, set: { [box.target.key]: text } }
			: {
					say,
					page: {
						kind: 'patch',
						ops: [
							{
								op: 'add',
								path: box.target.pointer,
								value: box.kind === 'rich' ? richTextOf(text) : text
							}
						]
					}
				};
	const accepted = acceptReply({
		type: row.type,
		current,
		name: row.name,
		reply: JSON.stringify(reply),
		attached: [],
		illustrations: [],
		messages: stated.map((said) => ({ author: 'operator', text: said })),
		activePrograms: [],
		// nothing here sets an end date, the one thing read in the zone.
		timeZone: 'UTC',
		now: Date.now()
	});
	if (!accepted.ok) return { ok: false, problem: accepted.reason };
	const [dropped] = accepted.kind === 'drafted' ? accepted.dropped : [];
	if (dropped?.what === 'tier') {
		const amount = formatMinorBrief(dropped.amountMinor, FORM_CURRENCY);
		return {
			ok: false,
			problem: `the words say what ${amount} buys, and the operator never said what ${amount} does`
		};
	}
	if (dropped?.what === 'link') {
		return { ok: false, problem: `"${dropped.href}" is not a link the page already holds` };
	}
	return { ok: true, text };
}

function oneLine(text: string) {
	return text.replace(/\s+/g, ' ').trim();
}

type Organisation = { name: string | null; mission: string | null; vision: string | null };

function systemPrompt(row: PageRow, current: Page, organisation: Organisation): string {
	const named = current.name ?? row.name ?? '';
	const campaignType = row.campaignType === null ? null : CAMPAIGN_TYPE_DETAILS[row.campaignType];
	return [
		'You write the words of one box on a donation page an organisation is building, and nothing else on the page.',
		'',
		'REPLY:',
		'Answer with one JSON object and nothing else: {"text": ...}.',
		'- text: the box’s words alone, as plain text: no HTML, no markdown, no quotation marks around them, and no web address the page does not already link.',
		'- write to a donor, in the organisation’s voice, from what the page and the organisation say. Invent no fact, name or date.',
		'- write an amount only where the page already shows it, and say what an amount buys or does only where the page already says it of that amount.',
		'',
		'CONTEXT:',
		`- organisation: ${organisation.name ?? '(not written)'}`,
		`- mission: ${organisation.mission ?? '(not written)'}`,
		`- vision: ${organisation.vision ?? '(not written)'}`,
		`- page: ${row.type === 'campaign' ? `a campaign named "${named}"` : 'the Donation page'}`,
		...(campaignType === null
			? []
			: [`- campaign type: ${campaignType.label} (${campaignType.description})`]),
		'',
		'THE PAGE AS IT STANDS, hand edits included:',
		JSON.stringify(draftFromPage(current))
	].join('\n');
}

function boxRequest(box: SuggestBox, now: string): string {
	const shape =
		box.kind === 'plain'
			? `one line of at most ${box.max} characters`
			: `paragraphs a blank line apart, at most ${box.max} characters in all`;
	const words = now.trim();
	return [
		`Write ${box.what}: ${shape}.`,
		words === ''
			? 'The box is empty now.'
			: `The box reads now: ${JSON.stringify(words)}. Improve it, keeping what it says.`
	].join('\n');
}
