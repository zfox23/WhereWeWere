package com.wherewewere.android.data.repository

import com.wherewewere.android.data.api.WhereWeWereService
import com.wherewewere.android.data.db.CacheDao
import com.wherewewere.android.data.db.CachedMoodCheckIn
import com.wherewewere.android.data.db.OfflineQueue
import com.wherewewere.android.data.model.MoodActivityGroup
import com.wherewewere.android.data.model.MoodCheckIn
import com.wherewewere.android.data.model.requests.CreateMoodCheckinRequest
import com.wherewewere.android.data.model.requests.UpdateMoodCheckinRequest
import com.wherewewere.android.data.sync.ConnectivityMonitor
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class MoodRepository @Inject constructor(
    private val service: WhereWeWereService,
    private val connectivity: ConnectivityMonitor,
    private val offlineQueue: OfflineQueue,
    private val cacheDao: CacheDao,
    private val json: Json,
) {
    companion object {
        private const val USER_ID = TimelineRepository.USER_ID
    }

    suspend fun getMoodCheckins(limit: Int = 50, offset: Int = 0): Result<List<MoodCheckIn>> =
        runCatching { service.getMoodCheckins(USER_ID, limit, offset) }

    suspend fun getMoodCheckin(id: String): Result<MoodCheckIn> {
        if (!connectivity.isOnline.value) {
            return runCatching {
                val cached = cacheDao.getMoodCheckIn(id)
                    ?: throw Exception("This mood entry isn't available offline.")
                json.decodeFromString(MoodCheckIn.serializer(), cached.json)
            }
        }
        return runCatching {
            val mc = service.getMoodCheckin(id)
            cacheDao.upsertMoodCheckIns(listOf(CachedMoodCheckIn(id = mc.id, json = json.encodeToString(MoodCheckIn.serializer(), mc))))
            mc
        }
    }

    suspend fun createMoodCheckin(
        mood: Int,
        note: String?,
        checkedInAt: String,
        moodTimezone: String,
        activityIds: List<String>,
    ): Result<Unit> {
        val req = CreateMoodCheckinRequest(
            userId = USER_ID,
            mood = mood,
            note = note,
            checkedInAt = checkedInAt,
            moodTimezone = moodTimezone,
            activityIds = activityIds,
        )
        if (!connectivity.isOnline.value) {
            return runCatching { offlineQueue.enqueueCreateMoodCheckin(req) }
        }
        return runCatching { service.createMoodCheckin(req); Unit }
    }

    suspend fun updateMoodCheckin(
        id: String,
        mood: Int,
        note: String?,
        checkedInAt: String,
        moodTimezone: String,
        activityIds: List<String>,
    ): Result<Unit> {
        if (!connectivity.isOnline.value) {
            return runCatching {
                offlineQueue.enqueueUpdateMoodCheckin(id, mood, note, checkedInAt, moodTimezone, activityIds)
            }
        }
        return runCatching {
            val updated = service.updateMoodCheckin(
                id = id,
                body = UpdateMoodCheckinRequest(
                    mood = mood,
                    note = note,
                    checkedInAt = checkedInAt,
                    moodTimezone = moodTimezone,
                    activityIds = activityIds,
                ),
            )
            cacheDao.upsertMoodCheckIns(listOf(CachedMoodCheckIn(id = updated.id, json = json.encodeToString(MoodCheckIn.serializer(), updated))))
        }
    }

    suspend fun deleteMoodCheckin(id: String): Result<Unit> {
        if (!connectivity.isOnline.value) {
            return runCatching { offlineQueue.enqueueDeleteMoodCheckin(id) }
        }
        return runCatching { service.deleteMoodCheckin(id) }
    }

    suspend fun getMoodActivityGroups(): Result<List<MoodActivityGroup>> =
        runCatching { service.getMoodActivityGroups() }
}
