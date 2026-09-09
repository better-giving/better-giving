// a profile row put straight into the table, for the states no save can produce.
//
// not a spec itself — no pool's `include` matches this name, which is what keeps it a module two
// specs import rather than a third file of tests, the same arrangement `../db/rejection.testing.ts`
// describes. nothing in the app imports it.
//
// it exists because `parseOrgProfile` (./org-input.ts) refuses a blank in six of the ten boxes, so
// the console can no longer save a profile that is missing one — while `missingForReceipt`
// (./receipt-fields.ts) and `identityMissing` (./identity.ts) both still have an arm for a row that
// is. that arm is not dead: a row can arrive from an importer or a `wrangler d1 execute` without
// ever passing through TypeScript, and a reader that stopped reporting one would be reporting the
// console's rules rather than the database's contents. this is how a spec reaches it.

/** the columns `writeOrgRow` may state. `legal_name` is not among them: it is always written. */
export type OrgColumn =
	| 'tax_id'
	| 'address_line1'
	| 'address_line2'
	| 'city'
	| 'region'
	| 'postal_code'
	| 'country'
	| 'notification_email'
	| 'deductibility_statement';

/**
 * writes the singleton row with only the columns it is given, and nothing else stated.
 *
 * `legal_name` is always written because the column is NOT NULL, and the timestamps because they
 * have no defaults in SQL — `$onUpdateFn` is drizzle's and this does not go through drizzle at
 * all. an unstated column is left null, which is the shape being reached for.
 *
 * the D1 handle is passed rather than imported, so this module names no binding and no pool.
 */
export async function writeOrgRow(
	database: D1Database,
	columns: Partial<Record<OrgColumn, string>> = {}
): Promise<void> {
	const stated = Object.keys(columns) as OrgColumn[];
	await database
		.prepare(
			`insert into org_profile (id, legal_name, created_at, updated_at${stated.map((column) => `, ${column}`).join('')})
			 values ('default', 'Hope Foundation', 0, 0${stated.map(() => ', ?').join('')})`
		)
		.bind(...stated.map((column) => columns[column]))
		.run();
}
