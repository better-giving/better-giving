import { Modal } from '@better-giving/operator/behaviour/Dialog';
import { Button } from '@better-giving/operator/components/controls/Button';
import { Banner } from '@better-giving/operator/components/status/Banner';
import { CheckboxGroup } from '@better-giving/operator/components/forms/CheckboxGroup';
import { ChoiceChips } from '@better-giving/operator/components/forms/ChoiceChips';
import { DateField } from '@better-giving/operator/components/forms/DateField';
import { Field } from '@better-giving/operator/components/forms/Field';
import { FieldMessage } from '@better-giving/operator/components/forms/FieldMessage';
import { type Resized, resizeImage } from '@better-giving/operator/images/resize';
import { type DragEvent, useEffect, useId, useRef, useState } from 'react';
import { getFormProps } from '@conform-to/react';
import { useFetcher, useSubmit } from 'react-router';
import { FormGivingFields } from '../forms/giving-fields';
import { FormProgramFields } from '../forms/program-fields';
import { type AdminActionData, useAdminForm } from '../use-admin-form';
import { readAmount } from '$lib/forms/amounts';
import { defineForm } from '$lib/forms/definition';
import {
	AMOUNT_LABEL_MAX,
	CAMPAIGN_AMOUNTS_MAX,
	CAMPAIGN_GENERAL_INPUT,
	CAMPAIGN_GOAL_INPUT,
	CAMPAIGN_MEDIA_INPUT,
	CAMPAIGN_SETTINGS_INPUT,
	type CampaignGeneralSeed,
	type CampaignGoalSeed,
	type CampaignMediaSeed,
	type CampaignSettingsSeed,
	EDIT_BOXES,
	EDIT_FORMS,
	type GoalMode,
	type PlacedPhoto,
	STORY_MAX
} from '$lib/page/edit-forms';
import { SHARE_MESSAGE_MAX } from '$lib/page/catalog';
import { imageSrc } from '$lib/page/image-src';
import { SWITCH_LABELS } from '$lib/page/settings-form';
import { plainText, type RichTextDocument } from '$lib/rich-text/document';
import { RichTextEditor } from '../rich-text/rich-text-editor';
import { AffixedField } from './affixed-field';
import { amountsChanged, programChanged, storyKey, textsChanged, ticksChanged } from './changed';
import { MoneyField } from './money-field';
import { postPhoto, type UploadAnswer } from './photo-upload';
import { ReplacePhotoControl, replaceRefusal } from './replace-photo';
import { SectionCard, useScreenAnswer, useSeeded } from './section-card';

// a campaign's four section cards on its edit screen (../../../routes/_app.admin.campaigns.$pageId.tsx),
// in the order the screen draws them: General, Media, Goal and amounts, Settings. each posts its
// own form ($lib/page/edit-forms.ts) and its Save writes the draft alone, but General's name and
// link, which move at once ($lib/server/pages/section-saves.ts).
//
// the cards whose boxes a script writes — the description, the photos, the amount rows — hold what
// is typed in state seeded from the loader (`useSeeded`), and say whether they hold a change by
// comparing that state with the seed as the save stores it (./changed.ts). Settings' boxes are
// plain, and conform's own reading of them is compared the same way.

const GENERAL = defineForm({ id: EDIT_FORMS.campaignGeneral, schema: CAMPAIGN_GENERAL_INPUT });
const MEDIA = defineForm({ id: EDIT_FORMS.campaignMedia, schema: CAMPAIGN_MEDIA_INPUT });
const GOAL = defineForm({ id: EDIT_FORMS.campaignGoal, schema: CAMPAIGN_GOAL_INPUT });
const SETTINGS = defineForm({ id: EDIT_FORMS.campaignSettings, schema: CAMPAIGN_SETTINGS_INPUT });

/** the question General's save came back with instead of a write. */
type Question =
	| { readonly kind: 'move'; readonly from: string; readonly to: string }
	| { readonly kind: 'takeover'; readonly holder: string; readonly to: string };

function questionIn(answer: AdminActionData): Question | null {
	const ask = answer?.ask;
	if (typeof ask !== 'object' || ask === null || !('kind' in ask)) return null;
	return ask as Question;
}

