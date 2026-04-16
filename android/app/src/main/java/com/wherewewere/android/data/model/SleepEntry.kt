package com.wherewewere.android.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class SleepEntry(
    val id: String,
    @SerialName("user_id") val userId: String,
    @SerialName("sleep_as_android_id") val sleepAsAndroidId: Long? = null,
    @SerialName("sleep_timezone") val sleepTimezone: String,
    @SerialName("started_at") val startedAt: String,
    @SerialName("ended_at") val endedAt: String,
    val rating: Double,
    val comment: String? = null,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String? = null,
)
