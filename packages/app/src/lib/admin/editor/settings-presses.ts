import { useEffect, useEffectEvent } from 'react';
import { useFetcher } from 'react-router';
import { type AdminActionData, resultFor } from '$lib/admin/use-admin-form';
import { RECORD_VERSION, WHICH_FORM } from '$lib/forms/definition';
import { BLOCK_FORMS, type EditorLook, type EditorShare } from '$lib/page/block-edit';
import type { BlockEdits, LookPart } from './settings-sheet';

// the Settings sheet's presses that apply at once — the look, the share buttons, and a block moved,
// removed or added — each posted to the editor route's action (`saveBlockForm` in
// $lib/server/pages/blocks.ts) against the page's version the editor holds at the press. a landed
// write moves that version, which reloads the preview and redraws the sheet from the draft.
//
// one fetcher carries all of them, and a press made while another is in flight is turned away:
// the second would carry the version the first is about to move, and be refused as stale. the
// controls draw what the press in flight asked for until it is answered, and what the draft holds
// once it is — so a refused pick goes back to the draft's, its refusal under the part it came from.
//
// a block that lands is handed to `onAdded` on the render its answer arrives in, which is the
// render the revalidated draft holding it arrives in too, so its sheet can open over Settings.
//
// the editor holds this hook for as long as it is up, as it holds the layout pick
// (`useLayoutPick` in ./block-edit.tsx): `startClean` is Settings opening, which lets go of an
// answer the sheet was closed on. a press still in flight is left to land.

type Answer = AdminActionData & { readonly saved?: string; readonly blockId?: string };

const LOOK_FORMS = {
	shade: BLOCK_FORMS.shade,
	corners: BLOCK_FORMS.corners,
	palette: BLOCK_FORMS.palette
} as const satisfies Record<LookPart, string>;

type SettingsPressesInput = {
	/** the page's version the editor was drawn at. */
	readonly version: number;
	readonly look: EditorLook;
	readonly share: EditorShare;
	/** the blocks the page may be given, as Add a block offers them. */
	readonly addable: BlockEdits['addable'];
	/** a block added by Add a block landed, and the draft holds it under this id. */
	readonly onAdded: (blockId: string) => void;
};

export function useSettingsPresses({
	version,
	look,
	share,
	addable,
	onAdded
}: SettingsPressesInput) {
	const fetcher = useFetcher<Answer>();
	const idle = fetcher.state === 'idle';
	const sent = idle ? undefined : fetcher.formData;
	const sentForm = sent?.get(WHICH_FORM);
	const answer = idle ? fetcher.data : undefined;

	const press = (form: string, fields: readonly (readonly [string, string])[]) => {
		if (!idle) return;
		const body = new FormData();
		body.set(WHICH_FORM, form);
		body.set(RECORD_VERSION, String(version));
		for (const [box, value] of fields) body.append(box, value);
		fetcher.submit(body, { method: 'post' });
	};

	/** the first sentence the last answer refused `form` with, under `box` or under none. */
	const refusal = (form: string, box: string): string | null => {
		const error = resultFor({ id: form }, answer)?.error;
		return error?.[box]?.[0] ?? error?.['']?.[0] ?? null;
	};

	/** what the press in flight asks `part` to be, while it is that part's. */
	const asked = (part: LookPart): string | null => {
		const value = sentForm === LOOK_FORMS[part] ? sent?.get(part) : null;
		return typeof value === 'string' ? value : null;
	};

	const channels =
		sentForm === BLOCK_FORMS.shareChannels
			? (sent?.getAll('share_channels').filter((one) => typeof one === 'string') ?? [])
			: share.channels;

	const added = answer?.saved === BLOCK_FORMS.add ? answer.blockId : undefined;
	const land = useEffectEvent((blockId: string) => onAdded(blockId));
	useEffect(() => {
		if (added !== undefined) land(added);
	}, [added]);

	return {
		sheet: {
			look: {
				shade: asked('shade') ?? look.shade,
				corners: asked('corners') ?? look.corners,
				palette: asked('palette') ?? look.palette
			},
			onLook: (part: LookPart, value: string) => press(LOOK_FORMS[part], [[part, value]]),
			lookRefusal:
				refusal(LOOK_FORMS.shade, 'shade') ??
				refusal(LOOK_FORMS.corners, 'corners') ??
				refusal(LOOK_FORMS.palette, 'palette'),
			share: { message: share.message, channels },
			onChannels: (next: readonly string[]) =>
				press(
					BLOCK_FORMS.shareChannels,
					next.map((channel) => ['share_channels', channel] as const)
				),
			sharingRefusal: refusal(BLOCK_FORMS.shareChannels, 'share_channels'),
			blockEdits: {
				addable,
				onAdd: (type: string) => press(BLOCK_FORMS.add, [['block_type', type]]),
				onMove: (id: string, direction: 'up' | 'down') =>
					press(BLOCK_FORMS.move, [
						['block_id', id],
						['direction', direction]
					]),
				onRemove: (id: string) => press(BLOCK_FORMS.remove, [['block_id', id]]),
				busy: !idle,
				refusal:
					refusal(BLOCK_FORMS.move, 'direction') ??
					refusal(BLOCK_FORMS.remove, '') ??
					refusal(BLOCK_FORMS.add, 'block_type')
			} satisfies BlockEdits
		},
		startClean: () => {
			if (idle) fetcher.reset();
		}
	};
}
