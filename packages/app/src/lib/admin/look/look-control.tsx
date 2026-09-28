import { Mark } from '@better-giving/operator/components/status/Mark';
import { type CSSProperties, useEffect, useEffectEvent, useId, useRef } from 'react';
import { CORNERS, type Corner, SHADES, type Shade } from '../../page/keys';
import { inkOn } from './ink';

// the look of a donor page, picked from its presets: a shade, a corner and a brand colour, each a
// picture of what the page will wear. the organisation page's Look edits the organisation's own
// look through it, and the editor's settings pick a page's.
//
// every choice is a native radio out of sight inside the face that pictures it, one `name` per
// axis, so the keyboard walks an axis with the arrow keys and moves nothing on the others, and the
// face is the whole of what a pointer presses. packages/operator/src/styles/adm.css draws the faces
// (`.adm-swatch`) and says how a taken one and a focused one differ.
//
// a pick is reported at once through `onChange` and nothing here holds a draft or a Save: the
// caller owns the value and whatever writes it.
//
// on a page the look is the organisation's or the page's own, whole — `PAGE_KEYS.look` absent means
// the organisation's (../../page/keys.ts). so the shade and corner groups always show the look the
// page will wear, the organisation's included, and picking one while the page follows the
// organisation gives the page its own look: the organisation's, with that one pick changed.
//
// the brand colour reports on the picker's `change`, when the operator settles on a colour, and not
// on every `input` while a pointer drags across the picker's field.
//
// a look may hold no brand colour, and the donor page then fills with its own unseeded ink. the
// picker draws that as an empty well described as "No colour set", the Organisation chip fills with
// the unseeded ink the page will wear, and a shade or corner pick hands the colour back as it was,
// `null` included: only the picker sets one.

/** a look as the organisation holds it, and as a page holds its own. */
export type Look = {
	readonly shade: Shade;
	readonly corner: Corner;
	/** lowercase `#rrggbb`, or `null` for none set. */
	readonly brandColour: string | null;
};

/** a page's look: the organisation's, or one of its own. */
export type PageLook = { readonly source: 'organisation' } | ({ readonly source: 'custom' } & Look);

type LookControlProps = { readonly className?: string } & (
	| {
			/** the editor's: the Organisation choice beside a look of the page's own. */
			readonly mode: 'page';
			readonly value: PageLook;
			/** the organisation's look — the Organisation chip's fill, and the look it stands for. */
			readonly organisation: Look;
			readonly onChange: (value: PageLook) => void;
	  }
	| {
			/** the organisation page's: the organisation's own look, so no Organisation choice. */
			readonly mode: 'organisation';
			readonly value: Look;
			readonly onChange: (value: Look) => void;
	  }
);

const SHADE_NAMES: Record<Shade, string> = { light: 'Light', warm: 'Warm', cool: 'Cool' };
const CORNER_NAMES: Record<Corner, string> = { square: 'Square', soft: 'Soft', round: 'Round' };

// each shade pictured as the donor page draws it: the card, `--_s` in
// packages/form/src/styles/tokens.css, over the tray, its `--_n3`. literals under a note each,
// because they are the donor page's values and no step of the operator system, and
// ./pictures.spec.ts holds them to that file.
export const SHADE_CARDS: Record<Shade, CSSProperties> = {
	light: { background: 'oklch(0.995 0.001 264)' }, // raw-colour-ok: light's --_s
	warm: { background: 'oklch(0.995 0.006 70)' }, // raw-colour-ok: warm's --_s
	cool: { background: 'oklch(0.995 0.006 240)' } // raw-colour-ok: cool's --_s
};

export const SHADE_TRAYS: Record<Shade, CSSProperties> = {
	light: { background: 'oklch(0.965 0.001 264)' }, // raw-colour-ok: light's --_n3
	warm: { background: 'oklch(0.965 0.006 70)' }, // raw-colour-ok: warm's --_n3
	cool: { background: 'oklch(0.965 0.006 240)' } // raw-colour-ok: cool's --_n3
};

// each corner pictured at the card's own radius, `--_r` in packages/form/src/styles/tokens.css, and
// held to it by ./pictures.spec.ts.
export const CORNER_PICTURES: Record<Corner, CSSProperties> = {
	square: { borderStartStartRadius: 0 },
	soft: { borderStartStartRadius: '8px' }, // raw-length-ok: soft's --_r
	round: { borderStartStartRadius: '12px' } // raw-length-ok: round's --_r
};

// what a donor page fills with while no brand colour is set: `--donate-primary`'s initial-value in
// packages/form/src/styles/tokens.css, as a `#rrggbb` so ./ink.ts can read it, and held to that file
// by ./pictures.spec.ts.
export const UNSEEDED_BRAND = '#262626'; // raw-colour-ok: the donor page's unseeded brand

