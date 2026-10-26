// the messages between a donor page drawn as the editor's preview and the editor around it. the
// page posts the section that was clicked, `{ type: SECTION_MESSAGE, id }` — a `SectionId` of
// ./content-edit.ts — and `{ type: READY_MESSAGE }` once it is listening; the editor answers that,
// and every press of its Edit, with `{ type: EDITING_MESSAGE, on }`, which the page draws its
// sections as clickable by. the page posts and listens ($lib/donate/page-view.tsx) and the
// editor's frame does the other half ($lib/admin/editor/preview-frame.tsx); it lives here because
// the page imports nothing of the dashboard's.

export const SECTION_MESSAGE = 'bg-page-section';
export const READY_MESSAGE = 'bg-page-ready';
export const EDITING_MESSAGE = 'bg-page-editing';

export type SectionMessage = { readonly type: typeof SECTION_MESSAGE; readonly id: string };
export type ReadyMessage = { readonly type: typeof READY_MESSAGE };
export type EditingMessage = { readonly type: typeof EDITING_MESSAGE; readonly on: boolean };
