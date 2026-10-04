import { type ReactNode, useEffect } from 'react';
import type { ProgramMode } from '../forms/program-modes';
import type { Block, Page } from '../page/catalog';
import { imageSrc } from '../page/image-src';
import type { Background, Corner, Layout, PageType, Shade } from '../page/keys';
import { BLOCK_MESSAGE, type BlockMessage } from '../page/preview-message';
import { isEmptyDocument } from '../rich-text/document';
import { AboutUsBlock } from './blocks/about-us';
import { FaqBlock } from './blocks/faq';
import { GoalBarBlock } from './blocks/goal-bar';
import { HeroBlock } from './blocks/hero';
import { ImageBlock } from './blocks/image';
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
// can cover it or cut it off. the cover is the one positioned block, and the box stands after it,
// never over it. ./page-view.dom.spec.tsx holds that for every layout.
//
// layouts, as ./page.css draws them. on a phone every layout is the stored order. from the page's
// widest breakpoint, `box-right` stands the box in a column of its own beside the other blocks and
// `banner` does the same inside a band at the top, the blocks after the box running full width
// under it; `column` keeps one narrow column at every width. a goal bar or program chooser listed
// directly before the box travels into the box's column with it, so the chooser always stands
// against the box it drives. `cover` needs a hero then a title as the first two blocks drawn: the
// hero runs edge to edge under the masthead with the title laid over it, and the rest of the page
// is `box-right` under it. a cover page without that pair draws as `box-right`, its hero in the
// flow where it is listed. an org-info footer always closes the page, wherever it is listed. a hero
// or image block with no photo leaves itself out.
//
// the masthead stands above every block and names the organisation. with a logo, a logo at least
// twice as wide as it is tall stands in for the name and carries it as its alt, and a narrower one
// stands beside the name and says nothing of its own; the stored image's width and height decide.
// with none, a badge of the name's initials stands beside the name, in the page's brand fill and
// corner (./page.css), and like a narrower logo says nothing of its own.
// a hero or image block marked as an AI illustration is captioned so, and a program's photo stands
// on its chooser option. every image arrives by stored image id, drawn from the deployment's own
// image route and never from an address a page carries.

export type PageLook = {
	/** lowercase `#rrggbb`, or null for the form's own grey. */
	readonly brandColour: string | null;
	readonly shade: Shade;
	readonly corner: Corner;
};

/** the organisation's logo: its stored image, and that image's shape. */
export type PageLogo = {
	readonly imageId: string;
	readonly width: number;
	readonly height: number;
};

