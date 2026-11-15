import {
	isProjectColor,
	type Attachment,
	type ProjectColor,
	type ProjectDetail,
	type ProjectMember,
	type ProjectRole,
	type ProjectSummary,
	type Section
} from '$lib/types';
import type { ServiceContext } from './context';
import { forbidden, invalid, notFound } from './errors';
import * as v from './validate';

const MAX_MEMBERS = 50;

type SummaryRow = {
	id: string;
	name: string;
	color: string;
	is_inbox: number;
	owner_email: string;
	archived_at: number | null;
	role: ProjectRole;
	open_count: number;
	member_count: number;
};

type Membership = {
	role: ProjectRole;
	isInbox: boolean;
	archivedAt: number | null;
	ownerEmail: string;
};

const SUMMARY_SELECT = `
	SELECT p.id, p.name, p.color, p.is_inbox, p.owner_email, p.archived_at, m.role,
		(SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.completed_at IS NULL) AS open_count,
		(SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count
	FROM projects p
	JOIN project_members m ON m.project_id = p.id AND m.email = ?`;

function mapSummary(row: SummaryRow): ProjectSummary {
	return {
		id: row.id,
		name: row.name,
		color: (isProjectColor(row.color) ? row.color : 'grey') as ProjectColor,
		isInbox: row.is_inbox === 1,
		ownerEmail: row.owner_email,
		role: row.role,
		archivedAt: row.archived_at,
		openCount: row.open_count,
		memberCount: row.member_count
	};
}

export async function listProjects(
	ctx: ServiceContext,
	options: { archived?: boolean } = {}
): Promise<ProjectSummary[]> {
	const archivedClause = options.archived ? 'p.archived_at IS NOT NULL' : 'p.archived_at IS NULL';
	const rows = await ctx.db
		.prepare(`${SUMMARY_SELECT} WHERE ${archivedClause} ORDER BY p.is_inbox DESC, p.created_at ASC`)
		.bind(ctx.user.email)
		.all<SummaryRow>();
	return rows.results.map(mapSummary);
}

export async function getMembership(ctx: ServiceContext, projectId: string): Promise<Membership> {
	const row = await ctx.db
		.prepare(
			`SELECT m.role, p.is_inbox, p.archived_at, p.owner_email
			 FROM projects p JOIN project_members m ON m.project_id = p.id AND m.email = ?
			 WHERE p.id = ?`
		)
		.bind(ctx.user.email, projectId)
		.first<{ role: ProjectRole; is_inbox: number; archived_at: number | null; owner_email: string }>();
	if (!row) throw notFound('Project');
	return {
		role: row.role,
		isInbox: row.is_inbox === 1,
		archivedAt: row.archived_at,
		ownerEmail: row.owner_email
	};
}

/** Any member may edit tasks, sections, comments and attachments in an active project. */
export async function requireEditor(ctx: ServiceContext, projectId: string): Promise<Membership> {
	const membership = await getMembership(ctx, projectId);
	if (membership.archivedAt) throw invalid('This project is archived. Unarchive it to make changes.');
	return membership;
}

export async function requireOwner(ctx: ServiceContext, projectId: string): Promise<Membership> {
	const membership = await getMembership(ctx, projectId);
	if (membership.role !== 'owner') throw forbidden('Only the project owner can do that');
	return membership;
}

export async function getProject(ctx: ServiceContext, projectId: string): Promise<ProjectDetail> {
	const row = await ctx.db
		.prepare(`${SUMMARY_SELECT} WHERE p.id = ?`)
		.bind(ctx.user.email, projectId)
		.first<SummaryRow>();
	if (!row) throw notFound('Project');

	const [notes, sections, members, attachments] = await Promise.all([
		ctx.db.prepare('SELECT notes FROM projects WHERE id = ?').bind(projectId).first<{ notes: string | null }>(),
		listSections(ctx.db, projectId),
		listMembers(ctx.db, projectId),
		ctx.db
			.prepare(
				`SELECT id, project_id, name, content_type, size, uploaded_by, created_at
				 FROM attachments WHERE project_id = ? ORDER BY created_at ASC`
			)
			.bind(projectId)
			.all<{
				id: string;
				project_id: string;
				name: string;
				content_type: string | null;
				size: number;
				uploaded_by: string;
				created_at: number;
			}>()
	]);

	return {
		...mapSummary(row),
		notes: notes?.notes ?? null,
		sections,
		members,
		attachments: attachments.results.map(
			(a): Attachment => ({
				id: a.id,
				projectId: a.project_id,
				name: a.name,
				contentType: a.content_type,
				size: a.size,
				uploadedBy: a.uploaded_by,
				createdAt: a.created_at
			})
		)
	};
}

