package com.wherewewere.android.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class CheckIn(
    val id: String,
    @SerialName("user_id") val userId: String,
    @SerialName("venue_id") val venueId: String,
    @SerialName("venue_name") val venueName: String? = null,
    @SerialName("venue_category") val venueCategory: String? = null,
    @SerialName("venue_latitude") val venueLatitude: Double? = null,
    @SerialName("venue_longitude") val venueLongitude: Double? = null,
    @SerialName("venue_timezone") val venueTimezone: String? = null,
    @SerialName("venue_address") val venueAddress: String? = null,
    @SerialName("venue_city") val venueCity: String? = null,
    @SerialName("venue_state") val venueState: String? = null,
    @SerialName("venue_country") val venueCountry: String? = null,
    @SerialName("parent_venue_id") val parentVenueId: String? = null,
    @SerialName("parent_venue_name") val parentVenueName: String? = null,
    val notes: String? = null,
    @SerialName("checked_in_at") val checkedInAt: String,
    @SerialName("created_at") val createdAt: String,
)
