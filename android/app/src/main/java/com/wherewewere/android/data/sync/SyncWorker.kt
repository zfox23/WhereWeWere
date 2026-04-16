package com.wherewewere.android.data.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.*
import com.wherewewere.android.data.api.WhereWeWereService
import com.wherewewere.android.data.db.*
import com.wherewewere.android.data.model.requests.*
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.serialization.json.Json

/** WorkManager worker that replays queued offline mutations against the live API. */
@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val offlineQueue: OfflineQueue,
    private val service: WhereWeWereService,
    private val json: Json,
) : CoroutineWorker(context, params) {

    companion object {
        private const val WORK_NAME = "offline_sync"
        private const val MAX_RETRIES = 3

        /**
         * Enqueues a chain: replay pending mutations, then refresh the read cache.
         * Uses [ExistingWorkPolicy.KEEP] so a queued-but-not-yet-running sync is not duplicated.
         */
        fun schedule(workManager: WorkManager) {
            val syncRequest = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30_000L, java.util.concurrent.TimeUnit.MILLISECONDS)
                .build()
            workManager
                .beginUniqueWork(WORK_NAME, ExistingWorkPolicy.KEEP, syncRequest)
                .then(CacheSyncWorker.buildRequest())
                .enqueue()
        }
    }

    override suspend fun doWork(): Result {
        val ops = offlineQueue.getAll()
        if (ops.isEmpty()) return Result.success()

        for (op in ops) {
            val succeeded = try {
                replay(op)
                offlineQueue.delete(op)
                true
            } catch (e: Exception) {
                if (op.retryCount >= MAX_RETRIES) {
                    // Give up on this operation after too many failures
                    offlineQueue.delete(op)
                } else {
                    offlineQueue.incrementRetry(op.id)
                }
                false
            }
            if (!succeeded) break // stop and let WorkManager retry
        }

        return if (offlineQueue.getAll().isEmpty()) Result.success() else Result.retry()
    }

    private suspend fun replay(op: PendingOperation) {
        when (OperationType.valueOf(op.operationType)) {
            OperationType.CREATE_CHECKIN -> {
                val req = json.decodeFromString<CreateCheckinRequest>(op.payload)
                service.createCheckin(req)
            }
            OperationType.UPDATE_CHECKIN -> {
                val p = json.decodeFromString<UpdateCheckinPayload>(op.payload)
                service.updateCheckin(p.id, UpdateCheckinRequest(notes = p.notes, checkedInAt = p.checkedInAt))
            }
            OperationType.DELETE_CHECKIN -> {
                val p = json.decodeFromString<IdPayload>(op.payload)
                service.deleteCheckin(p.id)
            }
            OperationType.CREATE_MOOD_CHECKIN -> {
                val req = json.decodeFromString<CreateMoodCheckinRequest>(op.payload)
                service.createMoodCheckin(req)
            }
            OperationType.UPDATE_MOOD_CHECKIN -> {
                val p = json.decodeFromString<UpdateMoodCheckinPayload>(op.payload)
                service.updateMoodCheckin(
                    id = p.id,
                    body = UpdateMoodCheckinRequest(
                        mood = p.mood,
                        note = p.note,
                        checkedInAt = p.checkedInAt,
                        moodTimezone = p.moodTimezone,
                        activityIds = p.activityIds,
                    ),
                )
            }
            OperationType.DELETE_MOOD_CHECKIN -> {
                val p = json.decodeFromString<IdPayload>(op.payload)
                service.deleteMoodCheckin(p.id)
            }
            OperationType.CREATE_SLEEP_ENTRY -> {
                val req = json.decodeFromString<CreateSleepEntryRequest>(op.payload)
                service.createSleepEntry(req)
            }
            OperationType.UPDATE_SLEEP_ENTRY -> {
                val p = json.decodeFromString<UpdateSleepEntryPayload>(op.payload)
                service.updateSleepEntry(
                    id = p.id,
                    body = UpdateSleepEntryRequest(
                        startedAt = p.startedAt,
                        endedAt = p.endedAt,
                        rating = p.rating,
                        comment = p.comment,
                    ),
                )
            }
            OperationType.DELETE_SLEEP_ENTRY -> {
                val p = json.decodeFromString<IdPayload>(op.payload)
                service.deleteSleepEntry(p.id)
            }
        }
    }
}