export async function listSections(db: D1Database, projectId: string): Promise<Section[]> {
	const rows = await db
		.prepare('SELECT id, project_id, name, sort_order FROM sections WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC')
		.bind(projectId)
		.all<{ id: string; project_id: string; name: string; sort_order: number }>();
	return rows.results.map((row) => ({
		id: row.id,
		projectId: row.project_id,
		name: row.name,
		sortOrder: row.sort_order
	}));
}

export async function listMembers(db: D1Database, projectId: string): Promise<ProjectMember[]> {
	const rows = await db
		.prepare(
			`SELECT email, role, added_at FROM project_members WHERE project_id = ?
			 ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, added_at ASC`
		)
		.bind(projectId)
		.all<{ email: string; role: ProjectRole; added_at: number }>();
	return rows.results.map((row) => ({ email: row.email, role: row.role, addedAt: row.added_at }));
}

export async function createProject(
	ctx: ServiceContext,
	input: { name: unknown; color?: unknown }
): Promise<ProjectSummary> {
	const name = v.requiredText(input.name, 'Project name', v.LIMITS.name);
	const color = input.color === undefined || input.color === '' ? 'grey' : v.color(input.color);
	const id = crypto.randomUUID();
	const now = Date.now();

	await ctx.db.batch([
		ctx.db
			.prepare(
				`INSERT INTO projects (id, owner_email, name, color, is_inbox, created_at, updated_at)
				 VALUES (?, ?, ?, ?, 0, ?, ?)`
			)
			.bind(id, ctx.user.email, name, color, now, now),
		ctx.db
			.prepare(`INSERT INTO project_members (project_id, email, role, added_by, added_at) VALUES (?, ?, 'owner', ?, ?)`)
			.bind(id, ctx.user.email, ctx.user.email, now)
	]);

	return (await listProjects(ctx)).find((project) => project.id === id)!;
}

export async function updateProject(
	ctx: ServiceContext,
	projectId: string,
	patch: { name?: unknown; color?: unknown; notes?: unknown }
): Promise<void> {
	const membership = await requireEditor(ctx, projectId);
	if (membership.isInbox && (patch.name !== undefined || patch.color !== undefined)) {
		throw invalid('The Inbox cannot be renamed or recolored');
	}

	const name = patch.name === undefined ? null : v.requiredText(patch.name, 'Project name', v.LIMITS.name);
	const color = patch.color === undefined ? null : v.color(patch.color);
	const notesProvided = patch.notes !== undefined;
	const notes = notesProvided ? v.optionalText(patch.notes, 'Notes', v.LIMITS.notes) : null;

	await ctx.db
		.prepare(
			`UPDATE projects SET
				name = COALESCE(?, name),
				color = COALESCE(?, color),
				notes = CASE WHEN ? THEN ? ELSE notes END,
				updated_at = ?
			 WHERE id = ?`
		)
		.bind(name, color, notesProvided ? 1 : 0, notes, Date.now(), projectId)
		.run();
}

export async function setProjectArchived(ctx: ServiceContext, projectId: string, archived: boolean): Promise<void> {
	const membership = await requireOwner(ctx, projectId);
	if (membership.isInbox) throw invalid('The Inbox cannot be archived');
	await ctx.db
		.prepare('UPDATE projects SET archived_at = ?, updated_at = ? WHERE id = ?')
		.bind(archived ? Date.now() : null, Date.now(), projectId)
		.run();
}

