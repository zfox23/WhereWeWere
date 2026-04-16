package com.wherewewere.android.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ActivityRef(
    val id: String,
    val name: String,
    @SerialName("group_name") val groupName: String,
    val icon: String? = null,
)

@Serializable
data class TimelineItem(
    val type: String, // "location" | "mood" | "sleep"
    val id: String,
    @SerialName("user_id") val userId: String,
    @SerialName("checked_in_at") val checkedInAt: String,
    @SerialName("created_at") val createdAt: String,
    val notes: String? = null,
    // Location fields
    @SerialName("venue_id") val venueId: String? = null,
    @SerialName("venue_name") val venueName: String? = null,
    @SerialName("venue_category") val venueCategory: String? = null,
    @SerialName("venue_latitude") val venueLatitude: Double? = null,
    @SerialName("venue_longitude") val venueLongitude: Double? = null,
    @SerialName("venue_timezone") val venueTimezone: String? = null,
    @SerialName("parent_venue_id") val parentVenueId: String? = null,
    @SerialName("parent_venue_name") val parentVenueName: String? = null,
    // Mood fields
    val mood: Int? = null,
    @SerialName("mood_timezone") val moodTimezone: String? = null,
    val activities: List<ActivityRef>? = null,
    // Sleep fields
    @SerialName("sleep_as_android_id") val sleepAsAndroidId: Long? = null,
    @SerialName("sleep_started_at") val sleepStartedAt: String? = null,
    @SerialName("sleep_ended_at") val sleepEndedAt: String? = null,
    @SerialName("sleep_timezone") val sleepTimezone: String? = null,
    @SerialName("sleep_rating") val sleepRating: Double? = null,
    @SerialName("sleep_comment") val sleepComment: String? = null,
)
