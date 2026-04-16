package com.wherewewere.android.data.model.requests

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class CreateMoodCheckinRequest(
    @SerialName("user_id") val userId: String,
    val mood: Int,
    val note: String? = null,
    @SerialName("checked_in_at") val checkedInAt: String,
    @SerialName("mood_timezone") val moodTimezone: String,
    @SerialName("activity_ids") val activityIds: List<String> = emptyList(),
)

@Serializable
data class UpdateMoodCheckinRequest(
    val mood: Int,
    val note: String? = null,
    @SerialName("checked_in_at") val checkedInAt: String,
    @SerialName("mood_timezone") val moodTimezone: String,
    @SerialName("activity_ids") val activityIds: List<String> = emptyList(),
)
