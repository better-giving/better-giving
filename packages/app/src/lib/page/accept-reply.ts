// the one door through which a chat reply becomes a page draft: `acceptReply` reads the model's
// answer, applies it to the page as it stands and hands back the draft to store, or refuses it
// whole and hands `current` back unchanged — a throw anywhere inside included. ./accept-reply.spec.ts
// holds that nothing else in the app calls `pageFromDraft` or imports ./json-patch.ts.
//
// a reply is `{ say, page?, set? }`. `say` is what the chat shows: words once trimmed, at most
// `SAY_MAX` characters. `page` edits the page as the model reads it (`draftFromPage` in
// ./ai-catalog.ts: layout, palette and blocks, each block's values under `props`), as an RFC 6902
// patch or an RFC 7396 merge (./json-patch.ts); an edit reaching past those three keys is refused,
// so the look, the switches, the share message, the donation settings, and a campaign's name, goal
// and end date never move through it. `set` names the five things a reply may change beside the
// page — a campaign's name, goal and end date, the program the page's gifts are pinned to and its
// suggested amounts — each written into the draft, and anything else it names is refused: the
// fund, the program's destination, the payment options, the look and the switches are the
// operator's alone. an end date is a day, `YYYY-MM-DD`, in the zone of the browser that posted the
// chat turn, stored as ./end-date.ts's `endOfDay` of it with that zone beside it, and refused once
// that day is over. pinning
// a program is refused on the Donation page while its donors choose one, since its program chooser
// stays. each value `set` changes comes back in `changes` — an end date as its day, a program with
// the mode it leaves — so the reply's own words can be held to what it did. a rename is from the
// draft's own name where it holds one, and from the dashboard's otherwise.
//
// the model's answer is text nobody checked, so its size is bounded before anything reads it: the
// text at `REPLY_BYTES_MAX`, its nesting before the schema walks it, a patch at `OPS_MAX`
// operations, and the page after every operation at `DRAFT_BYTES_MAX` as JSON and `DEPTH_MAX`
// levels, so an edit that copies the page into itself is stopped as it grows.
//
// what the model is told and cannot be trusted to keep is enforced here, after the edit:
// - a link: kept only where the page already held its address. any other has its link taken off
//   and its text kept, noted in `dropped`.
// - an impact tier: kept where its amount is a figure the operator wrote in the chat, or where the
//   page already held the same tier, amount and words alike. any other tier — one whose words the
//   reply rewrote included — is dropped and noted, and the rest of the reply lands.
// - a figure in the words: a new campaign name and every string a block draws — a heading, a lede,
//   what a tier buys, a question, each paragraph of a story or an answer — may hold only figures the operator wrote in
//   the chat or the page already draws, in its words, its tiers' amounts or its goal — the goal
//   this same reply sets included. any other refuses the reply, naming the figure. a donor reads a
//   figure as a promise the model cannot check.
// - an image: any `imageId`, whichever block carries it, is one attached in this page's chat, or
//   the reply is refused.
// - a block its page type does not take, and everything else about a page's shape, is
//   `parsePage`'s, which the draft passes last.
//
// a figure is read by this grammar, case aside, and in the chat only out of the operator's own
// messages, never the assistant's:
// - an amount is digits, optionally grouped in threes by commas (`1,000`, `12,500`), optionally with
//   a point and cents (`12.50`), and read by `readAmount` in ../forms/amounts.ts, so `12.505` is no
//   figure at all.
// - `k`, `thousand`, `m` or `million` after the digits, a space between or none, scales it
//   (`$15k`, `$15 thousand`, `$1.2m`); a letter run on past them (`$15kids`) leaves the digits
//   alone. a scaled figure finer than a cent (`$1.234567k`) is one nobody can check, and in the
//   words it refuses the reply.
// - it is a figure only beside the currency: after `$`, `US$` or `USD` (`$25`, `$ 25`, `USD 40`),
//   or before `dollar`, `dollars` or `USD` (`25 dollars`, `40 usd`). a bare number — `25 children`
//   — is not one.
// - dollars, since every page's settings are in `FORM_CURRENCY`.
//
// pure and not under `$lib/server/**`, beside the catalog it reads.
import { z } from 'zod';
import { formatMinorBrief } from '../donations/money';
import { FORM_CURRENCY, majorEntry, readAmount, readSuggestedAmounts } from '../forms/amounts';
import type { ProgramMode } from '../forms/program-modes';
import { draftFromPage, pageFromDraft } from './ai-catalog';
import { dayOf, endOfDay } from './end-date';
import { HEADING_MAX, type Page, parsePage } from './catalog';
import { PAGE_KEYS, type PageType } from './keys';
import { applyPatch, deeperThan, mergePatch, outOfBounds, pointer } from './json-patch';

