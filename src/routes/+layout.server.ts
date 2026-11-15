import type { LayoutServerLoad } from './$types';
import { getContext } from '$lib/server/context';
import { ServiceError } from '$lib/server/errors';
import { listProjects } from '$lib/server/projects';
import { getTaskDetail, listLabels, navCounts } from '$lib/server/tasks';

export const load: LayoutServerLoad = async (event) => {
	const ctx = await getContext(event);
	const taskId = event.url.searchParams.get('task');

	const [projects, labels, counts, taskDetail] = await Promise.all([
		listProjects(ctx),
		listLabels(ctx),
		navCounts(ctx),
		taskId
			? getTaskDetail(ctx, taskId).catch((err) => {
					if (err instanceof ServiceError) return null;
					throw err;
				})
			: Promise.resolve(null)
	]);

	return { user: ctx.user, today: ctx.today, projects, labels, counts, taskDetail };
};
