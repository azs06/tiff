import type { Actions, PageServerLoad } from './$types';
import { sharedActions } from '$lib/server/shared-actions';
import { collectAllUserEmails } from '$lib/server/migrations';
import { hasAnyStorage } from '$lib/storage';

export const load: PageServerLoad = async ({ platform }) => {
	const env = platform?.env;
	const migrationEnabled = Boolean(env?.TIFF_DB && env?.TIFF_KV && env?.MIGRATION_ADMIN_TOKEN);

	if (!migrationEnabled || !hasAnyStorage(env) || !env?.TIFF_KV) {
		return { kvUsers: [] as string[] };
	}

	try {
		const kvUsers = await collectAllUserEmails(env.TIFF_KV);
		return { kvUsers };
	} catch {
		return { kvUsers: [] as string[] };
	}
};

export const actions = sharedActions satisfies Actions;
