import { useEffect, useState } from 'react';
import { useFetcher } from 'react-router';
import { type AdminActionData, resultFor } from '$lib/admin/use-admin-form';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import type { Resized } from '@better-giving/operator/images/resize';
import { BLOCK_FORMS, type BlockText, type EditorBlock } from '$lib/page/block-edit';
import { imageSrc } from '$lib/page/image-src';
import { BlockSheet } from './block-sheet';
import { useFocusOnRefusal } from './done-sheet';
import { MoneyField } from './money-field';
import { postPhoto, type UploadAnswer } from './photo-upload';
import {
	ReplacePhotoControl,
	type ReplacePhotoControlProps,
	replaceRefusal
} from './replace-photo';
import { SuggestedField, SuggestedRichText, useSuggestedValue } from './suggest';

// a block's sheet as both editors open it — from a click on the block in the preview and from its
// row in Settings' block list alike, the donation box's being the Donation settings sheet — and the
// layout pictures' pick, each posted through a fetcher to the editor route's action (`saveBlockForm`
// in $lib/server/pages/blocks.ts), so the editor does not navigate. a landed write moves the page's
// version, which reloads the preview.
//
// the words are the boxes' own, uncontrolled: a refused Done leaves them holding what was typed,
// the refusal under the box the catalog's rule names, and the caret moved there. a picture applies
// on pick and is drawn picked while its write is in flight; a refused one goes back to the draft's,
// with its refusal under the pictures and never at Done. every post carries the version as the
// editor holds it at the press, so a pick that landed first does not make the Done after it stale.
//
// the tiers and the questions are repeating rows: each row a pair of boxes whose legend, read to a
// screen reader and not drawn, names it by its place — Tier 2 — and the rows a stack, so one row
// stands off the next further than the two boxes inside it stand apart, and nearer than the
// pictures stand off the rows. a tier's amount carries its currency on the box and groups its
// digits as typed (./money-field.tsx), as the goal's does.
//
// a placed photo's sheet is the replace press and its description (./replace-photo.tsx), with
// Illustration over the art while the photo is still the AI illustration it opened on. a new
// photo is posted to the images route as soon as it is resized (./photo-upload.ts) and drawn once
// stored, and Done writes its id and the description to the block, as a text block's words are;
// a sheet dismissed before Done leaves the block as it was. a refused description lands under its
// box, with the caret moved there; what else the photo's rule refuses lands at Done.
//
// every text box but a tier's amount carries Write with AI (./suggest.tsx), asked of the page's
// suggest route at `suggestUrl`; the words it fills go with Done like typed ones, and a Done that
// lands takes the boxes' "AI suggestion" away.

type Answer = AdminActionData & { readonly saved?: string };

/** the version a press is written against, beside the form it came from. */
function post(form: { readonly id: string }, version: number, fields: FormData = new FormData()) {
	fields.set(WHICH_FORM, form.id);
	fields.set(RECORD_VERSION, String(version));
	return fields;
}

/** the first message the last answer refused `form` with under `box` — `''` is the form's own. */
function refusal(
	form: { readonly id: string },
	answer: Answer | undefined,
	box: string
): string | null {
	return resultFor(form, answer)?.error?.[box]?.[0] ?? null;
}

const TEXT_FORMS = {
	title: { id: BLOCK_FORMS.title },
	story: { id: BLOCK_FORMS.story },
	'impact-tiers': { id: BLOCK_FORMS.impactTiers },
	faq: { id: BLOCK_FORMS.faq },
	photo: { id: BLOCK_FORMS.photo }
} as const;
const VARIANT_FORM = { id: BLOCK_FORMS.variant };
const LAYOUT_FORM = { id: BLOCK_FORMS.layout };

type BlockEditSheetProps = {
	/** the block as the editor reads it; `illustration` marks a photo that is an AI illustration. */
	readonly block: EditorBlock & { readonly illustration?: boolean | undefined };
	/** the page's version as the editor holds it now. */
	readonly version: number;
	/** the page's suggest route (`suggestUrl` in ./suggest.tsx), which Write with AI asks. */
	readonly suggestUrl: string;
	/** X or Escape. */
	readonly onDismiss: () => void;
	/** a Done landed: the draft holds the words. */
	readonly onSaved: () => void;
	/** opened from Settings' block list, and standing over it. */
	readonly stacked?: boolean | undefined;
};

