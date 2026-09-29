// which of a page's pictures an AI drew. the page never says: an image's `kind` does
// ($lib/server/db/schema.ts's `IMAGE_KINDS`), read when the page is, so a photo put in a block by
// hand or by the chat clears the mark by being a photo. a hero or an image block carries
// `illustration` on what a donor page and the editor are drawn with, and no stored page carries it.
//
// pure and not under `$lib/server/**`: the donor page and the editor draw what these return.
import type { Block, Page } from './catalog';

type PhotoBlock = Extract<Block, { type: 'hero' | 'image' }>;

/** a block as a donor page draws it: a hero or an image block marked where its picture was drawn. */
export type MarkedBlock = Exclude<Block, PhotoBlock> | (PhotoBlock & { illustration: boolean });
export type MarkedPage = Omit<Page, 'blocks'> & { blocks: MarkedBlock[] };

/** the id of each picture the page places. */
export function placedImageIds(page: Pick<Page, 'blocks'>): string[] {
	return page.blocks.flatMap((block) =>
		isPhotoBlock(block) && block.imageId !== null ? [block.imageId] : []
	);
}

/** `page` with each hero and image block marked by whether `illustrations` holds its picture. */
export function markIllustrations(page: Page, illustrations: ReadonlySet<string>): MarkedPage {
	return {
		...page,
		blocks: page.blocks.map((block) =>
			isPhotoBlock(block) ? { ...block, illustration: isIllustrated(block, illustrations) } : block
		)
	};
}

/** whether `block` is a hero or an image block holding a picture `illustrations` names. */
export function isIllustrated(block: Block, illustrations: ReadonlySet<string>): boolean {
	return isPhotoBlock(block) && block.imageId !== null && illustrations.has(block.imageId);
}

function isPhotoBlock(block: Block): block is PhotoBlock {
	return block.type === 'hero' || block.type === 'image';
}
