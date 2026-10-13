// the editor's Settings sheet as its goal and end date post: two forms, each under its id where it
// is posted ($lib/admin/editor/page-settings.tsx) and where it is read
// ($lib/server/pages/page-settings.ts), and named by both editors' actions. a body carries every
// box its form states, blank where the choice needs none.

export const PAGE_GOAL_FORM_ID = 'page-goal';
export const PAGE_END_DATE_FORM_ID = 'page-end-date';

export const PAGE_SETTING_FORM_IDS = [PAGE_GOAL_FORM_ID, PAGE_END_DATE_FORM_ID] as const;
export type PageSettingFormId = (typeof PAGE_SETTING_FORM_IDS)[number];
