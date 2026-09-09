// what a caller reaches through `@better-giving/emails`. rendering is `/render`'s, so a module
// that only builds a message never pulls react-dom's server renderer in behind it.

export { formatDate, formatMoney } from './format';
export type { EmailTemplate } from './template';
export * as adminAlert from './templates/admin-alert';
export * as invitation from './templates/invitation';
export * as passwordReset from './templates/password-reset';
export * as receipt from './templates/receipt';
export * as testSend from './templates/test-send';
export * as tribute from './templates/tribute';
export * as uncollected from './templates/uncollected';