export function LookControl(props: LookControlProps) {
	const id = useId();
	const look: Look =
		props.mode === 'organisation'
			? props.value
			: props.value.source === 'custom'
				? props.value
				: props.organisation;

	const pick = ({ shade, corner, brandColour }: Look) => {
		if (props.mode === 'organisation') props.onChange({ shade, corner, brandColour });
		else props.onChange({ source: 'custom', shade, corner, brandColour });
	};

	const brandColour = (
		<BrandColour
			id={`${id}-colour`}
			value={look.brandColour}
			onPick={(hex) => pick({ ...look, brandColour: hex })}
		/>
	);

	return (
		<div className={`adm-stack ${props.className ?? ''}`}>
			{props.mode === 'page' ? (
				<fieldset className="adm-fieldset">
					<legend className="adm-fieldset__legend">Colour</legend>
					<div className="adm-pickrow">
						<OrganisationChoice
							name={`${id}-source`}
							brandColour={props.organisation.brandColour}
							checked={props.value.source === 'organisation'}
							onPick={() => props.onChange({ source: 'organisation' })}
						/>
						<label className="adm-swatch adm-swatch--icon">
							<input
								className="adm-vh"
								type="radio"
								name={`${id}-source`}
								checked={props.value.source === 'custom'}
								onChange={() => pick(look)}
							/>
							<Mark name="palette" />
							<span className="adm-vh">Custom</span>
						</label>
					</div>
					{props.value.source === 'custom' ? brandColour : null}
				</fieldset>
			) : (
				brandColour
			)}

			<fieldset className="adm-fieldset">
				<legend className="adm-fieldset__legend">Shade</legend>
				<div className="adm-pickrow">
					{SHADES.map((shade) => (
						<label key={shade} className="adm-swatch adm-swatch--shade" style={SHADE_TRAYS[shade]}>
							<input
								className="adm-vh"
								type="radio"
								name={`${id}-shade`}
								value={shade}
								checked={look.shade === shade}
								onChange={() => pick({ ...look, shade })}
							/>
							<span className="adm-swatch__card" style={SHADE_CARDS[shade]}>
								{SHADE_NAMES[shade]}
							</span>
						</label>
					))}
				</div>
			</fieldset>

			<fieldset className="adm-fieldset">
				<legend className="adm-fieldset__legend">Corners</legend>
				<div className="adm-pickrow">
					{CORNERS.map((corner) => (
						<label key={corner} className="adm-swatch adm-corner">
							<input
								className="adm-vh"
								type="radio"
								name={`${id}-corner`}
								value={corner}
								checked={look.corner === corner}
								onChange={() => pick({ ...look, corner })}
							/>
							<span className="adm-corner__shape" style={CORNER_PICTURES[corner]} />
							<span className="adm-corner__name">{CORNER_NAMES[corner]}</span>
						</label>
					))}
				</div>
			</fieldset>
		</div>
	);
}

/** the Organisation choice, filled with the brand colour a page following the organisation wears. */
function OrganisationChoice({
	name,
	brandColour,
	checked,
	onPick
}: {
	name: string;
	brandColour: string | null;
	checked: boolean;
	onPick: () => void;
}) {
	const fill = brandColour ?? UNSEEDED_BRAND;
	return (
		<label
			className="adm-swatch"
			data-ink={inkOn(fill)}
			style={{
				background: fill, // raw-colour-ok: the organisation's brand colour, as stored, or the page's unseeded one
				borderColor: fill // raw-colour-ok: as above
			}}
		>
			<input className="adm-vh" type="radio" name={name} checked={checked} onChange={onPick} />
			Organisation
		</label>
	);
}

/**
 * the brand colour's picker, reporting a lowercase `#rrggbb` when a colour is settled on. with no
 * colour set it draws empty and opens on the donor page's unseeded ink.
 */
function BrandColour({
	id,
	value,
	onPick
}: {
	id: string;
	value: string | null;
	onPick: (hex: string) => void;
}) {
	const shown = value ?? UNSEEDED_BRAND;
	const ref = useRef<HTMLInputElement>(null);
	const settle = useEffectEvent((event: Event) => {
		onPick((event.currentTarget as HTMLInputElement).value.toLowerCase());
	});

	// react's `onChange` on an input is the `input` event, which a colour picker fires on every
	// step of a drag; the native `change` is the one fired once the colour is chosen.
	useEffect(() => {
		const input = ref.current;
		input?.addEventListener('change', settle);
		return () => input?.removeEventListener('change', settle);
	}, []);

	// left uncontrolled so a drag shows under the pointer before it is reported, and brought back
	// in line whenever the value the caller holds moves.
	useEffect(() => {
		if (ref.current && ref.current.value !== shown) ref.current.value = shown;
	}, [shown]);

	return (
		<div className="adm-field">
			<label className="adm-field__label" htmlFor={id}>
				Brand colour
			</label>
			<input
				ref={ref}
				id={id}
				className="adm-swatch adm-swatch--well"
				type="color"
				defaultValue={shown}
				data-empty={value === null || undefined}
				aria-describedby={value === null ? `${id}-none` : undefined}
			/>
			{value === null ? (
				<span id={`${id}-none`} className="adm-vh">
					No colour set
				</span>
			) : null}
		</div>
	);
}
