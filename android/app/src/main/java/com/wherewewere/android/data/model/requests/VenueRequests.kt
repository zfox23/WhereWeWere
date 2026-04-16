package com.wherewewere.android.data.model.requests

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ImportOsmRequest(
    @SerialName("osm_id") val osmId: String,
    val name: String,
    @SerialName("category_id") val categoryId: String? = null,
    val latitude: Double,
    val longitude: Double,
    val address: String? = null,
)

@Serializable
data class CreateVenueRequest(
    val name: String,
    @SerialName("category_id") val categoryId: String? = null,
    val address: String? = null,
    val latitude: Double,
    val longitude: Double,
)
