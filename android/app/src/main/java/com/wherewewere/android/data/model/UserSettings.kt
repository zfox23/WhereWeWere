package com.wherewewere.android.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class UserSettings(
    val username: String,
    val email: String,
    @SerialName("display_name") val displayName: String? = null,
    @SerialName("mood_icon_pack") val moodIconPack: String = "emoji",
    @SerialName("distance_unit") val distanceUnit: String = "metric",
    @SerialName("notifications_enabled") val notificationsEnabled: Boolean = false,
)

@Serializable
data class SearchResults(
    val venues: List<Venue> = emptyList(),
    val checkins: List<CheckIn> = emptyList(),
)
