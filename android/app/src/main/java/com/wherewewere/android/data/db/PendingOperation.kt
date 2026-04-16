package com.wherewewere.android.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/** A mutation that was queued while the device was offline and has not yet been synced. */
@Entity(tableName = "pending_operations")
data class PendingOperation(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "operation_type") val operationType: String,
    /** JSON-encoded payload specific to the operation type. */
    val payload: String,
    @ColumnInfo(name = "created_at") val createdAt: Long = System.currentTimeMillis(),
    @ColumnInfo(name = "retry_count") val retryCount: Int = 0,
)

enum class OperationType {
    CREATE_CHECKIN,
    UPDATE_CHECKIN,
    DELETE_CHECKIN,
    CREATE_MOOD_CHECKIN,
    UPDATE_MOOD_CHECKIN,
    DELETE_MOOD_CHECKIN,
    CREATE_SLEEP_ENTRY,
    UPDATE_SLEEP_ENTRY,
    DELETE_SLEEP_ENTRY,
}
