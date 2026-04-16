package com.wherewewere.android.data.model.requests

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class CreateCheckinRequest(
    @SerialName("user_id") val userId: String,
    @SerialName("venue_id") val venueId: String,
    val notes: String? = null,
    @SerialName("checked_in_at") val checkedInAt: String,
    @SerialName("also_checkin_parent") val alsoCheckinParent: Boolean = false,
)

@Serializable
data class UpdateCheckinRequest(
    val notes: String? = null,
    @SerialName("checked_in_at") val checkedInAt: String,
)