/** a reply's text, measured before it is parsed at all. */
export const REPLY_BYTES_MAX = 64 * 1024;
export const OPS_MAX = 200;
/** the page as the model reads it, measured after every edit. */
export const DRAFT_BYTES_MAX = 256 * 1024;
export const DEPTH_MAX = 32;
/** what the chat shows of a reply. */
export const SAY_MAX = 2000;
/** the page's depth and the levels a reply wraps an edit in: reply › page › ops › op › value. */
const REPLY_DEPTH_MAX = DEPTH_MAX + 5;
const DRAFT_BOUNDS = { bytes: DRAFT_BYTES_MAX, depth: DEPTH_MAX, what: 'the page' };

const patchOp = z.discriminatedUnion('op', [
	z.object({ op: z.enum(['add', 'replace', 'test']), path: z.string(), value: z.json() }),
	z.object({ op: z.literal('remove'), path: z.string() }),
	z.object({ op: z.enum(['move', 'copy']), from: z.string(), path: z.string() })
]);

const replySchema = z.strictObject({
	say: z
		.string()
		.trim()
		.min(1, { error: 'say holds no words' })
		.max(SAY_MAX, { error: `say holds at most ${SAY_MAX} characters` }),
	page: z
		.discriminatedUnion('kind', [
			z.strictObject({
				kind: z.literal('patch'),
				ops: z.array(patchOp).max(OPS_MAX, { error: `a patch holds at most ${OPS_MAX} operations` })
			}),
			z.strictObject({ kind: z.literal('merge'), doc: z.record(z.string(), z.json()) })
		])
		.optional(),
	set: z
		.strictObject(
			{
				name: z.string().trim().min(1).max(HEADING_MAX).optional(),
				goalMinor: z.int().positive().optional(),
				endDate: z.string().optional(),
				programId: z.string().min(1).optional(),
				suggestedAmounts: z.array(z.int().positive()).optional()
			},
			{
				error: (issue) =>
					issue.code === 'unrecognized_keys'
						? `a reply sets only name, goalMinor, endDate, programId and suggestedAmounts, not ${issue.keys.map((key) => `"${key}"`).join(', ')}`
						: undefined
			}
		)
		.optional()
});

/** the reply's shape as JSON Schema, for a model's JSON mode; this door checks it again whatever. */
export const REPLY_JSON_SCHEMA = z.toJSONSchema(replySchema, { io: 'input' });

/** what a page edit reaches: the page as the model reads it, `draftFromPage`'s keys. */
const DRAFT_KEYS: readonly string[] = ['layout', 'palette', 'blocks'];
/** what only a campaign has: as a reply's `set` names it, as a page edit would, and in words. */
const CAMPAIGN_ONLY = [
	{ set: 'name', page: PAGE_KEYS.name, what: 'name' },
	{ set: 'goalMinor', page: PAGE_KEYS.goalMinor, what: 'goal' },
	{ set: 'endDate', page: PAGE_KEYS.endsAt, what: 'end date' }
] as const;

export type ChatMessage = { author: 'operator' | 'assistant'; text: string };
export type ActiveProgram = { id: string; name: string };

