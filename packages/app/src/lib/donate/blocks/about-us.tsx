import type { RichTextDocument } from '../../rich-text/document';
import { RichText } from '../../rich-text/render';
import type { BlockOf } from './types';

// the organisation's mission and vision, from the Organisation page's Story. `statement` sets the
// first of the two at heading size with the other beneath it.

export function AboutUsBlock({
	block,
	mission,
	vision
}: {
	readonly block: BlockOf<'about-us'>;
	/** each is null where the organisation has written none; the page leaves the block out when both are. */
	readonly mission: RichTextDocument | null;
	readonly vision: RichTextDocument | null;
}) {
	if (block.variant === 'statement') {
		const [statement, beneath] = mission === null ? [vision, null] : [mission, vision];
		return (
			<div className="page-about" data-variant="statement">
				<h2 className="page-label">About us</h2>
				{statement === null ? null : (
					<div className="page-about-statement">
						<RichText doc={statement} />
					</div>
				)}
				{beneath === null ? null : (
					<div className="page-about-beneath">
						<RichText doc={beneath} />
					</div>
				)}
			</div>
		);
	}
	return (
		<div className="page-about" data-variant={block.variant}>
			<h2 className="page-heading">About us</h2>
			<div className="page-about-parts">
				{mission === null ? null : <Part label="Our mission" doc={mission} />}
				{vision === null ? null : <Part label="Our vision" doc={vision} />}
			</div>
		</div>
	);
}

function Part({ label, doc }: { readonly label: string; readonly doc: RichTextDocument }) {
	return (
		<div>
			<h3 className="page-label">{label}</h3>
			<div className="page-about-words">
				<RichText doc={doc} />
			</div>
		</div>
	);
}
