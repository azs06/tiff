import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProjects } from '$lib/storage';

function safeHeaderFilename(filename: string): string {
	return filename.replace(/[\r\n"]/g, '').trim() || 'attachment';
}

export const GET: RequestHandler = async ({ locals, params, platform }) => {
	const env = platform?.env;
	const r2 = platform?.env.TIFF_ATTACHMENTS;
	if (!r2) throw error(500, 'Storage is not configured');

	const projects = await getProjects(env, locals.userEmail);
	const project = projects.find((p) => p.id === params.projectId);
	if (!project) throw error(404, 'Project not found');

	const attachment = project.attachments?.find((a) => a.id === params.attachmentId);
	if (!attachment) throw error(404, 'Attachment not found');

	if (!attachment.key) {
		if (attachment.url) throw redirect(302, attachment.url);
		throw error(404, 'Attachment key is missing');
	}

	const object = await r2.get(attachment.key);
	if (!object) throw error(404, 'File not found');

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);
	headers.set('content-disposition', `inline; filename="${safeHeaderFilename(attachment.name)}"`);
	if (!headers.get('content-type')) {
		headers.set('content-type', attachment.contentType || 'application/octet-stream');
	}
	if (attachment.size && !headers.get('content-length')) {
		headers.set('content-length', String(attachment.size));
	}

	return new Response(object.body, { headers });
};
