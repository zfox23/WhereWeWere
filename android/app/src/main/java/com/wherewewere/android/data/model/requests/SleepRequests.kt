package com.wherewewere.android.data.model.requests

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class CreateSleepEntryRequest(
    @SerialName("user_id") val userId: String,
    @SerialName("started_at") val startedAt: String,
    @SerialName("ended_at") val endedAt: String,
    val rating: Double,
    val comment: String? = null,
    @SerialName("sleep_timezone") val sleepTimezone: String,
)

@Serializable
data class UpdateSleepEntryRequest(
    @SerialName("started_at") val startedAt: String,
    @SerialName("ended_at") val endedAt: String,
    val rating: Double,
    val comment: String? = null,
)