export type AcceptInput = {
	type: PageType;
	current: Page;
	/**
	 * the campaign's name on the dashboard; null on the Donation page. a draft holding a name of its
	 * own is renamed from that one.
	 */
	name: string | null;
	/** the model's answer as it arrived. */
	reply: string;
	attached: readonly string[];
	messages: readonly ChatMessage[];
	activePrograms: readonly ActiveProgram[];
	/** the IANA zone of the browser that posted the chat turn; an end date is a day there. */
	timeZone: string;
	/** the instant the reply is accepted at; an end date on a day already over is refused. */
	now: number;
};

export type Change =
	| { field: 'name'; from: string | null; to: string }
	| { field: 'goal'; from: number | null; to: number }
	| { field: 'endDate'; from: string | null; to: string }
	| {
			field: 'program';
			from: { mode: ProgramMode; programId: string | null };
			to: { mode: 'pinned'; programId: string };
	  }
	| { field: 'amounts'; from: number[]; to: number[] };

export type Dropped =
	| { what: 'tier'; blockId: string; amountMinor: number }
	| { what: 'link'; href: string; text: string };

export type Accepted = {
	ok: true;
	draft: Page;
	say: string;
	changes: Change[];
	dropped: Dropped[];
};
export type Refused = { ok: false; reason: string; current: Page };

export function acceptReply(input: AcceptInput): Accepted | Refused {
	try {
		return accept(input);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return { ok: false, reason: `the reply could not be read: ${reason}`, current: input.current };
	}
}

function accept(input: AcceptInput): Accepted | Refused {
	const { type, current } = input;
	const refuse = (reason: string): Refused => ({ ok: false, reason, current });

	if (new TextEncoder().encode(input.reply).byteLength > REPLY_BYTES_MAX) {
		return refuse(`the reply is over ${REPLY_BYTES_MAX} bytes`);
	}
	let json: unknown;
	try {
		json = JSON.parse(input.reply);
	} catch {
		return refuse('the reply is not JSON');
	}
	if (deeperThan(json, REPLY_DEPTH_MAX)) {
		return refuse(`the reply nests deeper than ${REPLY_DEPTH_MAX}`);
	}
	const parsed = replySchema.safeParse(json);
	if (!parsed.success) return refuse(issueText(parsed.error.issues));
	const reply = parsed.data;

	let draft: unknown = draftFromPage(current);
	if (reply.page?.kind === 'patch') {
		for (const op of reply.page.ops) {
			for (const text of 'from' in op ? [op.from, op.path] : [op.path]) {
				const [key] = pointer(text) ?? [];
				if (key !== undefined && !DRAFT_KEYS.includes(key)) return refuse(outsideDraft(key));
			}
		}
		const applied = applyPatch(draft, reply.page.ops, DRAFT_BOUNDS);
		if (!applied.ok) return refuse(applied.message);
		draft = applied.doc;
	} else if (reply.page?.kind === 'merge') {
		draft = mergePatch(draft, reply.page.doc);
		const over = outOfBounds(draft, DRAFT_BOUNDS);
		if (over !== null) return refuse(over);
	}

	const outside = isRecord(draft)
		? Object.keys(draft).find((key) => !DRAFT_KEYS.includes(key))
		: undefined;
	if (outside !== undefined) return refuse(outsideDraft(outside));

	const stray = imageIdsIn(draft).find(({ id }) => !input.attached.includes(id));
	if (stray !== undefined) {
		return refuse(located(stray.path, `image "${stray.id}" was not attached in this chat`));
	}

	const set = settle(input, reply.set ?? {});
	if (!set.ok) return refuse(set.reason);

	const page = pageFromDraft(type, draft, set.onto);
	if (!page.ok) return refuse(located(page.path, page.message));
	const dropped: Dropped[] = [];
	const stated = new Set(statedFigures(input.messages));
	const held = new Set(tiersOf(current).map(tierKey));
	const blocks = page.page.blocks.map((block) => {
		if (block.type !== 'impact-tiers') return block;
		const tiers = block.tiers.filter((tier) => {
			if (stated.has(tier.amountMinor) || held.has(tierKey(tier))) return true;
			dropped.push({ what: 'tier', blockId: block.id, amountMinor: tier.amountMinor });
			return false;
		});
		return { ...block, tiers };
	});

	const goal = set.onto.goalMinor === undefined ? [] : [set.onto.goalMinor];
	const shown = new Set([...stated, ...figuresShown(current), ...goal]);
	const worded = [
		...(set.renamed === undefined ? [] : [{ where: 'set.name', texts: [set.renamed] }]),
		...blocks.map((block, index) => ({
			where: `block ${index + 1} (id "${block.id}")`,
			texts: textsIn(block)
		}))
	];
	for (const { where, texts } of worded) {
		for (const text of texts) {
			const unshown = figuresIn(text).find(({ minor }) => minor === null || !shown.has(minor));
			if (unshown === undefined) continue;
			return refuse(
				`${where}: "${unshown.written}" is not a figure the operator wrote in the chat or one the page already shows`
			);
		}
	}

	const known = new Set(hrefsIn(current));
	const unlinked = withoutLinks({ ...page.page, blocks }, (href, text) => {
		if (known.has(href)) return false;
		dropped.push({ what: 'link', href, text });
		return true;
	});
	const checked = parsePage(type, unlinked);
	if (!checked.ok) return refuse(located(checked.path, checked.message));

	return {
		ok: true,
		draft: checked.page,
		say: reply.say,
		changes: set.changes,
		dropped
	};
}

