import { Router, Request, Response } from 'express';
import multer from 'multer';
import { pool, query } from '../db';

const router = Router();

const USER_ID = '00000000-0000-0000-0000-000000000001';
const BACKUP_FORMAT = 'wherewewere-backup';
const LATEST_BACKUP_SCHEMA_VERSION = 1;
const FIRST_START_OVER_CONFIRMATION = 'DELETE MY DATA';
const SECOND_START_OVER_CONFIRMATION = 'START OVER';

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/json' || file.originalname.endsWith('.json')) {
      cb(null, true);
    } else {
      cb(new Error('Only JSON backup files are allowed'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 },
});

interface BackupUser {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

interface BackupSettings {
  dawarich_url: string | null;
  dawarich_api_key: string | null;
  immich_url: string | null;
  immich_api_key: string | null;
  maloja_url: string | null;
  theme: string | null;
  notifications_enabled: boolean | null;
  mood_reminder_times: string[];
  mood_icon_pack: string | null;
  created_at?: string;
  updated_at?: string;
}

interface BackupVenueCategory {
  id: string;
  name: string;
  icon: string | null;
  parent_id: string | null;
  created_at: string;
}

interface BackupVenue {
  id: string;
  name: string;
  category_id: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postal_code: string | null;
  latitude: number;
  longitude: number;
  osm_id: string | null;
  swarm_venue_id: string | null;
  parent_venue_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface BackupCheckin {
  id: string;
  venue_id: string;
  notes: string | null;
  checked_in_at: string;
  checkin_timezone: string | null;
  created_at: string;
  updated_at: string;
  swarm_id: string | null;
}

interface BackupMoodActivityGroup {
  id: string;
  name: string;
  display_order: number;
  created_at: string;
  updated_at: string;
}

interface BackupMoodActivity {
  id: string;
  group_id: string;
  name: string;
  display_order: number;
  icon: string | null;
  created_at: string;
  updated_at: string;
}

interface BackupMoodCheckin {
  id: string;
  mood: number;
  note: string | null;
  checked_in_at: string;
  mood_timezone: string | null;
  created_at: string;
  updated_at: string;
  daylio_hash: string | null;
}

interface BackupMoodCheckinActivity {
  mood_checkin_id: string;
  activity_id: string;
}

interface BackupPushSubscription {
  id: string;
  subscription_json: unknown;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface BackupV1 {
  format: typeof BACKUP_FORMAT;
  schemaVersion: 1;
  exportedAt: string;
  data: {
    user: BackupUser | null;
    settings: BackupSettings | null;
    venueCategories: BackupVenueCategory[];
    venues: BackupVenue[];
    checkins: BackupCheckin[];
    moodActivityGroups: BackupMoodActivityGroup[];
    moodActivities: BackupMoodActivity[];
    moodCheckins: BackupMoodCheckin[];
    moodCheckinActivities: BackupMoodCheckinActivity[];
    pushSubscriptions: BackupPushSubscription[];
  };
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function ensureV1Backup(raw: unknown): BackupV1 {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Backup payload must be a JSON object');
  }

  const source = raw as Record<string, unknown>;
  if (source.format !== BACKUP_FORMAT) {
    throw new Error(`Unsupported backup format: expected "${BACKUP_FORMAT}"`);
  }

  const schemaVersion = toNumber(source.schemaVersion, NaN);
  if (!Number.isInteger(schemaVersion) || schemaVersion <= 0) {
    throw new Error('Backup schemaVersion must be a positive integer');
  }

  if (schemaVersion > LATEST_BACKUP_SCHEMA_VERSION) {
    throw new Error(
      `Backup schemaVersion ${schemaVersion} is newer than supported version ${LATEST_BACKUP_SCHEMA_VERSION}`
    );
  }

  // Migration hook for future schema upgrades.
  let migrated = source;
  let currentVersion = schemaVersion;
  while (currentVersion < LATEST_BACKUP_SCHEMA_VERSION) {
    throw new Error(`No migrator available for schemaVersion ${currentVersion}`);
  }

  const migratedData = (migrated.data ?? {}) as Record<string, unknown>;

  const user = migratedData.user && typeof migratedData.user === 'object'
    ? migratedData.user as BackupUser
    : null;

  const settings = migratedData.settings && typeof migratedData.settings === 'object'
    ? {
      ...(migratedData.settings as Record<string, unknown>),
      mood_reminder_times: asArray<string>((migratedData.settings as Record<string, unknown>).mood_reminder_times),
    } as BackupSettings
    : null;

  return {
    format: BACKUP_FORMAT,
    schemaVersion: 1,
    exportedAt: typeof migrated.exportedAt === 'string' ? migrated.exportedAt : new Date().toISOString(),
    data: {
      user,
      settings,
      venueCategories: asArray<BackupVenueCategory>(migratedData.venueCategories),
      venues: asArray<BackupVenue>(migratedData.venues).map((venue) => ({
        ...venue,
        latitude: toNumber((venue as BackupVenue).latitude),
        longitude: toNumber((venue as BackupVenue).longitude),
      })),
      checkins: asArray<BackupCheckin>(migratedData.checkins),
      moodActivityGroups: asArray<BackupMoodActivityGroup>(migratedData.moodActivityGroups),
      moodActivities: asArray<BackupMoodActivity>(migratedData.moodActivities),
      moodCheckins: asArray<BackupMoodCheckin>(migratedData.moodCheckins),
      moodCheckinActivities: asArray<BackupMoodCheckinActivity>(migratedData.moodCheckinActivities),
      pushSubscriptions: asArray<BackupPushSubscription>(migratedData.pushSubscriptions),
    },
  };
}

router.get('/export', async (_req: Request, res: Response) => {
  try {
    const [
      userResult,
      settingsResult,
      categoriesResult,
      venuesResult,
      checkinsResult,
      groupsResult,
      activitiesResult,
      moodCheckinsResult,
      moodCheckinActivitiesResult,
      pushSubscriptionsResult,
    ] = await Promise.all([
      query(
        `SELECT id, username, email, display_name, created_at, updated_at
         FROM users
         WHERE id = $1`,
        [USER_ID]
      ),
      query(
        `SELECT dawarich_url, dawarich_api_key,
                immich_url, immich_api_key,
                maloja_url,
                theme,
                notifications_enabled,
                COALESCE(mood_reminder_times, ARRAY[]::text[]) AS mood_reminder_times,
                mood_icon_pack,
                created_at,
                updated_at
         FROM user_settings
         WHERE user_id = $1`,
        [USER_ID]
      ),
      query(
        `SELECT DISTINCT vc.id, vc.name, vc.icon, vc.parent_id, vc.created_at
         FROM venue_categories vc
         JOIN venues v ON v.category_id = vc.id
         ORDER BY vc.name ASC`,
        []
      ),
      query(
        `SELECT DISTINCT v.id, v.name, v.category_id,
                v.address, v.city, v.state, v.country, v.postal_code,
                v.latitude, v.longitude,
                v.osm_id, v.swarm_venue_id,
                v.parent_venue_id, v.created_by,
                v.created_at, v.updated_at
         FROM venues v
         ORDER BY v.created_at ASC`,
        []
      ),
      query(
        `SELECT id, venue_id, notes,
                checked_in_at, checkin_timezone, created_at, updated_at, swarm_id
         FROM checkins
         WHERE user_id = $1
         ORDER BY checked_in_at ASC`,
        [USER_ID]
      ),
      query(
        `SELECT id, name, display_order, created_at, updated_at
         FROM mood_activity_groups
         WHERE user_id = $1
         ORDER BY display_order ASC, created_at ASC`,
        [USER_ID]
      ),
      query(
        `SELECT ma.id, ma.group_id, ma.name, ma.display_order, ma.icon, ma.created_at, ma.updated_at
         FROM mood_activities ma
         JOIN mood_activity_groups mag ON mag.id = ma.group_id
         WHERE mag.user_id = $1
         ORDER BY mag.display_order ASC, ma.display_order ASC, ma.created_at ASC`,
        [USER_ID]
      ),
      query(
        `SELECT id, mood, note, checked_in_at, mood_timezone, created_at, updated_at, daylio_hash
         FROM mood_checkins
         WHERE user_id = $1
         ORDER BY checked_in_at ASC`,
        [USER_ID]
      ),
      query(
        `SELECT mca.mood_checkin_id, mca.activity_id
         FROM mood_checkin_activities mca
         JOIN mood_checkins mc ON mc.id = mca.mood_checkin_id
         WHERE mc.user_id = $1
         ORDER BY mca.mood_checkin_id ASC`,
        [USER_ID]
      ),
      query(
        `SELECT id, subscription_json, is_active, created_at, updated_at
         FROM push_subscriptions
         WHERE user_id = $1
         ORDER BY created_at ASC`,
        [USER_ID]
      ),
    ]);

    const payload: BackupV1 = {
      format: BACKUP_FORMAT,
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      data: {
        user: userResult.rows[0] ?? null,
        settings: settingsResult.rows[0] ?? null,
        venueCategories: categoriesResult.rows,
        venues: venuesResult.rows.map((venue) => ({
          ...venue,
          latitude: toNumber(venue.latitude),
          longitude: toNumber(venue.longitude),
        })),
        checkins: checkinsResult.rows,
        moodActivityGroups: groupsResult.rows,
        moodActivities: activitiesResult.rows,
        moodCheckins: moodCheckinsResult.rows,
        moodCheckinActivities: moodCheckinActivitiesResult.rows,
        pushSubscriptions: pushSubscriptionsResult.rows,
      },
    };

    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="wherewewere-backup-v1-${day}.json"`);
    res.json(payload);
  } catch (err) {
    console.error('Error exporting backup:', err);
    res.status(500).json({ error: 'Failed to export backup' });
  }
});

router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const rawPayload = req.file
      ? JSON.parse(req.file.buffer.toString('utf-8'))
      : req.body;

    const backup = ensureV1Backup(rawPayload);
    const counts = {
      venues: { inserted: 0, skipped: 0 },
      checkins: { inserted: 0, skipped: 0 },
      moodActivityGroups: { inserted: 0, skipped: 0 },
      moodActivities: { inserted: 0, skipped: 0 },
      moodCheckins: { inserted: 0, skipped: 0 },
      moodCheckinActivities: { inserted: 0, skipped: 0 },
      pushSubscriptions: { inserted: 0, skipped: 0 },
    };
    const errors: string[] = [];

    await client.query('BEGIN');

    if (backup.data.user?.display_name !== undefined) {
      await client.query(
        `UPDATE users
         SET display_name = COALESCE($2, display_name),
             updated_at = NOW()
         WHERE id = $1`,
        [USER_ID, backup.data.user.display_name]
      );
    }

    if (backup.data.settings) {
      const s = backup.data.settings;
      await client.query(
        `INSERT INTO user_settings (
           user_id, dawarich_url, dawarich_api_key,
           immich_url, immich_api_key, maloja_url,
           theme, notifications_enabled, mood_reminder_times,
           mood_icon_pack
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10)
         ON CONFLICT (user_id) DO UPDATE SET
           dawarich_url = EXCLUDED.dawarich_url,
           dawarich_api_key = EXCLUDED.dawarich_api_key,
           immich_url = EXCLUDED.immich_url,
           immich_api_key = EXCLUDED.immich_api_key,
           maloja_url = EXCLUDED.maloja_url,
           theme = COALESCE(EXCLUDED.theme, user_settings.theme),
           notifications_enabled = COALESCE(EXCLUDED.notifications_enabled, user_settings.notifications_enabled),
           mood_reminder_times = COALESCE(EXCLUDED.mood_reminder_times, user_settings.mood_reminder_times),
           mood_icon_pack = COALESCE(EXCLUDED.mood_icon_pack, user_settings.mood_icon_pack),
           updated_at = NOW()`,
        [
          USER_ID,
          toStringOrNull(s.dawarich_url),
          toStringOrNull(s.dawarich_api_key),
          toStringOrNull(s.immich_url),
          toStringOrNull(s.immich_api_key),
          toStringOrNull(s.maloja_url),
          toStringOrNull(s.theme),
          typeof s.notifications_enabled === 'boolean' ? s.notifications_enabled : null,
          asArray<string>(s.mood_reminder_times),
          toStringOrNull(s.mood_icon_pack),
        ]
      );
    }

    const categoryIdMap = new Map<string, string>();
    for (const category of backup.data.venueCategories) {
      if (!category?.name) continue;

      const result = await client.query(
        `INSERT INTO venue_categories (id, name, icon, parent_id, created_at)
         VALUES ($1, $2, $3, NULL, COALESCE($4::timestamptz, NOW()))
         ON CONFLICT (name) DO UPDATE SET
           icon = COALESCE(EXCLUDED.icon, venue_categories.icon)
         RETURNING id`,
        [
          category.id,
          category.name,
          toStringOrNull(category.icon),
          category.created_at || null,
        ]
      );
      categoryIdMap.set(category.id, result.rows[0].id);
    }

    for (const category of backup.data.venueCategories) {
      const localCategoryId = categoryIdMap.get(category.id);
      const localParentId = category.parent_id ? categoryIdMap.get(category.parent_id) : null;
      if (!localCategoryId || !localParentId || localCategoryId === localParentId) continue;

      await client.query(
        `UPDATE venue_categories
         SET parent_id = $2
         WHERE id = $1`,
        [localCategoryId, localParentId]
      );
    }

    for (const venue of backup.data.venues) {
      if (!venue?.id || !venue.name) {
        counts.venues.skipped += 1;
        errors.push(`Skipped venue with missing id/name`);
        continue;
      }

      const result = await client.query(
        `INSERT INTO venues (
           id, name, category_id,
           address, city, state, country, postal_code,
           latitude, longitude,
           osm_id, swarm_venue_id,
           parent_venue_id, created_by,
           created_at, updated_at
         )
         VALUES (
           $1, $2, $3,
           $4, $5, $6, $7, $8,
           $9, $10,
           $11, $12,
           NULL, $13,
           COALESCE($14::timestamptz, NOW()), COALESCE($15::timestamptz, NOW())
         )
         ON CONFLICT (id) DO NOTHING`,
        [
          venue.id,
          venue.name,
          venue.category_id ? (categoryIdMap.get(venue.category_id) ?? null) : null,
          toStringOrNull(venue.address),
          toStringOrNull(venue.city),
          toStringOrNull(venue.state),
          toStringOrNull(venue.country),
          toStringOrNull(venue.postal_code),
          toNumber(venue.latitude),
          toNumber(venue.longitude),
          toStringOrNull(venue.osm_id),
          toStringOrNull(venue.swarm_venue_id),
          USER_ID,
          venue.created_at || null,
          venue.updated_at || null,
        ]
      );

      if (result.rowCount === 1) {
        counts.venues.inserted += 1;
      } else {
        counts.venues.skipped += 1;
      }
    }

    for (const venue of backup.data.venues) {
      if (!venue.parent_venue_id) continue;
      await client.query(
        `UPDATE venues
         SET parent_venue_id = $2
         WHERE id = $1`,
        [venue.id, venue.parent_venue_id]
      );
    }

    for (const checkin of backup.data.checkins) {
      if (!checkin?.id || !checkin.venue_id) {
        counts.checkins.skipped += 1;
        errors.push('Skipped check-in with missing id/venue_id');
        continue;
      }

      const result = await client.query(
        `INSERT INTO checkins (
           id, user_id, venue_id,
           notes,
           checked_in_at, checkin_timezone, created_at, updated_at,
           swarm_id
         )
         VALUES (
           $1, $2, $3,
           $4,
           COALESCE($5::timestamptz, NOW()), $6,
           COALESCE($7::timestamptz, NOW()),
           COALESCE($8::timestamptz, NOW()),
           $9
         )
         ON CONFLICT (id) DO NOTHING`,
        [
          checkin.id,
          USER_ID,
          checkin.venue_id,
          checkin.notes || null,
          checkin.checked_in_at || null,
          toStringOrNull(checkin.checkin_timezone),
          checkin.created_at || null,
          checkin.updated_at || null,
          checkin.swarm_id || null,
        ]
      );

      if (result.rowCount === 1) {
        counts.checkins.inserted += 1;
      } else {
        counts.checkins.skipped += 1;
      }
    }

    for (const group of backup.data.moodActivityGroups) {
      if (!group?.id || !group.name) {
        counts.moodActivityGroups.skipped += 1;
        errors.push('Skipped mood activity group with missing id/name');
        continue;
      }

      const result = await client.query(
        `INSERT INTO mood_activity_groups (id, user_id, name, display_order, created_at, updated_at)
         VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), COALESCE($6::timestamptz, NOW()))
         ON CONFLICT (id) DO NOTHING`,
        [group.id, USER_ID, group.name, group.display_order ?? 0, group.created_at || null, group.updated_at || null]
      );

      if (result.rowCount === 1) {
        counts.moodActivityGroups.inserted += 1;
      } else {
        counts.moodActivityGroups.skipped += 1;
      }
    }

    for (const activity of backup.data.moodActivities) {
      if (!activity?.id || !activity.group_id || !activity.name) {
        counts.moodActivities.skipped += 1;
        errors.push('Skipped mood activity with missing id/group_id/name');
        continue;
      }

      const result = await client.query(
        `INSERT INTO mood_activities (id, group_id, name, display_order, icon, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()), COALESCE($7::timestamptz, NOW()))
         ON CONFLICT (id) DO NOTHING`,
        [
          activity.id,
          activity.group_id,
          activity.name,
          activity.display_order ?? 0,
          toStringOrNull(activity.icon),
          activity.created_at || null,
          activity.updated_at || null,
        ]
      );

      if (result.rowCount === 1) {
        counts.moodActivities.inserted += 1;
      } else {
        counts.moodActivities.skipped += 1;
      }
    }

    for (const moodCheckin of backup.data.moodCheckins) {
      if (!moodCheckin?.id) {
        counts.moodCheckins.skipped += 1;
        errors.push('Skipped mood check-in with missing id');
        continue;
      }

      const mood = toNumber(moodCheckin.mood, 0);
      if (mood < 1 || mood > 5) {
        counts.moodCheckins.skipped += 1;
        errors.push(`Skipped mood check-in ${moodCheckin.id} with invalid mood`);
        continue;
      }

      const result = await client.query(
        `INSERT INTO mood_checkins (
           id, user_id, mood, note,
           checked_in_at, mood_timezone, created_at, updated_at,
           daylio_hash
         )
         VALUES (
           $1, $2, $3, $4,
           COALESCE($5::timestamptz, NOW()), $6,
           COALESCE($7::timestamptz, NOW()),
           COALESCE($8::timestamptz, NOW()),
           $9
         )
         ON CONFLICT (id) DO NOTHING`,
        [
          moodCheckin.id,
          USER_ID,
          mood,
          moodCheckin.note || null,
          moodCheckin.checked_in_at || null,
          toStringOrNull(moodCheckin.mood_timezone),
          moodCheckin.created_at || null,
          moodCheckin.updated_at || null,
          moodCheckin.daylio_hash || null,
        ]
      );

      if (result.rowCount === 1) {
        counts.moodCheckins.inserted += 1;
      } else {
        counts.moodCheckins.skipped += 1;
      }
    }

    for (const link of backup.data.moodCheckinActivities) {
      if (!link?.mood_checkin_id || !link.activity_id) {
        counts.moodCheckinActivities.skipped += 1;
        errors.push('Skipped mood check-in activity with missing ids');
        continue;
      }

      const result = await client.query(
        `INSERT INTO mood_checkin_activities (mood_checkin_id, activity_id)
         VALUES ($1, $2)
         ON CONFLICT (mood_checkin_id, activity_id) DO NOTHING`,
        [link.mood_checkin_id, link.activity_id]
      );

      if (result.rowCount === 1) {
        counts.moodCheckinActivities.inserted += 1;
      } else {
        counts.moodCheckinActivities.skipped += 1;
      }
    }

    for (const subscription of backup.data.pushSubscriptions) {
      if (!subscription?.id || !subscription.subscription_json) {
        counts.pushSubscriptions.skipped += 1;
        errors.push('Skipped push subscription with missing id/subscription_json');
        continue;
      }

      const result = await client.query(
        `INSERT INTO push_subscriptions (
           id, user_id, subscription_json, is_active,
           created_at, updated_at
         )
         VALUES (
           $1, $2, $3::jsonb, COALESCE($4, true),
           COALESCE($5::timestamptz, NOW()), COALESCE($6::timestamptz, NOW())
         )
         ON CONFLICT (id) DO NOTHING`,
        [
          subscription.id,
          USER_ID,
          JSON.stringify(subscription.subscription_json),
          subscription.is_active,
          subscription.created_at || null,
          subscription.updated_at || null,
        ]
      );

      if (result.rowCount === 1) {
        counts.pushSubscriptions.inserted += 1;
      } else {
        counts.pushSubscriptions.skipped += 1;
      }
    }

    await client.query('COMMIT');

    res.json({
      message: 'Backup import complete',
      schemaVersion: backup.schemaVersion,
      counts,
      errors,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error importing backup:', err);
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to import backup' });
  } finally {
    client.release();
  }
});

router.post('/start-over', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const first = (req.body?.first_confirmation ?? '').toString().trim();
    const second = (req.body?.second_confirmation ?? '').toString().trim();

    if (first !== FIRST_START_OVER_CONFIRMATION || second !== SECOND_START_OVER_CONFIRMATION) {
      return res.status(400).json({
        error: 'Start-over confirmation failed',
        required: {
          first_confirmation: FIRST_START_OVER_CONFIRMATION,
          second_confirmation: SECOND_START_OVER_CONFIRMATION,
        },
      });
    }

    const rawOptions = req.body?.options ?? {};
    const deleteAllCheckins = Boolean(rawOptions.delete_all_checkins);
    const deleteVenueCheckins = deleteAllCheckins || Boolean(rawOptions.delete_venue_checkins);
    const deleteMoodCheckins = deleteAllCheckins || Boolean(rawOptions.delete_mood_checkins);
    const resetAccountSettings = Boolean(rawOptions.reset_account_settings);
    const resetMoodSettings = Boolean(rawOptions.reset_mood_settings);
    const resetIntegrationsSettings = Boolean(rawOptions.reset_integrations_settings);

    if (!deleteVenueCheckins && !deleteMoodCheckins && !resetAccountSettings && !resetMoodSettings && !resetIntegrationsSettings) {
      return res.status(400).json({
        error: 'No start-over actions selected',
      });
    }

    await client.query('BEGIN');

    const counts: Record<string, number> = {};

    if (deleteVenueCheckins) {
      const scrobbleResult = await client.query(
        `DELETE FROM checkin_scrobbles
         WHERE checkin_id IN (SELECT id FROM checkins WHERE user_id = $1)`,
        [USER_ID]
      );
      counts.checkin_scrobbles = scrobbleResult.rowCount ?? 0;

      const checkinResult = await client.query('DELETE FROM checkins WHERE user_id = $1', [USER_ID]);
      counts.checkins = checkinResult.rowCount ?? 0;
    }

    if (deleteMoodCheckins) {
      const moodCheckinResult = await client.query('DELETE FROM mood_checkins WHERE user_id = $1', [USER_ID]);
      counts.mood_checkins = moodCheckinResult.rowCount ?? 0;
    }

    if (resetMoodSettings) {
      const groupResult = await client.query('DELETE FROM mood_activity_groups WHERE user_id = $1', [USER_ID]);
      counts.mood_activity_groups = groupResult.rowCount ?? 0;

      const moodSettingsResult = await client.query(
        `INSERT INTO user_settings (user_id, mood_reminder_times, mood_icon_pack)
         VALUES ($1, ARRAY[]::text[], 'emoji')
         ON CONFLICT (user_id) DO UPDATE SET
           mood_reminder_times = EXCLUDED.mood_reminder_times,
           mood_icon_pack = EXCLUDED.mood_icon_pack,
           updated_at = NOW()`,
        [USER_ID]
      );
      counts.user_settings_mood_reset = moodSettingsResult.rowCount ?? 0;
    }

    if (resetIntegrationsSettings) {
      const pushLogResult = await client.query('DELETE FROM push_delivery_logs WHERE user_id = $1', [USER_ID]);
      counts.push_delivery_logs = pushLogResult.rowCount ?? 0;

      const pushResult = await client.query('DELETE FROM push_subscriptions WHERE user_id = $1', [USER_ID]);
      counts.push_subscriptions = pushResult.rowCount ?? 0;

      const integrationSettingsResult = await client.query(
        `INSERT INTO user_settings (user_id, dawarich_url, dawarich_api_key, immich_url, immich_api_key, maloja_url)
         VALUES ($1, NULL, NULL, NULL, NULL, NULL)
         ON CONFLICT (user_id) DO UPDATE SET
           dawarich_url = NULL,
           dawarich_api_key = NULL,
           immich_url = NULL,
           immich_api_key = NULL,
           maloja_url = NULL,
           updated_at = NOW()`,
        [USER_ID]
      );
      counts.user_settings_integrations_reset = integrationSettingsResult.rowCount ?? 0;
    }

    if (resetAccountSettings) {
      const profileResult = await client.query(
        `UPDATE users
         SET display_name = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [USER_ID]
      );
      counts.user_profile_reset = profileResult.rowCount ?? 0;

      const accountSettingsResult = await client.query(
        `INSERT INTO user_settings (user_id, theme, notifications_enabled)
         VALUES ($1, 'system', true)
         ON CONFLICT (user_id) DO UPDATE SET
           theme = 'system',
           notifications_enabled = true,
           updated_at = NOW()`,
        [USER_ID]
      );
      counts.user_settings_account_reset = accountSettingsResult.rowCount ?? 0;
    }

    await client.query('COMMIT');

    res.json({ message: 'Selected data has been reset.', counts });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error running start-over:', err);
    res.status(500).json({ error: 'Failed to start over' });
  } finally {
    client.release();
  }
});

export const backupRouter = router;
