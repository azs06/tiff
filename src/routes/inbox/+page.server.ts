import type { Actions, PageServerLoad } from './$types';
import { sharedActions } from '$lib/server/actions';
import { getContext } from '$lib/server/context';
import { loadProjectPage } from '$lib/server/project-page';

export const load: PageServerLoad = async (event) => {
	const ctx = await getContext(event);
	return loadProjectPage(ctx, ctx.user.inboxProjectId, event.url);
};

export const actions = sharedActions satisfies Actions;
