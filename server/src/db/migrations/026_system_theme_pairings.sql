ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS system_light_theme VARCHAR(20);

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS system_dark_theme VARCHAR(20);

UPDATE user_settings
SET system_light_theme = 'sunrise'
WHERE system_light_theme IS NULL;

UPDATE user_settings
SET system_dark_theme = 'midnight'
WHERE system_dark_theme IS NULL;

ALTER TABLE user_settings
  ALTER COLUMN system_light_theme SET DEFAULT 'sunrise';

ALTER TABLE user_settings
  ALTER COLUMN system_dark_theme SET DEFAULT 'midnight';