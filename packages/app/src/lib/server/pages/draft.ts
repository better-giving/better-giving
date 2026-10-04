import { and, asc, eq, type SQL, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { formatMinorBrief } from '../../donations/money';
import { FORM_CURRENCY } from '../../forms/amounts';
import {
	type Accepted,
	acceptReply,
	type Change,
	type ChatMessage as AcceptMessage,
	type IllustrationRequest,
	illustrationRequests,
	REPLY_JSON_SCHEMA,
	readReply,
	SAY_MAX
} from '../../page/accept-reply';
import { draftFromPage, ILLUSTRATIONS_MAX, pageCatalog, switchRules } from '../../page/ai-catalog';
import type { Page } from '../../page/catalog';
import { placedImageIds } from '../../page/illustration';
import { dayOf, dayWords, endDayOf } from '../../page/end-date';
import type { ChatNote, PageType } from '../../page/keys';
import { SWITCH_LABELS } from '../../page/settings-form';
import {
	type Answer,
	answeredLines,
	answerWords,
	MISSION_QUESTION,
	type Question,
	QUESTIONS_MAX,
	readAnswers,
	readAsk,
	starterQuestions
} from '../../page/questions';
import { plainText, textDocument } from '../../rich-text/document';
import { type ChatMessage as ModelMessage, generate } from '../ai/generate';
import { illustrate } from '../ai/illustrate';
import type { Db } from '../db/client';
import { type ChatTurn, chatTurn, type Page as PageRow, page } from '../db/schema';
import { sqliteResultCode } from '../db/rejection';
import { firstMissingImage } from '../images/queries';
import { missionWhileEmptyStatement, readOrgLook, readOrgStory } from '../org/queries';
import type { OrgLook, Story } from '../org/presentation';
import { type ProgramOption, readActivePrograms } from '../programs/queries';
import { readableDraft } from './document';
import { nameToCarry, renaming, SLUG_ATTEMPTS } from './queries';

// one turn of a page's chat: the operator's message, or their answers to the questions the chat's
// last turn asked (`answerTurn`), the model's reply through `acceptReply`, and what lands — the
// draft and the two turns — in one `batch()`. the Donation page and a campaign alike. a page whose
// chat is empty is asked its opening questions instead, as one assistant turn (`openTurn`). a
// turn writes the draft document and the chat, and a campaign it renames is renamed everywhere a
// hand rename renames one (`renaming` in ./queries.ts). `published` is never written here, so
// nothing a turn does reaches a donor before Publish.
//
// the model is told the page as it stands (`draftFromPage` of the stored draft, hand edits and
// all), its type, name, goal, end date, donation settings and where its donation box opens, with
// the wording each switch that is on asks for (`switchRules`), the organisation's story and look,
// the active programs, and what it said so far: each accepted or asking exchange as the operator's
// message and the reply's `say`, cut at `SAY_MAX`, an ask with its questions beside its `say` and an
// answers turn as the words it was composed into. an opening ask follows the request an opening is
// asked with. which model is `generate`'s, never the chat's.
//
// an illustration the reply asks for in a photo's place (`illustrationRequests` in
// ../../page/accept-reply.ts) is drawn only for a reply `acceptReply` would take: the reply is read
// first with `STAND_IN` in each request's place, and one refused then is refused with nothing drawn.
// at most `ILLUSTRATIONS_MAX` are drawn a turn, and nothing where none is asked. each drawn id joins
// what this turn may place and stands in the request's place, and one not drawn stands there as
// null, so its block is left out as one with no photo is. a picture drawn for a turn that then goes
// stale stays stored and placed nowhere.
//
// four outcomes, each one assistant turn, its `note` the column's word for it:
// - accepted: the draft is replaced. the assistant's words are the reply's `say` on one line, then
//   a line naming each value `set` changed, each illustration made or not, and each thing
//   `acceptReply` dropped, so what the chat says it did is what it did. `fell-back` where the default
//   model wrote it in place of the chosen.
// - asked: the reply asks questions in place of a change. the draft is untouched, the turn's
//   `questions` hold them and its words are the reply's `say`. a reply to answers may not ask.
// - refused: the draft is untouched and the turn says why.
// - unanswered: no model answered; the draft is untouched and the turn says so plainly, with the
//   operator's fix where there is one. its `model` is the one `generate` asked.
//
// the operator's turn is inserted first, and everything after it lands only where it did. an
// accepted turn's is guarded on the draft text the reply was built against, so a hand edit or a
// second turn saved while the model was answering makes the whole batch write nothing, and the
// caller hears `stale`. an answers turn's is guarded on nothing having followed the questions, so
// answers sent twice land once and the second hears `answered`.

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

/**
 * the id every illustration request stands as while the reply is first read, before any picture is
 * drawn. a reply that stand-in cannot carry is refused with nothing drawn, and one it can carries
 * the drawn ids or null alike.
 */
const STAND_IN = '00000000-0000-4000-8000-000000000000';

export type TurnRequest = {
	pageId: string;
	message: string;
	imageIds: readonly string[];
	/** the IANA zone of the browser that posted the turn. */
	timeZone: string;
	now: number;
};

/** the operator's answers to the questions the chat's last turn asked, as posted. */
export type AnswersRequest = { pageId: string; answers: unknown; timeZone: string; now: number };

export type OpenRequest = { pageId: string; timeZone: string; now: number };

/** an answered question as the chat draws it: its prompt, from the turn that asked it. */
export type AnsweredQuestion = { id: string; prompt: string; words: string };

/** one turn as the chat draws it. */
export type ChatEntry = {
	id: string;
	role: 'operator' | 'assistant';
	text: string;
	imageIds: string[];
	note?: Exclude<ChatNote, 'unanswered'>;
	/** the questions an assistant turn asked. */
	questions?: Question[];
	/** what an operator turn answered them, in the order asked; `[]` where it skipped them all. */
	answers?: AnsweredQuestion[];
};

export type TurnResult =
	| {
			ok: true;
			/** `unchanged` is an opening asked of a chat that has turns: none written, all answered. */
			outcome: 'accepted' | 'refused' | 'unanswered' | 'asked' | 'unchanged';
			turns: ChatEntry[];
	  }
	| { ok: false; reason: 'not_found' | 'stale' }
	| { ok: false; reason: 'unknown_image'; imageId: string }
	/** the chat's last turn asks nothing open: its questions were answered, or none were asked. */
	| { ok: false; reason: 'answered' }
	| { ok: false; reason: 'invalid_answers'; error: string };

/** a page's chat in order, or `null` where there is no such page. */
export async function readChat(db: Db, pageId: string): Promise<ChatEntry[] | null> {
	const [found] = await db.select({ id: page.id }).from(page).where(eq(page.id, pageId));
	if (!found) return null;
	return chatEntries(await turnsOf(db, pageId));
}

export async function draftTurn(db: Db, env: unknown, request: TurnRequest): Promise<TurnResult> {
	const [row] = await db.select().from(page).where(eq(page.id, request.pageId));
	if (!row) return { ok: false, reason: 'not_found' };
	const [missing, turns] = await Promise.all([
		firstMissingImage(db, request.imageIds),
		turnsOf(db, row.id)
	]);
	if (missing !== null) return { ok: false, reason: 'unknown_image', imageId: missing };
	return respond(db, env, {
		row,
		turns,
		operator: operatorTurn(request.message, [...request.imageIds], null),
		said: withImages(request.message, request.imageIds),
		answering: false,
		alongside: [],
		timeZone: request.timeZone,
		now: request.now
	});
}

/**
 * the operator's answers to the questions the chat's last turn asked: one operator turn whose text
 * is `answerWords` and whose `answers` are the answers read, then the model's reply as any turn's,
 * except that it may not ask again. the mission question answered writes the Organisation's
 * mission in the same `batch()` as that turn, whatever the reply, while none is stored.
 */
export async function answerTurn(
	db: Db,
	env: unknown,
	request: AnswersRequest
): Promise<TurnResult> {
	const [row] = await db.select().from(page).where(eq(page.id, request.pageId));
	if (!row) return { ok: false, reason: 'not_found' };
	const turns = await turnsOf(db, row.id);
	const last = turns.at(-1);
	const questions = last?.author === 'assistant' ? questionsOf(last) : null;
	if (last === undefined || questions === null) return { ok: false, reason: 'answered' };
	const read = readAnswers(questions, request.answers);
	if (!read.ok) return { ok: false, reason: 'invalid_answers', error: read.reason };

	const words = answerWords(questions, read.answers);
	const operator = operatorTurn(words, [], JSON.stringify(read.answers));
	const mission = missionAnswered(questions, read.answers);
	const result = await respond(db, env, {
		row,
		turns,
		operator,
		said: answersMessage(words),
		answering: true,
		fresh: sql`not exists (select 1 from ${chatTurn} where ${chatTurn.pageId} = ${row.id} and ${chatTurn.seq} > ${last.seq})`,
		alongside: mission === null ? [] : [missionWhileEmptyStatement(db, mission, landed(operator))],
		timeZone: request.timeZone,
		now: request.now
	});
	if (result.ok || result.reason !== 'stale') return result;
	const after = await turnsOf(db, row.id);
	return after.at(-1)?.id === last.id ? result : { ok: false, reason: 'answered' };
}

/**
 * a page's opening questions, asked of a chat with no turn yet: one assistant turn with no operator
 * turn before it. a chat holding any turn is answered as it stands, and nothing is written; the
 * insert itself holds that, so two opens at once write one turn.
 *
 * while the Organisation's mission is empty, `MISSION_QUESTION` comes first and a question of the
 * model's under its id is dropped, `QUESTIONS_MAX` in all. no model answering, a reply refused or
 * read as anything but an ask, or an ask holding nothing past the mission, opens on
 * `starterQuestions` instead: a turn noted `starter`, its `model` the one asked.
 */
export async function openTurn(db: Db, env: unknown, request: OpenRequest): Promise<TurnResult> {
	const [row] = await db.select().from(page).where(eq(page.id, request.pageId));
	if (!row) return { ok: false, reason: 'not_found' };
	const turns = await turnsOf(db, row.id);
	if (turns.length > 0) return { ok: true, outcome: 'unchanged', turns: chatEntries(turns) };
	const context = await promptContext(db, row, request);
	const missionEmpty = context.story.mission === null;
	const answer = await generate(env, {
		system: systemPrompt(context),
		messages: [{ role: 'user', content: openingRequest(missionEmpty) }],
		jsonSchema: REPLY_JSON_SCHEMA
	});
	const reply = answer.ok
		? acceptReply({
				type: row.type,
				current: context.current,
				name: row.name,
				reply: answer.text,
				attached: [],
				illustrations: [],
				messages: [],
				activePrograms: context.programs,
				timeZone: request.timeZone,
				now: request.now
			})
		: null;
	const asked = reply?.ok === true && reply.kind === 'asked' ? reply : null;
	const own = asked?.questions.filter(({ id }) => id !== MISSION_QUESTION.id) ?? [];
	const assistant =
		asked !== null && own.length > 0
			? assistantTurn(
					oneLine(asked.say),
					answer.model,
					answer.ok && answer.fellBack ? 'fell-back' : null,
					[...(missionEmpty ? [MISSION_QUESTION] : []), ...own].slice(0, QUESTIONS_MAX)
				)
			: assistantTurn(
					STARTER_SAY,
					answer.model,
					'starter',
					starterQuestions(row.type, row.campaignType, missionEmpty)
				);

	const empty = sql`not exists (select 1 from ${chatTurn} where ${chatTurn.pageId} = ${row.id})`;
	const [written] = await db.batch([
		turnStatement(db, row.id, assistant, empty),
		db
			.update(page)
			.set({ updatedAt: new Date() })
			.where(sql`${eq(page.id, row.id)} and ${landed(assistant)}`)
	]);
	if (written.length > 0) return { ok: true, outcome: 'asked', turns: chatEntries(written) };
	return { ok: true, outcome: 'unchanged', turns: chatEntries(await turnsOf(db, row.id)) };
}

const STARTER_SAY = 'A few questions before I draft your page.';

/** the user message an opening is asked with, shown before every opening ask in the history. */
function openingRequest(missionFirst: boolean) {
	return missionFirst
		? 'Before you draft this page, ask me 3 to 4 questions whose answers you need to draft it. My mission is asked separately, so ask nothing about it.'
		: 'Before you draft this page, ask me 3 to 5 questions whose answers you need to draft it.';
}

/** an answers turn as the model reads it. */
function answersMessage(words: string) {
	return `My answers to your questions:\n${words}`;
}

/** the mission the answers give where `questions` asked `MISSION_QUESTION`; null where they did not. */
function missionAnswered(questions: readonly Question[], answers: readonly Answer[]) {
	const asked = questions.some(
		({ id, kind, prompt }) =>
			id === MISSION_QUESTION.id &&
			kind === MISSION_QUESTION.kind &&
			prompt === MISSION_QUESTION.prompt
	);
	const answer = answers.find(({ id }) => id === MISSION_QUESTION.id);
	return asked && typeof answer?.value === 'string' ? textDocument(answer.value) : null;
}

type Turning = {
	row: PageRow;
	turns: readonly ChatTurn[];
	operator: NewTurn;
	/** the operator's turn as the model reads it. */
	said: string;
	/** the turn answers the chat's questions, so the reply may not ask. */
	answering: boolean;
	/** what else must hold, over `page`, for the operator's turn to land. */
	fresh?: SQL;
	/** statements landing with the operator's turn, each guarded on it. */
	alongside: readonly ReturnType<typeof missionWhileEmptyStatement>[];
	timeZone: string;
	now: number;
};

/** the model asked for the reply to `operator`, and the outcome written: one exchange. */
async function respond(db: Db, env: unknown, turning: Turning): Promise<TurnResult> {
	const { row, turns, operator, alongside } = turning;
	const context = await promptContext(db, row, turning);
	const { current, programs } = context;
	const answer = await generate(env, {
		system: systemPrompt(context),
		messages: [...history(turns).slice(-HISTORY_TURNS), { role: 'user', content: turning.said }],
		jsonSchema: REPLY_JSON_SCHEMA
	});

	const written = async (
		outcome: 'refused' | 'unanswered' | 'asked',
		assistant: NewTurn
	): Promise<TurnResult> => {
		const entries = await writeTurns(db, row.id, operator, assistant, turning.fresh, alongside);
		if (entries.length === 0) return { ok: false, reason: 'stale' };
		return { ok: true, outcome, turns: entryPair(turns, entries) };
	};

	if (!answer.ok) {
		const text = `No model answered, so nothing changed. ${answer.operatorFix ?? 'Try again in a moment.'}`;
		return written('unanswered', assistantTurn(text, answer.model, 'unanswered'));
	}

	const refusedFor = (reason: string) =>
		written('refused', assistantTurn(`${REFUSED_PREFIX}${reason}`, answer.model, 'refused'));

	const read = readReply(answer.text);
	const asked = read.ok ? illustrationRequests(read.json) : read;
	if (!asked.ok) return refusedFor(asked.reason);
	const placeable = [...turns.flatMap(imageIdsOf), ...operator.imageIds];
	const acceptWith = (placed: readonly (string | null)[]) =>
		acceptReply({
			type: row.type,
			current,
			name: row.name,
			reply: asked.place(placed),
			attached: [...placeable, ...placed.filter((id) => id !== null)],
			illustrations: asked.requests,
			messages: [...turns.map(acceptMessage), { author: 'operator', text: operator.text }],
			activePrograms: programs,
			timeZone: turning.timeZone,
			now: turning.now,
			answering: turning.answering
		});
	let drawn: Drawn[] = [];
	if (asked.requests.length > 0) {
		const rehearsed = acceptWith(asked.requests.map(() => STAND_IN));
		if (!rehearsed.ok) return refusedFor(rehearsed.reason);
		drawn = await drawIllustrations(env, db, asked.requests);
	}
	const result = acceptWith(drawn.map(({ imageId }) => imageId));
	if (!result.ok) return refusedFor(result.reason);
	const note = answer.fellBack ? 'fell-back' : null;
	if (result.kind === 'asked') {
		return written(
			'asked',
			assistantTurn(oneLine(result.say), answer.model, note, result.questions)
		);
	}

	const draft = JSON.stringify(result.draft);
	const summary = summarise(result, drawn, programs);
	const text = [oneLine(result.say), summary].filter((line) => line !== '').join('\n');
	const assistant = assistantTurn(text, answer.model, note);
	const seen = and(eq(page.id, row.id), turning.fresh, eq(page.draft, row.draft));
	const name = nameToCarry(row, result.draft);
	for (let attempt = 1; ; attempt += 1) {
		const rename = name === null ? null : await renaming(db, row, name, seen);
		const statements = [
			turnStatement(db, row.id, operator, seen),
			turnStatement(db, row.id, assistant, landed(operator)),
			db
				.update(page)
				.set({ draft, ...rename?.columns })
				.where(sql`${eq(page.id, row.id)} and ${landed(operator)}`)
				.returning({ id: page.id }),
			...alongside
		] as const;
		try {
			// the settings row's rename runs first, since the page's update moves the draft `seen` reads.
			const [first, second, updated] =
				rename === null
					? await db.batch(statements)
					: await db.batch([rename.owned, ...statements]).then(([, ...rest]) => rest);
			if (updated.length === 0) return { ok: false, reason: 'stale' };
			return { ok: true, outcome: 'accepted', turns: entryPair(turns, [...first, ...second]) };
		} catch (error) {
			if (attempt === SLUG_ATTEMPTS || sqliteResultCode(error) !== 'SQLITE_CONSTRAINT_UNIQUE') {
				throw error;
			}
		}
	}
}

/** what the model is told of the page and the organisation, read afresh for each turn. */
async function promptContext(
	db: Db,
	row: PageRow,
	{ timeZone, now }: { timeZone: string; now: number }
): Promise<PromptContext> {
	const current = readableDraft(row);
	const [{ story }, { look }, programs] = await Promise.all([
		readOrgStory(db),
		readOrgLook(db),
		readActivePrograms(db)
	]);
	const name = current.name ?? row.name;
	return { type: row.type, name, current, story, look, programs, timeZone, now };
}

type NewTurn = Pick<
	ChatTurn,
	'id' | 'author' | 'text' | 'model' | 'note' | 'questions' | 'answers'
> & { imageIds: string[] };

function operatorTurn(text: string, imageIds: string[], answers: string | null): NewTurn {
	return {
		id: uuidv7(),
		author: 'operator',
		text,
		model: null,
		imageIds,
		note: null,
		questions: null,
		answers
	};
}

function assistantTurn(
	text: string,
	model: string,
	note: ChatNote | null,
	questions: readonly Question[] | null = null
): NewTurn {
	return {
		id: uuidv7(),
		author: 'assistant',
		text,
		model,
		imageIds: [],
		note,
		questions: questions === null ? null : JSON.stringify(questions),
		answers: null
	};
}

/** true once `turn` is in the chat: what every statement landing with it is guarded on. */
function landed(turn: NewTurn): SQL {
	return sql`exists (select 1 from ${chatTurn} where ${chatTurn.id} = ${turn.id})`;
}

/**
 * the operator's turn where the page matches `when`, the assistant's after it, and what lands
 * alongside. a turn that leaves the draft as it was still moves the page's version, as every write
 * to the page does, so a Discard changes drawn before it does not empty a chat it never saw. no
 * turn written where the page no longer matches.
 */
async function writeTurns(
	db: Db,
	pageId: string,
	operator: NewTurn,
	assistant: NewTurn,
	when: SQL | undefined,
	alongside: Turning['alongside']
) {
	const [first, second] = await db.batch([
		turnStatement(db, pageId, operator, when),
		turnStatement(db, pageId, assistant, landed(operator)),
		db
			.update(page)
			.set({ updatedAt: new Date() })
			.where(sql`${eq(page.id, pageId)} and ${landed(operator)}`),
		...alongside
	]);
	return [...first, ...second];
}

/**
 * a turn after the chat's last, inserted only where page `pageId` is there and `when` holds. `seq`
 * is read inside the statement, so the second of two turns in one batch lands after the first.
 */
function turnStatement(db: Db, pageId: string, turn: NewTurn, when: SQL | undefined) {
	return db
		.insert(chatTurn)
		.select((qb) =>
			qb
				.select({
					id: sql<string>`${turn.id}`.as('id'),
					pageId: sql<string>`${pageId}`.as('page_id'),
					seq: sql<number>`(select coalesce(max(${chatTurn.seq}), 0) + 1 from ${chatTurn} where ${chatTurn.pageId} = ${pageId})`.as(
						'seq'
					),
					author: sql<string>`${turn.author}`.as('author'),
					text: sql<string>`${turn.text}`.as('text'),
					model: sql<string | null>`${turn.model}`.as('model'),
					imageIds: sql<string>`${JSON.stringify(turn.imageIds)}`.as('image_ids'),
					createdAt: sql<number>`${Date.now()}`.as('created_at'),
					note: sql<ChatNote | null>`${turn.note}`.as('note'),
					questions: sql<string | null>`${turn.questions}`.as('questions'),
					answers: sql<string | null>`${turn.answers}`.as('answers')
				})
				.from(page)
				.where(and(eq(page.id, pageId), when))
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

/** the questions an assistant turn asked; null where it asked none, or they no longer read. */
function questionsOf(turn: ChatTurn): Question[] | null {
	if (turn.questions === null) return null;
	const read = readAsk(JSON.parse(turn.questions));
	return read.ok ? read.questions : null;
}

function chatEntries(turns: readonly ChatTurn[]): ChatEntry[] {
	return turns.map((turn, index) => chatEntry(turn, turns[index - 1]));
}

/** the turns one exchange wrote, each read beside the turn before it. */
function entryPair(before: readonly ChatTurn[], written: readonly ChatTurn[]): ChatEntry[] {
	const last = before.at(-1);
	return chatEntries(last === undefined ? written : [last, ...written]).slice(
		last === undefined ? 0 : 1
	);
}

/** `turn` as the chat draws it; an answering turn's prompts are the questions `before` asked. */
function chatEntry(turn: ChatTurn, before: ChatTurn | undefined): ChatEntry {
	const entry: ChatEntry = {
		id: turn.id,
		role: turn.author,
		text: turn.text,
		imageIds: imageIdsOf(turn)
	};
	// an unanswered turn's words say so, and the chat draws no note under it.
	if (turn.note !== null && turn.note !== 'unanswered') entry.note = turn.note;
	const questions = questionsOf(turn);
	if (questions !== null) entry.questions = questions;
	if (turn.answers !== null) {
		const asked = before === undefined ? [] : (questionsOf(before) ?? []);
		const read = readAnswers(asked, JSON.parse(turn.answers));
		entry.answers = read.ok ? answeredLines(asked, read.answers) : [];
	}
	return entry;
}

function acceptMessage(turn: ChatTurn): AcceptMessage {
	return { author: turn.author, text: turn.text };
}

/**
 * the chat as the model reads it: each exchange whose reply was accepted or asked, as the
 * operator's words and the reply's `say`, an ask with its questions beside. an opening ask, which
 * no operator turn comes before, follows the request it answers.
 */
function history(turns: readonly ChatTurn[]): ModelMessage[] {
	return turns.flatMap((turn, index) => {
		if (turn.author !== 'assistant') return [];
		if (turn.note === 'refused' || turn.note === 'unanswered') return [];
		const before = turns[index - 1];
		const questions = questionsOf(turn);
		const [say = ''] = turn.text.split('\n', 1);
		const reply = {
			role: 'assistant' as const,
			content:
				questions === null
					? say.slice(0, SAY_MAX)
					: `${say.slice(0, SAY_MAX)}\n\n(asked: ${JSON.stringify(questions)})`
		};
		if (before?.author === 'operator') {
			const content =
				before.answers === null
					? withImages(before.text, imageIdsOf(before))
					: answersMessage(before.text);
			return [{ role: 'user' as const, content }, reply];
		}
		if (questions === null) return [];
		const missionFirst = questions[0]?.id === MISSION_QUESTION.id;
		return [{ role: 'user' as const, content: openingRequest(missionFirst) }, reply];
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
		pageCatalog(context.type).prompt({ customRules: switchRules(context.current.switches) }),
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
		'Answer with one JSON object and nothing else: {"say": ..., "page": ..., "set": ...} to change the page, or {"say": ..., "ask": [...]} to ask the operator first.',
		'- say: one or two sentences to the operator saying what you changed, naming each value you set; when you ask, one sentence leading into the questions.',
		'- page: an edit to the page as it stands, changing only what the message asks for and keeping every word it does not mention. Either {"kind": "patch", "ops": [RFC 6902 operations, e.g. {"op": "replace", "path": "/blocks/0/props/heading", "value": ...}]} or {"kind": "merge", "doc": {an RFC 7396 merge of layout, palette or blocks}}. Leave it out when the page does not change.',
		`- set: only what the operator asked for, of ${settable}. Amounts are in minor units ($15,000 is 1500000); suggested amounts stay within the donation settings' minimum and maximum; programId is one of the active programs.`,
		...(type === 'campaign'
			? []
			: [
					'- the Donation page has no name, goal or end date; when asked for one, change nothing and say why.'
				]),
		'- where the donation box opens is the operator’s to set in Donation settings; when asked to change it, change nothing and say so.',
		'- write an amount in the words only from a figure the operator stated in the chat or one the page already shows.',
		'- say what an amount does, in the words or as an impact tier, only where the operator said it of that amount in one sentence, in the chat or on the page; otherwise an amount stays an amount alone, with no impact tier.',
		'- ask: when the message is vague, or the page needs what only the operator knows — figures, dates, names, what a gift does — ask instead of guessing. A reply that asks has no page and no set.',
		`- each question is {"id": ..., "kind": ..., "prompt": ..., "hint"?: ..., "options"?: [...], "placeholder"?: ..., "prefill"?: ...}, 1 to ${QUESTIONS_MAX} of them. id: lowercase letters, digits and "-", unique. kind: "choice" (pick one option), "choices" (pick several), "text", "amount" (answered in dollars) or "date" (answered as a day). Prefer "choice" and "choices", with 2 to 6 short options; every choice gets an Other box of its own, so never list "Other". placeholder and prefill are for "text" only.`,
		'- every word in a question is plain text: no HTML, no link, no web address.',
		'- never ask in reply to answers: when the message answers your questions, change the page from them.'
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
					`- end date: ${endDayOf(current) ?? 'none'}`
				]
			: []),
		settings === undefined
			? '- donation settings: none yet'
			: `- donation settings: minimum ${settings.minMinor === null ? 'none' : money(settings.minMinor)}, maximum ${settings.maxMinor === null ? 'none' : money(settings.maxMinor)}, suggested amounts ${settings.suggestedAmounts.map(money).join(', ') || 'none'}, program ${settings.programMode === 'pinned' ? `pinned to ${programName(settings.programId)}` : settings.programMode === 'choice' ? 'chosen by each donor' : 'none'}`,
		`- donation box: ${SWITCH_LABELS.open_on_monthly} ${onOff(current.switches.openOnMonthly)}, ${SWITCH_LABELS.dedication_on} ${onOff(current.switches.dedicationOn)}`,
		`- active programs: ${programs.map(({ id, name }) => `${id} (${name})`).join(', ') || 'none'}`
	];
}

const onOff = (on: boolean) => (on ? 'on' : 'off');

/**
 * an illustration a reply asked for, and the id of the picture drawn for it, or null. `honoured` is
 * false past `ILLUSTRATIONS_MAX`, where no picture was asked of the model.
 */
type Drawn = { description: string; imageId: string | null; honoured: boolean };

/**
 * the first `ILLUSTRATIONS_MAX` of `requests` drawn, each its own prompt and alt text; any past
 * them is drawn no picture, and an empty list asks nothing of the model.
 */
function drawIllustrations(env: unknown, db: Db, requests: readonly IllustrationRequest[]) {
	return Promise.all(
		requests.map(async ({ description }, index): Promise<Drawn> => {
			if (index >= ILLUSTRATIONS_MAX) return { description, imageId: null, honoured: false };
			const made = await illustrate(env, db, { prompt: description, alt: description });
			return { description, imageId: made.ok ? made.imageId : null, honoured: true };
		})
	);
}

/**
 * one line naming each value a reply changed, each illustration it made or could not, and each
 * thing it lost; empty where none. an illustration is named as made, never as a photo placed.
 */
function summarise(
	{ changes, dropped, draft }: Accepted,
	drawn: readonly Drawn[],
	programs: readonly ProgramOption[]
): string {
	const said = changes.map((change) => changeWords(change, programs));
	const placed = new Set(placedImageIds(draft));
	const pictured = drawn.flatMap(({ description, imageId, honoured }) => {
		if (imageId !== null) {
			return placed.has(imageId)
				? [`Made an illustration of “${description}”; a photo you attach can replace it.`]
				: [];
		}
		return honoured
			? [`Couldn’t make an illustration of “${description}”, so its block is left out.`]
			: [
					`Left out an illustration of “${description}”: a turn makes at most ${ILLUSTRATIONS_MAX}.`
				];
	});
	const lost = dropped.map((item) => {
		if (item.what === 'link') return `Took the link off “${item.text}”.`;
		const amount = money(item.amountMinor);
		return item.reworded
			? `Left out the ${amount} tier I reworded: what ${amount} does is yours to say, so tell me and I’ll use your words.`
			: `Left out the ${amount} tier: you haven’t said what ${amount} does.`;
	});
	return [...said, ...pictured, ...lost].join(' ');
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
