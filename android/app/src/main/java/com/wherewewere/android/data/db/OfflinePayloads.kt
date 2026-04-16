package com.wherewewere.android.data.db

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Payload for DELETE operations — just the entity id. */
@Serializable
data class IdPayload(val id: String)

/** Payload for UPDATE_CHECKIN. */
@Serializable
data class UpdateCheckinPayload(
    val id: String,
    val notes: String?,
    @SerialName("checked_in_at") val checkedInAt: String,
)

/** Payload for UPDATE_MOOD_CHECKIN. */
@Serializable
data class UpdateMoodCheckinPayload(
    val id: String,
    val mood: Int,
    val note: String?,
    @SerialName("checked_in_at") val checkedInAt: String,
    @SerialName("mood_timezone") val moodTimezone: String,
    @SerialName("activity_ids") val activityIds: List<String>,
)

/** Payload for UPDATE_SLEEP_ENTRY. */
@Serializable
data class UpdateSleepEntryPayload(
    val id: String,
    @SerialName("started_at") val startedAt: String,
    @SerialName("ended_at") val endedAt: String,
    val rating: Double,
    val comment: String?,
)
