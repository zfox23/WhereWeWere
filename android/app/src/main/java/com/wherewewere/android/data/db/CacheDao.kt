package com.wherewewere.android.data.db

import androidx.room.*

@Dao
interface CacheDao {

    // ── Timeline ──────────────────────────────────────────────────────────────

    @Query("SELECT * FROM cached_timeline_items ORDER BY checked_in_at DESC")
    suspend fun getAllTimeline(): List<CachedTimelineItem>

    @Upsert
    suspend fun upsertTimeline(items: List<CachedTimelineItem>)

    @Query("DELETE FROM cached_timeline_items")
    suspend fun deleteAllTimeline()

    // ── Check-ins ─────────────────────────────────────────────────────────────

    @Query("SELECT * FROM cached_checkins WHERE id = :id")
    suspend fun getCheckIn(id: String): CachedCheckIn?

    @Upsert
    suspend fun upsertCheckIns(items: List<CachedCheckIn>)

    @Query("DELETE FROM cached_checkins")
    suspend fun deleteAllCheckIns()

    // ── Mood check-ins ────────────────────────────────────────────────────────

    @Query("SELECT * FROM cached_mood_checkins WHERE id = :id")
    suspend fun getMoodCheckIn(id: String): CachedMoodCheckIn?

    @Upsert
    suspend fun upsertMoodCheckIns(items: List<CachedMoodCheckIn>)

    @Query("DELETE FROM cached_mood_checkins")
    suspend fun deleteAllMoodCheckIns()

    // ── Sleep entries ─────────────────────────────────────────────────────────

    @Query("SELECT * FROM cached_sleep_entries WHERE id = :id")
    suspend fun getSleepEntry(id: String): CachedSleepEntry?

    @Upsert
    suspend fun upsertSleepEntries(items: List<CachedSleepEntry>)

    @Query("DELETE FROM cached_sleep_entries")
    suspend fun deleteAllSleepEntries()

    // ── Bulk replace (used by CacheSyncWorker after full refresh) ─────────────

    @Transaction
    suspend fun replaceAllTimeline(items: List<CachedTimelineItem>) {
        deleteAllTimeline()
        upsertTimeline(items)
    }

    @Transaction
    suspend fun replaceAllCheckIns(items: List<CachedCheckIn>) {
        deleteAllCheckIns()
        upsertCheckIns(items)
    }

    @Transaction
    suspend fun replaceAllMoodCheckIns(items: List<CachedMoodCheckIn>) {
        deleteAllMoodCheckIns()
        upsertMoodCheckIns(items)
    }

    @Transaction
    suspend fun replaceAllSleepEntries(items: List<CachedSleepEntry>) {
        deleteAllSleepEntries()
        upsertSleepEntries(items)
    }
}