export function BlockEditSheet({
	block,
	version,
	suggestUrl,
	onDismiss,
	onSaved,
	stacked = false
}: BlockEditSheetProps) {
	// unkeyed, so an answer does not outlive the sheet: a reopened sheet starts with none.
	const words = useFetcher<Answer>();
	const picks = useFetcher<Answer>();

	const applying = words.state !== 'idle';
	const wordsAnswer = applying ? undefined : words.data;
	const saved = wordsAnswer?.saved === 'block';
	const picking = picks.state !== 'idle';
	const pickAnswer = picking ? undefined : picks.data;
	const picked = picking ? picks.formData?.get('variant') : null;

	useEffect(() => {
		if (saved) onSaved();
	}, [saved, onSaved]);

	const textForm = block.text === null ? null : TEXT_FORMS[block.text.kind];
	const pickRefusal =
		refusal(VARIANT_FORM, pickAnswer, 'variant') ?? refusal(VARIANT_FORM, pickAnswer, '');

	return (
		<BlockSheet
			title={block.label}
			block={block.type}
			stacked={stacked}
			variants={
				block.variant === null
					? undefined
					: {
							options: block.variants,
							value: typeof picked === 'string' ? picked : block.variant,
							refusal: pickRefusal,
							onPick: (variant) => {
								const body = post(VARIANT_FORM, version);
								body.set('block_id', block.id);
								body.set('variant', variant);
								picks.submit(body, { method: 'post' });
							}
						}
			}
			text={
				block.text === null || textForm === null
					? undefined
					: {
							fields: (
								<BlockFields
									id={block.id}
									text={block.text}
									error={(box) => refusal(textForm, wordsAnswer, box)}
									illustration={block.illustration === true}
									suggest={{ url: suggestUrl, saved: saved ? wordsAnswer : null }}
								/>
							),
							onDone: (form) => {
								const body = post(textForm, version, new FormData(form));
								body.set('block_id', block.id);
								words.submit(body, { method: 'post' });
							},
							applying,
							refusal: refusal(textForm, wordsAnswer, '')
						}
			}
			onDismiss={onDismiss}
		/>
	);
}

type BlockFieldsProps = {
	/** the block's id, which every box's id is made from. */
	readonly id: string;
	readonly text: BlockText;
	/** the last Done's refusal under `box`. */
	readonly error: (box: string) => string | null;
	/** the photo it holds is an AI illustration. */
	readonly illustration?: boolean | undefined;
	/** the suggest route, and the save that landed last, which takes a box's mark away. */
	readonly suggest: { readonly url: string; readonly saved: unknown };
};

/** the boxes a block's words are typed in, named as its form posts them. */
function BlockFields({ id, text, error, illustration, suggest }: BlockFieldsProps) {
	if (text.kind === 'photo')
		return (
			<PhotoFields
				id={id}
				text={text}
				error={error}
				illustration={illustration}
				suggest={suggest}
			/>
		);
	return <WordFields id={id} text={text} error={error} suggest={suggest} />;
}

type PhotoText = Extract<BlockText, { kind: 'photo' }>;

/** the photo Done writes, and what describes it, each posted from a hidden box. */
function PhotoFields({
	id,
	text,
	error,
	illustration = false,
	suggest
}: BlockFieldsProps & { readonly text: PhotoText }) {
	const upload = useFetcher<UploadAnswer>();
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
		if (!result.ok) {
			setRefused(replaceRefusal(result.reason));
			return;
		}
		setRefused(null);
		postPhoto(upload, result.blob);
	};
	const state: ReplacePhotoControlProps['state'] =
		upload.state !== 'idle' ? 'uploading' : refused === null ? undefined : { refused };
	const altId = boxId(id, 'alt');
	const altError = error('alt');
	useFocusOnRefusal(altError, altId);
	const { edited, ...altSuggest } = useSuggestedValue(
		{ url: suggest.url, block: id, field: 'alt' },
		alt,
		setAlt,
		suggest.saved
	);

	return (
		<>
			<ReplacePhotoControl
				imageSrc={imageSrc(imageId)}
				alt={alt}
				onResized={resized}
				onAltChange={(next) => {
					setAlt(next);
					edited();
				}}
				state={state}
				altId={altId}
				altError={altError}
				altSuggest={altSuggest}
				flag={illustration && imageId === text.imageId ? 'Illustration' : undefined}
			/>
			<input type="hidden" name="image_id" value={imageId} />
			<input type="hidden" name="alt" value={alt} />
		</>
	);
}

type WordsText = Exclude<BlockText, PhotoText>;

