import { Fragment } from 'react';

// the organisation's mission and vision, as plain text from the profile the console writes.
// the first of the two is set at heading size, with the other beneath it.
//
// a blank line starts a new paragraph and a single line break stays a break inside one, which is
// how the words were typed; nothing in them is read as markup.

export function AboutUs({
	mission,
	vision
}: {
	/** each is null where the organisation has written none; with neither, nothing is drawn. */
	readonly mission: string | null;
	readonly vision: string | null;
}) {
	if (mission === null && vision === null) return null;
	const [statement, beneath] = mission === null ? [vision, null] : [mission, vision];
	return (
		<div className="page-about">
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
