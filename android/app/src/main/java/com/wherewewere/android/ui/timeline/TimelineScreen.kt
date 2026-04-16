package com.wherewewere.android.ui.timeline

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Mood
import androidx.compose.material.icons.filled.Bedtime
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.wherewewere.android.ui.components.TimelineItemCard
import java.time.LocalDate
import java.time.format.DateTimeFormatter

private val dateFormatter = DateTimeFormatter.ofPattern("EEEE, MMMM d, yyyy")

private fun formatDateHeader(dateKey: String): String {
    return try {
        LocalDate.parse(dateKey).format(dateFormatter)
    } catch (_: Exception) {
        dateKey
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun TimelineScreen(
    viewModel: TimelineViewModel = hiltViewModel(),
    onNavigateToCheckinDetail: (String) -> Unit,
    onNavigateToMoodDetail: (String) -> Unit,
    onNavigateToSleepDetail: (String) -> Unit,
    onAddCheckin: () -> Unit,
    onAddMood: () -> Unit,
    onAddSleep: () -> Unit,
) {
    val grouped by viewModel.groupedItems.collectAsStateWithLifecycle()
    val isLoading by viewModel.isLoading.collectAsStateWithLifecycle()
    val isLoadingMore by viewModel.isLoadingMore.collectAsStateWithLifecycle()
    val searchQuery by viewModel.searchQuery.collectAsStateWithLifecycle()
    val filterType by viewModel.filterType.collectAsStateWithLifecycle()
    val error by viewModel.error.collectAsStateWithLifecycle()

    val listState = rememberLazyListState()
    val snackbarHostState = remember { SnackbarHostState() }

    // Load more when near end of list
    val shouldLoadMore by remember {
        derivedStateOf {
            val lastVisible = listState.layoutInfo.visibleItemsInfo.lastOrNull()
            val totalItems = listState.layoutInfo.totalItemsCount
            lastVisible != null && lastVisible.index >= totalItems - 5
        }
    }
    LaunchedEffect(shouldLoadMore) {
        if (shouldLoadMore) viewModel.loadMore()
    }

    LaunchedEffect(error) {
        if (error != null) {
            snackbarHostState.showSnackbar(error ?: "Unknown error")
            viewModel.clearError()
        }
    }

    var showAddMenu by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            Column {
                TopAppBar(title = { Text("Journal") })
                SearchBar(
                    inputField = {
                        SearchBarDefaults.InputField(
                            query = searchQuery,
                            onQueryChange = viewModel::setSearchQuery,
                            onSearch = {},
                            expanded = false,
                            onExpandedChange = {},
                            placeholder = { Text("Search journal...") },
                        )
                    },
                    expanded = false,
                    onExpandedChange = {},
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 4.dp),
                ) {}
                // Filter chips
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    FilterChip(
                        selected = filterType == null,
                        onClick = { viewModel.setFilterType(null) },
                        label = { Text("All") },
                    )
                    FilterChip(
                        selected = filterType == "location",
                        onClick = { viewModel.setFilterType(if (filterType == "location") null else "location") },
                        label = { Text("Places") },
                        leadingIcon = {
                            Icon(Icons.Default.LocationOn, null, Modifier.size(16.dp))
                        },
                    )
                    FilterChip(
                        selected = filterType == "mood",
                        onClick = { viewModel.setFilterType(if (filterType == "mood") null else "mood") },
                        label = { Text("Mood") },
                        leadingIcon = {
                            Icon(Icons.Default.Mood, null, Modifier.size(16.dp))
                        },
                    )
                    FilterChip(
                        selected = filterType == "sleep",
                        onClick = { viewModel.setFilterType(if (filterType == "sleep") null else "sleep") },
                        label = { Text("Sleep") },
                        leadingIcon = {
                            Icon(Icons.Default.Bedtime, null, Modifier.size(16.dp))
                        },
                    )
                }
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        floatingActionButton = {
            Box {
                FloatingActionButton(onClick = { showAddMenu = true }) {
                    Icon(Icons.Default.Add, contentDescription = "Add entry")
                }
                DropdownMenu(
                    expanded = showAddMenu,
                    onDismissRequest = { showAddMenu = false },
                ) {
                    DropdownMenuItem(
                        text = { Text("Check In") },
                        leadingIcon = { Icon(Icons.Default.LocationOn, null) },
                        onClick = { showAddMenu = false; onAddCheckin() },
                    )
                    DropdownMenuItem(
                        text = { Text("Mood") },
                        leadingIcon = { Icon(Icons.Default.Mood, null) },
                        onClick = { showAddMenu = false; onAddMood() },
                    )
                    DropdownMenuItem(
                        text = { Text("Sleep") },
                        leadingIcon = { Icon(Icons.Default.Bedtime, null) },
                        onClick = { showAddMenu = false; onAddSleep() },
                    )
                }
            }
        },
    ) { innerPadding ->
        PullToRefreshBox(
            isRefreshing = isLoading,
            onRefresh = viewModel::refresh,
            modifier = Modifier.padding(innerPadding),
        ) {
            if (isLoading && grouped.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else if (!isLoading && grouped.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            "No entries yet",
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "Tap + to add your first check-in, mood, or sleep entry.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            } else {
                LazyColumn(
                    state = listState,
                    contentPadding = PaddingValues(bottom = 80.dp),
                ) {
                    grouped.forEach { (dateKey, dayItems) ->
                        stickyHeader(key = "header_$dateKey") {
                            Surface(
                                color = MaterialTheme.colorScheme.background,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text(
                                    text = formatDateHeader(dateKey),
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(
                                        horizontal = 16.dp,
                                        vertical = 8.dp,
                                    ),
                                )
                            }
                        }
                        items(dayItems, key = { it.id }) { item ->
                            TimelineItemCard(
                                item = item,
                                onClick = {
                                    when (item.type) {
                                        "location" -> onNavigateToCheckinDetail(item.id)
                                        "mood" -> onNavigateToMoodDetail(item.id)
                                        "sleep" -> onNavigateToSleepDetail(item.id)
                                    }
                                },
                            )
                        }
                    }
                    if (isLoadingMore) {
                        item {
                            Box(
                                Modifier.fillMaxWidth().padding(16.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                CircularProgressIndicator(modifier = Modifier.size(24.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}
