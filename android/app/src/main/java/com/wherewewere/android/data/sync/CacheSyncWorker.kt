package com.wherewewere.android.data.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.*
import com.wherewewere.android.data.api.WhereWeWereService
import com.wherewewere.android.data.db.*
import com.wherewewere.android.data.model.CheckIn
import com.wherewewere.android.data.model.MoodCheckIn
import com.wherewewere.android.data.model.SleepEntry
import com.wherewewere.android.data.model.TimelineItem
import com.wherewewere.android.data.repository.TimelineRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Downloads the user's complete check-in, mood, and sleep history from the server and stores it
 * locally in Room so it can be browsed while offline.
 *
 * Always replaces (delete + re-insert) each entity type so the local cache is an exact server
 * mirror — no conflict resolution needed, server always wins.
 */
@HiltWorker
class CacheSyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val service: WhereWeWereService,
    private val cacheDao: CacheDao,
    private val json: Json,
) : CoroutineWorker(context, params) {

    companion object {
        private const val WORK_NAME = "cache_sync"
        private const val PAGE_SIZE = 200

        fun schedule(workManager: WorkManager) {
            val request = OneTimeWorkRequestBuilder<CacheSyncWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .build()
            workManager.enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.KEEP, request)
        }

        /** Returns a [OneTimeWorkRequest] for use in a WorkManager chain after [SyncWorker]. */
        fun buildRequest(): OneTimeWorkRequest =
            OneTimeWorkRequestBuilder<CacheSyncWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .build()
    }

    override suspend fun doWork(): Result {
        return try {
            syncTimeline()
            syncCheckIns()
            syncMoodCheckIns()
            syncSleepEntries()
            Result.success()
        } catch (e: Exception) {
            // Retry on network failures; the work constraint already ensures connectivity
            Result.retry()
        }
    }

    private suspend fun syncTimeline() {
        val all = fetchAllPages { offset ->
            service.getTimeline(userId = TimelineRepository.USER_ID, limit = PAGE_SIZE, offset = offset)
        }
        cacheDao.replaceAllTimeline(all.map { item: TimelineItem ->
            CachedTimelineItem(
                id = item.id,
                json = json.encodeToString(item),
                checkedInAt = item.checkedInAt,
            )
        })
    }

    private suspend fun syncCheckIns() {
        val all = fetchAllPages { offset ->
            service.getCheckins(userId = TimelineRepository.USER_ID, limit = PAGE_SIZE, offset = offset)
        }
        cacheDao.replaceAllCheckIns(all.map { ci: CheckIn ->
            CachedCheckIn(id = ci.id, json = json.encodeToString(ci))
        })
    }

    private suspend fun syncMoodCheckIns() {
        val all = fetchAllPages { offset ->
            service.getMoodCheckins(userId = TimelineRepository.USER_ID, limit = PAGE_SIZE, offset = offset)
        }
        cacheDao.replaceAllMoodCheckIns(all.map { mc: MoodCheckIn ->
            CachedMoodCheckIn(id = mc.id, json = json.encodeToString(mc))
        })
    }

    private suspend fun syncSleepEntries() {
        val all = fetchAllPages { offset ->
            service.getSleepEntries(userId = TimelineRepository.USER_ID, limit = PAGE_SIZE, offset = offset)
        }
        cacheDao.replaceAllSleepEntries(all.map { se: SleepEntry ->
            CachedSleepEntry(id = se.id, json = json.encodeToString(se))
        })
    }

    /** Fetches all pages of [T] by calling [fetch] repeatedly until a page smaller than [PAGE_SIZE] is returned. */
    private suspend fun <T> fetchAllPages(fetch: suspend (offset: Int) -> List<T>): List<T> {
        val all = mutableListOf<T>()
        var offset = 0
        while (true) {
            val page = fetch(offset)
            all.addAll(page)
            if (page.size < PAGE_SIZE) break
            offset += page.size
        }
        return all
    }
}
