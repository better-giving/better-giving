import { eq } from 'drizzle-orm';
import { FORM_CURRENCY, majorText } from '../../forms/amounts';
import type { FormInputField, FormInputFieldErrors, FormInputValues } from '../../forms/fields';
import { NEW_FORM } from '../../forms/new-form';
import { unlistedSiteProblem, unlistedSites } from '../../forms/input-schema';
import type { ProgramMode } from '../../forms/program-modes';
import type { Db } from '../db/client';
import { page } from '../db/schema';
import {
	formInputValuesFrom,
	parseFormGiving,
	parseFormInput,
	parseFormName,
	parseFormOrigins,
	parseFormProgram
} from '../forms/form-input';
import {
	createForm,
	type ProgramSave,
	readForm,
	readForms,
	type StoredForm,
	updateFormGiving,
	updateFormName,
	updateFormOrigins,
	updateFormProgram
} from '../forms/queries';
import { identityMissing } from '../org/identity';
import { readOrgProfile } from '../org/queries';
import { readSites } from '../sites/queries';
import type { Refused } from './campaigns';

// the form actions of `/connector/v1`: the dashboard's Forms screens in the contract's terms. a
// body is translated into the boxes those screens submit (`FormInputValues`, ../../forms/fields.ts)
// and handed to the same parsers and writes — `parseFormInput` and the group parsers in
// ../forms/form-input.ts, `createForm` and the group writes in ../forms/queries.ts — so a form the
// connector makes or changes meets every rule a hand edit does, and the refusals come back keyed to
// the wire's field names rather than the boxes'. an update donors would see at once also takes
// `confirm: true` (`updateConnectorForm`).

type Money = { readonly amount: string; readonly currency: string };

/** a form as `forms.list`, `forms.get` and every write answer it. */
export type ConnectorForm = {
	readonly id: string;
	readonly name: string;
	readonly status: 'draft' | 'live';
	readonly suggested_amounts: readonly Money[];
	readonly minimum: Money | null;
	readonly maximum: Money | null;
	readonly allowed_origins: readonly string[];
	readonly gifts_go_to: { readonly mode: ProgramMode; readonly program_id: string | null };
	readonly campaign_id: string | null;
	readonly updated_at: string;
};

type Done = { readonly ok: true; readonly form: ConnectorForm };

const money = (minor: number, currency: string): Money => ({
	amount: majorText(minor, currency),
	currency
});

function wireOf(record: StoredForm, campaignId: string | null): ConnectorForm {
	return {
		id: record.id,
		name: record.name,
		// an archived row never reaches here: `readConnectorForm` answers it as not found.
		status: record.status === 'live' ? 'live' : 'draft',
		suggested_amounts: record.suggestedAmounts.map((minor) => money(minor, record.currency)),
		minimum: record.minMinor === null ? null : money(record.minMinor, record.currency),
		maximum: record.maxMinor === null ? null : money(record.maxMinor, record.currency),
		allowed_origins: record.allowedOrigins,
		gifts_go_to: { mode: record.programMode, program_id: record.programId },
		campaign_id: campaignId,
		updated_at: record.updatedAt.toISOString()
	};
}

/** the page whose donation settings form `id` is, or `null` for one of the Forms screens'. */
async function owner(db: Db, id: string) {
	const [row] = await db
		.select({ id: page.id, type: page.type, name: page.name })
		.from(page)
		.where(eq(page.formId, id))
		.limit(1);
	return row ?? null;
}

/** form `id` as the wire answers it, or `null` where there is none or it is archived. */
export async function readConnectorForm(db: Db, id: string): Promise<ConnectorForm | null> {
	const record = await readForm(db, id);
	if (record === null || record.status === 'archived') return null;
	const owned = await owner(db, id);
	return wireOf(record, owned?.type === 'campaign' ? owned.id : null);
}

/**
 * the forms the dashboard's Forms list shows, oldest first, from `from` for `limit`; and whether
 * any follow. a page's own row is not one of them (`readForms`), so `campaign_id` is null on each.
 */
