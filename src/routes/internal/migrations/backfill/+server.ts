import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	backfillUser,
	collectUserEmailBatch,
	decodeCursor,
	ensureMigrationRun,
	updateMigrationRunProgress
} from '$lib/server/migrations';

function requireMigrationToken(request: Request, token: string | undefined) {
	if (!token) throw error(500, 'MIGRATION_ADMIN_TOKEN is not configured');
	const auth = request.headers.get('authorization') ?? '';
	if (!auth.startsWith('Bearer ')) throw error(401, 'Missing bearer token');
	const provided = auth.slice('Bearer '.length).trim();
	if (provided !== token) throw error(403, 'Invalid bearer token');
}

export const POST: RequestHandler = async ({ request, platform }) => {
	const env = platform?.env;
	if (!env?.TIFF_KV || !env.TIFF_DB) throw error(500, 'Both KV and D1 must be configured');
	if (!env.MIGRATION_ADMIN_TOKEN) throw error(500, 'MIGRATION_ADMIN_TOKEN is not configured');

	requireMigrationToken(request, env.MIGRATION_ADMIN_TOKEN);

	const body = await request.json().catch(() => ({})) as {
		runId?: string;
		cursor?: string;
		batchUsers?: number;
	};
	const runId = body.runId?.trim() || crypto.randomUUID();
	const batchUsers = Math.max(1, Math.min(500, Number(body.batchUsers) || 50));

	await ensureMigrationRun(env.TIFF_DB, runId);

	const cursorState = decodeCursor(body.cursor ?? null);
	const batch = await collectUserEmailBatch(env.TIFF_KV, cursorState, batchUsers);

	const failed: Array<{ email: string; error: string }> = [];
	let processed = 0;
	for (const email of batch.emails) {
		try {
			await backfillUser(env.TIFF_KV, env.TIFF_DB, email);
			processed += 1;
		} catch (err) {
			failed.push({
				email,
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}

	await updateMigrationRunProgress(env.TIFF_DB, runId, {
		status: failed.length > 0 ? 'failed' : batch.scanComplete ? 'completed' : 'running',
		cursor: batch.nextCursor,
		processedUsersDelta: processed,
		notes: failed.length > 0 ? `Failed users: ${failed.map((f) => f.email).join(', ')}` : undefined,
		finished: batch.scanComplete
	});

	return json({
		runId,
		processedUsers: processed,
		failedUsers: failed,
		nextCursor: batch.nextCursor,
		scanComplete: batch.scanComplete
	});
};
