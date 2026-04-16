package com.wherewewere.android.data.repository

import com.wherewewere.android.data.api.WhereWeWereService
import com.wherewewere.android.data.db.CacheDao
import com.wherewewere.android.data.db.CachedSleepEntry
import com.wherewewere.android.data.db.OfflineQueue
import com.wherewewere.android.data.model.SleepEntry
import com.wherewewere.android.data.model.requests.CreateSleepEntryRequest
import com.wherewewere.android.data.model.requests.UpdateSleepEntryRequest
import com.wherewewere.android.data.sync.ConnectivityMonitor
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SleepRepository @Inject constructor(
    private val service: WhereWeWereService,
    private val connectivity: ConnectivityMonitor,
    private val offlineQueue: OfflineQueue,
    private val cacheDao: CacheDao,
    private val json: Json,
) {
    companion object {
        private const val USER_ID = TimelineRepository.USER_ID
    }

    suspend fun getSleepEntries(limit: Int = 50, offset: Int = 0): Result<List<SleepEntry>> =
        runCatching { service.getSleepEntries(USER_ID, limit, offset) }

    suspend fun getSleepEntry(id: String): Result<SleepEntry> {
        if (!connectivity.isOnline.value) {
            return runCatching {
                val cached = cacheDao.getSleepEntry(id)
                    ?: throw Exception("This sleep entry isn't available offline.")
                json.decodeFromString(SleepEntry.serializer(), cached.json)
            }
        }
        return runCatching {
            val se = service.getSleepEntry(id)
            cacheDao.upsertSleepEntries(listOf(CachedSleepEntry(id = se.id, json = json.encodeToString(SleepEntry.serializer(), se))))
            se
        }
    }

    suspend fun createSleepEntry(
        startedAt: String,
        endedAt: String,
        rating: Double,
        comment: String?,
        sleepTimezone: String,
    ): Result<Unit> {
        val req = CreateSleepEntryRequest(
            userId = USER_ID,
            startedAt = startedAt,
            endedAt = endedAt,
            rating = rating,
            comment = comment,
            sleepTimezone = sleepTimezone,
        )
        if (!connectivity.isOnline.value) {
            return runCatching { offlineQueue.enqueueCreateSleepEntry(req) }
        }
        return runCatching { service.createSleepEntry(req); Unit }
    }

    suspend fun updateSleepEntry(
        id: String,
        startedAt: String,
        endedAt: String,
        rating: Double,
        comment: String?,
    ): Result<Unit> {
        if (!connectivity.isOnline.value) {
            return runCatching { offlineQueue.enqueueUpdateSleepEntry(id, startedAt, endedAt, rating, comment) }
        }
        return runCatching {
            val updated = service.updateSleepEntry(
                id = id,
                body = UpdateSleepEntryRequest(
                    startedAt = startedAt,
                    endedAt = endedAt,
                    rating = rating,
                    comment = comment,
                ),
            )
            cacheDao.upsertSleepEntries(listOf(CachedSleepEntry(id = updated.id, json = json.encodeToString(SleepEntry.serializer(), updated))))
        }
    }

    suspend fun deleteSleepEntry(id: String): Result<Unit> {
        if (!connectivity.isOnline.value) {
            return runCatching { offlineQueue.enqueueDeleteSleepEntry(id) }
        }
        return runCatching { service.deleteSleepEntry(id) }
    }
}