export async function listConnectorForms(
	db: Db,
	from: number,
	limit: number
): Promise<{ data: ConnectorForm[]; more: boolean }> {
	const listed = await readForms(db);
	const records = await Promise.all(
		listed.slice(from, from + limit).map((row) => readForm(db, row.id))
	);
	return {
		data: records.flatMap((record) => (record === null ? [] : [wireOf(record, null)])),
		more: from + limit < listed.length
	};
}

/** the wire name each box's refusal is answered at. */
const WIRE_PATH: Record<FormInputField, string> = {
	name: 'name',
	status: 'status',
	suggested_amounts: 'suggested_amounts',
	min_minor: 'minimum.amount',
	max_minor: 'maximum.amount',
	allowed_origins: 'allowed_origins',
	program_mode: 'gifts_go_to.mode',
	program_id: 'gifts_go_to.program_id'
};

type Issue = { readonly path: string; readonly message: string };

function refusedFields(what: string, issues: readonly Issue[]): Refused {
	return {
		ok: false,
		status: 422,
		code: 'invalid',
		detail: `${what} was refused: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}. Nothing was changed.`,
		errors: issues
	};
}

const issuesOf = (errors: FormInputFieldErrors): Issue[] =>
	Object.entries(errors).map(([field, message]) => ({
		path: WIRE_PATH[field as FormInputField],
		message
	}));

const MONEY_IS = `is { "amount": "<decimal>", "currency": "${FORM_CURRENCY}" }`;

/** a wire amount as the box it is typed into, or the issue it is refused with. */
function amountBox(value: unknown, path: string): string | Issue {
	if (typeof value !== 'object' || value === null) return { path, message: MONEY_IS };
	const { amount, currency } = value as { amount?: unknown; currency?: unknown };
	if ((currency ?? FORM_CURRENCY) !== FORM_CURRENCY)
		return {
			path: `${path}.currency`,
			message: `is ${FORM_CURRENCY}, the one currency a form takes`
		};
	if (typeof amount !== 'string')
		return { path: `${path}.amount`, message: 'is a decimal string, such as "25.00"' };
	return amount;
}

const WRITABLE = [
	'name',
	'status',
	'suggested_amounts',
	'minimum',
	'maximum',
	'allowed_origins',
	'gifts_go_to'
] as const;

/** the groups the dashboard's editor saves one at a time, by the wire fields each holds. */
type FormGroup = 'name' | 'giving' | 'origins' | 'program';

/**
 * a wire body as the boxes it fills, laid over `base`, with the groups it touches; or every issue
 * with its shape. the rules about what the values may be are the parsers', not this.
 */
