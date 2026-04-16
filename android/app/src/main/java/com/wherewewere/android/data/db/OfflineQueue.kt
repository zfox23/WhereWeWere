package com.wherewewere.android.data.db

import com.wherewewere.android.data.model.requests.CreateCheckinRequest
import com.wherewewere.android.data.model.requests.CreateMoodCheckinRequest
import com.wherewewere.android.data.model.requests.CreateSleepEntryRequest
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/** High-level API for enqueuing offline mutations. Used by repositories. */
@Singleton
class OfflineQueue @Inject constructor(
    private val dao: PendingOperationDao,
    private val json: Json,
) {
    val pendingCount: Flow<Int> = dao.countFlow()

    // ── Check-ins ─────────────────────────────────────────────────────────────

    suspend fun enqueueCreateCheckin(req: CreateCheckinRequest) {
        dao.insert(PendingOperation(
            operationType = OperationType.CREATE_CHECKIN.name,
            payload = json.encodeToString(CreateCheckinRequest.serializer(), req),
        ))
    }

    suspend fun enqueueUpdateCheckin(id: String, notes: String?, checkedInAt: String) {
        dao.insert(PendingOperation(
            operationType = OperationType.UPDATE_CHECKIN.name,
            payload = json.encodeToString(UpdateCheckinPayload.serializer(), UpdateCheckinPayload(id, notes, checkedInAt)),
        ))
    }

    suspend fun enqueueDeleteCheckin(id: String) {
        dao.insert(PendingOperation(
            operationType = OperationType.DELETE_CHECKIN.name,
            payload = json.encodeToString(IdPayload.serializer(), IdPayload(id)),
        ))
    }

    // ── Mood check-ins ────────────────────────────────────────────────────────

    suspend fun enqueueCreateMoodCheckin(req: CreateMoodCheckinRequest) {
        dao.insert(PendingOperation(
            operationType = OperationType.CREATE_MOOD_CHECKIN.name,
            payload = json.encodeToString(CreateMoodCheckinRequest.serializer(), req),
        ))
    }

    suspend fun enqueueUpdateMoodCheckin(
        id: String, mood: Int, note: String?, checkedInAt: String,
        moodTimezone: String, activityIds: List<String>,
    ) {
        dao.insert(PendingOperation(
            operationType = OperationType.UPDATE_MOOD_CHECKIN.name,
            payload = json.encodeToString(
                UpdateMoodCheckinPayload.serializer(),
                UpdateMoodCheckinPayload(id, mood, note, checkedInAt, moodTimezone, activityIds),
            ),
        ))
    }

    suspend fun enqueueDeleteMoodCheckin(id: String) {
        dao.insert(PendingOperation(
            operationType = OperationType.DELETE_MOOD_CHECKIN.name,
            payload = json.encodeToString(IdPayload.serializer(), IdPayload(id)),
        ))
    }

    // ── Sleep entries ─────────────────────────────────────────────────────────

    suspend fun enqueueCreateSleepEntry(req: CreateSleepEntryRequest) {
        dao.insert(PendingOperation(
            operationType = OperationType.CREATE_SLEEP_ENTRY.name,
            payload = json.encodeToString(CreateSleepEntryRequest.serializer(), req),
        ))
    }

    suspend fun enqueueUpdateSleepEntry(
        id: String, startedAt: String, endedAt: String, rating: Double, comment: String?,
    ) {
        dao.insert(PendingOperation(
            operationType = OperationType.UPDATE_SLEEP_ENTRY.name,
            payload = json.encodeToString(
                UpdateSleepEntryPayload.serializer(),
                UpdateSleepEntryPayload(id, startedAt, endedAt, rating, comment),
            ),
        ))
    }

    suspend fun enqueueDeleteSleepEntry(id: String) {
        dao.insert(PendingOperation(
            operationType = OperationType.DELETE_SLEEP_ENTRY.name,
            payload = json.encodeToString(IdPayload.serializer(), IdPayload(id)),
        ))
    }

    // ── Internal helpers used by SyncWorker ───────────────────────────────────

    suspend fun getAll(): List<PendingOperation> = dao.getAll()
    suspend fun delete(op: PendingOperation) = dao.delete(op)
    suspend fun incrementRetry(id: Long) = dao.incrementRetry(id)
}
