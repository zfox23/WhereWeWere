package com.wherewewere.android.data.repository

import com.wherewewere.android.data.api.WhereWeWereService
import com.wherewewere.android.data.model.NearbyVenue
import com.wherewewere.android.data.model.Venue
import com.wherewewere.android.data.model.VenueCategory
import com.wherewewere.android.data.model.requests.ImportOsmRequest
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class VenueRepository @Inject constructor(
    private val service: WhereWeWereService,
) {
    suspend fun getVenue(id: String): Result<Venue> =
        runCatching { service.getVenue(id) }

    suspend fun getNearbyVenues(
        lat: Double,
        lon: Double,
        radius: Int = 5000,
        query: String? = null,
    ): Result<List<NearbyVenue>> = runCatching {
        service.getNearbyVenues(lat = lat, lon = lon, radius = radius, query = query)
    }

    suspend fun searchPlaces(query: String): Result<List<NearbyVenue>> =
        runCatching { service.searchPlaces(query) }

    suspend fun importOsmVenue(venue: NearbyVenue): Result<Venue> = runCatching {
        service.importOsmVenue(
            ImportOsmRequest(
                osmId = venue.osmId ?: "",
                name = venue.name,
                latitude = venue.latitude,
                longitude = venue.longitude,
                address = venue.address,
            )
        )
    }

    suspend fun getCategories(): Result<List<VenueCategory>> =
        runCatching { service.getVenueCategories() }
}
