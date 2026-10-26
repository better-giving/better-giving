import { Button } from '@better-giving/operator/components/controls/Button';
import { Field } from '@better-giving/operator/components/forms/Field';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { type FetcherWithComponents, useFetcher } from 'react-router';
import type { Resized } from '@better-giving/operator/images/resize';
import {
	BOXES,
	CONTENT_FORMS,
	type EditorSection,
	rowBox,
	type SectionText
} from '$lib/page/content-edit';
import { FAQ_MAX, TIERS_MAX } from '$lib/page/catalog';
import { imageSrc } from '$lib/page/image-src';
import type { RichTextDocument } from '$lib/rich-text/document';
import { RichTextEditor } from '../rich-text/rich-text-editor';
import { DoneSheet, useFocusOnRefusal } from './done-sheet';
import { useDraftPresses } from './draft-presses';
import { MoneyField } from './money-field';
import { postPhoto, type UploadAnswer } from './photo-upload';
import {
	ReplacePhotoControl,
	type ReplacePhotoControlProps,
	replaceRefusal
} from './replace-photo';

// a section's sheet as both editors open it — from a click on the section in the preview and from
// its row in Settings' content list alike — each press posted to the editor route's action through
// ./draft-presses.ts. a sheet holds the section's words and photos and nothing that says how they are
// drawn: the page picks its layout from what the content holds ($lib/page/shape.ts).
//
// the words are the boxes' own, uncontrolled: a refused Done leaves them holding what was typed, the
// refusal under the box the catalog's rule names, and the caret moved there.
//
// the tiers and the questions are repeating rows: each row a pair of boxes whose legend, read to a
// screen reader and not drawn, names it by its place — Tier 2 — and the rows a stack, so one row
// stands off the next further than the two boxes inside it stand apart. a tier's amount carries its
// currency on the box and groups its digits as typed (./money-field.tsx), as the goal's does. a row
// is added under the rows, up to the catalog's cap, and dropped by its own Remove while another row
// stands; a section holding none opens on one empty row, and the save leaves out a row emptied of
// both its boxes. each row is keyed by an identity of its own, so a half-typed row keeps its words
// as rows above it go, and the focus moves into the row added, or onto the row above the one
// dropped. a refused Done names a row by the place it stood in when Done posted, and the refusal is
// read back to the row that stood there: it stays on that row as rows above it go, goes with it when
// it is dropped, and is never on a row added since. the caret is moved to the first refused box when
// the refusal arrives, and not again as rows come and go. Add and Remove stand at the touch floor.
//
// a placed photo's sheet is the replace press, its description and Remove photo
// (./replace-photo.tsx). a new photo is posted to the images route as soon as it is resized
// (./photo-upload.ts) and drawn once stored, and Done writes its id and the description into the
// photo's slot — the cover, a photo's place, or a new one after the rest — as a section's words are;
// a sheet dismissed before Done leaves the page as it was. while a new photo resizes or uploads,
// Done is held as it is while a press is in flight, so it never writes the photo being replaced nor
// says a photo is wanted. a refused description lands under its box, with the caret moved there;
// what else the photo's rule refuses lands at Done. a slot with no photo yet opens on Add photo
// alone, and Done there posts nothing: it says at the press that a photo is wanted and puts the
// focus on it. Remove photo takes the photo off the page at once, and the cover's falls back to the
// organisation's logo where it has one.

const TEXT_FORMS = {
	title: CONTENT_FORMS.title,
	story: CONTENT_FORMS.story,
	tiers: CONTENT_FORMS.tiers,
	faq: CONTENT_FORMS.faq,
	photo: CONTENT_FORMS.photo
} as const;

type SectionEditSheetProps = {
	/** the section as the editor reads it. */
	readonly section: EditorSection;
	/** the page's version as the editor holds it now. */
	readonly version: number;
	/** X or Escape. */
	readonly onDismiss: () => void;
	/** a Done or a Remove photo landed: the draft holds the change. */
	readonly onSaved: () => void;
	/** opened from Settings' content list, and standing over it. */
	readonly stacked?: boolean | undefined;
};

