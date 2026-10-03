import { asc, eq, type SQL, sql } from 'drizzle-orm';
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
import { plainText } from '../../rich-text/document';
import { type ChatMessage as ModelMessage, generate } from '../ai/generate';
import { illustrate } from '../ai/illustrate';
import type { Db } from '../db/client';
import { type ChatTurn, chatTurn, page } from '../db/schema';
import { sqliteResultCode } from '../db/rejection';
import { firstMissingImage } from '../images/queries';
import { readOrgLook, readOrgStory } from '../org/queries';
import type { OrgLook, Story } from '../org/presentation';
import { type ProgramOption, readActivePrograms } from '../programs/queries';
import { readableDraft } from './document';
import { nameToCarry, renaming, SLUG_ATTEMPTS } from './queries';

// one turn of a page's chat: the operator's message, the model's reply through `acceptReply`, and
// what lands — the draft and the two turns — in one `batch()`. the Donation page and a campaign
// alike. a turn writes the draft document and the chat, and a campaign it renames is renamed
// everywhere a hand rename renames one (`renaming` in ./queries.ts). `published` is never written
// here, so nothing a turn does reaches a donor before Publish.
//
// the model is told the page as it stands (`draftFromPage` of the stored draft, hand edits and
// all), its type, name, goal, end date, donation settings and where its donation box opens, with
// the wording each switch that is on asks for (`switchRules`), the organisation's story and look,
// the active programs, and what it said so far: each accepted exchange as the operator's message
// and the reply's `say`, cut at `SAY_MAX`. which model is `generate`'s, never the chat's.
//
// an illustration the reply asks for in a photo's place (`illustrationRequests` in
// ../../page/accept-reply.ts) is drawn only for a reply `acceptReply` would take: the reply is read
// first with `STAND_IN` in each request's place, and one refused then is refused with nothing drawn.
// at most `ILLUSTRATIONS_MAX` are drawn a turn, and nothing where none is asked. each drawn id joins
// what this turn may place and stands in the request's place, and one not drawn stands there as
// null, so its block is left out as one with no photo is. a picture drawn for a turn that then goes
// stale stays stored and placed nowhere.
//
// three outcomes, each one assistant turn, its `note` the column's word for it:
// - accepted: the draft is replaced. the assistant's words are the reply's `say` on one line, then
//   a line naming each value `set` changed, each illustration made or not, and each thing
//   `acceptReply` dropped, so what the chat says it did is what it did. `fell-back` where the default
//   model wrote it in place of the chosen.
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
	const current = readableDraft(row);
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

	const refusedFor = async (reason: string): Promise<TurnResult> => {
		const assistant = assistantTurn(`${REFUSED_PREFIX}${reason}`, answer.model, 'refused');
		const written = await writeTurns(db, row.id, [operator, assistant], onPage);
		return { ok: true, outcome: 'refused', turns: written };
	};

	const read = readReply(answer.text);
	const asked = read.ok ? illustrationRequests(read.json) : read;
	if (!asked.ok) return refusedFor(asked.reason);
	const placeable = [...turns.flatMap(imageIdsOf), ...request.imageIds];
	const acceptWith = (placed: readonly (string | null)[]) =>
		acceptReply({
			type: row.type,
			current,
			name: row.name,
			reply: asked.place(placed),
			attached: [...placeable, ...placed.filter((id) => id !== null)],
			illustrations: asked.requests,
			messages: [...turns.map(acceptMessage), { author: 'operator', text: request.message }],
			activePrograms: programs,
			timeZone: request.timeZone,
			now: request.now
		});
	let drawn: Drawn[] = [];
	if (asked.requests.length > 0) {
		const rehearsed = acceptWith(asked.requests.map(() => STAND_IN));
		if (!rehearsed.ok) return refusedFor(rehearsed.reason);
		drawn = await drawIllustrations(env, db, asked.requests);
	}
	const result = acceptWith(drawn.map(({ imageId }) => imageId));
	if (!result.ok) return refusedFor(result.reason);

	const draft = JSON.stringify(result.draft);
	const summary = summarise(result, drawn, programs);
	const text = [oneLine(result.say), summary].filter((line) => line !== '').join('\n');
	const assistant = assistantTurn(text, answer.model, answer.fellBack ? 'fell-back' : null);
	const seen = sql`${onPage} and ${eq(page.draft, row.draft)}`;
	const name = nameToCarry(row, result.draft);
	for (let attempt = 1; ; attempt += 1) {
		const rename = name === null ? null : await renaming(db, row, name, seen);
		const statements = [
			turnStatement(db, row.id, operator, seen),
			turnStatement(db, row.id, assistant, seen),
			db
				.update(page)
				.set({ draft, ...rename?.columns })
				.where(seen)
				.returning({ id: page.id })
		] as const;
		try {
			// the settings row's rename runs first, since the page's update moves the draft `seen` reads.
			const [first, second, updated] =
				rename === null
					? await db.batch(statements)
					: await db.batch([rename.owned, ...statements]).then(([, ...rest]) => rest);
			if (updated.length === 0) return { ok: false, reason: 'stale' };
			return { ok: true, outcome: 'accepted', turns: [...first, ...second].map(chatEntry) };
		} catch (error) {
			if (attempt === SLUG_ATTEMPTS || sqliteResultCode(error) !== 'SQLITE_CONSTRAINT_UNIQUE') {
				throw error;
			}
		}
	}
}

type NewTurn = Pick<ChatTurn, 'author' | 'text' | 'model' | 'note'> & { imageIds: string[] };

function assistantTurn(text: string, model: string, note: ChatNote | null): NewTurn {
	return { author: 'assistant', text, model, imageIds: [], note };
}

/**
 * a turn that leaves the draft as it was still moves the page's version, as every write to the
 * page does, so a Discard changes drawn before it does not empty a chat it never saw.
 */
async function writeTurns(db: Db, pageId: string, turns: [NewTurn, NewTurn], when: SQL) {
	const [first, second] = await db.batch([
		turnStatement(db, pageId, turns[0], when),
		turnStatement(db, pageId, turns[1], when),
		db.update(page).set({ updatedAt: new Date() }).where(when)
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
		'Answer with one JSON object and nothing else: {"say": ..., "page": ..., "set": ...}',
		'- say: one or two sentences to the operator saying what you changed, naming each value you set.',
		'- page: an edit to the page as it stands, changing only what the message asks for and keeping every word it does not mention. Either {"kind": "patch", "ops": [RFC 6902 operations, e.g. {"op": "replace", "path": "/blocks/0/props/heading", "value": ...}]} or {"kind": "merge", "doc": {an RFC 7396 merge of layout, palette or blocks}}. Leave it out when the page does not change.',
		`- set: only what the operator asked for, of ${settable}. Amounts are in minor units ($15,000 is 1500000); suggested amounts stay within the donation settings' minimum and maximum; programId is one of the active programs.`,
		...(type === 'campaign'
			? []
			: [
					'- the Donation page has no name, goal or end date; when asked for one, change nothing and say why.'
				]),
		'- where the donation box opens is the operator’s to set in Donation settings; when asked to change it, change nothing and say so.',
		'- write an amount in the words only from a figure the operator stated in the chat or one the page already shows.',
		'- say what an amount does, in the words or as an impact tier, only where the operator said it of that amount in one sentence, in the chat or on the page; otherwise an amount stays an amount alone, with no impact tier.'
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
