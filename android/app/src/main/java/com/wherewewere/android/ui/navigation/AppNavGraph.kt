package com.wherewewere.android.ui.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.navArgument
import com.wherewewere.android.ui.checkin.CheckInScreen
import com.wherewewere.android.ui.checkindetail.CheckInDetailScreen
import com.wherewewere.android.ui.mood.MoodCheckInScreen
import com.wherewewere.android.ui.settings.SettingsScreen
import com.wherewewere.android.ui.sleep.SleepEntryScreen
import com.wherewewere.android.ui.timeline.TimelineScreen
import com.wherewewere.android.ui.venuedetail.VenueDetailScreen

sealed class Screen(val route: String) {
    object Timeline : Screen("timeline")
    object CheckIn : Screen("checkin?edit={edit}&venueId={venueId}&venueName={venueName}") {
        fun createRoute(
            edit: String? = null,
            venueId: String? = null,
            venueName: String? = null,
        ): String {
            val params = buildList {
                if (edit != null) add("edit=$edit")
                if (venueId != null) add("venueId=$venueId")
                if (venueName != null) add("venueName=${venueName.encodeUrl()}")
            }
            return if (params.isEmpty()) "checkin" else "checkin?${params.joinToString("&")}"
        }
    }
    object CheckInDetail : Screen("checkin_detail/{id}") {
        fun route(id: String) = "checkin_detail/$id"
    }
    object VenueDetail : Screen("venue/{id}") {
        fun route(id: String) = "venue/$id"
    }
    object MoodCheckIn : Screen("mood?edit={edit}") {
        fun createRoute(edit: String? = null) =
            if (edit != null) "mood?edit=$edit" else "mood"
    }
    object SleepEntry : Screen("sleep?edit={edit}") {
        fun createRoute(edit: String? = null) =
            if (edit != null) "sleep?edit=$edit" else "sleep"
    }
    object Settings : Screen("settings")
}

private fun String.encodeUrl() = java.net.URLEncoder.encode(this, "UTF-8")

private enum class TopLevelRoute(val screen: Screen, val icon: ImageVector, val label: String) {
    TIMELINE(Screen.Timeline, Icons.Default.Home, "Timeline"),
    SETTINGS(Screen.Settings, Icons.Default.Settings, "Settings"),
}

@Composable
fun AppNavGraph(navController: NavHostController) {
    val currentEntry by navController.currentBackStackEntryAsState()
    val currentRoute = currentEntry?.destination?.route

    val topLevelRoutes = listOf(Screen.Timeline.route, Screen.Settings.route)
    val showBottomBar = topLevelRoutes.any { currentRoute?.startsWith(it) == true }

    Scaffold(
        contentWindowInsets = WindowInsets(0),
        bottomBar = {
            if (showBottomBar) {
                NavigationBar {
                    TopLevelRoute.entries.forEach { dest ->
                        NavigationBarItem(
                            selected = currentRoute == dest.screen.route,
                            onClick = {
                                if (currentRoute != dest.screen.route) {
                                    navController.navigate(dest.screen.route) {
                                        popUpTo(Screen.Timeline.route) { saveState = true }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                }
                            },
                            icon = { Icon(dest.icon, contentDescription = dest.label) },
                            label = { Text(dest.label) },
                        )
                    }
                }
            }
        },
    ) { innerPadding ->
        Box(Modifier.padding(innerPadding)) {
            NavHost(
                navController = navController,
                startDestination = Screen.Timeline.route,
            ) {
                composable(Screen.Timeline.route) {
                    TimelineScreen(
                        onNavigateToCheckinDetail = { id ->
                            navController.navigate(Screen.CheckInDetail.route(id))
                        },
                        onNavigateToMoodDetail = { id ->
                            navController.navigate(Screen.MoodCheckIn.createRoute(edit = id))
                        },
                        onNavigateToSleepDetail = { id ->
                            navController.navigate(Screen.SleepEntry.createRoute(edit = id))
                        },
                        onAddCheckin = { navController.navigate(Screen.CheckIn.createRoute()) },
                        onAddMood = { navController.navigate(Screen.MoodCheckIn.createRoute()) },
                        onAddSleep = { navController.navigate(Screen.SleepEntry.createRoute()) },
                    )
                }

                composable(
                    route = Screen.CheckIn.route,
                    arguments = listOf(
                        navArgument("edit") { type = NavType.StringType; nullable = true; defaultValue = null },
                        navArgument("venueId") { type = NavType.StringType; nullable = true; defaultValue = null },
                        navArgument("venueName") { type = NavType.StringType; nullable = true; defaultValue = null },
                    ),
                ) { back ->
                    CheckInScreen(
                        editId = back.arguments?.getString("edit"),
                        prefillVenueId = back.arguments?.getString("venueId"),
                        prefillVenueName = back.arguments?.getString("venueName"),
                        onBack = { navController.popBackStack() },
                    )
                }

                composable(
                    route = Screen.CheckInDetail.route,
                    arguments = listOf(navArgument("id") { type = NavType.StringType }),
                ) { back ->
                    CheckInDetailScreen(
                        id = back.arguments!!.getString("id")!!,
                        onBack = { navController.popBackStack() },
                        onNavigateToVenue = { id -> navController.navigate(Screen.VenueDetail.route(id)) },
                        onEdit = { id -> navController.navigate(Screen.CheckIn.createRoute(edit = id)) },
                    )
                }

                composable(
                    route = Screen.VenueDetail.route,
                    arguments = listOf(navArgument("id") { type = NavType.StringType }),
                ) { back ->
                    VenueDetailScreen(
                        id = back.arguments!!.getString("id")!!,
                        onBack = { navController.popBackStack() },
                        onCheckinHere = { venueId, venueName ->
                            navController.navigate(Screen.CheckIn.createRoute(venueId = venueId, venueName = venueName))
                        },
                        onNavigateToCheckin = { id ->
                            navController.navigate(Screen.CheckInDetail.route(id))
                        },
                    )
                }

                composable(
                    route = Screen.MoodCheckIn.route,
                    arguments = listOf(
                        navArgument("edit") { type = NavType.StringType; nullable = true; defaultValue = null },
                    ),
                ) { back ->
                    MoodCheckInScreen(
                        editId = back.arguments?.getString("edit"),
                        onBack = { navController.popBackStack() },
                    )
                }

                composable(
                    route = Screen.SleepEntry.route,
                    arguments = listOf(
                        navArgument("edit") { type = NavType.StringType; nullable = true; defaultValue = null },
                    ),
                ) { back ->
                    SleepEntryScreen(
                        editId = back.arguments?.getString("edit"),
                        onBack = { navController.popBackStack() },
                    )
                }

                composable(Screen.Settings.route) {
                    SettingsScreen()
                }
            }
        }
    }
}
