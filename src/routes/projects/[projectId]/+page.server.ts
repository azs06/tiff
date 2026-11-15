import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { sharedActions } from '$lib/server/actions';
import { getContext } from '$lib/server/context';
import { loadProjectPage } from '$lib/server/project-page';

export const load: PageServerLoad = async (event) => {
	const ctx = await getContext(event);
	if (event.params.projectId === ctx.user.inboxProjectId) redirect(307, `/inbox${event.url.search}`);
	return loadProjectPage(ctx, event.params.projectId, event.url);
};

export const actions = sharedActions satisfies Actions;
