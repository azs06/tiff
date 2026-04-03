CREATE TABLE user_settings_new (
  user_email TEXT NOT NULL PRIMARY KEY,
  work_ms INTEGER,
  short_break_ms INTEGER,
  long_break_ms INTEGER,
  theme TEXT NOT NULL
);

INSERT INTO user_settings_new (
  user_email,
  work_ms,
  short_break_ms,
  long_break_ms,
  theme
)
SELECT
  user_email,
  work_ms,
  short_break_ms,
  long_break_ms,
  theme
FROM user_settings;

DROP TABLE user_settings;

ALTER TABLE user_settings_new RENAME TO user_settings;
