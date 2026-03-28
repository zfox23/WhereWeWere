-- Seed the default user for single-user / small-group mode
INSERT INTO users (id, username, email, password_hash, display_name)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'default',
    'user@wherewewere.local',
    'no-auth',
    'Default User'
) ON CONFLICT (id) DO NOTHING;
