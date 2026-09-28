import { type ReactNode, useEffect } from 'react';
import type { ProgramMode } from '../forms/program-modes';
import type { Block, Page } from '../page/catalog';
import type { Background, Corner, Layout, PageType, Shade } from '../page/keys';
import { BLOCK_MESSAGE, type BlockMessage } from '../page/preview-message';
import { isEmptyDocument, type RichTextDocument } from '../rich-text/document';
import { AboutUsBlock } from './blocks/about-us';
import { FaqBlock } from './blocks/faq';
import { GoalBarBlock } from './blocks/goal-bar';
import { ImpactTiersBlock } from './blocks/impact-tiers';
import { OrgInfoBlock } from './blocks/org-info';
import { ProgramChooserBlock } from './blocks/program-chooser';
import { ShareBlock } from './blocks/share';
import { StoryBlock } from './blocks/story';
import { TitleBlock } from './blocks/title';
import type { PageGoal, PageMoney, PageOrg, PageProgram, PageSharing } from './blocks/types';
import { PageRoot } from './page-root';

// a donor page drawn from its stored document: the Donation page at /donate, a campaign at its
// address, and either one as the editor's preview. one renderer for all three, so the preview is
// what a donor sees.
//
// the route reads everything a block draws beyond its own stored values and hands it in, and it
// builds the donation box itself (`donationBox`), so nothing here knows the card's props. this file
// decides three things: which blocks leave themselves out, where each stands in the page's layout,
// and what the preview reports when a block is clicked.
//
// the donation box is always drawn, exactly once, in normal flow, and never inside another block's
// wrapper: no layout here gives it an ancestor that clips, positions or transforms it, so no block
// can cover it or cut it off. ./page-view.dom.spec.tsx holds that for every layout.
//
// layouts, as ./page.css draws them. on a phone every layout is the stored order. from the page's
// widest breakpoint, `box-right` stands the box in a column of its own beside the other blocks and
// `banner` does the same inside a band at the top, the blocks after the box running full width
// under it; `column` keeps one narrow column at every width. a goal bar or program chooser listed
// directly before the box travels into the box's column with it, so the chooser always stands
// against the box it drives. `cover` needs a hero and then a title first, and the page has no hero
// block, so it draws as `box-right`. an org-info footer always closes the page, wherever it is
// listed.

export type PageLook = {
	/** lowercase `#rrggbb`, or null for the form's own grey. */
	readonly brandColour: string | null;
	readonly shade: Shade;
	readonly corner: Corner;
};

export type PageViewProps = {
	readonly type: PageType;
	readonly page: Page;
	/** a campaign's name, which an empty title heading draws; null on the Donation page. */
	readonly pageName: string | null;
	readonly org: PageOrg;
	/** the look the page is drawn in: its own, or the organisation's. */
	readonly look: PageLook;
	readonly sharing: PageSharing;
	/** a campaign's goal; null where it has none, and on the Donation page. */
	readonly goal: PageGoal | null;
	readonly money: PageMoney;
	/** the active programs the box would offer, in their order. */
	readonly programs: readonly PageProgram[];
	readonly programMode: ProgramMode;
	/** the donation box, built by the route; `hideProgramSelect` is set where the chooser is drawn. */
	readonly donationBox: (options: { readonly hideProgramSelect: boolean }) => ReactNode;
	/** a pick on the program chooser: a program's id, or null for where it's needed most. */
	readonly onProgramPick?: (id: string | null) => void;
	readonly chosenProgramId?: string | null;
	/** drawn as the editor's preview: a click on a block reports the block, and does nothing else. */
	readonly preview?: boolean;
	/** the caller's placement of the page root. */
	readonly className?: string;
};

/** a block's DOM id. stored ids are the drafting model's to choose, so each is kept in a namespace of its own. */
export const blockDomId = (id: string) => `blk-${id}`;

/** blocks that travel into the box's column when listed directly before it. */
const COMPANIONS: ReadonlySet<Block['type']> = new Set(['goal-bar', 'program-chooser']);

export function PageView(props: PageViewProps) {
	const { page, look, org, preview = false, className } = props;
	usePreviewReport(preview);

	const shown = page.blocks.filter((block) => isDrawn(block, props));
	const hideProgramSelect = shown.some((block) => block.type === 'program-chooser');
	const firstTitle = shown.find((block) => block.type === 'title');
	const isFooter = (block: Block) => block.type === 'org-info' && block.variant === 'footer';
	const footers = shown.filter(isFooter);
	const body = shown.filter((block) => !isFooter(block));
	const layout: Layout = page.layout === 'cover' ? 'box-right' : page.layout;

	const draw = (block: Block, ground: Background = block.background) =>
		block.type === 'donation-box' ? (
			<div
				key={block.id}
				className="page-box"
				id={blockDomId(block.id)}
				data-block="donation-box"
				data-block-id={block.id}
			>
				<div className="page-in">{props.donationBox({ hideProgramSelect })}</div>
			</div>
		) : (
			<section
				key={block.id}
				className="page-block"
				id={blockDomId(block.id)}
				data-block={block.type}
				data-block-id={block.id}
				data-background={ground}
			>
				<div className="page-in">{content(block, props, block === firstTitle)}</div>
			</section>
		);

	return (
		<PageRoot
			brandColour={look.brandColour}
			shade={look.shade}
			corner={look.corner}
			palette={page.palette}
			layout={layout}
			{...(className === undefined ? {} : { className })}
		>
			<header className="page-mast">
				<div className="page-in">
					<p className="page-mast-name">{org.name}</p>
				</div>
			</header>
			<main className="page-body">{arranged(body, layout, draw)}</main>
			{footers.length === 0 ? null : (
				<footer className="page-foot">{footers.map((block) => draw(block))}</footer>
			)}
		</PageRoot>
	);
}