function boxesFrom(
	body: unknown,
	base: FormInputValues
): { values: FormInputValues; groups: Set<FormGroup> } | { issues: Issue[] } {
	if (typeof body !== 'object' || body === null || Array.isArray(body))
		return { issues: [{ path: '', message: 'the body is a JSON object' }] };
	const input = body as Record<string, unknown>;
	const issues: Issue[] = [];
	const values: Record<string, unknown> = { ...base };
	const groups = new Set<FormGroup>();
	for (const key of Object.keys(input)) {
		if (key !== 'confirm' && !(WRITABLE as readonly string[]).includes(key))
			issues.push({
				path: key,
				message: `is not a field a form takes; the fields are ${WRITABLE.join(', ')}`
			});
	}
	const text = (key: 'name' | 'status', group: FormGroup) => {
		const value = input[key];
		if (value === undefined) return;
		groups.add(group);
		if (typeof value === 'string') values[key] = value;
		else issues.push({ path: key, message: 'is a string' });
	};
	text('name', 'name');
	text('status', 'name');
	for (const [key, box] of [
		['minimum', 'min_minor'],
		['maximum', 'max_minor']
	] as const) {
		if (input[key] === undefined) continue;
		groups.add('giving');
		const read = amountBox(input[key], key);
		if (typeof read === 'string') values[box] = read;
		else issues.push(read);
	}
	if (input.suggested_amounts !== undefined) {
		groups.add('giving');
		if (!Array.isArray(input.suggested_amounts))
			issues.push({ path: 'suggested_amounts', message: `is a list, each one ${MONEY_IS}` });
		else {
			const rows = input.suggested_amounts.map((row, at) =>
				amountBox(row, `suggested_amounts.${at}`)
			);
			const bad = rows.filter((row): row is Issue => typeof row !== 'string');
			if (bad.length > 0) issues.push(...bad);
			else values.suggested_amounts = rows;
		}
	}
	if (input.allowed_origins !== undefined) {
		groups.add('origins');
		const origins = input.allowed_origins;
		if (Array.isArray(origins) && origins.every((origin) => typeof origin === 'string'))
			values.allowed_origins = origins;
		else
			issues.push({
				path: 'allowed_origins',
				message: 'is a list of site addresses, such as "https://www.example.org"'
			});
	}
	if (input.gifts_go_to !== undefined) {
		groups.add('program');
		const goTo = input.gifts_go_to;
		const { mode, program_id } =
			typeof goTo === 'object' && goTo !== null
				? (goTo as { mode?: unknown; program_id?: unknown })
				: {};
		if (typeof mode !== 'string')
			issues.push({ path: 'gifts_go_to.mode', message: 'is one of none, pinned, choice' });
		else values.program_mode = mode;
		if (program_id !== undefined && program_id !== null && typeof program_id !== 'string')
			issues.push({ path: 'gifts_go_to.program_id', message: 'is a program id, or null' });
		else values.program_id = typeof program_id === 'string' ? program_id : '';
	}
	return issues.length > 0 ? { issues } : { values: values as FormInputValues, groups };
}

const NO_SUCH_PROGRAM: Issue = {
	path: 'gifts_go_to.program_id',
	message: 'is not a program this deployment still offers; ask the operator which program to use'
};

/** the issue a list naming a site this deployment does not list is refused with, or `null`. */
async function unlistedIssue(db: Db, origins: readonly string[]): Promise<Issue | null> {
	const problem = unlistedSiteProblem(unlistedSites(origins, await readSites(db)));
	return problem === null
		? null
		: {
				path: 'allowed_origins',
				message: `${problem} Sites are listed by the operator in the console.`
			};
}

/** whether the organisation's details stand between this deployment and a serving form. */
async function blocked(db: Db): Promise<boolean> {
	return identityMissing(await readOrgProfile(db)).length > 0;
}

const NOT_READY =
	'the organisation’s details are not finished, and a form serves no donor until they are; the operator fills them in on the console';

/**
 * makes a form, through the rules and the defaults of the dashboard's Add a donation form: what the
 * body leaves out is what that screen opens on (`NEW_FORM`).
 */
export async function createConnectorForm(db: Db, body: unknown): Promise<Done | Refused> {
	const boxes = boxesFrom(body, NEW_FORM);
	if ('issues' in boxes) return refusedFields('The form', boxes.issues);
	const parsed = parseFormInput(boxes.values);
	if (!parsed.ok) return refusedFields('The form', issuesOf(parsed.errors));
	if (await blocked(db))
		return {
			ok: false,
			status: 409,
			code: 'not_ready',
			detail: `No form was made: ${NOT_READY}.`
		};
	const unlisted = await unlistedIssue(db, parsed.value.allowedOrigins);
	if (unlisted !== null) return refusedFields('The form', [unlisted]);
	const record = await createForm(db, parsed.value);
	if (record === null) return refusedFields('The form', [NO_SUCH_PROGRAM]);
	return { ok: true, form: wireOf(record, null) };
}

/** the columns a group write sets, as the parsed group carries them. */
type Settings = Pick<
	StoredForm,
	| 'name'
	| 'status'
	| 'suggestedAmounts'
	| 'minMinor'
	| 'maxMinor'
	| 'allowedOrigins'
	| 'programMode'
	| 'programId'
>;

