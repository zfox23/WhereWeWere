package com.wherewewere.android.data.db

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface PendingOperationDao {

    @Query("SELECT * FROM pending_operations ORDER BY created_at ASC")
    suspend fun getAll(): List<PendingOperation>

    @Query("SELECT COUNT(*) FROM pending_operations")
    fun countFlow(): Flow<Int>

    @Insert
    suspend fun insert(op: PendingOperation): Long

    @Delete
    suspend fun delete(op: PendingOperation)

    @Query("UPDATE pending_operations SET retry_count = retry_count + 1 WHERE id = :id")
    suspend fun incrementRetry(id: Long)
}
