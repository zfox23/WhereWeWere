package com.wherewewere.android.data.repository

import com.wherewewere.android.data.api.WhereWeWereService
import com.wherewewere.android.data.db.CacheDao
import com.wherewewere.android.data.db.CachedCheckIn
import com.wherewewere.android.data.db.OfflineQueue
import com.wherewewere.android.data.model.CheckIn
import com.wherewewere.android.data.model.requests.CreateCheckinRequest
import com.wherewewere.android.data.model.requests.UpdateCheckinRequest
import com.wherewewere.android.data.sync.ConnectivityMonitor
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class CheckInRepository @Inject constructor(
    private val service: WhereWeWereService,
    private val connectivity: ConnectivityMonitor,
    private val offlineQueue: OfflineQueue,
    private val cacheDao: CacheDao,
    private val json: Json,
) {
    companion object {
        const val USER_ID = TimelineRepository.USER_ID
    }

    suspend fun getCheckins(venueId: String? = null, limit: Int = 50, offset: Int = 0): Result<List<CheckIn>> =
        runCatching { service.getCheckins(USER_ID, venueId = venueId, limit = limit, offset = offset) }

    suspend fun getCheckin(id: String): Result<CheckIn> {
        if (!connectivity.isOnline.value) {
            return runCatching {
                val cached = cacheDao.getCheckIn(id)
                    ?: throw Exception("This check-in isn't available offline.")
                json.decodeFromString(CheckIn.serializer(), cached.json)
            }
        }
        return runCatching {
            val ci = service.getCheckin(id)
            cacheDao.upsertCheckIns(listOf(CachedCheckIn(id = ci.id, json = json.encodeToString(CheckIn.serializer(), ci))))
            ci
        }
    }

    suspend fun createCheckin(
        venueId: String,
        notes: String?,
        checkedInAt: String,
        alsoCheckinParent: Boolean = false,
    ): Result<Unit> {
        val req = CreateCheckinRequest(
            userId = USER_ID,
            venueId = venueId,
            notes = notes,
            checkedInAt = checkedInAt,
            alsoCheckinParent = alsoCheckinParent,
        )
        if (!connectivity.isOnline.value) {
            return runCatching { offlineQueue.enqueueCreateCheckin(req) }
        }
        return runCatching { service.createCheckin(req); Unit }
    }

    suspend fun updateCheckin(id: String, notes: String?, checkedInAt: String): Result<Unit> {
        if (!connectivity.isOnline.value) {
            return runCatching { offlineQueue.enqueueUpdateCheckin(id, notes, checkedInAt) }
        }
        return runCatching {
            val updated = service.updateCheckin(id, UpdateCheckinRequest(notes = notes, checkedInAt = checkedInAt))
            cacheDao.upsertCheckIns(listOf(CachedCheckIn(id = updated.id, json = json.encodeToString(CheckIn.serializer(), updated))))
        }
    }

    suspend fun deleteCheckin(id: String): Result<Unit> {
        if (!connectivity.isOnline.value) {
            return runCatching { offlineQueue.enqueueDeleteCheckin(id) }
        }
        return runCatching { service.deleteCheckin(id) }
    }
}
