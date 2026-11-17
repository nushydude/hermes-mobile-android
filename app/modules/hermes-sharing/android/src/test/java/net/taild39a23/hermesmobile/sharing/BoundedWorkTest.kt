package net.taild39a23.hermesmobile.sharing

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.InputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class BoundedWorkTest {
  @Test fun stalledInterruptIgnoringProviderReleasesLockAndLateFileIsRemoved() {
    val worker = BoundedWork(2)
    val caller = Executors.newSingleThreadExecutor()
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    val lateCleaned = CountDownLatch(1)
    val streamClosed = CountDownLatch(1)
    val committed = AtomicBoolean(false)
    val lock = Any()
    val directory = createTempDir(prefix = "share-test-")
    val partial = File(directory, "image.part")
    try {
      val first = caller.submit {
        synchronized(lock) {
          try {
            worker.run(150, task = {
              val stream = object : InputStream() {
                override fun read(): Int {
                  entered.countDown()
                  // Simulate an actual blocking read that ignores thread interruption.
                  while (release.count > 0) try { release.await() } catch (_: InterruptedException) {}
                  return 42
                }
                override fun close() { streamClosed.countDown() }
              }
              stream.use { partial.writeBytes(byteArrayOf(it.read().toByte())) }
              "prepared"
            }, cleanup = {
              if (partial.exists()) { partial.delete(); lateCleaned.countDown() }
            })
            committed.set(true)
          } catch (_: ShareWorkTimeout) {}
        }
      }
      assertTrue(entered.await(2, TimeUnit.SECONDS))
      first.get(3, TimeUnit.SECONDS)
      assertFalse(committed.get())
      // A subsequent inbox operation acquires the same lock and uses the remaining worker.
      val value = synchronized(lock) { worker.run(1000, task = { "next share" }, cleanup = {}) }
      assertEquals("next share", value)
      release.countDown()
      assertTrue(streamClosed.await(3, TimeUnit.SECONDS))
      assertTrue(lateCleaned.await(3, TimeUnit.SECONDS))
      assertFalse(partial.exists())
      assertFalse(committed.get())
    } finally {
      release.countDown()
      caller.shutdownNow()
      directory.deleteRecursively()
    }
  }

  @Test fun saturatedWorkersRejectPromptlyInsteadOfQueuingUnboundedWork() {
    val worker = BoundedWork(1)
    val caller = Executors.newSingleThreadExecutor()
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    try {
      val first = caller.submit {
        try {
          worker.run(100, task = {
            entered.countDown()
            while (release.count > 0) try { release.await() } catch (_: InterruptedException) {}
          }, cleanup = {})
          fail("Expected timeout")
        } catch (_: ShareWorkTimeout) {}
      }
      assertTrue(entered.await(2, TimeUnit.SECONDS))
      first.get(3, TimeUnit.SECONDS)
      val start = System.nanoTime()
      try { worker.run(1000, task = { "must not run" }, cleanup = {}); fail("Expected saturation") }
      catch (_: ShareWorkUnavailable) {}
      assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) < 500)
    } finally {
      release.countDown()
      caller.shutdownNow()
    }
  }
}
