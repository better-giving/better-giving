import type { ReactNode } from 'react';

// the layout and variant pickers, drawn as pictures: the drawing is the control and a pick applies
// at once — there is no Save and no Done behind one (the editor's sheets argue that in
// ./done-sheet.tsx).
//
// what may be picked is the caller's: the closed sets live in the block catalog and reach this file
// as `{ value, label }` options, so a name the catalog drops is a picture nobody is offered. what is
// drawn for a name is this file's, keyed by the catalog's own names — a layout by its name, a
// variant by its block and its name, because `cards`, `list` and `wide` each name two blocks'
// variants. a name with no drawing here is drawn as an empty face under its label rather than
// refused: the label still says what it is.
//
// each choice is a native radio inside its own label, out of sight (`.adm-vh`) with the drawing and
// the label as the face. the label's words are the radio's name, and the platform's arrow keys move
// the pick within the group — each step is a pick, and applies, as a radio group's does.

export type PictureOption = { readonly value: string; readonly label: string };

/** what a picker draws: the page's layouts, or one block's variants. */
export type PictureSet = 'layout' | { readonly block: string };

type LineProps = {
	/** a heading's line, thicker than a line of prose. */
	readonly head?: boolean;
	/** the last line of a paragraph, or a title shorter than its column. */
	readonly short?: boolean;
	/** stood on the drawing's centre rather than its start. */
	readonly centre?: boolean;
};

function Line({ head = false, short = false, centre = false }: LineProps) {
	return (
		<span
			className={[
				'adm-picture__line',
				head ? 'adm-picture__line--head' : '',
				short ? 'adm-picture__line--short' : '',
				centre ? 'adm-picture__line--centre' : ''
			]
				.filter(Boolean)
				.join(' ')}
		/>
	);
}

/** the donation box. `lifted` draws it overlapping the band above it, as `banner` places it. */
function Box({ lifted = false }: { readonly lifted?: boolean }) {
	return (
		<span className={lifted ? 'adm-picture__box adm-picture__box--lifted' : 'adm-picture__box'} />
	);
}

/** two columns, the wider first; `even` splits them in half. */
function Cols({
	even = false,
	children
}: {
	readonly even?: boolean;
	readonly children: ReactNode;
}) {
	return (
		<span className={even ? 'adm-picture__cols adm-picture__cols--even' : 'adm-picture__cols'}>
			{children}
		</span>
	);
}

const Stack = ({ children }: { readonly children: ReactNode }) => (
	<span className="adm-picture__stack">{children}</span>
);
/** a photo, with anything drawn over it standing at its foot. */
const Fill = ({ children }: { readonly children?: ReactNode }) => (
	<span className="adm-picture__fill">{children}</span>
);
/** a band of ground across the page. */
const Band = ({ children }: { readonly children: ReactNode }) => (
	<span className="adm-picture__band">{children}</span>
);
const Narrow = ({ children }: { readonly children: ReactNode }) => (
	<span className="adm-picture__narrow">{children}</span>
);
const Card = ({ children }: { readonly children: ReactNode }) => (
	<span className="adm-picture__card">{children}</span>
);
const Tiles = ({ children }: { readonly children: ReactNode }) => (
	<span className="adm-picture__tiles">{children}</span>
);
const Row = ({ children }: { readonly children: ReactNode }) => (
	<span className="adm-picture__row">{children}</span>
);
const Pills = ({ children }: { readonly children: ReactNode }) => (
	<span className="adm-picture__pills">{children}</span>
);
const Dot = () => <span className="adm-picture__dot" />;
const Track = () => (
	<span className="adm-picture__track">
		<Box />
	</span>
);

const LAYOUTS: Readonly<Record<string, ReactNode>> = {
	'box-right': (
		<>
			<Line head short />
			<Cols>
				<Stack>
					<Line />
					<Line />
					<Line />
					<Line short />
				</Stack>
				<Box />
			</Cols>
		</>
	),
	banner: (
		<>
			<Band>
				<Line head short />
				<Line short />
			</Band>
			<Cols>
				<Stack>
					<Line />
					<Line />
					<Line short />
				</Stack>
				<Box lifted />
			</Cols>
		</>
	),
	column: (
		<Narrow>
			<Line head />
			<Line />
			<Line />
			<Line short />
			<Box />
		</Narrow>
	),
	cover: (
		<>
			<Fill>
				<Line head short />
				<Line short />
			</Fill>
			<Cols>
				<Stack>
					<Line />
					<Line short />
				</Stack>
				<Box />
			</Cols>
		</>
	)
};