/** the first message under `name` in a form's errors. */
function firstError(errors: Record<string, string[] | undefined> | undefined, name: string) {
	const said = errors?.[name]?.[0];
	return said === undefined ? undefined : said;
}

type CardProps<Seed> = { readonly seed: Seed; readonly version: number };

/** "n/max" under a box, read with it. */
function Counter({ id, count, max }: { id: string; count: number; max: number }) {
	return (
		<p className="adm-hint adm-num" id={id}>
			{count.toLocaleString('en-US')}/{max.toLocaleString('en-US')}
		</p>
	);
}

/**
 * General: the name, the campaign link and the description. a link that would stop a published
 * campaign's address working, or take an ended campaign's, comes back as a question; yes posts the
 * card again with that question answered.
 */
export function GeneralCard({
	seed,
	version,
	host
}: CardProps<CampaignGeneralSeed> & {
	/** the site address the link is affixed to — `example.org/`. */
	readonly host: string;
}) {
	const id = useId();
	const answer = useScreenAnswer();
	const [form, fields] = useAdminForm(GENERAL, answer, { defaultValue: { ...seed.boxes } });
	const [name, setName] = useSeeded(seed.boxes.name, () => seed.boxes.name);
	const [slug, setSlug] = useSeeded(seed.boxes.slug, () => seed.boxes.slug);
	const [story, setStory] = useSeeded<RichTextDocument>(seed.story, () => seed.story);
	const [question, setQuestion] = useState<Question | null>(null);
	const [answered, setAnswered] = useState(answer);
	if (answered !== answer) {
		setAnswered(answer);
		setQuestion(questionIn(answer));
	}
	const submit = useSubmit();

	const changed =
		name.trim() !== seed.boxes.name ||
		slug.trim().toLowerCase() !== seed.boxes.slug ||
		storyKey(story) !== storyKey(seed.story);

	/** the card posted again with `kind` answered yes. */
	const yes = (kind: Question['kind']) => {
		const element = document.forms.namedItem(GENERAL.id);
		if (element === null) return;
		const body = new FormData(element);
		body.set(kind, 'on');
		if (kind === 'takeover' && question?.kind === 'takeover') body.set(EDIT_BOXES.move, 'on');
		setQuestion(null);
		submit(body, { method: 'post' });
	};
	const no = () => setQuestion(null);

	const storyHintId = `${id}-story-count`;
	return (
		<SectionCard
			form={getFormProps(form)}
			title="General"
			saveName="general"
			version={version}
			changed={changed}
		>
			<Field
				id={fields.name.id}
				name={fields.name.name}
				label="Name"
				value={name}
				onChange={(event) => setName(event.currentTarget.value)}
				error={firstError(form.allErrors, fields.name.name)}
			/>
			<AffixedField
				id={fields.slug.id}
				name={fields.slug.name}
				label="Campaign link"
				hint="Links you’ve already shared stop working once you publish a new one."
				affix={host}
				affixAt="start"
				value={slug}
				onValueChange={setSlug}
				error={firstError(form.allErrors, fields.slug.name)}
			/>
			<div className="adm-stack adm-stack--tight">
				<RichTextEditor
					id={fields.story.id}
					name={fields.story.name}
					label="Description"
					defaultValue={seed.story}
					onChange={setStory}
					describedBy={storyHintId}
					error={firstError(form.allErrors, fields.story.name)}
				/>
				<Counter id={storyHintId} count={plainText(story).length} max={STORY_MAX} />
			</div>
			{question?.kind === 'move' ? (
				<Modal
					title={`Change the link to ${question.to}?`}
					danger="Change link"
					dangerProps={{ type: 'button', onClick: () => yes('move') }}
					cancel="Cancel"
					cancelProps={{ type: 'button', onClick: no }}
					onDismiss={no}
				>
					<p>
						Once you publish, <code className="adm-chip">{question.from}</code> stops working, and
						links already shared to it will find nothing.
					</p>
				</Modal>
			) : null}
			{question?.kind === 'takeover' ? (
				<Modal
					title={`Use ${question.to} here?`}
					commit="Use it here"
					commitProps={{ type: 'button', onClick: () => yes('takeover') }}
					cancel="Cancel"
					cancelProps={{ type: 'button', onClick: no }}
					onDismiss={no}
				>
					<p>
						This link now shows that {question.holder} has ended. Once you publish, it is this
						campaign’s, and {question.holder} is left with no link.
					</p>
				</Modal>
			) : null}
		</SectionCard>
	);
}

