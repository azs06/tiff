PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS todos (
  user_email TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  detail TEXT,
  deadline INTEGER,
  archived INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER,
  project_id TEXT,
  total_focus_ms INTEGER,
  PRIMARY KEY (user_email, id)
);

CREATE INDEX IF NOT EXISTS idx_todos_user_archived_created
  ON todos (user_email, archived, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_todos_user_project
  ON todos (user_email, project_id);
CREATE INDEX IF NOT EXISTS idx_todos_user_done
  ON todos (user_email, done);

CREATE TABLE IF NOT EXISTS task_logs (
  user_email TEXT NOT NULL,
  id TEXT NOT NULL,
  todo_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_email, id),
  FOREIGN KEY (user_email, todo_id) REFERENCES todos (user_email, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_logs_user_todo_created
  ON task_logs (user_email, todo_id, created_at ASC);

CREATE TABLE IF NOT EXISTS projects (
  user_email TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  detail TEXT,
  github_repo TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER,
  PRIMARY KEY (user_email, id)
);

CREATE INDEX IF NOT EXISTS idx_projects_user_archived_created
  ON projects (user_email, archived, created_at ASC);

CREATE TABLE IF NOT EXISTS project_resources (
  user_email TEXT NOT NULL,
  id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  url TEXT NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_email, id),
  FOREIGN KEY (user_email, project_id) REFERENCES projects (user_email, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_resources_user_project_created
  ON project_resources (user_email, project_id, created_at ASC);

CREATE TABLE IF NOT EXISTS project_attachments (
  user_email TEXT NOT NULL,
  id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  key TEXT,
  content_type TEXT,
  size INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_email, id),
  FOREIGN KEY (user_email, project_id) REFERENCES projects (user_email, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_attachments_user_project_created
  ON project_attachments (user_email, project_id, created_at ASC);

CREATE TABLE IF NOT EXISTS focus_state (
  user_email TEXT NOT NULL PRIMARY KEY,
  active_task_id TEXT NOT NULL,
  focused_at INTEGER NOT NULL,
  session_paused INTEGER,
  paused_at INTEGER,
  accumulated_pause_ms INTEGER,
  pomo_started_at INTEGER,
  pomo_duration INTEGER,
  pomo_type TEXT,
  pomo_completed_pomodoros INTEGER,
  pomo_paused INTEGER,
  pomo_paused_remaining INTEGER
);

CREATE TABLE IF NOT EXISTS focus_sessions (
  user_email TEXT NOT NULL,
  id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  end_reason TEXT,
  PRIMARY KEY (user_email, id)
);

CREATE INDEX IF NOT EXISTS idx_focus_sessions_user_started
  ON focus_sessions (user_email, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_focus_sessions_user_task_started
  ON focus_sessions (user_email, task_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_focus_sessions_user_ended
  ON focus_sessions (user_email, ended_at);

CREATE TABLE IF NOT EXISTS pomodoro_logs (
  user_email TEXT NOT NULL,
  id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  type TEXT NOT NULL,
  duration INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  PRIMARY KEY (user_email, id)
);

CREATE INDEX IF NOT EXISTS idx_pomodoro_logs_user_completed
  ON pomodoro_logs (user_email, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pomodoro_logs_user_task_completed
  ON pomodoro_logs (user_email, task_id, completed_at DESC);

CREATE TABLE IF NOT EXISTS user_settings (
  user_email TEXT NOT NULL PRIMARY KEY,
  work_ms INTEGER NOT NULL,
  short_break_ms INTEGER NOT NULL,
  long_break_ms INTEGER NOT NULL,
  theme TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS migration_runs (
  run_id TEXT NOT NULL PRIMARY KEY,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,
  cursor TEXT,
  processed_users INTEGER NOT NULL DEFAULT 0,
  mismatched_users INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);
