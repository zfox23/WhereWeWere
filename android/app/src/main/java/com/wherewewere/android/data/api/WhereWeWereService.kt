package com.wherewewere.android.data.api

import com.wherewewere.android.data.model.*
import com.wherewewere.android.data.model.requests.*
import retrofit2.http.*

interface WhereWeWereService {

    // ── Timeline ─────────────────────────────────────────────────────────────

    @GET("timeline")
    suspend fun getTimeline(
        @Query("user_id") userId: String,
        @Query("limit") limit: Int = 50,
        @Query("offset") offset: Int = 0,
        @Query("from") from: String? = null,
        @Query("to") to: String? = null,
        @Query("q") query: String? = null,
    ): List<TimelineItem>

    // ── Location checkins ────────────────────────────────────────────────────

    @GET("checkins")
    suspend fun getCheckins(
        @Query("user_id") userId: String,
        @Query("venue_id") venueId: String? = null,
        @Query("limit") limit: Int = 50,
        @Query("offset") offset: Int = 0,
    ): List<CheckIn>

    @GET("checkins/{id}")
    suspend fun getCheckin(@Path("id") id: String): CheckIn

    @POST("checkins")
    suspend fun createCheckin(@Body body: CreateCheckinRequest): CheckIn

    @PUT("checkins/{id}")
    suspend fun updateCheckin(@Path("id") id: String, @Body body: UpdateCheckinRequest): CheckIn

    @DELETE("checkins/{id}")
    suspend fun deleteCheckin(@Path("id") id: String)

    // ── Venues ────────────────────────────────────────────────────────────────

    @GET("venues/{id}")
    suspend fun getVenue(@Path("id") id: String): Venue

    @GET("venues/nearby")
    suspend fun getNearbyVenues(
        @Query("lat") lat: Double,
        @Query("lon") lon: Double,
        @Query("radius") radius: Int = 5000,
        @Query("limit") limit: Int = 20,
        @Query("q") query: String? = null,
    ): List<NearbyVenue>

    @GET("venues/place-search")
    suspend fun searchPlaces(@Query("q") query: String): List<NearbyVenue>

    @POST("venues/import-osm")
    suspend fun importOsmVenue(@Body body: ImportOsmRequest): Venue

    @GET("venues/categories")
    suspend fun getVenueCategories(): List<VenueCategory>

    @POST("venues")
    suspend fun createVenue(@Body body: CreateVenueRequest): Venue

    // ── Mood checkins ─────────────────────────────────────────────────────────

    @GET("mood-checkins")
    suspend fun getMoodCheckins(
        @Query("user_id") userId: String,
        @Query("limit") limit: Int = 50,
        @Query("offset") offset: Int = 0,
    ): List<MoodCheckIn>

    @GET("mood-checkins/{id}")
    suspend fun getMoodCheckin(@Path("id") id: String): MoodCheckIn

    @POST("mood-checkins")
    suspend fun createMoodCheckin(@Body body: CreateMoodCheckinRequest): MoodCheckIn

    @PUT("mood-checkins/{id}")
    suspend fun updateMoodCheckin(
        @Path("id") id: String,
        @Body body: UpdateMoodCheckinRequest,
    ): MoodCheckIn

    @DELETE("mood-checkins/{id}")
    suspend fun deleteMoodCheckin(@Path("id") id: String)

    // ── Mood activities ───────────────────────────────────────────────────────

    @GET("mood-activities/groups")
    suspend fun getMoodActivityGroups(): List<MoodActivityGroup>

    // ── Sleep entries ─────────────────────────────────────────────────────────

    @GET("sleep-entries")
    suspend fun getSleepEntries(
        @Query("user_id") userId: String,
        @Query("limit") limit: Int = 50,
        @Query("offset") offset: Int = 0,
    ): List<SleepEntry>

    @GET("sleep-entries/{id}")
    suspend fun getSleepEntry(@Path("id") id: String): SleepEntry

    @POST("sleep-entries")
    suspend fun createSleepEntry(@Body body: CreateSleepEntryRequest): SleepEntry

    @PUT("sleep-entries/{id}")
    suspend fun updateSleepEntry(
        @Path("id") id: String,
        @Body body: UpdateSleepEntryRequest,
    ): SleepEntry

    @DELETE("sleep-entries/{id}")
    suspend fun deleteSleepEntry(@Path("id") id: String)

    // ── Search ────────────────────────────────────────────────────────────────

    @GET("search")
    suspend fun search(
        @Query("q") query: String,
        @Query("type") type: String = "all",
        @Query("limit") limit: Int = 20,
    ): SearchResults

    // ── Settings ──────────────────────────────────────────────────────────────

    @GET("settings")
    suspend fun getSettings(): UserSettings

    @PUT("settings")
    suspend fun updateSettings(@Body body: Map<String, String>): UserSettings
}
