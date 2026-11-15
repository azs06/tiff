-- Replaces the focus-tracker schema with a shared task manager schema.
-- Drops ALL existing data from the previous app version.

PRAGMA defer_foreign_keys = true;

DROP TABLE IF EXISTS task_logs;
DROP TABLE IF EXISTS project_resources;
DROP TABLE IF EXISTS project_attachments;
DROP TABLE IF EXISTS project_github_repos;
DROP TABLE IF EXISTS todos;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS focus_state;
DROP TABLE IF EXISTS focus_sessions;
DROP TABLE IF EXISTS pomodoro_logs;
DROP TABLE IF EXISTS user_settings;
DROP TABLE IF EXISTS migration_runs;

CREATE TABLE users (
  email TEXT NOT NULL PRIMARY KEY,
  theme TEXT NOT NULL DEFAULT 'signal',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  inbox_project_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE projects (
  id TEXT NOT NULL PRIMARY KEY,
  owner_email TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'grey',
  notes TEXT,
  is_inbox INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_projects_owner ON projects (owner_email);

CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor')),
  added_by TEXT,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, email)
);

CREATE INDEX idx_project_members_email ON project_members (email);

CREATE TABLE sections (
  id TEXT NOT NULL PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order REAL NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_sections_project ON sections (project_id, sort_order);

CREATE TABLE tasks (
  id TEXT NOT NULL PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  section_id TEXT REFERENCES sections (id) ON DELETE SET NULL,
  parent_id TEXT REFERENCES tasks (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  priority INTEGER NOT NULL DEFAULT 4 CHECK (priority BETWEEN 1 AND 4),
  due_date TEXT,
  due_time TEXT,
  recurrence TEXT,
  assignee_email TEXT,
  sort_order REAL NOT NULL,
  completed_at INTEGER,
  completed_by TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_tasks_project ON tasks (project_id, completed_at, sort_order);
CREATE INDEX idx_tasks_parent ON tasks (parent_id);
CREATE INDEX idx_tasks_open_due ON tasks (due_date) WHERE completed_at IS NULL;
CREATE INDEX idx_tasks_completed ON tasks (completed_at) WHERE completed_at IS NOT NULL;

CREATE TABLE task_labels (
  task_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY (task_id, name)
);

CREATE INDEX idx_task_labels_name ON task_labels (name);

CREATE TABLE comments (
  id TEXT NOT NULL PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  author_email TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_comments_task ON comments (task_id, created_at);

CREATE TABLE attachments (
  id TEXT NOT NULL PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  content_type TEXT,
  size INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_attachments_project ON attachments (project_id, created_at);

CREATE TABLE api_tokens (
  id TEXT NOT NULL PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);

CREATE INDEX idx_api_tokens_email ON api_tokens (email);