const tiles = (card: ReactNode) => (
	<Tiles>
		<Card>{card}</Card>
		<Card>{card}</Card>
		<Card>{card}</Card>
	</Tiles>
);
const rows = (row: ReactNode) => (
	<>
		<Row>{row}</Row>
		<Row>{row}</Row>
		<Row>{row}</Row>
	</>
);

const VARIANTS: Readonly<Record<string, ReactNode>> = {
	'title:left': (
		<>
			<Line head />
			<Line head short />
			<Line short />
		</>
	),
	'title:center': (
		<>
			<Line head short centre />
			<Line short centre />
		</>
	),
	'title:compact': (
		<>
			<Line head short />
			<Line short />
		</>
	),
	'story:plain': (
		<>
			<Line />
			<Line />
			<Line />
			<Line short />
		</>
	),
	'story:lede': (
		<>
			<Line head />
			<Line head short />
			<Line />
			<Line short />
		</>
	),
	'story:split': (
		<Cols even>
			<Stack>
				<Line />
				<Line />
				<Line />
			</Stack>
			<Stack>
				<Line />
				<Line />
				<Line short />
			</Stack>
		</Cols>
	),
	'impact-tiers:cards': tiles(
		<>
			<Line head short />
			<Line />
		</>
	),
	'impact-tiers:list': rows(
		<>
			<Line head />
			<Line />
		</>
	),
	'faq:accordion': rows(
		<>
			<Line />
			<Dot />
		</>
	),
	'faq:open': (
		<>
			<Line head short />
			<Line />
			<Line head short />
			<Line />
		</>
	),
	'about-us:stacked': (
		<>
			<Line head short />
			<Line />
			<Line />
			<Line short />
		</>
	),
	'about-us:side-by-side': (
		<Cols even>
			<Fill />
			<Stack>
				<Line head short />
				<Line />
				<Line short />
			</Stack>
		</Cols>
	),
	'about-us:statement': (
		<Band>
			<Line head centre />
			<Line head short centre />
		</Band>
	),
	'org-info:footer': (
		<Band>
			<Line short />
			<Line short />
		</Band>
	),
	'org-info:card': (
		<Card>
			<Line head short />
			<Line />
			<Line short />
		</Card>
	),
	'share:buttons': (
		<Pills>
			<Line />
			<Line />
			<Line />
		</Pills>
	),
	'share:icons': (
		<Pills>
			<Dot />
			<Dot />
			<Dot />
		</Pills>
	),
	'hero:wide': <Fill />,
	'hero:framed': (
		<Card>
			<Fill />
		</Card>
	),
	'image:column': (
		<Narrow>
			<Fill />
		</Narrow>
	),
	'image:wide': <Fill />,
	'goal-bar:bar': (
		<>
			<Line short />
			<Track />
		</>
	),
	'goal-bar:figure': (
		<>
			<Line head short />
			<Line short />
		</>
	),
	'program-chooser:cards': tiles(
		<>
			<Dot />
			<Line short />
		</>
	),
	'program-chooser:list': rows(
		<>
			<Dot />
			<Line />
		</>
	)
};

/** the drawing for one name in a set, or nothing where this file has none for it. */
function drawingFor(set: PictureSet, value: string): ReactNode {
	return (set === 'layout' ? LAYOUTS[value] : VARIANTS[`${set.block}:${value}`]) ?? null;
}

type PicturePickerProps = {
	/** the question the group answers — "Layout", "Story style" — read to a screen reader. */
	readonly legend: string;
	/** the radios' shared name, which is what makes the pictures one group to the keyboard. */
	readonly name: string;
	readonly set: PictureSet;
	readonly options: readonly PictureOption[];
	/** the name picked now. */
	readonly value: string;
	/** a picture was picked. it applies to the draft at once. */
	readonly onPick: (value: string) => void;
};

/**
 * the legend is never drawn: in Settings the part's own heading stands over the group, and in a
 * block's sheet the sheet's title does, so a second word on the screen would say it twice.
 */
export function PicturePicker({ legend, name, set, options, value, onPick }: PicturePickerProps) {
	return (
		<div className="adm-pictures" role="radiogroup" aria-label={legend}>
			{options.map((option) => (
				<label key={option.value} className="adm-picture">
					<input
						className="adm-vh"
						type="radio"
						name={name}
						value={option.value}
						checked={option.value === value}
						onChange={() => onPick(option.value)}
					/>
					<span className="adm-picture__art" aria-hidden="true">
						{drawingFor(set, option.value)}
					</span>
					{option.label}
				</label>
			))}
		</div>
	);
}
