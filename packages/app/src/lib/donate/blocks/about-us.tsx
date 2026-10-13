import { Fragment } from 'react';
import type { BlockOf } from './types';

// the organisation's mission and vision, as plain text from the profile the console writes.
// `statement` sets the first of the two at heading size with the other beneath it.
//
// a blank line starts a new paragraph and a single line break stays a break inside one, which is
// how the words were typed; nothing in them is read as markup.

export function AboutUsBlock({
	block,
	mission,
	vision
}: {
	readonly block: BlockOf<'about-us'>;
	/** each is null where the organisation has written none; with neither, the block draws nothing. */
	readonly mission: string | null;
	readonly vision: string | null;
}) {
	if (mission === null && vision === null) return null;
	if (block.variant === 'statement') {
		const [statement, beneath] = mission === null ? [vision, null] : [mission, vision];
		return (
			<div className="page-about" data-variant="statement">
				<h2 className="page-label">About us</h2>
				{statement === null ? null : (
					<div className="page-about-statement">
						<Paragraphs text={statement} />
					</div>
				)}
				{beneath === null ? null : (
					<div className="page-about-beneath">
						<Paragraphs text={beneath} />
					</div>
				)}
			</div>
		);
	}
	return (
		<div className="page-about" data-variant={block.variant}>
			<h2 className="page-heading">About us</h2>
			<div className="page-about-parts">
				{mission === null ? null : <Part label="Our mission" text={mission} />}
				{vision === null ? null : <Part label="Our vision" text={vision} />}
			</div>
		</div>
	);
}

function Part({ label, text }: { readonly label: string; readonly text: string }) {
	return (
		<div>
			<h3 className="page-label">{label}</h3>
			<div className="page-about-words">
				<Paragraphs text={text} />
			</div>
		</div>
	);
}

function Paragraphs({ text }: { readonly text: string }) {
	const paragraphs = text
		.replace(/\r\n?/g, '\n')
		.split(/\n[^\S\n]*\n\s*/)
		.map((paragraph) => paragraph.trim())
		.filter((paragraph) => paragraph !== '');
	return paragraphs.map((paragraph, at) => (
		<p key={`${at}-${paragraph}`}>
			{paragraph.split('\n').map((line, index) => (
				<Fragment key={`${index}-${line}`}>
					{index === 0 ? null : <br />}
					{line}
				</Fragment>
			))}
		</p>
	));
}
