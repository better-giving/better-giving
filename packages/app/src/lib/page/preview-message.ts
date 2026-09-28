// what a donor page drawn as the editor's preview posts to the editor around it when a block is
// clicked: `{ type: BLOCK_MESSAGE, id }`, the block's own id as the page document stores it. the
// page posts it ($lib/donate/page-view.tsx) and the editor's frame reads it
// ($lib/admin/editor/preview-frame.tsx); it lives here because the page imports nothing of the
// dashboard's.

export const BLOCK_MESSAGE = 'bg-page-block';

export type BlockMessage = { readonly type: typeof BLOCK_MESSAGE; readonly id: string };
