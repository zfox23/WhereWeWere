package com.wherewewere.android.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class MoodCheckIn(
    val id: String,
    @SerialName("user_id") val userId: String,
    val mood: Int,
    val note: String? = null,
    @SerialName("mood_timezone") val moodTimezone: String? = null,
    val activities: List<ActivityRef> = emptyList(),
    @SerialName("checked_in_at") val checkedInAt: String,
    @SerialName("created_at") val createdAt: String,
)

@Serializable
data class MoodActivityGroup(
    val id: String,
    val name: String,
    @SerialName("display_order") val displayOrder: Int,
    val activities: List<MoodActivity> = emptyList(),
)

@Serializable
data class MoodActivity(
    val id: String,
    @SerialName("group_id") val groupId: String,
    val name: String,
    @SerialName("display_order") val displayOrder: Int,
    val icon: String? = null,
    @SerialName("mood_checkin_count") val moodCheckinCount: Int? = null,
)
