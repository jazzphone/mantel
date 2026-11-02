-- Which app a push target is (docs/phase14/SYSTEM-ALERTS.md, slice 14.10): "ios" (the iPhone and iPad app) or "mac"
-- (the menu bar app). Apple's topic is each app's own bundle id, so a Mac's token sent to the iPhone app's topic is
-- refused (DeviceTokenNotForTopic). NULL: a target from before this (the iPhone app, or Web Push).
ALTER TABLE push_targets ADD COLUMN platform TEXT;
