package com.wherewewere.android.ui.timeline

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.wherewewere.android.data.model.TimelineItem
import com.wherewewere.android.data.repository.TimelineRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import javax.inject.Inject

@OptIn(FlowPreview::class)
@HiltViewModel
class TimelineViewModel @Inject constructor(
    private val repo: TimelineRepository,
) : ViewModel() {

    private val _items = MutableStateFlow<List<TimelineItem>>(emptyList())
    val items: StateFlow<List<TimelineItem>> = _items.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _isLoadingMore = MutableStateFlow(false)
    val isLoadingMore: StateFlow<Boolean> = _isLoadingMore.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()

    private val _filterType = MutableStateFlow<String?>(null) // null = all
    val filterType: StateFlow<String?> = _filterType.asStateFlow()

    private var currentOffset = 0
    private val pageSize = 50
    private var hasMore = true

    /** Groups items by local date key (timezone-aware). */
    val groupedItems: StateFlow<Map<String, List<TimelineItem>>> =
        combine(items, filterType) { allItems, filter ->
            val filtered = if (filter == null) allItems else allItems.filter { it.type == filter }
            filtered
                .groupBy { it.localDateKey() }
                .entries
                .sortedByDescending { it.key }
                .associate { it.key to it.value }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyMap())

    init {
        // Debounce search query changes
        viewModelScope.launch {
            _searchQuery
                .debounce(400)
                .drop(1) // skip initial empty string
                .collect { load(reset = true) }
        }
        load()
    }

    fun load(reset: Boolean = false) {
        if (!reset && !hasMore) return
        if (reset) {
            currentOffset = 0
            hasMore = true
            _items.value = emptyList()
        }
        if (_isLoading.value && currentOffset == 0) return

        viewModelScope.launch {
            if (currentOffset == 0) _isLoading.value = true
            else _isLoadingMore.value = true

            repo.getPage(
                offset = currentOffset,
                limit = pageSize,
                query = _searchQuery.value.ifBlank { null },
            ).onSuccess { page ->
                _items.value = _items.value + page
                currentOffset += page.size
                hasMore = page.size == pageSize
                _error.value = null
            }.onFailure { err ->
                _error.value = err.message ?: "Failed to load timeline"
            }

            _isLoading.value = false
            _isLoadingMore.value = false
        }
    }

    fun loadMore() {
        if (!_isLoadingMore.value && hasMore && !_isLoading.value) {
            load(reset = false)
        }
    }

    fun setSearchQuery(q: String) {
        _searchQuery.value = q
    }

    fun setFilterType(type: String?) {
        _filterType.value = type
    }

    fun refresh() = load(reset = true)

    fun clearError() {
        _error.value = null
    }
}

/** Map a timeline item to a YYYY-MM-DD string using its entry timezone. */
fun TimelineItem.localDateKey(): String {
    val timestamp = when (type) {
        "sleep" -> sleepEndedAt ?: checkedInAt
        else -> checkedInAt
    }
    val tz = when (type) {
        "location" -> venueTimezone
        "mood" -> moodTimezone
        "sleep" -> sleepTimezone
        else -> null
    }
    return try {
        val instant = Instant.parse(timestamp)
        val zone = if (!tz.isNullOrBlank()) ZoneId.of(tz) else ZoneId.systemDefault()
        instant.atZone(zone).toLocalDate().toString()
    } catch (_: Exception) {
        timestamp.substring(0, minOf(10, timestamp.length))
    }
}
