import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAttachment } from '$lib/server/attachments';
import { getContext } from '$lib/server/context';
import { ServiceError } from '$lib/server/errors';

// Types a browser could render as an active document are always downloaded instead.
const INLINE_TYPES = /^(image\/(png|jpeg|gif|webp|avif)|application\/pdf|text\/plain|audio\/|video\/)/;

export const GET: RequestHandler = async (event) => {
	const r2 = event.platform?.env?.TIFF_ATTACHMENTS;
	if (!r2) error(500, 'Attachment storage is not configured');

	const ctx = await getContext(event);
	const attachment = await getAttachment(ctx, event.params.attachmentId).catch((err) => {
		if (err instanceof ServiceError) error(err.status, err.message);
		throw err;
	});

	const object = await r2.get(attachment.r2Key);
	if (!object) error(404, 'File not found');

	const contentType = attachment.contentType || 'application/octet-stream';
	const disposition = INLINE_TYPES.test(contentType) ? 'inline' : 'attachment';
	const filename = encodeURIComponent(attachment.name);

	return new Response(object.body, {
		headers: {
			'content-type': contentType,
			'content-length': String(object.size),
			'content-disposition': `${disposition}; filename*=UTF-8''${filename}`,
			'x-content-type-options': 'nosniff',
			'cache-control': 'private, max-age=300',
			etag: object.httpEtag
		}
	});
};