/** the boxes of a block whose words are typed. */
function WordFields({ id, text, error, suggest }: BlockFieldsProps & { readonly text: WordsText }) {
	const ask = (field: string) => ({ url: suggest.url, block: id, field });
	const boxes = boxNames(text);
	const refused = boxes.find((box) => error(box) !== null) ?? null;
	useFocusOnRefusal(
		refused === null ? null : error(refused),
		refused === null ? '' : boxId(id, refused)
	);

	switch (text.kind) {
		case 'title':
			return (
				<>
					<SuggestedField
						ask={ask('heading')}
						saved={suggest.saved}
						id={boxId(id, 'heading')}
						name="heading"
						label="Heading"
						optional
						hint="Leave it empty to show the page’s name."
						defaultValue={text.heading}
						error={error('heading')}
					/>
					<SuggestedField
						ask={ask('lede')}
						saved={suggest.saved}
						id={boxId(id, 'lede')}
						name="lede"
						label="Lead-in"
						optional
						as="textarea"
						defaultValue={text.lede}
						error={error('lede')}
					/>
				</>
			);
		case 'story':
			return (
				<SuggestedRichText
					ask={ask('body')}
					saved={suggest.saved}
					id={boxId(id, 'body')}
					name="body"
					label="Story"
					defaultValue={text.body}
					error={error('body')}
				/>
			);
		case 'impact-tiers':
			return (
				<div className="adm-stack">
					{text.tiers.map((tier, at) => (
						<fieldset key={`tier-${String(at)}`} className="adm-pair">
							<legend className="adm-vh">Tier {at + 1}</legend>
							<MoneyField
								id={boxId(id, `tier_amount[${at}]`)}
								name={`tier_amount[${at}]`}
								label="Amount"
								affix={text.currency}
								affixAt="end"
								currency={text.currency}
								defaultValue={tier.amount}
								error={error(`tier_amount[${at}]`)}
							/>
							<SuggestedField
								ask={ask(`tier_buys[${at}]`)}
								saved={suggest.saved}
								id={boxId(id, `tier_buys[${at}]`)}
								name={`tier_buys[${at}]`}
								label="What it buys"
								defaultValue={tier.buys}
								error={error(`tier_buys[${at}]`)}
							/>
						</fieldset>
					))}
				</div>
			);
		case 'faq':
			return (
				<div className="adm-stack">
					{text.items.map((item, at) => (
						<fieldset key={`item-${String(at)}`} className="adm-pair">
							<legend className="adm-vh">Question {at + 1}</legend>
							<SuggestedField
								ask={ask(`question[${at}]`)}
								saved={suggest.saved}
								id={boxId(id, `question[${at}]`)}
								name={`question[${at}]`}
								label="Question"
								defaultValue={item.question}
								error={error(`question[${at}]`)}
							/>
							<SuggestedRichText
								ask={ask(`answer[${at}]`)}
								saved={suggest.saved}
								id={boxId(id, `answer[${at}]`)}
								name={`answer[${at}]`}
								label="Answer"
								defaultValue={item.answer}
								error={error(`answer[${at}]`)}
							/>
						</fieldset>
					))}
				</div>
			);
	}
}

/** every box a block's form posts, in the order the sheet draws them. */
function boxNames(text: WordsText): string[] {
	switch (text.kind) {
		case 'title':
			return ['heading', 'lede'];
		case 'story':
			return ['body'];
		case 'impact-tiers':
			return text.tiers.flatMap((_, at) => [`tier_amount[${at}]`, `tier_buys[${at}]`]);
		case 'faq':
			return text.items.flatMap((_, at) => [`question[${at}]`, `answer[${at}]`]);
	}
}

function boxId(block: string, box: string): string {
	return `block-${block}-${box.replace(/[[\]]/g, '-')}`;
}

/**
 * the donation box has no sheet of its own: what it draws is the page's donation settings, so a
 * click on it, or its row in the block list, opens the Donation settings sheet instead.
 */
export function isDonationBox(blocks: readonly EditorBlock[], id: string): boolean {
	return blocks.some((block) => block.id === id && block.type === 'donation-box');
}

/**
 * the Settings sheet's layout pictures: `sheet` is the draft's layout, drawn as the pick in flight
 * while its write is, the pick posted to the editor's action, and the last pick's refusal.
 * `startClean` is the sheet opening: the editor holds this hook for as long as it is up, so a
 * refusal the sheet was closed on is let go of there, and the sheet opens without it. a pick still
 * in flight is left to land.
 */
export function useLayoutPick(layout: string, version: number) {
	const fetcher = useFetcher<Answer>();
	const idle = fetcher.state === 'idle';
	const sent = idle ? null : fetcher.formData?.get('layout');
	const answer = idle ? fetcher.data : undefined;
	return {
		sheet: {
			layout: typeof sent === 'string' ? sent : layout,
			layoutRefusal: refusal(LAYOUT_FORM, answer, 'layout') ?? refusal(LAYOUT_FORM, answer, ''),
			onLayout: (next: string) => {
				const body = post(LAYOUT_FORM, version);
				body.set('layout', next);
				fetcher.submit(body, { method: 'post' });
			}
		},
		startClean: () => {
			if (idle) fetcher.reset();
		}
	};
}
