// the wording a US 501(c)(3) receipt carries, and the one place a deployment states it.
//
// it is in this package rather than beside a screen because it is not a screen's: no operator
// surface asks for a wording and no press stores one. `servedDeductibilityStatement` in
// `packages/app/src/lib/server/org/deductibility.ts` is the reader, and it puts this sentence on
// every config served from a deployment whose `org_profile.deductibility_statement` is empty —
// which is every deployment nobody has written one on.
//
// nothing here is a rule about what may be stored. ./console/org-rules.ts is where the profile's
// rules are, and the column is not one of them.

/**
 * the sentence a donation form states while asking for a tax-deductible gift.
 *
 * **this is the wording a fork edits.** one deployment serves one organisation (`README.md`), and
 * this product is for US 501(c)(3) organisations, whose sentence is this one — so an organisation
 * whose gifts carry a benefit, a gala ticket or member perks, has an engineer on its own fork and
 * changes the words here. `DEPLOY.md` is where that is written down for whoever deploys, along
 * with the column that overrides it on a single deployment.
 *
 * nothing checks either wording, and no pattern could: a correct statement and a plausible one
 * read the same.
 */
export const SUGGESTED_DEDUCTIBILITY_STATEMENT =
	'No goods or services were provided in exchange for this gift.';
