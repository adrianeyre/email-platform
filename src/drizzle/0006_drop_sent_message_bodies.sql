-- A Message's body is kept only until it is sent or has finally failed (#116): the worker now drops it then.
-- Drop it from every Message already sent or failed, so the account links in the log go with this deploy.
UPDATE "messages" SET "html" = NULL, "text" = NULL WHERE "status" IN ('sent', 'failed') AND ("html" IS NOT NULL OR "text" IS NOT NULL);
