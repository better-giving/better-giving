import { Button } from '@better-giving/operator/components/controls/Button';
import type { Resized, ResizeRefusal } from '@better-giving/operator/images/resize';
import { usePhotoPicker } from '../photo-picker';

export interface AttachControlProps {
	/** a reply is being written: the press stays where it is, focusable, and opens nothing. */
	readonly held: boolean;
	/** a file came back from the picker; its resize has started. */
	readonly onPicked: (file: File) => void;
	/** the latest pick, resized or refused. the route posts `blob` and draws the attachment row. */
	readonly onResized: (result: Resized) => void;
}

/* the chat's Attach photo press, drawn at the start of the composer's row through `AiPanel`'s
   `attach` slot. it opens the device's picker, resizes what comes back and reports; the attachment
   row the operator then sees is ./ai-panel.tsx's, drawn from what the route makes of the report.

   held with `aria-disabled` rather than `disabled`, so a press the operator is standing on keeps
   their focus while a reply is written. */
export function AttachControl({ held, onPicked, onResized }: AttachControlProps) {
	const picker = usePhotoPicker({ onPicked, onResized });
	return (
		<>
			<Button
				type="button"
				variant="quiet"
				size="sm"
				mark="paperclip"
				state={picker.choosing ? 'active' : undefined}
				aria-disabled={held || undefined}
				onClick={() => {
					if (!held) picker.open();
				}}
			>
				Attach photo
			</Button>
			{picker.field}
		</>
	);
}

const REFUSED: Record<ResizeRefusal, string> = {
	'not-an-image': 'Not a photo. Attach a JPEG, PNG, WebP or HEIC.',
	unreadable: 'This photo couldn’t be opened here. Attach it as a JPEG, PNG or WebP.',
	'too-large-after-resize': 'Too large even after resizing. Attach a smaller photo.'
};

/** the attachment row's words for a refused pick: `ChatAttachment`'s `reason`. */
export const attachRefusal = (reason: ResizeRefusal) => REFUSED[reason];
