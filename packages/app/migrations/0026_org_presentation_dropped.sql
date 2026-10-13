-- drops `org_presentation`. the dashboard's organisation page was its only reader and writer, and
-- the organisation's story, brand colour and logo are `org_profile`'s; nothing in it is carried
-- across. no table, trigger or view references it. its two logo columns are keys to `image`, so the
-- drop's implicit delete removes child rows only, which no enforced key refuses, and no deferral is
-- needed. an image only those columns named stays in `image`, with its bytes, unreferenced.
DROP TABLE `org_presentation`;
