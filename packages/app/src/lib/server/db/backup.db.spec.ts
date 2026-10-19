import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { backupDatabase } from './backup';
import { openDatabase } from './open';
import { all, client, rawSql, run, stmt } from './database.testing';

// the copy `pnpm db:backup` writes, opened as the server opens a database, and read back.

const dir = mkdtempSync(join(tmpdir(), 'better-giving-backup-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const photo = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 1, 2]);

describe('backupDatabase()', () => {
	it('writes a database holding every row, a photo’s bytes and the applied migrations included', async () => {
		await run(
			stmt(
				`insert into image (id, kind, content_type, width, height, byte_size, created_at, updated_at)
				 values ('img_1', 'photo', 'image/png', 1, 1, ?, 0, 0)`,
				photo.byteLength
			)
		);
		await run(stmt('insert into image_bytes (image_id, bytes) values (?, ?)', 'img_1', photo));
		const path = join(dir, 'copy.db');

		await backupDatabase(client, path);

		const copy = await openDatabase(pathToFileURL(path).href);
		try {
			const read = rawSql(copy);
			const stored = await read.first<{ bytes: ArrayBuffer }>(
				stmt("select bytes from image_bytes where image_id = 'img_1'")
			);
			expect(new Uint8Array(stored?.bytes ?? new ArrayBuffer(0))).toEqual(photo);
			const applied = stmt('select name from d1_migrations order by id');
			expect(await read.all(applied)).toEqual(await all(applied));
		} finally {
			copy.close();
		}
	});

	it('refuses a path that already holds a file, and leaves that file as it was', async () => {
		const path = join(dir, 'kept.db');
		writeFileSync(path, 'an earlier backup');

		await expect(backupDatabase(client, path)).rejects.toThrow();
		expect(readFileSync(path, 'utf8')).toBe('an earlier backup');
	});
});
