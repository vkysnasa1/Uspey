-- База для бота «Успею» (Cloudflare D1). Выполнить один раз в консоли D1.

-- Какой ключ устройства к какому чату Telegram привязан
CREATE TABLE IF NOT EXISTS links (
  token   TEXT PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS links_chat ON links (chat_id);

-- Готовые напоминания: когда (мс с 1970 года, UTC) и что написать
CREATE TABLE IF NOT EXISTS reminders (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL,
  at    INTEGER NOT NULL,
  text  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reminders_at ON reminders (at);
CREATE INDEX IF NOT EXISTS reminders_token ON reminders (token);
