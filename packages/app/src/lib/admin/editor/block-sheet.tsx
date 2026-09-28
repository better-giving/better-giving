import { Sheet } from '@better-giving/operator/components/shell/Sheet';
import type { ReactNode } from 'react';
import { DoneSheet } from './done-sheet';
import { PicturePicker, type PictureOption } from './pictures';

// one block's sheet, opened by a click on the block in the preview or by its row in Settings' block
// list: its variant pictures first, which apply the moment one is picked, then its words, which wait
// for the one Done. a block with nothing typed in it — the share buttons, the donation box — has no
// Done: its picks are the whole of it.

type BlockVariants = {
	/** the variants this block may take, from the block catalog. */
	readonly options: readonly PictureOption[];
	readonly value: string;
	readonly onPick: (variant: string) => void;
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
};

export function BlockSheet({ title, block, variants, text, onDismiss }: BlockSheetProps) {
	const pictures = variants ? (
		<PicturePicker
			legend={`${title} style`}
			name="variant"
			set={{ block }}
			options={variants.options}
			value={variants.value}
			onPick={variants.onPick}
		/>
	) : null;

	if (text === undefined) {
		return (
			<Sheet title={title} onDismiss={onDismiss}>
				{pictures}
			</Sheet>
		);
	}
	return (
		<DoneSheet
			title={title}
			onDismiss={onDismiss}
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
