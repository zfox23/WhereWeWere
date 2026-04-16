package com.wherewewere.android.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Cached timeline item. [checkedInAt] is stored separately for ORDER BY without deserializing JSON.
 */
@Entity(tableName = "cached_timeline_items")
data class CachedTimelineItem(
    @PrimaryKey val id: String,
    /** JSON-encoded [com.wherewewere.android.data.model.TimelineItem]. */
    val json: String,
    /** ISO-8601 timestamp used for sorting offline results (matches server sort order). */
    @ColumnInfo(name = "checked_in_at") val checkedInAt: String,
)

/** Cached full [com.wherewewere.android.data.model.CheckIn] detail. */
@Entity(tableName = "cached_checkins")
data class CachedCheckIn(
    @PrimaryKey val id: String,
    val json: String,
)

/** Cached full [com.wherewewere.android.data.model.MoodCheckIn] detail. */
@Entity(tableName = "cached_mood_checkins")
data class CachedMoodCheckIn(
    @PrimaryKey val id: String,
    val json: String,
)

/** Cached full [com.wherewewere.android.data.model.SleepEntry] detail. */
@Entity(tableName = "cached_sleep_entries")
data class CachedSleepEntry(
    @PrimaryKey val id: String,
    val json: String,
)