/** Deletes the project and everything in it. Returns R2 keys the caller must delete. */
export async function deleteProject(ctx: ServiceContext, projectId: string): Promise<string[]> {
	const membership = await requireOwner(ctx, projectId);
	if (membership.isInbox) throw invalid('The Inbox cannot be deleted');

	const keys = await ctx.db
		.prepare('SELECT r2_key FROM attachments WHERE project_id = ?')
		.bind(projectId)
		.all<{ r2_key: string }>();
	await ctx.db.prepare('DELETE FROM projects WHERE id = ?').bind(projectId).run();
	return keys.results.map((row) => row.r2_key);
}

export async function addMember(ctx: ServiceContext, projectId: string, rawEmail: unknown): Promise<void> {
	const membership = await requireOwner(ctx, projectId);
	if (membership.isInbox) throw invalid('The Inbox cannot be shared');
	if (membership.archivedAt) throw invalid('This project is archived. Unarchive it to make changes.');
	const memberEmail = v.email(rawEmail);

	const count = await ctx.db
		.prepare('SELECT COUNT(*) AS n FROM project_members WHERE project_id = ?')
		.bind(projectId)
		.first<{ n: number }>();
	if ((count?.n ?? 0) >= MAX_MEMBERS) throw invalid(`A project can have at most ${MAX_MEMBERS} members`);

	await ctx.db
		.prepare(
			`INSERT OR IGNORE INTO project_members (project_id, email, role, added_by, added_at)
			 VALUES (?, ?, 'editor', ?, ?)`
		)
		.bind(projectId, memberEmail, ctx.user.email, Date.now())
		.run();
}

/** Owners can remove editors. Any editor can remove themselves (leave the project). */
export async function removeMember(ctx: ServiceContext, projectId: string, rawEmail: unknown): Promise<void> {
	const membership = await getMembership(ctx, projectId);
	const memberEmail = v.email(rawEmail);
	const leaving = memberEmail === ctx.user.email;

	if (leaving && membership.role === 'owner') {
		throw invalid('The owner cannot leave their own project. Delete or archive it instead.');
	}
	if (!leaving && membership.role !== 'owner') throw forbidden('Only the project owner can remove members');
	// Leaving is always allowed; removing someone else counts as a change to the project.
	if (!leaving && membership.archivedAt) throw invalid('This project is archived. Unarchive it to make changes.');

	await ctx.db.batch([
		ctx.db
			.prepare(`DELETE FROM project_members WHERE project_id = ? AND email = ? AND role <> 'owner'`)
			.bind(projectId, memberEmail),
		ctx.db
			.prepare('UPDATE tasks SET assignee_email = NULL WHERE project_id = ? AND assignee_email = ?')
			.bind(projectId, memberEmail)
	]);
}

export async function createSection(ctx: ServiceContext, projectId: string, rawName: unknown): Promise<Section> {
	await requireEditor(ctx, projectId);
	const name = v.requiredText(rawName, 'Section name', v.LIMITS.name);
	const id = crypto.randomUUID();
	await ctx.db
		.prepare(
			`INSERT INTO sections (id, project_id, name, sort_order, created_at)
			 VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM sections WHERE project_id = ?), ?)`
		)
		.bind(id, projectId, name, projectId, Date.now())
		.run();
	return (await listSections(ctx.db, projectId)).find((section) => section.id === id)!;
}

async function sectionProject(ctx: ServiceContext, sectionId: string): Promise<string> {
	const row = await ctx.db
		.prepare('SELECT project_id FROM sections WHERE id = ?')
		.bind(sectionId)
		.first<{ project_id: string }>();
	if (!row) throw notFound('Section');
	await requireEditor(ctx, row.project_id);
	return row.project_id;
}

export async function renameSection(ctx: ServiceContext, sectionId: string, rawName: unknown): Promise<void> {
	await sectionProject(ctx, sectionId);
	const name = v.requiredText(rawName, 'Section name', v.LIMITS.name);
	await ctx.db.prepare('UPDATE sections SET name = ? WHERE id = ?').bind(name, sectionId).run();
}

/** Deletes the section. Its tasks stay in the project without a section. */
export async function deleteSection(ctx: ServiceContext, sectionId: string): Promise<void> {
	await sectionProject(ctx, sectionId);
	await ctx.db.prepare('DELETE FROM sections WHERE id = ?').bind(sectionId).run();
}
