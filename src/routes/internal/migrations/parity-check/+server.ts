import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ensureMigrationRun, parityCheckUser, updateMigrationRunProgress } from '$lib/server/migrations';

function requireMigrationToken(request: Request, token: string | undefined) {
	if (!token) throw error(500, 'MIGRATION_ADMIN_TOKEN is not configured');
	const auth = request.headers.get('authorization') ?? '';
	if (!auth.startsWith('Bearer ')) throw error(401, 'Missing bearer token');
	const provided = auth.slice('Bearer '.length).trim();
	if (provided !== token) throw error(403, 'Invalid bearer token');
}

function resolveEmails(bodyEmails: unknown, canaryRaw: string | undefined): string[] {
	if (Array.isArray(bodyEmails)) {
		return bodyEmails.map((value) => String(value).trim()).filter(Boolean);
	}
	if (!canaryRaw?.trim()) return [];
	return canaryRaw
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);
}

export const POST: RequestHandler = async ({ request, platform }) => {
	const env = platform?.env;
	if (!env?.TIFF_KV || !env.TIFF_DB) throw error(500, 'Both KV and D1 must be configured');
	if (!env.MIGRATION_ADMIN_TOKEN) throw error(500, 'MIGRATION_ADMIN_TOKEN is not configured');

	requireMigrationToken(request, env.MIGRATION_ADMIN_TOKEN);

	const body = await request.json().catch(() => ({})) as {
		runId?: string;
		emails?: string[];
	};
	const emails = resolveEmails(body.emails, env.D1_CANARY_EMAILS);
	if (emails.length === 0) {
		throw error(400, 'No users provided. Send `emails` or configure D1_CANARY_EMAILS.');
	}

	const results = await Promise.all(emails.map((email) => parityCheckUser(env.TIFF_KV, env.TIFF_DB, email)));
	const mismatches = results.filter((result) => !result.matches);

	if (body.runId?.trim()) {
		const runId = body.runId.trim();
		await ensureMigrationRun(env.TIFF_DB, runId);
		await updateMigrationRunProgress(env.TIFF_DB, runId, {
			mismatchedUsers: mismatches.length,
			status: mismatches.length > 0 ? 'failed' : 'running',
			notes:
				mismatches.length > 0
					? `Parity mismatches for: ${mismatches.map((m) => m.email).join(', ')}`
					: 'Parity check passed for requested users'
		});
	}

	return json({
		checkedUsers: results.length,
		mismatchedUsers: mismatches.length,
		results
	});
};
