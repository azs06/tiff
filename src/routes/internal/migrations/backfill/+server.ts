import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	backfillUser,
	collectAllUserEmails,
	ensureMigrationRun,
	getMigrationRun,
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

	const body = (await request.json().catch(() => ({}))) as {
		runId?: string;
		email?: string;
		batchUsers?: number;
	};
	const selectedEmail = body.email?.trim() || null;

	// Single-user mode
	if (selectedEmail) {
		const runId = crypto.randomUUID();
		await ensureMigrationRun(env.TIFF_DB, runId);

		try {
			await backfillUser(env.TIFF_KV, env.TIFF_DB, selectedEmail);
			await updateMigrationRunProgress(env.TIFF_DB, runId, {
				status: 'completed',
				totalUsers: 1,
				processedUsersDelta: 1,
				notes: `Single user: ${selectedEmail}`,
				finished: true
			});
			return json({ runId, processedUsers: 1, totalUsers: 1, failedUsers: [], scanComplete: true });
		} catch (err) {
			await updateMigrationRunProgress(env.TIFF_DB, runId, {
				status: 'failed',
				totalUsers: 1,
				notes: `Failed: ${selectedEmail} — ${err instanceof Error ? err.message : String(err)}`,
				finished: true
			});
			throw error(500, `Backfill failed for ${selectedEmail}`);
		}
	}

	// Batch mode
	const runId = body.runId?.trim() || crypto.randomUUID();
	const batchUsers = Math.max(1, Math.min(500, Number(body.batchUsers) || 50));

	await ensureMigrationRun(env.TIFF_DB, runId);

	const existing = await getMigrationRun(env.TIFF_DB, runId);
	const offset = existing?.processedUsers ?? 0;

	let allEmails: string[];
	try {
		allEmails = await collectAllUserEmails(env.TIFF_KV);
	} catch (err) {
		await updateMigrationRunProgress(env.TIFF_DB, runId, {
			status: 'failed',
			notes: `KV scan failed: ${err instanceof Error ? err.message : String(err)}`,
			finished: true
		});
		throw error(500, 'Failed to scan KV for user emails');
	}

	const batch = allEmails.slice(offset, offset + batchUsers);
	const scanComplete = offset + batch.length >= allEmails.length;

	const failed: Array<{ email: string; error: string }> = [];
	let processed = 0;
	for (const email of batch) {
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
		status: failed.length > 0 ? 'failed' : scanComplete ? 'completed' : 'running',
		totalUsers: allEmails.length,
		processedUsersDelta: processed,
		notes: failed.length > 0 ? `Failed users: ${failed.map((f) => f.email).join(', ')}` : undefined,
		finished: scanComplete
	});

	return json({
		runId,
		processedUsers: processed,
		totalUsers: allEmails.length,
		failedUsers: failed,
		scanComplete
	});
};
