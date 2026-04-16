package com.wherewewere.android.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class VenueChild(
    val id: String,
    val name: String,
)

@Serializable
data class Venue(
    val id: String,
    val name: String,
    @SerialName("category_id") val categoryId: String? = null,
    @SerialName("category_name") val categoryName: String? = null,
    val address: String? = null,
    val city: String? = null,
    val state: String? = null,
    val country: String? = null,
    @SerialName("postal_code") val postalCode: String? = null,
    val latitude: Double,
    val longitude: Double,
    @SerialName("osm_id") val osmId: String? = null,
    @SerialName("parent_venue_id") val parentVenueId: String? = null,
    @SerialName("parent_venue_name") val parentVenueName: String? = null,
    @SerialName("child_venues") val childVenues: List<VenueChild>? = null,
    @SerialName("checkin_count") val checkinCount: Int? = null,
    @SerialName("created_at") val createdAt: String,
)

@Serializable
data class NearbyVenue(
    val name: String,
    // OSM venues return "category"; local DB venues return "category_name" from SQL join alias.
    // Both fields are captured and displayCategory picks whichever is populated.
    val category: String = "",
    @SerialName("category_name") val categoryName: String? = null,
    val latitude: Double,
    val longitude: Double,
    val address: String? = null,
    // Local venues that were not imported from OSM have osm_id = null.
    @SerialName("osm_id") val osmId: String? = null,
    val source: String, // "local" | "osm"
    val id: String? = null, // only for local venues
    val distance: Double? = null,
) {
    val displayCategory: String get() = category.ifBlank { categoryName ?: "" }
}

@Serializable
data class VenueCategory(
    val id: String,
    val name: String,
    val icon: String? = null,
    @SerialName("parent_id") val parentId: String? = null,
)