/**
 * a photo slot's upload: the photo it holds now, whether one is on its way — resizing, from a pick
 * or a drop, then uploading — and why one was not. only the latest pick or drop is reported.
 */
function usePhotoSlot(seeded: PlacedPhoto | null, seedKey: unknown) {
	const upload = useFetcher<UploadAnswer>();
	const [photo, setPhoto] = useSeeded<PlacedPhoto | null>(seedKey, () => seeded);
	const [refused, setRefused] = useState<string | null>(null);
	const [resizing, setResizing] = useState(false);
	const latest = useRef<File | null>(null);
	const [landed, setLanded] = useState(upload.data);
	if (upload.data !== landed) {
		setLanded(upload.data);
		if (upload.data !== undefined && 'error' in upload.data) {
			setRefused(
				upload.data.reason === 'failed'
					? 'The photo didn’t upload. Choose it again.'
					: upload.data.error
			);
		} else if (upload.data !== undefined) {
			setPhoto({ imageId: upload.data.id, src: imageSrc(upload.data.id) });
		}
	}
	const uploading = upload.state !== 'idle';
	const resized = (result: Resized) => {
		setResizing(false);
		if (!result.ok) {
			setRefused(replaceRefusal(result.reason));
			return;
		}
		setRefused(null);
		postPhoto(upload, result.blob);
	};
	return {
		photo,
		/** a photo is resizing or uploading, and the card waits on it. */
		busy: resizing || uploading,
		state: resizing
			? ('resizing' as const)
			: uploading
				? ('uploading' as const)
				: refused === null
					? undefined
					: { refused },
		/** a pick through Replace, which the control resizes and hands to `resized`. */
		picked: () => {
			latest.current = null;
			setRefused(null);
			setResizing(true);
		},
		resized,
		/** a file dropped on the slot, resized and posted as a picked one is. */
		dropped: async (file: File) => {
			latest.current = file;
			setRefused(null);
			setResizing(true);
			const result = await resizeImage(file);
			if (latest.current === file) resized(result);
		},
		reset: () => {
			setRefused(null);
			setPhoto(seeded);
		}
	};
}

type Slot = ReturnType<typeof usePhotoSlot>;

/** one of Media's two photos: the drop area, Replace, and Reset back to the saved one. */
function PhotoSlot({
	legend,
	hint,
	slot,
	saved,
	frame,
	noun,
	error
}: {
	readonly legend: 'Banner' | 'Logo';
	readonly hint: string;
	readonly slot: Slot;
	readonly saved: PlacedPhoto | null;
	readonly frame: 'banner' | 'logo';
	readonly noun: 'photo' | 'logo';
	readonly error: string | undefined;
}) {
	const hintId = useId();
	const [over, setOver] = useState(false);
	const undoable = (slot.photo?.imageId ?? '') !== (saved?.imageId ?? '');
	const drop = (event: DragEvent<HTMLFieldSetElement>) => {
		event.preventDefault();
		setOver(false);
		const file = event.dataTransfer.files[0];
		if (file !== undefined && !slot.busy) void slot.dropped(file);
	};
	return (
		<fieldset
			className={
				over && !slot.busy ? 'adm-fieldset adm-dropzone is-drop' : 'adm-fieldset adm-dropzone'
			}
			aria-describedby={hintId}
			onDragOver={(event) => {
				event.preventDefault();
				setOver(true);
			}}
			onDragLeave={() => setOver(false)}
			onDrop={drop}
		>
			<legend className="adm-fieldset__legend">{legend}</legend>
			<p className="adm-hint" id={hintId}>
				{hint}
			</p>
			<ReplacePhotoControl
				describe={false}
				noun={noun}
				frame={frame}
				imageSrc={slot.photo?.src}
				state={slot.state}
				onPicked={slot.picked}
				onResized={slot.resized}
			/>
			<div className="adm-actions">
				<Button
					type="button"
					variant="quiet"
					mark="undo-2"
					aria-disabled={!undoable || slot.busy || undefined}
					onClick={() => {
						if (undoable && !slot.busy) slot.reset();
					}}
				>
					Reset {legend.toLowerCase()}
				</Button>
			</div>
			{error === undefined ? null : <FieldMessage id={`${hintId}-err`}>{error}</FieldMessage>}
		</fieldset>
	);
}

