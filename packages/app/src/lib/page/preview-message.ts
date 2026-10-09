// the messages between a donor page drawn as the editor's preview and the editor around it. the
// page posts the id of a block that was clicked, `{ type: BLOCK_MESSAGE, id }`, the block's own id
// as the page document stores it, and `{ type: READY_MESSAGE }` once it is listening; the editor
// answers that, and every press of its Edit, with `{ type: EDITING_MESSAGE, on }`, which the page
// draws its blocks as clickable by. the page posts and listens ($lib/donate/page-view.tsx) and the
// editor's frame does the other half ($lib/admin/editor/preview-frame.tsx); it lives here because
// the page imports nothing of the dashboard's.

export const BLOCK_MESSAGE = 'bg-page-block';
export const READY_MESSAGE = 'bg-page-ready';
export const EDITING_MESSAGE = 'bg-page-editing';

export type BlockMessage = { readonly type: typeof BLOCK_MESSAGE; readonly id: string };
export type ReadyMessage = { readonly type: typeof READY_MESSAGE };
export type EditingMessage = { readonly type: typeof EDITING_MESSAGE; readonly on: boolean };
