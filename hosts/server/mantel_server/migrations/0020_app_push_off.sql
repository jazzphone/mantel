-- An app's notifications stopped from Mantel Settings (Me → Notifications → Stop Sending to…, push.delete_target):
-- the app does not register again on its own at its next start, only when the person turns notifications on in
-- the app itself (app_api.push_register, ``resume``). Signing the app out ends the row, and the flag with it.
ALTER TABLE app_credentials ADD COLUMN push_off INTEGER NOT NULL DEFAULT 0;
