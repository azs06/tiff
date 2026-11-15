import type { Attachment } from '$lib/types';
import type { ServiceContext } from './context';
import { invalid, notFound } from './errors';
import { requireEditor } from './projects';

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

type AttachmentRow = {
	id: string;
	project_id: string;
	name: string;
	r2_key: string;
	content_type: string | null;
	size: number;
	uploaded_by: string;
	created_at: number;
};

function cleanFileName(name: string): string {
	const cleaned = name.replace(/[\u0000-\u001f\u007f"\\/]/g, '').trim();
	return (cleaned || 'attachment').slice(0, 200);
}

export async function uploadAttachment(
	ctx: ServiceContext,
	r2: R2Bucket,
	projectId: string,
	file: File
): Promise<void> {
	await requireEditor(ctx, projectId);
	if (file.size === 0) throw invalid('The file is empty');
	if (file.size > MAX_ATTACHMENT_BYTES) throw invalid('Files must be 25 MB or smaller');

	const id = crypto.randomUUID();
	const key = `projects/${projectId}/${id}`;
	const contentType = file.type || 'application/octet-stream';
	await r2.put(key, file, { httpMetadata: { contentType } });

	try {
		await ctx.db
			.prepare(
				`INSERT INTO attachments (id, project_id, name, r2_key, content_type, size, uploaded_by, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(id, projectId, cleanFileName(file.name), key, contentType, file.size, ctx.user.email, Date.now())
			.run();
	} catch (err) {
		await r2.delete(key);
		throw err;
	}
}

async function findAttachment(ctx: ServiceContext, attachmentId: string): Promise<AttachmentRow> {
	const row = await ctx.db
		.prepare(
			`SELECT a.* FROM attachments a
			 JOIN project_members m ON m.project_id = a.project_id AND m.email = ?
			 WHERE a.id = ?`
		)
		.bind(ctx.user.email, attachmentId)
		.first<AttachmentRow>();
	if (!row) throw notFound('Attachment');
	return row;
}

export async function getAttachment(
	ctx: ServiceContext,
	attachmentId: string
): Promise<Attachment & { r2Key: string }> {
	const row = await findAttachment(ctx, attachmentId);
	return {
		id: row.id,
		projectId: row.project_id,
		name: row.name,
		contentType: row.content_type,
		size: row.size,
		uploadedBy: row.uploaded_by,
		createdAt: row.created_at,
		r2Key: row.r2_key
	};
}

export async function deleteAttachment(ctx: ServiceContext, r2: R2Bucket, attachmentId: string): Promise<void> {
	const row = await findAttachment(ctx, attachmentId);
	await requireEditor(ctx, row.project_id);
	await ctx.db.prepare('DELETE FROM attachments WHERE id = ?').bind(attachmentId).run();
	await r2.delete(row.r2_key);
}
