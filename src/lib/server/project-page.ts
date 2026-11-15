import { error } from '@sveltejs/kit';
import type { ServiceContext } from './context';
import { ServiceError } from './errors';
import { getProject } from './projects';
import { listTasks } from './tasks';

/** Shared load for /inbox and /projects/[id]. */
export async function loadProjectPage(ctx: ServiceContext, projectId: string, url: URL) {
	const showCompleted = url.searchParams.get('completed') === '1';
	try {
		const [project, tasks] = await Promise.all([
			getProject(ctx, projectId),
			listTasks(ctx, { projectId, status: showCompleted ? 'all' : 'open' })
		]);
		return { project, tasks, showCompleted };
	} catch (err) {
		if (err instanceof ServiceError) error(err.status, err.message);
		throw err;
	}
}
