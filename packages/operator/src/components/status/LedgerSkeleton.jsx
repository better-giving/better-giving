/**
 * @typedef {object} LedgerSkeletonProps
 * @property {string} label what is being waited on, and the only thing a reader of the tree gets:
 *   the shape drawn under it says nothing a reader could read.
 * @property {readonly number[]} blocks the named blocks the reading resolves into, as how many lines
 *   each one holds, in the order the screen draws them.
 */

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

   the status words are ./ProgressBar.jsx's arrangement: a polite status region whose text is the
   label, visually hidden, beside a drawing hidden from the tree. */
/** @param {LedgerSkeletonProps} props */
export function LedgerSkeleton({ label, blocks }) {
	return (
		<div role="status">
			<span className="adm-vh">{label}</span>
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
		</div>
	);
}
