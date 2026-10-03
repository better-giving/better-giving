-- drops `zapier_key`. migrations/0017_zapier_key_is_an_api_key.sql carried its key's hash into a
-- `zapier` row of `api_key` and nulled the plaintext, and nothing reads or writes the table after
-- it. no table, trigger or view references it, so the drop touches no other row.
DROP TABLE `zapier_key`;