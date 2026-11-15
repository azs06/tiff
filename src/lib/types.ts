export type Theme = 'signal' | 'paper' | 'nothing';
export const THEMES: Theme[] = ['signal', 'paper', 'nothing'];

export type Priority = 1 | 2 | 3 | 4;
export type ProjectRole = 'owner' | 'editor';

export const PROJECT_COLORS = {
	grey: '#8a8a8a',
	red: '#d1453b',
	orange: '#eb8909',
	yellow: '#d6a800',
	green: '#299438',
	teal: '#158fad',
	blue: '#246fe0',
	purple: '#884dff',
	pink: '#e05194'
} as const;

export type ProjectColor = keyof typeof PROJECT_COLORS;
export const PROJECT_COLOR_NAMES = Object.keys(PROJECT_COLORS) as ProjectColor[];

export function isProjectColor(value: unknown): value is ProjectColor {
	return typeof value === 'string' && value in PROJECT_COLORS;
}

export interface User {
	email: string;
	theme: Theme;
	timezone: string;
	inboxProjectId: string;
}

export interface ProjectSummary {
	id: string;
	name: string;
	color: ProjectColor;
	isInbox: boolean;
	ownerEmail: string;
	role: ProjectRole;
	archivedAt: number | null;
	openCount: number;
	memberCount: number;
}

export interface Section {
	id: string;
	projectId: string;
	name: string;
	sortOrder: number;
}

export interface ProjectMember {
	email: string;
	role: ProjectRole;
	addedAt: number;
}

export interface Attachment {
	id: string;
	projectId: string;
	name: string;
	contentType: string | null;
	size: number;
	uploadedBy: string;
	createdAt: number;
}

export interface ProjectDetail extends ProjectSummary {
	notes: string | null;
	sections: Section[];
	members: ProjectMember[];
	attachments: Attachment[];
}

export interface Task {
	id: string;
	projectId: string;
	projectName: string;
	projectColor: ProjectColor;
	sectionId: string | null;
	parentId: string | null;
	title: string;
	notes: string | null;
	priority: Priority;
	dueDate: string | null;
	dueTime: string | null;
	recurrence: string | null;
	assigneeEmail: string | null;
	sortOrder: number;
	completedAt: number | null;
	completedBy: string | null;
	createdBy: string;
	createdAt: number;
	updatedAt: number;
	labels: string[];
	subtaskCount: number;
	subtaskDoneCount: number;
	commentCount: number;
}

export interface Comment {
	id: string;
	taskId: string;
	authorEmail: string;
	body: string;
	createdAt: number;
}

export interface LabelSummary {
	name: string;
	openCount: number;
}

export interface ApiToken {
	id: string;
	name: string;
	prefix: string;
	createdAt: number;
	lastUsedAt: number | null;
}

export interface TaskDetail {
	task: Task;
	parent: Task | null;
	subtasks: Task[];
	comments: Comment[];
	sections: Section[];
	members: ProjectMember[];
}
