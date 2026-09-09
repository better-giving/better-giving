import type { readOrgProfile } from './queries';
import type { OrgProfileField, OrgProfileFormValues } from './org-input';

// the stored row projected back onto the names the wire and the form both use.
//
// one projection, and the console surface answers with it — the two vocabularies differ by design
// (`address_line1` is the input, `addressLine1` is the row) and a second hand-written mapping is
// how one of them starts answering with a column the other does not have.
//
// it is also the whole guard on what leaves the server. `id`, `created_at` and `updated_at` are
// not inputs, so they are not here — a column shipped outward because it happened to be selected
// is how the next one added to this table leaks by default.

/**
 * the stored row, named through the query rather than imported.
 *
 * `../db/schema` exports an `OrgProfile` type and nothing here may reach for it: ./queries.ts is
 * the only module that touches the table, and importing the row type would be the first half of
 * importing the table object. derived from the query's own return type, so the boundary holds and
 * a column change still lands here.
 */
type StoredOrgProfile = NonNullable<Awaited<ReturnType<typeof readOrgProfile>>>;

/**
 * the stored row as the form would have submitted it.
 *
 * a null column becomes an absent key, not an `undefined` one — `exactOptionalPropertyTypes`
 * is on, so the two are different types and `OrgProfileFormValues` admits only the first: its
 * fields are optional rather than `string | undefined`, which is the same thing an input nobody
 * filled in yields. that is the point of the shape: the screen drawing the form states a value for
 * every box and fills an absent key with `''`, so a column holding null arrives at the box as an
 * empty one rather than as a box with no seed at all.
 *
 * spelled out one field at a time rather than derived from the column names: the two vocabularies
 * differ by design — `address_line1` is the input, `addressLine1` is the row — and a string
 * transform between them silently starts yielding `undefined` when a column is renamed. this way a
 * rename is a type error.
 */
export function toFormValues(profile: StoredOrgProfile): OrgProfileFormValues {
	// `legal_name` is the only column that cannot be null, so it is the only one assigned
	// outright; everything else is stated only if it was stated.
	const values: OrgProfileFormValues = { legal_name: profile.legalName };
	put(values, 'tax_id', profile.taxId);
	put(values, 'address_line1', profile.addressLine1);
	put(values, 'address_line2', profile.addressLine2);
	put(values, 'city', profile.city);
	put(values, 'region', profile.region);
	put(values, 'postal_code', profile.postalCode);
	put(values, 'country', profile.country);
	put(values, 'notification_email', profile.notificationEmail);
	return values;
}

function put(values: OrgProfileFormValues, field: OrgProfileField, value: string | null): void {
	if (value !== null) values[field] = value;
}
