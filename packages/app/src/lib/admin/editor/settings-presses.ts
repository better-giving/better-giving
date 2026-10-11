import { useEffect, useEffectEvent } from 'react';
import { BLOCK_FORMS, BOXES, type EditorLook, type EditorShare } from '$lib/page/block-edit';
import { useDraftPresses } from './draft-presses';
import type { BlockEdits, LookPart } from './settings-sheet';

// the Settings sheet's presses that apply at once — the layout, the look, the share buttons, and a
// block moved, removed or added — all on one owner (./draft-presses.ts), so a press made while
// another of them is in flight is turned away rather than sent against the version the first is
// about to move. each control draws what the press in flight asked for until it is answered, and
// what the draft holds once it is, so a refused pick goes back to the draft's, its refusal at the
// foot of the part it came from.
//
// a share button ticked or unticked keeps the order the page holds them in: an unticked one is
// taken out where it stands and a ticked one goes last, which is where the page then draws it.
//
// a block that lands is handed to `onAdded` on the render its answer arrives in, which is the
// render the revalidated draft holding it arrives in too, so its sheet can open over Settings.
//
// the editor holds this hook for as long as it is up: `startClean` is Settings opening, which lets
// go of an answer the sheet was closed on. a press still in flight is left to land.

const LOOK_FORMS = {
	shade: BLOCK_FORMS.shade,
	corners: BLOCK_FORMS.corners,
	palette: BLOCK_FORMS.palette
} as const satisfies Record<LookPart, string>;

const LOOK_BOXES = {
	shade: BOXES.shade,
	corners: BOXES.corners,
	palette: BOXES.palette
} as const satisfies Record<LookPart, string>;

type SettingsPressesInput = {
	/** the page's version the editor was drawn at. */
	readonly version: number;
	/** the draft's layout. */
	readonly layout: string;
	readonly look: EditorLook;
	readonly share: EditorShare;
	/** the blocks the page may be given, as Add a block offers them. */
	readonly addable: BlockEdits['addable'];
	/** a block added by Add a block landed, and the draft holds it under this id. */
	readonly onAdded: (blockId: string) => void;
};

export function useSettingsPresses({
	version,
	layout,
	look,
	share,
	addable,
	onAdded
}: SettingsPressesInput) {
	const presses = useDraftPresses(version);
	const { press, sending, said } = presses;
	const asking = (form: string, box: string) => sending(form, box)?.[0];

	const channels = sending(BLOCK_FORMS.shareChannels, BOXES.shareChannels) ?? share.channels;

	const added = presses.landed(BLOCK_FORMS.add) ? presses.answer?.blockId : undefined;
	const land = useEffectEvent((blockId: string) => onAdded(blockId));
	useEffect(() => {
		if (added !== undefined) land(added);
	}, [added]);

	const lookOf = (part: LookPart) => asking(LOOK_FORMS[part], LOOK_BOXES[part]) ?? look[part];

	return {
		sheet: {
			layout: asking(BLOCK_FORMS.layout, BOXES.layout) ?? layout,
			onLayout: (next: string) => press(BLOCK_FORMS.layout, [[BOXES.layout, next]]),
			layoutRefusal: said(BLOCK_FORMS.layout, BOXES.layout),
			look: { shade: lookOf('shade'), corners: lookOf('corners'), palette: lookOf('palette') },
			onLook: (part: LookPart, value: string) =>
				press(LOOK_FORMS[part], [[LOOK_BOXES[part], value]]),
			lookRefusal:
				said(LOOK_FORMS.shade, BOXES.shade) ??
				said(LOOK_FORMS.corners, BOXES.corners) ??
				said(LOOK_FORMS.palette, BOXES.palette),
			share: { message: share.message, channels },
			onChannel: (channel: string, ticked: boolean) =>
				press(
					BLOCK_FORMS.shareChannels,
					(ticked ? [...channels, channel] : channels.filter((one) => one !== channel)).map(
						(one) => [BOXES.shareChannels, one] as const
					)
				),
			sharingRefusal: said(BLOCK_FORMS.shareChannels, BOXES.shareChannels),
			blockEdits: {
				addable,
				onAdd: (type: string) => press(BLOCK_FORMS.add, [[BOXES.blockType, type]]),
				onMove: (id: string, direction: 'up' | 'down') =>
					press(BLOCK_FORMS.move, [
						[BOXES.blockId, id],
						[BOXES.direction, direction]
					]),
				onRemove: (id: string) => press(BLOCK_FORMS.remove, [[BOXES.blockId, id]]),
				busy: presses.busy,
				refusal:
					said(BLOCK_FORMS.move, BOXES.direction) ??
					said(BLOCK_FORMS.remove, '') ??
					said(BLOCK_FORMS.add, BOXES.blockType)
			} satisfies BlockEdits
		},
		startClean: presses.startClean
	};
}