type Draw = (block: Block, ground?: Background) => ReactNode;

function arranged(blocks: Block[], layout: Layout, draw: Draw) {
	const flow = (list: Block[]) => (
		<div className="page-flow">{list.map((block) => draw(block))}</div>
	);
	const at = blocks.findIndex((block) => block.type === 'donation-box');
	if (layout === 'column' || at === -1) return flow(blocks);
	let from = at;
	while (from > 0 && COMPANIONS.has(blocks[from - 1]?.type ?? 'donation-box')) from -= 1;
	const lead = blocks.slice(0, from);
	const aside = blocks.slice(from, at + 1);
	const rest = blocks.slice(at + 1);
	const asideColumn = <div className="page-aside">{aside.map((block) => draw(block))}</div>;
	if (layout === 'box-right') {
		return (
			<div className="page-split">
				{lead.length === 0 ? null : (
					<div className="page-lead">{lead.map((block) => draw(block))}</div>
				)}
				{asideColumn}
				{rest.length === 0 ? null : (
					<div className="page-rest">{rest.map((block) => draw(block))}</div>
				)}
			</div>
		);
	}
	// banner: the blocks before the box stand on one band, in the first one's ground, and each
	// draws on none of its own.
	return (
		<>
			<div className="page-band" data-background={lead[0]?.background ?? 'none'}>
				<div className="page-split">
					{lead.length === 0 ? null : (
						<div className="page-lead">{lead.map((block) => draw(block, 'none'))}</div>
					)}
					{asideColumn}
				</div>
			</div>
			{rest.length === 0 ? null : flow(rest)}
		</>
	);
}

const hasWords = (doc: RichTextDocument | null) => doc !== null && !isEmptyDocument(doc);

/** a block with nothing to show leaves itself out. */
function isDrawn(block: Block, props: PageViewProps): boolean {
	switch (block.type) {
		case 'program-chooser':
			return (
				props.type === 'donation_page' &&
				props.programMode === 'choice' &&
				props.programs.length >= 2
			);
		case 'goal-bar':
			return props.type === 'campaign' && props.goal !== null;
		case 'impact-tiers':
			return block.tiers.length > 0;
		case 'faq':
			return block.items.length > 0;
		case 'story':
			return !isEmptyDocument(block.body);
		case 'about-us':
			return hasWords(props.org.mission) || hasWords(props.org.vision);
		case 'share':
			return props.sharing.channels.length > 0;
		case 'title':
		case 'org-info':
		case 'donation-box':
			return true;
	}
}

function content(
	block: Exclude<Block, { type: 'donation-box' }>,
	props: PageViewProps,
	first: boolean
) {
	const domId = blockDomId(block.id);
	switch (block.type) {
		case 'title':
			return (
				<TitleBlock block={block} heading={titleHeading(block.heading, props)} first={first} />
			);
		case 'story':
			return <StoryBlock block={block} />;
		case 'impact-tiers':
			return <ImpactTiersBlock block={block} money={props.money} />;
		case 'faq':
			return <FaqBlock block={block} domId={domId} />;
		case 'about-us':
			return (
				<AboutUsBlock
					block={block}
					mission={hasWords(props.org.mission) ? props.org.mission : null}
					vision={hasWords(props.org.vision) ? props.org.vision : null}
				/>
			);
		case 'org-info':
			return <OrgInfoBlock block={block} info={props.org.info} />;
		case 'share':
			return (
				<ShareBlock
					block={block}
					sharing={props.sharing}
					heading={props.type === 'campaign' ? 'Share this campaign' : 'Share this page'}
				/>
			);
		case 'goal-bar':
			// isDrawn left the bar out where there is no goal
			return props.goal === null ? null : (
				<GoalBarBlock block={block} goal={props.goal} money={props.money} />
			);
		case 'program-chooser':
			return (
				<ProgramChooserBlock
					block={block}
					programs={props.programs}
					chosen={props.chosenProgramId ?? null}
					onPick={props.onProgramPick}
					domId={domId}
				/>
			);
	}
}

/** an empty heading draws a campaign's name, and on the Donation page "Donate to" the organisation. */
function titleHeading(heading: string, { type, pageName, org }: PageViewProps) {
	if (heading.trim() !== '') return heading;
	if (type === 'campaign' && pageName !== null) return pageName;
	return `Donate to ${org.name}`;
}

/**
 * in the preview, a click anywhere in a block posts that block's id to the editor around the frame
 * and goes no further: the preview is a picture of the page, so a link, a share or a pick in it is
 * not followed.
 */
function usePreviewReport(preview: boolean) {
	useEffect(() => {
		if (!preview) return;
		const report = (event: MouseEvent) => {
			const target = event.target instanceof Element ? event.target : null;
			const id = target?.closest<HTMLElement>('[data-block-id]')?.dataset.blockId;
			event.preventDefault();
			if (id === undefined) return;
			const message: BlockMessage = { type: BLOCK_MESSAGE, id };
			window.parent.postMessage(message, window.location.origin);
		};
		document.addEventListener('click', report, true);
		return () => document.removeEventListener('click', report, true);
	}, [preview]);
}