const settingsOf = (record: Settings): string =>
	JSON.stringify([
		record.name,
		record.status,
		record.suggestedAmounts,
		record.minMinor,
		record.maxMinor,
		record.allowedOrigins,
		record.programMode,
		record.programId
	]);

/** one group's save, ready to run against the version the form was read at. */
type GroupWrite = {
	readonly fields: string;
	readonly columns: Partial<Settings>;
	readonly run: (version: Date) => Promise<ProgramSave>;
};

/**
 * whether an edit changes what an embed already pasted serves at once: any field but `name` on a
 * live form, or `status: 'live'` on any. a form has no draft, and its name reaches no donor — the
 * served config carries none, and only the staff notice, Zapier and `/integrations/v1` do.
 */
function reachesDonors(stored: StoredForm, body: Record<string, unknown>): boolean {
	if (body.status === 'live') return true;
	return (
		stored.status === 'live' &&
		WRITABLE.some((field) => field !== 'name' && body[field] !== undefined)
	);
}

/** the refusal of an edit `reachesDonors` names, sent without `confirm: true`. */
function unconfirmed(stored: StoredForm): Refused {
	const where =
		stored.status === 'live'
			? 'This form is live, so the edit reaches every site already embedding it'
			: 'This edit sets the form live, so it starts serving on every site already embedding it';
	return {
		ok: false,
		status: 422,
		code: 'invalid',
		detail: `Nothing was changed: ${where} at once, with no Publish step. First ask the operator, saying so, and send the edit again with confirm set to true only once they agree.`,
		errors: [
			{
				path: 'confirm',
				message:
					'is true, sent once the operator has agreed to an edit donors see on the sites embedding this form'
			}
		]
	};
}

/**
 * changes the fields the body names, through the dashboard's group writes and their parsers. a
 * field left out keeps what is stored, and a group is saved whole from the stored values with the
 * body's laid over them, as the editor saves it.
 *
 * an edit donors would see at once (`reachesDonors`) is refused unless the body holds
 * `confirm: true`, the JSON boolean, which the chat sends only once the operator has said yes.
 * `confirm` is no field of the form: elsewhere it is ignored, and it alone names nothing to change.
 *
 * every group the body touches is checked before any is written, so a refusal changes nothing.
 * the writes then run one group at a time, each guarded on the version the form was read at just
 * before — the gifts first, so the one refusal only a write can make (a program retired since)
 * lands before anything is saved, and the name and status last, so a form goes live only once
 * everything else in the body has. a write that loses a race after an earlier one saved answers
 * 409 naming what was saved.
 */
