package com.wherewewere.android.data.db

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [
        PendingOperation::class,
        CachedTimelineItem::class,
        CachedCheckIn::class,
        CachedMoodCheckIn::class,
        CachedSleepEntry::class,
    ],
    version = 2,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun pendingOperationDao(): PendingOperationDao
    abstract fun cacheDao(): CacheDao
}
