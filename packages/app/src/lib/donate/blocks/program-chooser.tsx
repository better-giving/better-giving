import { NO_PROGRAM_LABEL } from '@better-giving/form/v1';
import { imageSrc } from '../../page/image-src';
import { Glyph } from './glyph';
import type { BlockOf, PageProgram } from './types';

// where the gift goes, picked on the page rather than in the box: the same active programs the
// box's own select would offer, after the choice of none at all, which is the box's resting answer.
// a pick is the route's to carry into the box (`onPick`); the box then draws no select of its own.
//
// a radio set, each option its own label so the words are the radio's name. locked, each radio is
// `aria-disabled` rather than `disabled`, so the set keeps its place in the tab order and a screen
// reader still reads the pick standing; a press is ignored and the controlled `checked` stays put.
//
// a program with a photo draws it at the option's start, from the deployment's image route by its
// id. it says nothing of its own — the name beside it is the option's name. a program with none
// draws as it always has, and where the gift is needed most is no program and never has one. the
// photos arrive beside the programs, keyed by program id, and never on a program itself: the
// programs are the served config's `v1` options, and a photo is no part of that contract.

export function ProgramChooserBlock({
	block,
	programs,
	chosen,
	onPick,
	locked,
	domId,
	photos = {}
}: {
	readonly block: BlockOf<'program-chooser'>;
	readonly programs: readonly PageProgram[];
	/** the chosen program's id; null is none, the gift going where it is needed most. */
	readonly chosen: string | null;
	readonly onPick: ((id: string | null) => void) | undefined;
	readonly locked: boolean;
	readonly domId: string;
	/** a program's photo, as its stored image id, by the program's id. */
	readonly photos?: Readonly<Record<string, string>> | undefined;
}) {
	const options: readonly (Omit<PageProgram, 'id'> & { readonly id: string | null })[] = [
		{ id: null, name: NO_PROGRAM_LABEL },
		...programs
	];
	return (
		<fieldset className="page-choose" data-variant={block.variant}>
			<legend className="page-choose-legend">Where should your gift go?</legend>
			<div className="page-choose-options">
				{options.map((option) => {
					const photo = option.id === null ? undefined : photos[option.id];
					return (
						<label className="page-choose-option" key={option.id ?? ''}>
							<input
								className="page-choose-input"
								type="radio"
								name={`${domId}-program`}
								value={option.id ?? ''}
								checked={option.id === chosen}
								aria-disabled={locked ? true : undefined}
								onChange={() => {
									if (!locked) onPick?.(option.id);
								}}
							/>
							{photo === undefined ? null : (
								<img className="page-choose-thumb" src={imageSrc(photo)} alt="" loading="lazy" />
							)}
							<span className="page-choose-mark">
								{block.variant === 'cards' && option.id === chosen ? (
									<Glyph name="tick" className="page-choose-tick" />
								) : null}
							</span>
							<span className="page-choose-name">{option.name}</span>
							{option.description === undefined ? null : (
								<span className="page-choose-description">{option.description}</span>
							)}
						</label>
					);
				})}
			</div>
		</fieldset>
	);
}