export function SectionEditSheet({
	section,
	version,
	onDismiss,
	onSaved,
	stacked = false
}: SectionEditSheetProps) {
	const presses = useDraftPresses(version);
	/** a photo's Done found no photo, until one is chosen. */
	const [photoWanted, setPhotoWanted] = useState(false);
	/** a new photo, posted to the images route once resized. */
	const upload = useFetcher<UploadAnswer>();
	const [resizing, setResizing] = useState(false);
	const photoLanding = resizing || upload.state !== 'idle';
	const pressId = boxId(section.id, 'photo');
	const { text } = section;
	const form = TEXT_FORMS[text.kind];
	const saved = presses.landed(form) || presses.landed(CONTENT_FORMS.photoRemove);

	useEffect(() => {
		if (saved) onSaved();
	}, [saved, onSaved]);

	const remove =
		text.kind === 'photo' && text.removable ? (
			<Button
				type="button"
				variant="quiet"
				aria-busy={presses.flying(CONTENT_FORMS.photoRemove) || undefined}
				aria-disabled={presses.busy || undefined}
				onClick={() => {
					if (!presses.busy) presses.press(CONTENT_FORMS.photoRemove, [[BOXES.slot, text.slot]]);
				}}
			>
				Remove photo
			</Button>
		) : undefined;

	return (
		<DoneSheet
			title={section.label}
			stacked={stacked}
			onDone={(element) => {
				const body = new FormData(element);
				if (text.kind === 'photo') {
					if (body.get(BOXES.imageId) === '') {
						setPhotoWanted(true);
						document.getElementById(pressId)?.focus();
						return;
					}
					body.set(BOXES.slot, text.slot);
				}
				presses.press(form, body);
			}}
			applying={presses.busy || photoLanding}
			refusal={presses.refused(form, '') ?? presses.refused(CONTENT_FORMS.photoRemove, '')}
			aside={remove}
			onDismiss={onDismiss}
		>
			<SectionFields
				id={section.id}
				text={text}
				error={(box) => presses.refused(form, box)}
				posting={presses.flying(form)}
				photo={{ pressId, wanted: photoWanted, upload, onResizing: setResizing }}
			/>
		</DoneSheet>
	);
}

type SectionFieldsProps = {
	/** the section's id, which every box's id is made from. */
	readonly id: string;
	readonly text: SectionText;
	/** the last Done's refusal under `box`. */
	readonly error: (box: string) => string | null;
	/** a Done is in flight. */
	readonly posting: boolean;
	/**
	 * a photo's press, by its id; whether a Done found no photo chosen; the upload of a new photo;
	 * and its resize starting and ending — the sheet holds Done on the last two.
	 */
	readonly photo: {
		readonly pressId: string;
		readonly wanted: boolean;
		readonly upload: FetcherWithComponents<UploadAnswer>;
		readonly onResizing: (resizing: boolean) => void;
	};
};

/** the boxes a section's words are typed in, named as its form posts them. */
function SectionFields({ id, text, error, posting, photo }: SectionFieldsProps) {
	if (text.kind === 'photo') return <PhotoFields id={id} text={text} error={error} photo={photo} />;
	return <WordFields id={id} text={text} error={error} posting={posting} />;
}

/** what the press says to a Done that found no photo chosen. */
const PHOTO_WANTED = 'Add a photo first. The page doesn’t change until you do.';

type PhotoText = Extract<SectionText, { kind: 'photo' }>;

/** the photo Done writes, and what describes it, each posted from a hidden box. */
function PhotoFields({
	id,
	text,
	error,
	photo
}: Omit<SectionFieldsProps, 'posting'> & { readonly text: PhotoText }) {
	const { upload } = photo;
	const [imageId, setImageId] = useState(text.imageId);
	const [alt, setAlt] = useState(text.alt);
	const [refused, setRefused] = useState<string | null>(null);
	const [answered, setAnswered] = useState(upload.data);
	if (upload.data !== answered) {
		setAnswered(upload.data);
		if (upload.data !== undefined && 'error' in upload.data) {
			setRefused(
				upload.data.reason === 'failed'
					? 'That didn’t go through. Choose the photo again.'
					: upload.data.error
			);
		} else if (upload.data !== undefined) {
			setImageId(upload.data.id);
		}
	}

	const resized = (result: Resized) => {
		photo.onResizing(false);
		if (!result.ok) {
			setRefused(replaceRefusal(result.reason));
			return;
		}
		setRefused(null);
		postPhoto(upload, result.blob);
	};
	const said = refused ?? (photo.wanted && imageId === null ? PHOTO_WANTED : null);
	const state: ReplacePhotoControlProps['state'] =
		upload.state !== 'idle' ? 'uploading' : said === null ? undefined : { refused: said };
	const altId = boxId(id, BOXES.alt);
	const altError = error(BOXES.alt);
	useFocusOnRefusal(altError, altId);

	return (
		<>
			<ReplacePhotoControl
				imageSrc={imageId === null ? undefined : imageSrc(imageId)}
				alt={alt}
				onPicked={() => photo.onResizing(true)}
				onResized={resized}
				onAltChange={setAlt}
				state={state}
				altId={altId}
				altError={altError}
				pressId={photo.pressId}
			/>
			<input type="hidden" name={BOXES.imageId} value={imageId ?? ''} />
			<input type="hidden" name={BOXES.alt} value={alt} />
		</>
	);
}

