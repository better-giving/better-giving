import { Sheet } from '@better-giving/operator/components/shell/Sheet';
import type { ReactNode } from 'react';
import { DoneSheet } from './done-sheet';
import { PickRefusal, PicturePicker, type PictureOption } from './pictures';

// one block's sheet, opened by a click on the block in the preview or by its row in Settings' block
// list: its variant pictures first, which apply the moment one is picked, then its words, which wait
// for the one Done. a block with nothing typed in it — the share buttons, the donation box — has no
// Done: its picks are the whole of it.
//
// a refused pick is reported under the pictures, in a region there whenever they are, and never at
// Done: Done reports the words, and a block with no words has no Done. the pictures and their
// report are one part of the sheet (`.adm-sheetpart`), so the report stands at the part's step
// under them rather than at the body's step between parts.
//
// opened from Settings' block list, the sheet is `stacked` over Settings, as Settings' own sheets
// are; opened from the preview it stands alone.

type BlockVariants = {
	/** the variants this block may take, from the block catalog. */
	readonly options: readonly PictureOption[];
	readonly value: string;
	readonly onPick: (variant: string) => void;
	/** the last pick's refusal. */
	readonly refusal?: string | null | undefined;
};

type BlockText = {
	/** the block's boxes. */
	readonly fields: ReactNode;
	/** Done was pressed, or Enter in a box, and no apply is in flight. */
	readonly onDone: (form: HTMLFormElement) => void;
	readonly applying: boolean;
	/** the last apply's refusal that no box carries. */
	readonly refusal?: string | null | undefined;
	/** the form's id, for a caller whose form library names it. */
	readonly formId?: string | undefined;
};

type BlockSheetProps = {
	/** the block's name — Story, Hero — which is the sheet's title. */
	readonly title: string;
	/** the block's name in the catalog, which picks the variant drawings. */
	readonly block: string;
	/** absent for a block with one way to draw it. */
	readonly variants?: BlockVariants | undefined;
	/** absent for a block with nothing typed in it. */
	readonly text?: BlockText | undefined;
	readonly onDismiss: () => void;
	/** opened from inside Settings, and standing over it. */
	readonly stacked?: boolean | undefined;
};

export function BlockSheet({
	title,
	block,
	variants,
	text,
	onDismiss,
	stacked = false
}: BlockSheetProps) {
	const pictures = variants ? (
		<div className="adm-sheetpart">
			<PicturePicker
				legend={`${title} style`}
				name="variant"
				set={{ block }}
				options={variants.options}
				value={variants.value}
				onPick={variants.onPick}
			/>
			<PickRefusal refusal={variants.refusal} />
		</div>
	) : null;

	if (text === undefined) {
		return (
			<Sheet title={title} onDismiss={onDismiss} stacked={stacked}>
				{pictures}
			</Sheet>
		);
	}
	return (
		<DoneSheet
			title={title}
			onDismiss={onDismiss}
			stacked={stacked}
			onDone={text.onDone}
			applying={text.applying}
			refusal={text.refusal}
			formId={text.formId}
			lead={pictures}
		>
			{text.fields}
		</DoneSheet>
	);
}