/** Media: the banner and the logo, each uploaded as it is picked and saved by Save media. */
export function MediaCard({ seed, version }: CardProps<CampaignMediaSeed>) {
	const answer = useScreenAnswer();
	const [form, fields] = useAdminForm(MEDIA, answer, { defaultValue: { ...seed.boxes } });
	const hero = usePhotoSlot(seed.hero, seed.hero);
	const logo = usePhotoSlot(seed.logo, seed.logo);
	const heroId = hero.photo?.imageId ?? '';
	const logoId = logo.photo?.imageId ?? '';
	return (
		<SectionCard
			form={getFormProps(form)}
			title="Media"
			saveName="media"
			version={version}
			changed={heroId !== seed.boxes.hero_image_id || logoId !== seed.boxes.logo_image_id}
			held={hero.busy || logo.busy}
		>
			<input type="hidden" name={fields.hero_image_id.name} value={heroId} />
			<input type="hidden" name={fields.logo_image_id.name} value={logoId} />
			<PhotoSlot
				legend="Banner"
				hint="Across the top of the campaign page. A wide photo works best, about four times as wide as it is tall."
				slot={hero}
				saved={seed.hero}
				frame="banner"
				noun="photo"
				error={firstError(form.allErrors, fields.hero_image_id.name)}
			/>
			<PhotoSlot
				legend="Logo"
				hint="Beside the campaign’s name. A square image works best."
				slot={logo}
				saved={seed.logo}
				frame="logo"
				noun="logo"
				error={firstError(form.allErrors, fields.logo_image_id.name)}
			/>
		</SectionCard>
	);
}

type AmountRow = { readonly key: number; readonly amount: string; readonly label: string };

/** the rows as the save stores them: an amount once in minor units beside its label, blanks dropped. */
function rowsKey(rows: readonly AmountRow[], currency: string): string {
	return rows
		.filter((row) => row.amount.trim() !== '')
		.map(
			(row) =>
				`${readAmount(row.amount.trim(), currency).minor ?? row.amount.trim()}|${row.label.trim()}`
		)
		.join('\n');
}

const seededRows = (seed: CampaignGoalSeed): AmountRow[] =>
	seed.boxes.amount.map((amount, at) => ({
		key: at,
		amount,
		label: seed.boxes.amount_label[at] ?? ''
	}));

const GOAL_CHOICES = [
	{ value: 'none', label: 'No goal' },
	{ value: 'fixed', label: 'Fixed amount' }
] as const satisfies readonly { value: GoalMode; label: string }[];

/**
 * Goal and amounts: no goal or a fixed one, and up to `CAMPAIGN_AMOUNTS_MAX` suggested amounts, each
 * with an optional label. the rows post side by side, `amount[i]` beside `amount_label[i]`.
 */
