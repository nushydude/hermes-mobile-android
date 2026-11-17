package net.taild39a23.hermesmobile.sharing

import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean

internal class ShareWorkTimeout : Exception()
internal class ShareWorkUnavailable : Exception()

/**
 * Bounds both elapsed wait and outstanding provider calls, even if a provider ignores interrupts.
 * Work may only write uniquely-owned staging files. The caller alone commits successful results.
 */
internal class BoundedWork(parallelism: Int = 2) {
  private val executor = ThreadPoolExecutor(
    parallelism, parallelism, 0L, TimeUnit.MILLISECONDS, SynchronousQueue(),
    { runnable -> Thread(runnable, "HermesShareProvider").apply { isDaemon = true } },
    ThreadPoolExecutor.AbortPolicy()
  )

  fun <T> run(timeoutMillis: Long, task: (AtomicBoolean) -> T, cleanup: () -> Unit): T {
    require(timeoutMillis > 0)
    val active = AtomicBoolean(true)
    val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMillis)
    val future = try {
      executor.submit(Callable {
        try { task(active) } finally { if (!active.get()) safely(cleanup) }
      })
    } catch (_: RejectedExecutionException) {
      active.set(false)
      safely(cleanup)
      throw ShareWorkUnavailable()
    }

    try {
      val remaining = deadline - System.nanoTime()
      if (remaining <= 0) throw TimeoutException()
      return future.get(remaining, TimeUnit.NANOSECONDS)
    } catch (_: TimeoutException) {
      active.set(false)
      future.cancel(true)
      safely(cleanup)
      throw ShareWorkTimeout()
    } catch (error: InterruptedException) {
      active.set(false)
      future.cancel(true)
      safely(cleanup)
      Thread.currentThread().interrupt()
      throw error
    } catch (error: ExecutionException) {
      active.set(false)
      safely(cleanup)
      throw (error.cause ?: error)
    }
  }

  private fun safely(cleanup: () -> Unit) { try { cleanup() } catch (_: Exception) {} }
}
