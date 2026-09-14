import { ProgressBar } from '@better-giving/operator/components/status/ProgressBar';

/*
 * the bar a document draws as its own waiting face, filling.
 *
 * only that shape is drawn. the finish is no prop: it is packages/operator/src/progress-bar.ts's
 * module state, flipped by a loader whose reading has landed, so a specimen pinning it would be
 * driving that state for every bar on this page. the shape over a move (`overMove`) is fixed to the
 * viewport's top edge and would stand over this whole page rather than in its cell.
 */
export default function StatusProgressBarPreview() {
	return (
		<div className="adm-stack adm-stack--tight adm-stack--centred">
			<ProgressBar label="Starting" overMove={false} />
		</div>
	);
}