export function GoalCard({ seed, version }: CardProps<CampaignGoalSeed>) {
	const id = useId();
	const answer = useScreenAnswer();
	const [form, fields] = useAdminForm(GOAL, answer);
	const [mode, setMode] = useSeeded<GoalMode>(seed.boxes.goal_mode, () => seed.boxes.goal_mode);
	const [goal, setGoal] = useSeeded(seed.boxes.goal_amount, () => seed.boxes.goal_amount);
	const [rows, setRows] = useSeeded(seed.boxes, () => seededRows(seed));
	const [minted, setMinted] = useState(seed.boxes.amount.length);
	const { currency } = seed;

	const goalMinor = (text: string) => readAmount(text.trim(), currency).minor ?? text.trim();
	const changed =
		mode !== seed.boxes.goal_mode ||
		(mode === 'fixed' && goalMinor(goal) !== goalMinor(seed.boxes.goal_amount)) ||
		rowsKey(rows, currency) !== rowsKey(seededRows(seed), currency);

	const full = rows.length >= CAMPAIGN_AMOUNTS_MAX;
	// a campaign saved before the cap may hold more amounts than a save takes now.
	const over = rows.filter((row) => row.amount.trim() !== '').length - CAMPAIGN_AMOUNTS_MAX;
	const capId = `${id}-cap`;
	const edit = (key: number, patch: Partial<AmountRow>) =>
		setRows(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
	const errors = form.allErrors;

	return (
		<SectionCard
			form={getFormProps(form)}
			title="Goal and amounts"
			saveName="goal and amounts"
			version={version}
			changed={changed}
		>
			<ChoiceChips
				id={`${id}-mode`}
				name={fields.goal_mode.name}
				legend="Goal"
				error={firstError(errors, fields.goal_mode.name)}
				options={GOAL_CHOICES.map((choice) => ({
					...choice,
					checked: mode === choice.value,
					onChange: () => setMode(choice.value)
				}))}
			/>
			{mode === 'fixed' ? (
				<MoneyField
					id={fields.goal_amount.id}
					name={fields.goal_amount.name}
					label="How much money do you want to raise?"
					currency={currency}
					affix={currency}
					affixAt="end"
					value={goal}
					onValueChange={setGoal}
					error={firstError(errors, fields.goal_amount.name)}
				/>
			) : (
				// every box the card states arrives ($lib/server/conform.ts): no goal posts an empty one.
				<input type="hidden" name={fields.goal_amount.name} value="" />
			)}
			<fieldset className="adm-fieldset" aria-describedby={`${id}-amounts-hint`}>
				<legend className="adm-fieldset__legend">Suggested amounts</legend>
				<p className="adm-hint" id={`${id}-amounts-hint`}>
					Donors see these as buttons, in this order, and can still give any amount between the
					smallest and largest gift. A label says what an amount does, like “Feeds a family for a
					week”.
				</p>
				{over > 0 ? (
					<Banner
						tone="attention"
						word={`Remove ${over} ${over === 1 ? 'amount' : 'amounts'} to save`}
					>
						A campaign suggests up to {CAMPAIGN_AMOUNTS_MAX} amounts.
					</Banner>
				) : null}
				{rows.map((row, at) => {
					const labelId = `${id}-label-${row.key}`;
					return (
						<div className="adm-stack adm-stack--tight" key={row.key}>
							<div className="adm-actions">
								<MoneyField
									id={`${id}-amount-${row.key}`}
									name={`${EDIT_BOXES.amount}[${at}]`}
									aria-label={`Amount ${at + 1}`}
									currency={currency}
									affix={currency}
									affixAt="end"
									value={row.amount}
									onValueChange={(amount) => edit(row.key, { amount })}
									error={firstError(errors, `${EDIT_BOXES.amount}[${at}]`)}
								/>
								<Field
									id={labelId}
									name={`${EDIT_BOXES.amountLabel}[${at}]`}
									aria-label={`Label for amount ${at + 1}`}
									placeholder="Label (optional)"
									value={row.label}
									aria-describedby={`${labelId}-count`}
									onChange={(event) => edit(row.key, { label: event.currentTarget.value })}
									error={firstError(errors, `${EDIT_BOXES.amountLabel}[${at}]`)}
								/>
								<Button
									type="button"
									variant="quiet"
									mark="trash-2"
									aria-label={`Remove amount ${at + 1}`}
									onClick={() => setRows(rows.filter((each) => each.key !== row.key))}
								>
									Remove
								</Button>
							</div>
							<Counter
								id={`${labelId}-count`}
								count={row.label.trim().length}
								max={AMOUNT_LABEL_MAX}
							/>
						</div>
					);
				})}
				<div className="adm-actions">
					<Button
						type="button"
						mark="list-ordered"
						aria-disabled={full || undefined}
						aria-describedby={full && over <= 0 ? capId : undefined}
						onClick={() => {
							if (full) return;
							setRows([...rows, { key: minted, amount: '', label: '' }]);
							setMinted(minted + 1);
						}}
					>
						Add an amount
					</Button>
					{full && over <= 0 ? (
						<p className="adm-hint" id={capId}>
							You can suggest up to {CAMPAIGN_AMOUNTS_MAX} amounts.
						</p>
					) : null}
				</div>
				{firstError(errors, EDIT_BOXES.amount) === undefined ? null : (
					<FieldMessage id={`${id}-amounts-err`}>
						{firstError(errors, EDIT_BOXES.amount)}
					</FieldMessage>
				)}
			</fieldset>
		</SectionCard>
	);
}

/** today in the browser's zone, as `YYYY-MM-DD`. */
function today(): string {
	const now = new Date();
	const two = (n: number) => String(n).padStart(2, '0');
	return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

const MONTHLY_UNOFFERED =
	'Monthly giving is off until a connected payment account can collect recurring gifts.';

/**
 * Settings: where a gift goes, the smallest and largest gift, the two switches, the share message
 * and the end date. the end date posts with the browser's own zone, the zone the day ends in.
 */
export function SettingsCard({ seed, version }: CardProps<CampaignSettingsSeed>) {
	const id = useId();
	const answer = useScreenAnswer();
	const [form, fields] = useAdminForm(SETTINGS, answer, { defaultValue: { ...seed.boxes } });
	// set after hydration: the server does not know the browser's today.
	const [earliest, setEarliest] = useState<string | undefined>(undefined);
	useEffect(() => setEarliest(today()), []);
	const held = form.value ?? {};
	const boxes: Record<string, unknown> = { ...seed.boxes };
	const changed =
		programChanged(boxes, held) ||
		amountsChanged(boxes, held, [EDIT_BOXES.minMinor, EDIT_BOXES.maxMinor], seed.currency) ||
		ticksChanged(boxes, held, [EDIT_BOXES.openOnMonthly, EDIT_BOXES.dedicationOn]) ||
		textsChanged(boxes, held, [EDIT_BOXES.shareMessage, EDIT_BOXES.endDate]);
	const shareCount = typeof held.share_message === 'string' ? held.share_message.trim().length : 0;

	return (
		<SectionCard
			form={getFormProps(form)}
			title="Settings"
			saveName="settings"
			version={version}
			changed={changed}
			beforeSubmit={(element) => {
				const zone = element.elements.namedItem(EDIT_BOXES.timeZone);
				if (zone instanceof HTMLInputElement) {
					zone.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
				}
			}}
		>
			<FormProgramFields
				boxes={{ program_mode: fields.program_mode, program_id: fields.program_id }}
				programs={seed.programs}
				retired={seed.retired}
				heading="h3"
			/>
			<FormGivingFields
				boxes={{ min_minor: fields.min_minor, max_minor: fields.max_minor }}
				currency={seed.currency}
				heading="h3"
			/>
			<h3>How the donation box opens</h3>
			<CheckboxGroup
				id={`${id}-opens`}
				items={[
					{
						id: fields.open_on_monthly.id,
						name: fields.open_on_monthly.name,
						label: SWITCH_LABELS.open_on_monthly,
						defaultChecked: fields.open_on_monthly.defaultChecked,
						note: seed.monthlyOffered ? undefined : MONTHLY_UNOFFERED
					},
					{
						id: fields.dedication_on.id,
						name: fields.dedication_on.name,
						label: SWITCH_LABELS.dedication_on,
						defaultChecked: fields.dedication_on.defaultChecked
					}
				]}
			/>
			<h3>Sharing and end date</h3>
			<div className="adm-stack adm-stack--tight">
				<Field
					id={fields.share_message.id}
					name={fields.share_message.name}
					as="textarea"
					label="Share message"
					optional
					hint="What a donor’s post says when they share the campaign. Left empty, it says the campaign’s name."
					defaultValue={seed.boxes.share_message}
					aria-describedby={`${id}-share-count`}
					error={firstError(form.allErrors, fields.share_message.name)}
				/>
				<Counter id={`${id}-share-count`} count={shareCount} max={SHARE_MESSAGE_MAX} />
			</div>
			<DateField
				id={fields.end_date.id}
				name={fields.end_date.name}
				label="End date"
				hint="The campaign ends at the end of this day, your time. Leave it empty to run until you end it."
				defaultValue={seed.boxes.end_date}
				min={earliest}
				error={
					firstError(form.allErrors, fields.end_date.name) ??
					firstError(form.allErrors, fields.time_zone.name)
				}
			/>
			<input type="hidden" name={fields.time_zone.name} defaultValue="" />
		</SectionCard>
	);
}
