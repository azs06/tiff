import type { Actions, PageServerLoad } from './$types';
import { sharedActions } from '$lib/server/actions';
import { getContext } from '$lib/server/context';
import { listProjects } from '$lib/server/projects';

export const load: PageServerLoad = async (event) => {
	const ctx = await getContext(event);
	return { archived: await listProjects(ctx, { archived: true }) };
};

export const actions = sharedActions satisfies Actions;