const NUMBER = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s?(k|m|thousand|million)\b)?(?![\d,.]?\d)`;
/** how many places each scale moves the point. */
const SCALES: Record<string, number> = { k: 3, thousand: 3, m: 6, million: 6 };
const FIGURES = [
	new RegExp(String.raw`(?:\bUS\$|\$|\bUSD\b)\s?${NUMBER}`, 'gi'),
	new RegExp(String.raw`(?<![\d.,$])${NUMBER}\s?(?:dollars?|USD)\b`, 'gi')
];

/** every amount an operator wrote in the chat, in minor units. */
function statedFigures(messages: readonly ChatMessage[]): number[] {
	return messages
		.filter(({ author }) => author === 'operator')
		.flatMap(({ text }) => readFigures(text));
}

/**
 * each figure `text` holds, as written and in minor units. a scaled figure finer than a cent is
 * `null`, a figure nobody can check; unscaled, it is no figure at all.
 */
function figuresIn(text: string): { written: string; minor: number | null }[] {
	return FIGURES.flatMap((pattern) => [...text.matchAll(pattern)]).flatMap(
		([written, whole = '', fraction = '', scale]) => {
			const places = scale === undefined ? 0 : (SCALES[scale.toLowerCase()] ?? 0);
			const shifted = fraction.padEnd(places, '0');
			const units = `${whole.replaceAll(',', '')}${shifted.slice(0, places)}`;
			const cents = shifted.slice(places);
			const { minor } = readAmount(cents === '' ? units : `${units}.${cents}`, FORM_CURRENCY);
			if (minor === null && scale === undefined) return [];
			return [{ written, minor }];
		}
	);
}

/** every figure in `text` a check can read, in minor units. */
function readFigures(text: string): number[] {
	return figuresIn(text).flatMap(({ minor }) => (minor === null ? [] : [minor]));
}

/** every figure the page draws: in its words, its tiers' amounts and its goal. */
function figuresShown(page: Page): number[] {
	return [
		...page.blocks.flatMap(textsIn).flatMap(readFigures),
		...tiersOf(page).map(({ amountMinor }) => amountMinor),
		...(page.goalMinor === undefined ? [] : [page.goalMinor])
	];
}

type Tier = { amountMinor: number; buys: string };

function tiersOf(page: Page): Tier[] {
	return page.blocks.flatMap((block) => (block.type === 'impact-tiers' ? block.tiers : []));
}

function tierKey({ amountMinor, buys }: Tier) {
	return JSON.stringify([amountMinor, buys]);
}

/** keys whose strings a donor never reads as words. */
const NOT_WORDS: readonly string[] = ['id', 'type', 'variant', 'background', 'href', 'imageId'];

/** the words a block draws: each plain string, and each rich-text paragraph as one line. */
function textsIn(value: unknown): string[] {
	if (Array.isArray(value)) return value.flatMap(textsIn);
	if (!isRecord(value)) return [];
	if (value.type === 'paragraph') {
		const content = Array.isArray(value.content) ? value.content : [];
		return [content.map((node) => (isRecord(node) ? String(node.text ?? '') : '')).join('')];
	}
	return Object.entries(value).flatMap(([key, item]) =>
		NOT_WORDS.includes(key) ? [] : typeof item === 'string' ? [item] : textsIn(item)
	);
}

type Settable = NonNullable<z.infer<typeof replySchema>['set']>;

/** `current` with what the reply sets put onto it, and each change it makes. */
function settle(
	{ type, current, name, activePrograms, timeZone, now }: AcceptInput,
	set: Settable
):
	| { ok: true; onto: Page; renamed: string | undefined; changes: Change[] }
	| { ok: false; reason: string } {
	if (type === 'donation_page') {
		for (const { set: key, what } of CAMPAIGN_ONLY) {
			if (set[key] !== undefined) {
				return { ok: false, reason: `the Donation page has no ${what}; only a campaign does` };
			}
		}
	}
	const onto: Page = { ...current };
	const changes: Change[] = [];
	const named = current.name ?? name;
	const renamed = set.name !== undefined && set.name !== named ? set.name : undefined;
	if (renamed !== undefined) {
		changes.push({ field: 'name', from: named, to: renamed });
		onto.name = renamed;
	}
	if (set.goalMinor !== undefined && set.goalMinor !== current.goalMinor) {
		changes.push({ field: 'goal', from: current.goalMinor ?? null, to: set.goalMinor });
		onto.goalMinor = set.goalMinor;
	}
	const endedOn = current.endsAt === undefined ? null : dayOf(current.endsAt, timeZone);
	if (set.endDate !== undefined && set.endDate !== endedOn) {
		const end = endOfDay({ day: set.endDate, timeZone, now });
		if (!end.ok) return { ok: false, reason: `set.endDate: ${end.reason}` };
		changes.push({ field: 'endDate', from: endedOn, to: set.endDate });
		onto.endsAt = end.endsAt;
		onto.endsZone = timeZone;
	}
	if (set.programId === undefined && set.suggestedAmounts === undefined) {
		return { ok: true, onto, renamed, changes };
	}

	let settings = current.settings;
	if (settings === undefined) {
		return { ok: false, reason: 'set: this page’s draft holds no donation settings to change' };
	}
	if (set.programId !== undefined) {
		const { programId } = set;
		if (!activePrograms.some(({ id }) => id === programId)) {
			const active = activePrograms.map(({ id, name }) => `${id} (${name})`);
			return {
				ok: false,
				reason: `set.programId: "${programId}" is not an active program; ${active.length === 0 ? 'none is active' : `the active ones are ${listed(active)}`}`
			};
		}
		const { programMode: mode } = settings;
		if (type === 'donation_page' && mode === 'choice') {
			return {
				ok: false,
				reason:
					'set.programId: the Donation page lets each donor choose a program, and a reply cannot pin it to one'
			};
		}
		if (mode !== 'pinned' || settings.programId !== programId) {
			const from = { mode, programId: mode === 'pinned' ? settings.programId : null };
			changes.push({ field: 'program', from, to: { mode: 'pinned', programId } });
			settings = { ...settings, programMode: 'pinned', programId };
		}
	}
	if (set.suggestedAmounts !== undefined) {
		const rows = set.suggestedAmounts.map((amount) => majorEntry(amount, FORM_CURRENCY));
		const read = readSuggestedAmounts(rows, settings.minMinor, settings.maxMinor);
		if (read.problem !== null) {
			return { ok: false, reason: `set.suggestedAmounts: a page suggests ${read.problem}` };
		}
		const [first] = read.problems;
		if (first !== undefined) {
			const amount = formatMinorBrief(set.suggestedAmounts[first.row] ?? 0, FORM_CURRENCY);
			return { ok: false, reason: `set.suggestedAmounts: ${amount} ${first.problem}` };
		}
		if (!sameList(read.amounts, settings.suggestedAmounts)) {
			changes.push({ field: 'amounts', from: settings.suggestedAmounts, to: read.amounts });
			settings = { ...settings, suggestedAmounts: read.amounts };
		}
	}
	onto.settings = settings;
	return { ok: true, onto, renamed, changes };
}

function sameList(a: readonly number[], b: readonly number[]) {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

function listed(names: readonly string[]) {
	return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function issueText(issues: readonly z.core.$ZodIssue[]) {
	const [issue] = issues;
	if (issue === undefined) return 'the reply is off its schema';
	return located(
		issue.path.filter((key) => typeof key !== 'symbol'),
		issue.message
	);
}

/** a refusal prefixed with where it lands, as dotted keys and indexes from the document's root. */
function located(path: readonly (string | number)[], message: string) {
	return path.length === 0 ? message : `${path.join('.')}: ${message}`;
}

function outsideDraft(key: string) {
	const field = CAMPAIGN_ONLY.find(({ page }) => page === key);
	const through =
		field === undefined ? '' : `; a campaign’s ${field.what} goes through set.${field.set}`;
	return `a page edit reaches layout, palette and blocks only, not "${key}"${through}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type LinkMark = { type: 'link'; attrs: { href: string } };

