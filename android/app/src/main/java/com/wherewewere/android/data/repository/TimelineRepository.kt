package com.wherewewere.android.data.repository

import com.wherewewere.android.data.api.WhereWeWereService
import com.wherewewere.android.data.db.CacheDao
import com.wherewewere.android.data.db.CachedTimelineItem
import com.wherewewere.android.data.model.TimelineItem
import com.wherewewere.android.data.sync.ConnectivityMonitor
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TimelineRepository @Inject constructor(
    private val service: WhereWeWereService,
    private val connectivity: ConnectivityMonitor,
    private val cacheDao: CacheDao,
    private val json: Json,
) {
    companion object {
        const val USER_ID = "00000000-0000-0000-0000-000000000001"
    }

    suspend fun getPage(
        offset: Int,
        limit: Int = 50,
        query: String? = null,
        from: String? = null,
        to: String? = null,
    ): Result<List<TimelineItem>> {
        if (!connectivity.isOnline.value) {
            return offlinePage(offset, query)
        }
        return runCatching {
            val page = service.getTimeline(
                userId = USER_ID,
                limit = limit,
                offset = offset,
                query = query,
                from = from,
                to = to,
            )
            // Update cache with each fetched page (incremental warm-up while browsing online)
            cacheDao.upsertTimeline(page.map { item ->
                CachedTimelineItem(
                    id = item.id,
                    json = json.encodeToString(TimelineItem.serializer(), item),
                    checkedInAt = item.checkedInAt,
                )
            })
            page
        }
    }

    /**
     * Returns all cached items on the first offline page request (offset == 0), filtered by
     * [query] if provided. Subsequent pages return empty so the VM stops paginating.
     */
    private suspend fun offlinePage(offset: Int, query: String?): Result<List<TimelineItem>> = runCatching {
        if (offset > 0) return@runCatching emptyList()
        val cached = cacheDao.getAllTimeline()
        val items = cached.map { json.decodeFromString(TimelineItem.serializer(), it.json) }
        if (query.isNullOrBlank()) items
        else items.filter { it.matchesQuery(query) }
    }

    private fun TimelineItem.matchesQuery(q: String): Boolean {
        val lower = q.lowercase()
        return venueName?.lowercase()?.contains(lower) == true
            || notes?.lowercase()?.contains(lower) == true
    }
}
