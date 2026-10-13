import type { FormConfig } from '@better-giving/form/v1';
import { useCallback, useState } from 'react';
import { DonateCard, type DonateCardProps } from './card';
import type { CheckoutMounts } from './machine';
import { PageView, type PageViewProps } from './page-view';

// a donor page with the donation card in its box, the pair a route mounts.
//
// the program chooser and the card are read off one configuration here, the served config the card
// takes gifts against: the chooser lists that config's own programs under its own mode, so it can
// offer nothing the card would refuse. where the page draws the chooser, its pick goes to the card
// as `pageProgram` and the card draws no select of its own; where it does not, the card is handed
// nothing and asks for itself.
//
// the chooser draws the flow's answer rather than the pick it sent: the card reports the program the
// gift holds and whether it still takes one, and from the press on Donate the chooser is locked, so
// the page never shows a cause the gift was not asked for with.

export type PageWithCardProps = Omit<
	PageViewProps,
	'donationBox' | 'programs' | 'programMode' | 'onProgramPick' | 'chosenProgramId' | 'chooserLocked'
> & {
	/** the served configuration the card takes the gift against, as the card itself takes it. */
	readonly config: FormConfig;
	/** the card's provider seams, which only a spec passes. */
	readonly seams?: CheckoutMounts['seams'];
	/** where the card starts, the card's own `opening`. */
	readonly opening?: DonateCardProps['opening'];
	/** whether the address carries this page's resume stamp, the card's own `resuming`. */
	readonly resuming?: boolean;
};

export function PageWithCard({ config, seams, opening, resuming, ...page }: PageWithCardProps) {
	const [picked, setPicked] = useState<string | null>(null);
	const [held, setHeld] = useState<{ programId: string | null; locked: boolean }>({
		programId: null,
		locked: false
	});
	const report = useCallback((programId: string | null, locked: boolean) => {
		setHeld({ programId, locked });
	}, []);
	const program = config.program;

	return (
		<PageView
			{...page}
			programs={program?.mode === 'choice' ? program.options : []}
			programMode={program?.mode ?? 'none'}
			chosenProgramId={held.programId}
			chooserLocked={held.locked}
			onProgramPick={setPicked}
			donationBox={({ hideProgramSelect }) => (
				<DonateCard
					config={config}
					onProgramChange={report}
					{...(seams === undefined ? {} : { seams })}
					{...(opening === undefined ? {} : { opening })}
					{...(resuming === undefined ? {} : { resuming })}
					{...(hideProgramSelect ? { pageProgram: picked } : {})}
				/>
			)}
		/>
	);
}
