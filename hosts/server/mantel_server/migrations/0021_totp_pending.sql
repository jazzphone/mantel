-- Replacing an authenticator app (Me → Replace…): the new seed waits here, sealed like seed_enc, until its first
-- code confirms it. The working seed stays in force meanwhile, so an abandoned Replace never leaves the account
-- signing in with a password alone (accounts.totp_begin / totp_check).
ALTER TABLE totp_credentials ADD COLUMN pending_enc BLOB;
