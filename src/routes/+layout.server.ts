import type { LayoutServerLoad } from './$types';
import { loadAppData } from '$lib/server/shared-load';

export const load: LayoutServerLoad = async ({ locals, platform }) => {
	return loadAppData(locals, platform);
};
