import { createContext, useContext, useEffect, useState } from 'react';

/**
 * @typedef {object} LedgerSkeletonProps
 * @property {readonly number[]} blocks the named blocks the reading resolves into, as how many lines
 *   each one holds, in the order the screen draws them.
 */

/**
 * how a skeleton tells the {@link SkeletonStatus} over it that it is drawn: the setter of how many
 * are, or `null` where no status stands over it.
 *
 * @type {import('react').Context<import('react').Dispatch<import('react').SetStateAction<number>> | null>}
 */
const Drawn = createContext(
	/** @type {import('react').Dispatch<import('react').SetStateAction<number>> | null} */ (null)
);

/**
 * the status words over the ledger skeletons under it, as one region that stands for the caller's
 * whole life and says `label` for as long as a skeleton under it is drawn, and nothing otherwise.
 *
 * it is apart from the skeleton because the skeleton is a `Suspense` fallback, mounted only while a
 * reading is pending, and a live region that arrives with the wait is one a reader commonly has not
 * registered by the time its words land — ./ProgressBar.jsx's `MoveStatus` holds its region for the
 * same reason. so a caller mounts this outside its boundaries, and a skeleton with none over it says
 * nothing at all.
 *
 * it follows what is drawn rather than the promise behind it: a boundary re-asked inside a
 * transition keeps its resolved content on the screen and draws no skeleton, and words saying the
 * page is asking would be about a wait nobody can see. two boundaries one inside the other are one
 * wait, since the inner skeleton is drawn in the commit the outer one is taken down in.
 *
 * its words are written a task after the change that earns them, for ./ProgressBar.jsx's reason: on
 * the caller's first draw the region and the first skeleton arrive together, and the words have to
 * land in a region that is already standing. `.adm-vh` from ../../styles/base.css: drawn to a reader
 * and not on the screen.
 *
 * @param {{ label: string, children?: import('react').ReactNode }} props
 */
export function SkeletonStatus({ label, children }) {
	const [drawn, setDrawn] = useState(0);
	const waiting = drawn > 0;
	const [said, setSaid] = useState('');
	useEffect(() => {
		const say = setTimeout(() => setSaid(waiting ? label : ''), 0);
		return () => clearTimeout(say);
	}, [waiting, label]);

	return (
		<>
			<div role="status" className="adm-vh">
				{said}
			</div>
			<Drawn.Provider value={setDrawn}>{children}</Drawn.Provider>
		</>
	);
}

/* the shape of a reading that has not landed: a heading over a run of lines, once per named block,
   standing where those blocks will stand so the page does not move when they arrive.

   it is drawn in the ledger's own classes — `.adm-named`, `.adm-ledger`, `.adm-status` and its
   parts, in packages/operator/src/styles/adm.css — so every step between a heading, a line and the
   next line is the one the resolved reading takes, and a change to those steps moves both. what is
   its own is `.adm-skeleton`, the bar standing in for a mark, a heading, a label and a sentence,
   each one line box tall in the type it stands in for.

   every line is drawn with a sentence under it, because the resolved lines this stands in for
   carry one, and a line that carries one takes the ledger's wider step.

   it holds still. the motion tokens name every movement an operator screen may make and a waiting
   placeholder is none of them, so nothing here moves.

   it is hidden from the tree whole and is no live region: the shape says nothing a reader could
   read, and what is waited on is said by the {@link SkeletonStatus} its caller holds over it. */
/** @param {LedgerSkeletonProps} props */
export function LedgerSkeleton({ blocks }) {
	const drawn = useContext(Drawn);
	// counted up while drawn and back down when taken away, so a mount StrictMode runs twice nets
	// one, and the words follow whether any skeleton is on the page.
	useEffect(() => {
		if (drawn === null) return;
		drawn((count) => count + 1);
		return () => drawn((count) => count - 1);
	}, [drawn]);

	return (
		<div className="adm-stack" aria-hidden="true">
			{blocks.map((lines, block) => (
				<div className="adm-named" key={block}>
					<span className="adm-skeleton adm-skeleton--heading" />
					<ul className="adm-ledger">
						{Array.from({ length: lines }, (_, line) => (
							<li key={line}>
								<div className="adm-status">
									<div className="adm-status__mark">
										<span className="adm-skeleton adm-skeleton--mark" />
									</div>
									<div className="adm-status__body">
										<div className="adm-status__head">
											<span className="adm-status__label">
												<span className="adm-skeleton adm-skeleton--label" />
											</span>
										</div>
										<p className="adm-status__note">
											<span className="adm-skeleton adm-skeleton--note" />
										</p>
									</div>
								</div>
							</li>
						))}
					</ul>
				</div>
			))}
		</div>
	);
}