export type PageViewProps = {
	readonly type: PageType;
	readonly page: Page;
	/** a campaign's name, which an empty title heading draws; null on the Donation page. */
	readonly pageName: string | null;
	readonly org: PageOrg;
	/** the organisation's logo, atop the page; null or absent where it has none. */
	readonly logo?: PageLogo | null | undefined;
	/** the look the page is drawn in: its own, or the organisation's. */
	readonly look: PageLook;
	readonly sharing: PageSharing;
	/** a campaign's goal; null where it has none, and on the Donation page. */
	readonly goal: PageGoal | null;
	readonly money: PageMoney;
	/** the active programs the box would offer, in their order. */
	readonly programs: readonly PageProgram[];
	readonly programMode: ProgramMode;
	/** a program's photo on the chooser, as its stored image id, by the program's id. */
	readonly programPhotos?: Readonly<Record<string, string>> | undefined;
	/** the donation box, built by the route; `hideProgramSelect` is set where the chooser is drawn. */
	readonly donationBox: (options: { readonly hideProgramSelect: boolean }) => ReactNode;
	/** a pick on the program chooser: a program's id, or null for where it's needed most. */
	readonly onProgramPick?: (id: string | null) => void;
	readonly chosenProgramId?: string | null;
	/** the chooser takes no pick: the gift it would change has already been asked for. */
	readonly chooserLocked?: boolean;
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
	const cover = page.layout === 'cover' ? coverOf(body) : null;
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
				<div className="page-in" inert={preview}>
					{props.donationBox({ hideProgramSelect })}
				</div>
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
			layout={cover === null ? layout : 'cover'}
			{...(className === undefined ? {} : { className })}
		>
			<Masthead name={org.name} logo={props.logo ?? null} />
			<main className="page-body">
				{cover === null ? (
					arranged(body, layout, draw)
				) : (
					<>
						<section
							className="page-block"
							id={blockDomId(cover.hero.id)}
							data-block="hero"
							data-block-id={cover.hero.id}
							data-background={cover.hero.background}
						>
							<HeroBlock
								block={cover.hero}
								imageSrc={imageSrc}
								over={
									<div
										id={blockDomId(cover.title.id)}
										data-block="title"
										data-block-id={cover.title.id}
									>
										<TitleBlock
											block={cover.title}
											heading={titleHeading(cover.title.heading, props)}
											first={cover.title === firstTitle}
										/>
									</div>
								}
							/>
						</section>
						{arranged(body.slice(2), layout, draw)}
					</>
				)}
			</main>
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
	// draws on none of its own. the band never takes a strong ground: the box's column stands on it,
	// and a goal bar's brand fill would be drawn on a ground of its own colour, so strong draws as tint.
	const first = lead[0]?.background ?? 'none';
	return (
		<>
			<div className="page-band" data-background={first === 'strong' ? 'tint' : first}>
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

export function Masthead({
	name,
	logo
}: {
	readonly name: string;
	readonly logo: PageLogo | null;
}) {
	if (logo === null) {
		const letters = initials(name);
		return (
			<header className="page-mast">
				<div className="page-in page-mast-in">
					{letters === '' ? null : (
						<span className="page-mast-badge" aria-hidden="true">
							{letters}
						</span>
					)}
					<p className="page-mast-name">{name}</p>
				</div>
			</header>
		);
	}
	const art = (alt: string) => (
		<img
			className="page-mast-logo"
			src={imageSrc(logo.imageId)}
			alt={alt}
			width={logo.width}
			height={logo.height}
		/>
	);
	return (
		<header className="page-mast">
			<div className="page-in page-mast-in">
				{logo.width >= 2 * logo.height ? (
					<p className="page-mast-name">{art(name)}</p>
				) : (
					<>
						{art('')}
						<p className="page-mast-name">{name}</p>
					</>
				)}
			</div>
		</header>
	);
}

/**
 * the first letter of each of the name's first two words, upper-cased, a leading "The" passed over
 * where a word follows it: "The Hope Fund" is `HF`, "Kiva" is `K`. a word holding no letter, an `&`,
 * a dash or a `1%`, is not counted, and a name with none is `''`, which draws no badge. a letter
 * keeps its combining marks, so a decomposed accent survives. upper-cased with no locale, so the
 * server's render and a Turkish-locale browser's hydration read the same `I`.
 */
export function initials(name: string): string {
	const words = name.split(/\s+/).filter((word) => word !== '');
	const named = words.length > 1 && words[0]?.toLowerCase() === 'the' ? words.slice(1) : words;
	return named
		.flatMap((word) => /\p{L}\p{M}*/u.exec(word)?.[0] ?? [])
		.slice(0, 2)
		.join('')
		.toUpperCase();
}

/** the cover's hero and the title laid over it: the first two blocks drawn, in that order. */
function coverOf(body: readonly Block[]) {
	const [hero, title] = body;
	if (hero?.type !== 'hero' || title?.type !== 'title') return null;
	return { hero, title };
}

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
			return props.org.mission !== null || props.org.vision !== null;
		case 'share':
			return props.sharing.channels.length > 0;
		case 'hero':
		case 'image':
			return block.imageId !== null;
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
			return <AboutUsBlock block={block} mission={props.org.mission} vision={props.org.vision} />;
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
		case 'hero':
			return <HeroBlock block={block} imageSrc={imageSrc} />;
		case 'image':
			return <ImageBlock block={block} imageSrc={imageSrc} />;
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
					locked={props.chooserLocked ?? false}
					domId={domId}
					photos={props.programPhotos}
				/>
			);
	}
}

/** an empty heading draws a campaign's name, and on the Donation page "Donate to" the organisation. */
export function titleHeading(
	heading: string,
	{
		type,
		pageName,
		org
	}: Pick<PageViewProps, 'type' | 'pageName'> & { readonly org: Pick<PageOrg, 'name'> }
) {
	if (heading.trim() !== '') return heading;
	if (type === 'campaign' && pageName !== null) return pageName;
	return `Donate to ${org.name}`;
}

/** every element a keyboard can stop on, the ones inside the inert donation box aside. */
const TAB_STOPS =
	'a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable]';

/**
 * in the preview, a click anywhere in a block posts that block's id to the editor around the frame
 * and goes no further: the preview is a picture of the page, so a link, a share or a pick in it is
 * not followed, and no handler of a block's hears it. nothing in it takes a tab stop either — the
 * donation box is inert, and every other stop is taken out of the order. the document itself stays
 * live, since an inert one would take no click to report.
 */
function usePreviewReport(preview: boolean) {
	useEffect(() => {
		if (!preview) return;
		for (const stop of document.querySelectorAll<HTMLElement>(TAB_STOPS)) stop.tabIndex = -1;
		const report = (event: MouseEvent) => {
			const target = event.target instanceof Element ? event.target : null;
			const id = target?.closest<HTMLElement>('[data-block-id]')?.dataset.blockId;
			event.preventDefault();
			event.stopPropagation();
			if (id === undefined) return;
			const message: BlockMessage = { type: BLOCK_MESSAGE, id };
			window.parent.postMessage(message, window.location.origin);
		};
		document.addEventListener('click', report, true);
		return () => document.removeEventListener('click', report, true);
	}, [preview]);
}