type WordsText = Exclude<SectionText, PhotoText>;
type WordsProps<K extends WordsText['kind']> = Pick<SectionFieldsProps, 'id' | 'error'> & {
	readonly text: Extract<WordsText, { kind: K }>;
};
/** a list's rows take the Done in flight as well, which is when their keys are taken. */
type RowsProps<K extends 'tiers' | 'faq'> = WordsProps<K> & Pick<SectionFieldsProps, 'posting'>;

/** the boxes of a section whose words are typed. */
function WordFields({
	id,
	text,
	error,
	posting
}: Omit<SectionFieldsProps, 'photo'> & { readonly text: WordsText }) {
	switch (text.kind) {
		case 'title':
			return <TitleFields id={id} text={text} error={error} />;
		case 'story':
			return <StoryFields id={id} text={text} error={error} />;
		case 'tiers':
			return <TierRows id={id} text={text} error={error} posting={posting} />;
		case 'faq':
			return <QuestionRows id={id} text={text} error={error} posting={posting} />;
	}
}

/** the caret moved to the first of `boxes` the last Done refused, on the render it arrives in. */
function useFocusOnFirstRefused(
	id: string,
	boxes: readonly string[],
	error: (box: string) => string | null
) {
	const refused = boxes.find((box) => error(box) !== null) ?? null;
	useFocusOnRefusal(
		refused === null ? null : error(refused),
		refused === null ? '' : boxId(id, refused)
	);
}

function TitleFields({ id, text, error }: WordsProps<'title'>) {
	useFocusOnFirstRefused(id, [BOXES.heading, BOXES.lede], error);
	return (
		<>
			<Field
				id={boxId(id, BOXES.heading)}
				name={BOXES.heading}
				label="Heading"
				optional
				hint="Leave it empty to show the page’s name."
				defaultValue={text.heading}
				error={error(BOXES.heading)}
			/>
			{text.lede === null ? null : (
				<Field
					id={boxId(id, BOXES.lede)}
					name={BOXES.lede}
					label="Lead-in"
					optional
					as="textarea"
					defaultValue={text.lede}
					error={error(BOXES.lede)}
				/>
			)}
		</>
	);
}

function StoryFields({ id, text, error }: WordsProps<'story'>) {
	useFocusOnFirstRefused(id, [BOXES.body], error);
	return (
		<RichTextEditor
			id={boxId(id, BOXES.body)}
			name={BOXES.body}
			label="Story"
			defaultValue={text.body}
			error={error(BOXES.body)}
		/>
	);
}

/** a row of a list the sheet adds to and drops from, and the identity it is keyed by. */
type Keyed<T> = { readonly key: string; readonly row: T };

/**
 * the rows a section's list holds as the sheet draws them: its own, or one empty row where it holds
 * none. `first(at)` is the id of the box the focus goes to in the row at `at`.
 */
function useRows<T>(seed: readonly T[], blank: T, first: (at: number) => string) {
	const minted = useRef(0);
	const [rows, setRows] = useState<readonly Keyed<T>[]>(() =>
		(seed.length === 0 ? [blank] : seed).map((row, at) => ({ key: `held-${at}`, row }))
	);
	/** the box the focus is owed to by the add or remove that just changed the rows. */
	const [owed, setOwed] = useState<string | null>(null);
	useEffect(() => {
		if (owed === null) return;
		document.getElementById(owed)?.focus();
		setOwed(null);
	}, [owed]);
	return {
		rows,
		add() {
			minted.current += 1;
			const key = `added-${minted.current}`;
			setRows((was) => [...was, { key, row: blank }]);
			setOwed(first(rows.length));
		},
		remove(key: string) {
			const at = rows.findIndex((one) => one.key === key);
			setRows((was) => was.filter((one) => one.key !== key));
			setOwed(first(Math.max(at - 1, 0)));
		}
	};
}

/**
 * the last Done's refusals, row by row. the answer names a row by its place when Done posted, so
 * the rows' keys are taken as Done goes and each place is read back to the row that stood in it.
 * the caret is moved to the first refused box on the render the answer arrives in.
 */
function useRowRefusals<T>(
	id: string,
	rows: readonly Keyed<T>[],
	boxes: readonly string[],
	{ error, posting }: Pick<SectionFieldsProps, 'error' | 'posting'>
) {
	const keys = rows.map((one) => one.key);
	const [posted, setPosted] = useState(keys);
	const [wasPosting, setWasPosting] = useState(posting);
	if (posting !== wasPosting) {
		setWasPosting(posting);
		if (posting) setPosted(keys);
	}
	const refused = (key: string, box: string): string | null => {
		const at = posted.indexOf(key);
		return at === -1 ? null : error(rowBox(box, at));
	};
	const first = rows
		.flatMap(({ key }, at) => boxes.map((box) => ({ at, box, said: refused(key, box) })))
		.find((one) => one.said !== null);
	// the keys Done posted, while a refusal of theirs stands: a new Done takes new keys, and its
	// answer arriving is the refusal standing again, so this changes on that render and on no other.
	const answered = first === undefined ? null : posted;
	const focusFirst = useEffectEvent(() => {
		if (first === undefined) return;
		document.getElementById(boxId(id, rowBox(first.box, first.at)))?.focus();
	});
	useEffect(() => {
		if (answered !== null) focusFirst();
	}, [answered]);
	return refused;
}

