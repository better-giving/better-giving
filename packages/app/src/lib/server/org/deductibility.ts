import { SUGGESTED_DEDUCTIBILITY_STATEMENT } from '@better-giving/operator/deductibility';
import { present } from './receipt-fields';

// the sentence a donation form states while asking for a tax-deductible gift, decided here for
// every path that serves one.
//
// **the standard wording is the answer and the column is the exception.** this product is for US
// 501(c)(3) organisations (`README.md`), whose receipts carry the same sentence — so a deployment
// is not asked to compose one and nothing on either operator surface draws a box for it. an
// organisation whose gifts carry a benefit words it differently, and this repository is one fork
// per organisation: that fork edits the wording where it is stated, which is
// `packages/operator/src/deductibility.ts`, or writes `org_profile.deductibility_statement` on its
// own deployment. `DEPLOY.md` is where both are written down for whoever deploys.
//
// **the column is read and never written by a screen.** `saveOrgProfile` in ./queries.ts leaves it
// out of the columns it stores, so a wording a fork wrote survives every profile save — and there
// is nothing to seed, because an unwritten column is the standard sentence by this reading rather
// than by a default.
//
// `present` is ./receipt-fields.ts's, so a whitespace-only value written by hand reads as unwritten
// here and everywhere else rather than putting a blank line on a screen asking for money.

/** what a form states, which is the organisation's own wording or the standard one. */
export function servedDeductibilityStatement(stored: string | null): string {
	return present(stored) ? stored : SUGGESTED_DEDUCTIBILITY_STATEMENT;
}
