import { Field } from '@better-giving/operator/components/forms/Field';
import { useEffect } from 'react';
import { useFetcher } from 'react-router';
import { RichTextEditor } from '$lib/admin/rich-text/rich-text-editor';
import { type AdminActionData, resultFor } from '$lib/admin/use-admin-form';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { BLOCK_FORMS, type BlockText, type EditorBlock } from '$lib/page/block-edit';
import { BlockSheet } from './block-sheet';
import { useFocusOnRefusal } from './done-sheet';

// a block's sheet as both editors open it — from a click on the block in the preview and from its
// row in Settings' block list alike, the donation box's being Donation settings — and the layout
// pictures' pick, each posted through a fetcher
// to the editor route's action (`saveBlockForm` in $lib/server/pages/blocks.ts), so the editor does
// not navigate. a landed write moves the page's version, which reloads the preview.
//
// the words are the boxes' own, uncontrolled: a refused Done leaves them holding what was typed,
// the refusal under the box the catalog's rule names, and the caret moved there. a picture applies
// on pick and is drawn picked while its write is in flight; a refused one goes back to the draft's.
// every post carries the version as the editor holds it at the press, so a pick that landed first
// does not make the Done after it stale.

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
	faq: { id: BLOCK_FORMS.faq }
} as const;
const VARIANT_FORM = { id: BLOCK_FORMS.variant };
const LAYOUT_FORM = { id: BLOCK_FORMS.layout };

type BlockEditSheetProps = {
	readonly block: EditorBlock;
	/** the page's version as the editor holds it now. */
	readonly version: number;
	/** X or Escape. */
	readonly onDismiss: () => void;
	/** a Done landed: the draft holds the words. */
	readonly onSaved: () => void;
};

export function BlockEditSheet({ block, version, onDismiss, onSaved }: BlockEditSheetProps) {
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
			variants={
				block.variant === null
					? undefined
					: {
							options: block.variants,
							value: typeof picked === 'string' ? picked : block.variant,
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
								/>
							),
							onDone: (form) => {
								const body = post(textForm, version, new FormData(form));
								body.set('block_id', block.id);
								words.submit(body, { method: 'post' });
							},
							applying,
							refusal: refusal(textForm, wordsAnswer, '') ?? pickRefusal
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
};

/** the boxes a block's words are typed in, named as its form posts them. */
function BlockFields({ id, text, error }: BlockFieldsProps) {
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
					<Field
						id={boxId(id, 'heading')}
						name="heading"
						label="Heading"
						optional
						hint="Leave it empty to show the page’s name."
						defaultValue={text.heading}
						error={error('heading')}
					/>
					<Field
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
				<RichTextEditor
					id={boxId(id, 'body')}
					name="body"
					label="Story"
					defaultValue={text.body}
					error={error('body')}
				/>
			);
		case 'impact-tiers':
			return (
				<>
					{text.tiers.map((tier, at) => (
						<fieldset key={`tier-${String(at)}`} className="adm-fieldset">
							<legend className="adm-fieldset__legend">Tier {at + 1}</legend>
							<Field
								id={boxId(id, `tier_amount[${at}]`)}
								name={`tier_amount[${at}]`}
								label={`Amount, ${text.currency}`}
								inputMode="decimal"
								defaultValue={tier.amount}
								error={error(`tier_amount[${at}]`)}
							/>
							<Field
								id={boxId(id, `tier_buys[${at}]`)}
								name={`tier_buys[${at}]`}
								label="What it buys"
								defaultValue={tier.buys}
								error={error(`tier_buys[${at}]`)}
							/>
						</fieldset>
					))}
				</>
			);
		case 'faq':
			return (
				<>
					{text.items.map((item, at) => (
						<fieldset key={`item-${String(at)}`} className="adm-fieldset">
							<legend className="adm-fieldset__legend">Question {at + 1}</legend>
							<Field
								id={boxId(id, `question[${at}]`)}
								name={`question[${at}]`}
								label="Question"
								defaultValue={item.question}
								error={error(`question[${at}]`)}
							/>
							<RichTextEditor
								id={boxId(id, `answer[${at}]`)}
								name={`answer[${at}]`}
								label="Answer"
								defaultValue={item.answer}
								error={error(`answer[${at}]`)}
							/>
						</fieldset>
					))}
				</>
			);
	}
}

/** every box a block's form posts, in the order the sheet draws them. */
function boxNames(text: BlockText): string[] {
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
 * the Settings sheet's layout pictures: the draft's layout, drawn as the pick in flight while its
 * write is, and the pick posted to the editor's action.
 */
export function useLayoutPick(layout: string, version: number) {
	const fetcher = useFetcher<Answer>({ key: LAYOUT_FORM.id });
	const sent = fetcher.state === 'idle' ? null : fetcher.formData?.get('layout');
	return {
		layout: typeof sent === 'string' ? sent : layout,
		onLayout: (next: string) => {
			const body = post(LAYOUT_FORM, version);
			body.set('layout', next);
			fetcher.submit(body, { method: 'post' });
		}
	};
}
