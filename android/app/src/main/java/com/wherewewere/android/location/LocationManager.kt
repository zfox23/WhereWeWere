package com.wherewewere.android.location

import android.content.Context
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

data class LatLng(val latitude: Double, val longitude: Double)

@Singleton
class LocationManager @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val fusedClient = LocationServices.getFusedLocationProviderClient(context)

    /**
     * Returns the last known location quickly (may be stale).
     * Returns null if unavailable or permission denied.
     */
    suspend fun getLastLocation(): LatLng? = try {
        fusedClient.lastLocation.await()?.let { LatLng(it.latitude, it.longitude) }
    } catch (_: SecurityException) {
        null
    } catch (_: Exception) {
        null
    }

    /**
     * Requests the current location with high accuracy.
     * Returns null if unavailable or permission denied.
     */
    suspend fun getCurrentLocation(): LatLng? {
        val cts = CancellationTokenSource()
        return try {
            val request = CurrentLocationRequest.Builder()
                .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                .setMaxUpdateAgeMillis(30_000)
                .build()
            fusedClient.getCurrentLocation(request, cts.token).await()
                ?.let { LatLng(it.latitude, it.longitude) }
        } catch (_: SecurityException) {
            null
        } catch (_: Exception) {
            null
        } finally {
            cts.cancel()
        }
    }
}