type RowPressesProps = {
	/** how many rows stand, and how many the catalog lets the section hold. */
	readonly count: number;
	readonly max: number;
	/** Add's words — `Add a tier` — and what stands in its place once the list is full. */
	readonly add: string;
	readonly full: string;
	readonly onAdd: () => void;
};

/** Add under a list's rows, or the line saying the list is full. */
function AddRow({ count, max, add, full, onAdd }: RowPressesProps) {
	return count < max ? (
		<div className="adm-actions">
			<Button type="button" size="sm" mark="plus" className="adm-rowpress" onClick={onAdd}>
				{add}
			</Button>
		</div>
	) : (
		<p className="adm-hint">{full}</p>
	);
}

/** a row's Remove, named for the row it drops. */
function RemoveRow({ name, onRemove }: { readonly name: string; readonly onRemove: () => void }) {
	return (
		<div className="adm-actions">
			<Button
				type="button"
				size="sm"
				variant="quiet"
				mark="x"
				className="adm-rowpress"
				aria-label={`Remove ${name}`}
				onClick={onRemove}
			>
				Remove
			</Button>
		</div>
	);
}

function TierRows({ id, text, error, posting }: RowsProps<'tiers'>) {
	const list = useRows(text.tiers, { amount: '', buys: '' }, (at) =>
		boxId(id, rowBox(BOXES.tierAmount, at))
	);
	const refused = useRowRefusals(id, list.rows, [BOXES.tierAmount, BOXES.tierBuys], {
		error,
		posting
	});
	return (
		<div className="adm-stack">
			{list.rows.map(({ key, row }, at) => {
				const amount = rowBox(BOXES.tierAmount, at);
				const buys = rowBox(BOXES.tierBuys, at);
				return (
					<fieldset key={key} className="adm-pair">
						<legend className="adm-vh">Tier {at + 1}</legend>
						<MoneyField
							id={boxId(id, amount)}
							name={amount}
							label="Amount"
							affix={text.currency}
							affixAt="end"
							currency={text.currency}
							defaultValue={row.amount}
							error={refused(key, BOXES.tierAmount)}
						/>
						<Field
							id={boxId(id, buys)}
							name={buys}
							label="What it buys"
							defaultValue={row.buys}
							error={refused(key, BOXES.tierBuys)}
						/>
						{list.rows.length > 1 ? (
							<RemoveRow name={`tier ${at + 1}`} onRemove={() => list.remove(key)} />
						) : null}
					</fieldset>
				);
			})}
			<AddRow
				count={list.rows.length}
				max={TIERS_MAX}
				add="Add a tier"
				full={`A campaign holds ${TIERS_MAX} tiers at most.`}
				onAdd={list.add}
			/>
		</div>
	);
}

function QuestionRows({ id, text, error, posting }: RowsProps<'faq'>) {
	const blank: { question: string; answer: RichTextDocument | undefined } = {
		question: '',
		answer: undefined
	};
	const list = useRows<typeof blank>(text.items, blank, (at) =>
		boxId(id, rowBox(BOXES.question, at))
	);
	const refused = useRowRefusals(id, list.rows, [BOXES.question, BOXES.answer], {
		error,
		posting
	});
	return (
		<div className="adm-stack">
			{list.rows.map(({ key, row }, at) => {
				const question = rowBox(BOXES.question, at);
				const answer = rowBox(BOXES.answer, at);
				return (
					<fieldset key={key} className="adm-pair">
						<legend className="adm-vh">Question {at + 1}</legend>
						<Field
							id={boxId(id, question)}
							name={question}
							label="Question"
							defaultValue={row.question}
							error={refused(key, BOXES.question)}
						/>
						<RichTextEditor
							id={boxId(id, answer)}
							name={answer}
							label="Answer"
							{...(row.answer === undefined ? {} : { defaultValue: row.answer })}
							error={refused(key, BOXES.answer)}
						/>
						{list.rows.length > 1 ? (
							<RemoveRow name={`question ${at + 1}`} onRemove={() => list.remove(key)} />
						) : null}
					</fieldset>
				);
			})}
			<AddRow
				count={list.rows.length}
				max={FAQ_MAX}
				add="Add a question"
				full={`A campaign holds ${FAQ_MAX} questions at most.`}
				onAdd={list.add}
			/>
		</div>
	);
}

function boxId(section: string, box: string): string {
	return `section-${section}-${box.replace(/[[\]]/g, '-')}`;
}
