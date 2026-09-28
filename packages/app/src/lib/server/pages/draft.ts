import { asc, eq, type SQL, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { formatMinorBrief } from '../../donations/money';
import { FORM_CURRENCY } from '../../forms/amounts';
import {
	acceptReply,
	type Change,
	type ChatMessage as AcceptMessage,
	type Dropped,
	REPLY_JSON_SCHEMA,
	SAY_MAX
} from '../../page/accept-reply';
import { draftFromPage, pageCatalog } from '../../page/ai-catalog';
import { type Page, parsePage } from '../../page/catalog';
import { dayOf, dayWords } from '../../page/end-date';
import type { ChatNote, PageType } from '../../page/keys';
import { plainText } from '../../rich-text/document';
import { type ChatMessage as ModelMessage, generate } from '../ai/generate';
import type { Db } from '../db/client';
import { type ChatTurn, chatTurn, page } from '../db/schema';
import { firstMissingImage } from '../images/queries';
import { readOrgLook, readOrgStory } from '../org/queries';
import type { OrgLook, Story } from '../org/presentation';
import { type ProgramOption, readActivePrograms } from '../programs/queries';

// one turn of a page's chat: the operator's message, the model's reply through `acceptReply`, and
// what lands — the draft and the two turns — in one `batch()`. the Donation page and a campaign
// alike. a turn writes the draft document and the chat and nothing else: `published` and the
// row's own `name` are never written here, and a campaign renamed in the chat is renamed in its
// draft, so nothing a turn does reaches a donor before Publish.
//
// the model is told the page as it stands (`draftFromPage` of the stored draft, hand edits and
// all), its type, name, goal, end date and donation settings, the organisation's story and look,
// the active programs, and what it said so far: each accepted exchange as the operator's message
// and the reply's `say`, cut at `SAY_MAX`. which model is `generate`'s, never the chat's.
//
// three outcomes, each one assistant turn, its `note` the column's word for it:
// - accepted: the draft is replaced. the assistant's words are the reply's `say` on one line, then
//   a line naming each value `set` changed and each thing `acceptReply` dropped, so what the chat
//   says it did is what it did. `fell-back` where the free model wrote it in place of the chosen.
// - refused: the draft is untouched and the turn says why.
// - unanswered: no model answered; the draft is untouched and the turn says so plainly, with the
//   operator's fix where there is one. its `model` is the one `generate` asked.
//
// an accepted turn's three statements are each guarded on the draft text the reply was built
// against, the two inserts first: a hand edit or a second turn saved while the model was
// answering makes the whole batch write nothing, and the caller hears `stale`.

/** the longest message a turn takes. */
export const MESSAGE_MAX = 4000;
/** the most photos one turn carries. */
export const TURN_IMAGES_MAX = 4;
/**
 * the messages of the chat the model is shown, newest last: ten exchanges, so they open on the
 * operator's. every operator turn still counts for its figures.
 */
const HISTORY_TURNS = 20;

const REFUSED_PREFIX = 'I couldn’t apply that: ';

export type TurnRequest = {
	pageId: string;
	message: string;
	imageIds: readonly string[];
	/** the IANA zone of the browser that posted the turn. */
	timeZone: string;
	now: number;
};

/** one turn as the chat draws it. */
export type ChatEntry = {
	id: string;
	role: 'operator' | 'assistant';
	text: string;
	imageIds: string[];
	note?: 'fell-back' | 'refused';
};

export type TurnResult =
	| { ok: true; outcome: 'accepted' | 'refused' | 'unanswered'; turns: ChatEntry[] }
	| { ok: false; reason: 'not_found' | 'stale' }
	| { ok: false; reason: 'unknown_image'; imageId: string };

/** a page's chat in order, or `null` where there is no such page. */
export async function readChat(db: Db, pageId: string): Promise<ChatEntry[] | null> {
	const [found] = await db.select({ id: page.id }).from(page).where(eq(page.id, pageId));
	if (!found) return null;
	return (await turnsOf(db, pageId)).map(chatEntry);
}

export async function draftTurn(db: Db, env: unknown, request: TurnRequest): Promise<TurnResult> {
	const [row] = await db.select().from(page).where(eq(page.id, request.pageId));
	if (!row) return { ok: false, reason: 'not_found' };
	const parsed = parsePage(row.type, JSON.parse(row.draft));
	if (!parsed.ok) {
		throw new Error(`page ${row.id}'s stored draft fails its rule: ${parsed.message}`);
	}
	const current = parsed.page;
	const [missing, turns, { story }, { look }, programs] = await Promise.all([
		firstMissingImage(db, request.imageIds),
		turnsOf(db, row.id),
		readOrgStory(db),
		readOrgLook(db),
		readActivePrograms(db)
	]);
	if (missing !== null) return { ok: false, reason: 'unknown_image', imageId: missing };

	const said = withImages(request.message, request.imageIds);
	const answer = await generate(env, {
		system: systemPrompt({
			type: row.type,
			name: current.name ?? row.name,
			current,
			story,
			look,
			programs,
			timeZone: request.timeZone,
			now: request.now
		}),
		messages: [...history(turns).slice(-HISTORY_TURNS), { role: 'user', content: said }],
		jsonSchema: REPLY_JSON_SCHEMA
	});

	const operator: NewTurn = {
		author: 'operator',
		text: request.message,
		model: null,
		imageIds: [...request.imageIds],
		note: null
	};
	const onPage = eq(page.id, row.id);

	if (!answer.ok) {
		const text = `No model answered, so nothing changed. ${answer.operatorFix ?? 'Try again in a moment.'}`;
		const assistant = assistantTurn(text, answer.model, 'unanswered');
		const written = await writeTurns(db, row.id, [operator, assistant], onPage);
		return { ok: true, outcome: 'unanswered', turns: written };
	}

	const result = acceptReply({
		type: row.type,
		current,
		name: row.name,
		reply: answer.text,
		attached: [...turns.flatMap(imageIdsOf), ...request.imageIds],
		messages: [...turns.map(acceptMessage), { author: 'operator', text: request.message }],
		activePrograms: programs,
		timeZone: request.timeZone,
		now: request.now
	});

	if (!result.ok) {
		const text = `${REFUSED_PREFIX}${result.reason}`;
		const assistant = assistantTurn(text, answer.model, 'refused');
		const written = await writeTurns(db, row.id, [operator, assistant], onPage);
		return { ok: true, outcome: 'refused', turns: written };
	}

	const draft = JSON.stringify(result.draft);
	const summary = summarise(result.changes, result.dropped, programs);
	const text = [oneLine(result.say), summary].filter((line) => line !== '').join('\n');
	const assistant = assistantTurn(text, answer.model, answer.fellBack ? 'fell-back' : null);
	const seen = sql`${onPage} and ${eq(page.draft, row.draft)}`;
	const [first, second, updated] = await db.batch([
		turnStatement(db, row.id, operator, seen),
		turnStatement(db, row.id, assistant, seen),
		db.update(page).set({ draft }).where(seen).returning({ id: page.id })
	]);
	if (updated.length === 0) return { ok: false, reason: 'stale' };
	return { ok: true, outcome: 'accepted', turns: [...first, ...second].map(chatEntry) };
}

type NewTurn = Pick<ChatTurn, 'author' | 'text' | 'model' | 'note'> & { imageIds: string[] };

function assistantTurn(text: string, model: string, note: ChatNote | null): NewTurn {
	return { author: 'assistant', text, model, imageIds: [], note };
}

async function writeTurns(db: Db, pageId: string, turns: [NewTurn, NewTurn], when: SQL) {
	const [first, second] = await db.batch([
		turnStatement(db, pageId, turns[0], when),
		turnStatement(db, pageId, turns[1], when)
	]);
	return [...first, ...second].map(chatEntry);
}

/**
 * a turn after the chat's last, inserted only where the page matches `when`. `seq` is read inside
 * the statement, so the second of two turns in one batch lands after the first.
 */
function turnStatement(db: Db, pageId: string, turn: NewTurn, when: SQL) {
	return db
		.insert(chatTurn)
		.select((qb) =>
			qb
				.select({
					id: sql<string>`${uuidv7()}`.as('id'),
					pageId: sql<string>`${pageId}`.as('page_id'),
					seq: sql<number>`(select coalesce(max(${chatTurn.seq}), 0) + 1 from ${chatTurn} where ${chatTurn.pageId} = ${pageId})`.as(
						'seq'
					),
					author: sql<string>`${turn.author}`.as('author'),
					text: sql<string>`${turn.text}`.as('text'),
					model: sql<string | null>`${turn.model}`.as('model'),
					imageIds: sql<string>`${JSON.stringify(turn.imageIds)}`.as('image_ids'),
					createdAt: sql<number>`${Date.now()}`.as('created_at'),
					note: sql<ChatNote | null>`${turn.note}`.as('note')
				})
				.from(page)
				.where(when)
		)
		.returning();
}

function turnsOf(db: Db, pageId: string) {
	return db.select().from(chatTurn).where(eq(chatTurn.pageId, pageId)).orderBy(asc(chatTurn.seq));
}

function imageIdsOf(turn: ChatTurn): string[] {
	const ids: unknown = JSON.parse(turn.imageIds);
	return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

function chatEntry(turn: ChatTurn): ChatEntry {
	const entry: ChatEntry = {
		id: turn.id,
		role: turn.author,
		text: turn.text,
		imageIds: imageIdsOf(turn)
	};
	// an unanswered turn's words say so, and the chat draws no note under it.
	return turn.note === null || turn.note === 'unanswered' ? entry : { ...entry, note: turn.note };
}

function acceptMessage(turn: ChatTurn): AcceptMessage {
	return { author: turn.author, text: turn.text };
}

/**
 * the chat as the model reads it: each exchange whose reply was accepted, as the operator's words
 * and the reply's `say`. turns are written in pairs, an operator's then an assistant's.
 */
function history(turns: readonly ChatTurn[]): ModelMessage[] {
	return turns.flatMap((turn, index) => {
		const asked = turns[index - 1];
		if (turn.author !== 'assistant' || asked?.author !== 'operator') return [];
		if (turn.note === 'refused' || turn.note === 'unanswered') return [];
		const [say = ''] = turn.text.split('\n', 1);
		return [
			{ role: 'user' as const, content: withImages(asked.text, imageIdsOf(asked)) },
			{ role: 'assistant' as const, content: say.slice(0, SAY_MAX) }
		];
	});
}

/** a reply's `say` on the one line an accepted turn's text opens with. */
function oneLine(say: string) {
	return say.replace(/\s*\n\s*/g, ' ');
}

function withImages(text: string, imageIds: readonly string[]) {
	return imageIds.length === 0 ? text : `${text}\n\n(attached photos: ${imageIds.join(', ')})`;
}

type PromptContext = {
	type: PageType;
	name: string | null;
	current: Page;
	story: Story;
	look: OrgLook;
	programs: readonly ProgramOption[];
	timeZone: string;
	now: number;
};

function systemPrompt(context: PromptContext): string {
	return [
		pageCatalog(context.type).prompt(),
		'',
		...replyFormat(context.type),
		'',
		'CONTEXT:',
		...contextLines(context),
		'',
		'THE PAGE AS IT STANDS, hand edits included:',
		JSON.stringify(draftFromPage(context.current))
	].join('\n');
}

function replyFormat(type: PageType): string[] {
	const settable =
		type === 'campaign'
			? '{"name": ..., "goalMinor": ..., "endDate": "YYYY-MM-DD", "programId": ..., "suggestedAmounts": [...]}'
			: '{"programId": ..., "suggestedAmounts": [...]}';
	return [
		'REPLY:',
		'Answer with one JSON object and nothing else: {"say": ..., "page": ..., "set": ...}',
		'- say: one or two sentences to the operator saying what you changed, naming each value you set.',
		'- page: an edit to the page as it stands, changing only what the message asks for and keeping every word it does not mention. Either {"kind": "patch", "ops": [RFC 6902 operations, e.g. {"op": "replace", "path": "/blocks/0/props/heading", "value": ...}]} or {"kind": "merge", "doc": {an RFC 7396 merge of layout, palette or blocks}}. Leave it out when the page does not change.',
		`- set: only what the operator asked for, of ${settable}. Amounts are in minor units ($15,000 is 1500000); suggested amounts stay within the donation settings' minimum and maximum; programId is one of the active programs.`,
		...(type === 'campaign'
			? []
			: [
					'- the Donation page has no name, goal or end date; when asked for one, change nothing and say why.'
				]),
		'- write an amount in the words, or an impact tier, only from a figure the operator stated in the chat; with none, leave the impact tiers out.'
	];
}

function contextLines({
	type,
	name,
	current,
	story,
	look,
	programs,
	timeZone,
	now
}: PromptContext): string[] {
	const settings = current.settings;
	const programName = (id: string | null) =>
		programs.find((program) => program.id === id)?.name ?? id ?? 'none';
	return [
		`- page: ${type === 'campaign' ? `a campaign named "${name ?? ''}"` : 'the Donation page'}`,
		`- today: ${dayOf(now, timeZone) ?? 'unknown'}, in the operator's time zone ${timeZone}`,
		`- mission: ${story.mission === null ? '(not written)' : plainText(story.mission)}`,
		`- vision: ${story.vision === null ? '(not written)' : plainText(story.vision)}`,
		`- look: ${look.shade} shade, ${look.corner} corners, brand colour ${look.brandColour ?? 'none'}`,
		...(type === 'campaign'
			? [
					`- goal: ${current.goalMinor === undefined ? 'none' : money(current.goalMinor)}`,
					`- end date: ${current.endsAt === undefined ? 'none' : (dayOf(current.endsAt, timeZone) ?? 'none')}`
				]
			: []),
		settings === undefined
			? '- donation settings: none yet'
			: `- donation settings: minimum ${settings.minMinor === null ? 'none' : money(settings.minMinor)}, maximum ${settings.maxMinor === null ? 'none' : money(settings.maxMinor)}, suggested amounts ${settings.suggestedAmounts.map(money).join(', ') || 'none'}, program ${settings.programMode === 'pinned' ? `pinned to ${programName(settings.programId)}` : settings.programMode === 'choice' ? 'chosen by each donor' : 'none'}`,
		`- active programs: ${programs.map(({ id, name }) => `${id} (${name})`).join(', ') || 'none'}`
	];
}

/** one line naming each value a reply changed and each thing it lost; empty where neither. */
function summarise(
	changes: readonly Change[],
	dropped: readonly Dropped[],
	programs: readonly ProgramOption[]
): string {
	const said = changes.map((change) => changeWords(change, programs));
	const lost = dropped.map((item) =>
		item.what === 'tier'
			? `Left out the ${money(item.amountMinor)} tier: you haven’t given that figure.`
			: `Took the link off “${item.text}”.`
	);
	return [...said, ...lost].join(' ');
}

function changeWords(change: Change, programs: readonly ProgramOption[]): string {
	switch (change.field) {
		case 'name':
			return `Renamed to “${change.to}”.`;
		case 'goal':
			return `Goal set to ${money(change.to)}.`;
		case 'endDate':
			return `Ends ${dayWords(change.to)}.`;
		case 'program': {
			const named = programs.find(({ id }) => id === change.to.programId)?.name;
			return `Gifts go to ${named ?? change.to.programId}.`;
		}
		case 'amounts':
			return `Suggested amounts: ${change.to.map(money).join(', ')}.`;
	}
}

function money(minor: number) {
	return formatMinorBrief(minor, FORM_CURRENCY);
}