function isLinkMark(mark: unknown): mark is LinkMark {
	return (
		isRecord(mark) &&
		mark.type === 'link' &&
		isRecord(mark.attrs) &&
		typeof mark.attrs.href === 'string'
	);
}

/** every link's address anywhere in `value`: a link mark on rich text, wherever a block holds it. */
function hrefsIn(value: unknown): string[] {
	if (Array.isArray(value)) return value.flatMap(hrefsIn);
	if (!isRecord(value)) return [];
	const own = Array.isArray(value.marks)
		? value.marks.filter(isLinkMark).map(({ attrs }) => attrs.href)
		: [];
	return [...own, ...Object.values(value).flatMap(hrefsIn)];
}

/** `value` with each link mark `strip` answers true for taken off its text, the text kept. */
function withoutLinks(value: unknown, strip: (href: string, text: string) => boolean): unknown {
	if (Array.isArray(value)) return value.map((item) => withoutLinks(item, strip));
	if (!isRecord(value)) return value;
	const copy = Object.fromEntries(
		Object.entries(value).map(([key, item]) => [key, withoutLinks(item, strip)])
	);
	if (!Array.isArray(copy.marks)) return copy;
	const text = typeof copy.text === 'string' ? copy.text : '';
	const marks = copy.marks.filter((mark) => !(isLinkMark(mark) && strip(mark.attrs.href, text)));
	return { ...copy, marks };
}

/** every `imageId` anywhere in `value`, whichever block carries it, with where it sits. */
function imageIdsIn(
	value: unknown,
	path: (string | number)[] = []
): { id: string; path: (string | number)[] }[] {
	if (Array.isArray(value))
		return value.flatMap((item, index) => imageIdsIn(item, [...path, index]));
	if (!isRecord(value)) return [];
	return Object.entries(value).flatMap(([key, item]) =>
		key === 'imageId' && typeof item === 'string'
			? [{ id: item, path: [...path, key] }]
			: imageIdsIn(item, [...path, key])
	);
}