export async function updateConnectorForm(
	db: Db,
	id: string,
	body: unknown
): Promise<Done | Refused> {
	const record = await readForm(db, id);
	if (record === null || record.status === 'archived') return missing(id);
	const owned = await owner(db, id);
	if (owned !== null) return pageOwned(id, owned, []);

	const boxes = boxesFrom(body, formInputValuesFrom(record));
	if ('issues' in boxes) return refusedFields('The edit', boxes.issues);
	const { values, groups } = boxes;
	if (groups.size === 0)
		return refusedFields('The edit', [
			{ path: '', message: `names no field to change; the fields are ${WRITABLE.join(', ')}` }
		]);

	const issues: Issue[] = [];
	const writes: GroupWrite[] = [];
	if (groups.has('program')) {
		const parsed = parseFormProgram(values);
		if (!parsed.ok) issues.push(...issuesOf(parsed.errors));
		else
			writes.push({
				fields: 'gifts_go_to',
				columns: parsed.value,
				run: (version) => updateFormProgram(db, id, version, parsed.value)
			});
	}
	if (groups.has('giving')) {
		const parsed = parseFormGiving(values);
		if (!parsed.ok) issues.push(...issuesOf(parsed.errors));
		else
			writes.push({
				fields: 'suggested_amounts, minimum and maximum',
				columns: { ...parsed.value, suggestedAmounts: [...parsed.value.suggestedAmounts] },
				run: (version) => updateFormGiving(db, id, version, parsed.value)
			});
	}
	if (groups.has('origins')) {
		const parsed = parseFormOrigins(values);
		if (!parsed.ok) issues.push(...issuesOf(parsed.errors));
		else {
			const unlisted = await unlistedIssue(db, parsed.value.allowedOrigins);
			if (unlisted !== null) issues.push(unlisted);
			writes.push({
				fields: 'allowed_origins',
				columns: { allowedOrigins: [...parsed.value.allowedOrigins] },
				run: (version) => updateFormOrigins(db, id, version, parsed.value)
			});
		}
	}
	if (groups.has('name')) {
		const parsed = parseFormName(values);
		if (!parsed.ok) issues.push(...issuesOf(parsed.errors));
		else {
			// the editor's one refusal no box states: Live while the organisation's details stand.
			if (parsed.value.status === 'live' && (await blocked(db)))
				issues.push({ path: 'status', message: `cannot be live yet: ${NOT_READY}` });
			writes.push({
				fields: 'name and status',
				columns: parsed.value,
				run: (version) => updateFormName(db, id, version, parsed.value)
			});
		}
	}
	if (issues.length > 0) return refusedFields('The edit', issues);
	const edit = body as Record<string, unknown>;
	if (reachesDonors(record, edit) && edit.confirm !== true) return unconfirmed(record);

	let version = record.updatedAt;
	let expected: Settings = record;
	const saved: string[] = [];
	for (const [at, write] of writes.entries()) {
		const outcome = await write.run(version);
		if (typeof outcome === 'object') return pageOwned(id, outcome.ownedBy, saved);
		if (outcome === 'unknown_program') return refusedFields('The edit', [NO_SUCH_PROGRAM]);
		if (outcome === 'gone' && saved.length === 0) return missing(id);
		if (outcome !== 'saved') return changed(saved, writes.slice(at));
		saved.push(write.fields);
		expected = { ...expected, ...write.columns };
		const now = await readForm(db, id);
		if (now === null) return changed(saved, writes.slice(at + 1));
		// another write landing between this save and the read gets its version adopted unless the
		// read is compared too: anything stored but what this edit wrote means it raced one.
		if (at < writes.length - 1 && settingsOf(now) !== settingsOf(expected))
			return changed(saved, writes.slice(at + 1));
		version = now.updatedAt;
	}
	const answered = await readConnectorForm(db, id);
	if (answered === null) return changed(saved, []);
	return { ok: true, form: answered };
}

function missing(id: string): Refused {
	return {
		ok: false,
		status: 404,
		code: 'not_found',
		detail: `Form ${id} does not exist on this deployment, or was archived in the dashboard. List the forms with forms.list.`
	};
}

/** the 409 for an edit that lost to another write, naming what of it was saved and what was not. */
function changed(saved: readonly string[], unsaved: readonly GroupWrite[]): Refused {
	const told =
		saved.length === 0
			? 'Nothing was changed.'
			: `Saved: ${saved.join('; ')}.${unsaved.length === 0 ? '' : ` Not saved: ${unsaved.map((w) => w.fields).join('; ')}.`}`;
	return {
		ok: false,
		status: 409,
		code: 'conflict',
		detail: `The form changed while this edit was being saved, probably in the dashboard. ${told} Read it again with forms.get and redo what was not saved.`
	};
}

/** the 409 for a form that is a page's donation settings, which that page's editor changes. */
function pageOwned(
	id: string,
	page: { readonly type: string; readonly name?: string | null },
	saved: readonly string[]
): Refused {
	const whose =
		page.type === 'campaign' ? `the campaign “${page.name ?? ''}”` : 'the donation page';
	const told = saved.length === 0 ? 'Nothing was changed' : `Only ${saved.join('; ')} was saved`;
	return {
		ok: false,
		status: 409,
		code: 'page_owned',
		detail: `${told}: form ${id} holds the donation settings of ${whose}, and those are changed with ${page.type === 'campaign' ? 'that campaign' : 'the donation page'}, in its editor in the dashboard, rather than as a form.`
	};
}
