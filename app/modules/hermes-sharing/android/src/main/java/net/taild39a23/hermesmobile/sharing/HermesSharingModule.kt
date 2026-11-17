package net.taild39a23.hermesmobile.sharing

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.WeakHashMap
import java.util.concurrent.atomic.AtomicBoolean

private const val MAX_SHARES = 20
private const val MAX_IMAGES = 10
private const val MAX_TEXT = 100_000
private const val MAX_IMAGE_BYTES = 25L * 1024 * 1024
private const val MAX_TOTAL_BYTES = 100L * 1024 * 1024
private const val PROVIDER_DEADLINE_MS = 15_000L
private const val EVENT = "onSharesChanged"
private const val MARKER = "net.taild39a23.hermesmobile.PRIVATE_SHARE_MARKER"
private val SAFE_SHARE_ERRORS = setOf(
  "Shared text is too long (limit 100,000 characters).",
  "A share can include up to 10 images.",
  "This share has no supported text or images.",
  "Only images shared through Android are supported.",
  "This image type is unsupported or does not match the share.",
  "Shared images exceed the total 100 MiB limit.",
  "A shared image exceeds the 25 MiB per-image or 100 MiB total limit.",
  "A shared image is empty.",
  "The shared image contents do not match its type."
)

/** The single process-wide lock serializes copies, manifests and discards across module instances. */
private object ShareLock {
  val lock = Any()
  val processNonce: String = UUID.randomUUID().toString()
  val intents = WeakHashMap<Intent, String>()
  val rejected = WeakHashMap<Intent, Boolean>()
  val providerWork = BoundedWork(2)
  var deferred: Intent? = null
}
private class ShareInboxFull : IllegalStateException("Share inbox is full. Open or discard a share, then try again.")
private data class PreparedImage(val name:String, val mime:String, val size:Long)

class HermesSharingModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HermesSharing")
    Events(EVENT)

    OnNewIntent { intent ->
      if (isShare(intent)) {
        // Copy while the activity's URI grants are alive; never read image bytes on the UI thread.
        appContext.backgroundCoroutineScope.launch(Dispatchers.IO) {
          var errorMessage: String? = null
          try {
            synchronized(ShareLock.lock) { ingest(intent) }
          } catch (_: ShareInboxFull) {
            val kept = synchronized(ShareLock.lock) {
              if (ShareLock.deferred == null || ShareLock.deferred === intent) { ShareLock.deferred = intent; true } else false
            }
            errorMessage = if (kept) "Share inbox is full. This share will wait while the app is open; open or discard another share." else
              "Could not save this share because the inbox is full. Make room, then share it again."
          } catch (_: Exception) {
            errorMessage = "Could not save the shared item. Please try sharing it again."
          }
          sendEvent(EVENT, mapOf("error" to errorMessage))
        }
      }
    }

    AsyncFunction("getPendingShares") Coroutine { ->
      val launchIntent = appContext.currentActivity?.intent
      withContext(Dispatchers.IO) {
        synchronized(ShareLock.lock) {
          val directory = inboxDirectory()
          cleanupOrphans(directory)
          val deferred = ShareLock.deferred
          if (deferred != null && manifestFiles(directory).size < MAX_SHARES) {
            ingest(deferred)
            ShareLock.deferred = null
          }
          if (launchIntent != null && isShare(launchIntent)) {
            try { ingest(launchIntent) } catch (_: ShareInboxFull) {
              if (ShareLock.deferred == null) {
                ShareLock.deferred = launchIntent
                sendEvent(EVENT, mapOf("error" to "Share inbox is full. This share will wait while the app is open; open or discard another share."))
              } else if (ShareLock.deferred !== launchIntent && !ShareLock.rejected.containsKey(launchIntent)) {
                ShareLock.rejected[launchIntent] = true
                sendEvent(EVENT, mapOf("error" to "Could not save this share because the inbox is full. Make room, then share it again."))
              }
            }
          }
          readShares()
        }
      }
    }

    AsyncFunction("discardShare") Coroutine { id: String ->
      withContext(Dispatchers.IO) {
        synchronized(ShareLock.lock) {
          require(SharePolicy.validId(id)) { "Invalid share identifier" }
          val directory = inboxDirectory()
          val manifest = owned(directory, "$id.json")
          if (manifest.exists() && !manifest.delete()) throw IllegalStateException("Could not remove the shared item")
          var cleanupFailed = false
          for (index in 0 until MAX_IMAGES) {
            val image = owned(directory, "$id-$index.bin")
            if (image.exists() && !image.delete()) cleanupFailed = true
          }
          if (cleanupFailed) throw IllegalStateException("Could not remove all shared image files")
        }
      }
      sendEvent(EVENT)
    }
  }

  private fun context(): Context = requireNotNull(appContext.reactContext) { "Application context unavailable" }
  private fun isShare(intent: Intent): Boolean = intent.action == Intent.ACTION_SEND || intent.action == Intent.ACTION_SEND_MULTIPLE

  private fun inboxDirectory(): File {
    // Keeps captures across process death but excludes private shares from automatic cloud backups.
    val directory = File(context().noBackupFilesDir, "hermes-share-inbox").canonicalFile
    if (!directory.exists() && !directory.mkdirs()) throw IllegalStateException("Could not open share inbox")
    if (!directory.isDirectory) throw IllegalStateException("Could not open share inbox")
    return directory
  }

  private fun owned(directory: File, name: String): File {
    val file = File(directory, name).canonicalFile
    require(file.parentFile == directory) { "Invalid share path" }
    return file
  }

  /** Holds the global lock. An invalid payload is recorded as a non-sensitive actionable error. */
  private fun ingest(intent: Intent) {
    val directory = inboxDirectory()
    if (ShareLock.intents.containsKey(intent)) return
    val marker = intent.getStringExtra(MARKER)
    if (marker != null && marker.startsWith("${ShareLock.processNonce}:")) {
      val id = marker.substringAfter(':')
      if (SharePolicy.validId(id)) { ShareLock.intents[intent] = id; return }
    }
    if (manifestFiles(directory).size >= MAX_SHARES) throw ShareInboxFull()

    val id = UUID.randomUUID().toString()
    val createdAt = System.currentTimeMillis()
    val copied = mutableListOf<File>()
    val staging = mutableListOf<File>()
    val manifest = JSONObject().put("id", id).put("createdAt", createdAt)
    var savedText = ""
    try {
      val rawText = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
        ?: intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT)?.toString() ?: ""
      require(rawText.length <= MAX_TEXT) { "Shared text is too long (limit 100,000 characters)." }
      savedText = rawText
      val images = readUris(intent)
      require(images.size <= MAX_IMAGES) { "A share can include up to 10 images." }
      require(rawText.isNotBlank() || images.isNotEmpty()) { "This share has no supported text or images." }
      for (index in images.indices) staging.add(owned(directory, "$id-$index.part"))
      val prepared = if (images.isEmpty()) emptyList() else ShareLock.providerWork.run(
        PROVIDER_DEADLINE_MS,
        task = { active -> prepareImages(images, intent.type, staging, active) },
        cleanup = { staging.forEach { it.delete() } }
      )
      val payload = JSONArray()
      for ((index, image) in prepared.withIndex()) {
        val target = owned(directory, "$id-$index.bin")
        if (!staging[index].renameTo(target)) throw IllegalStateException("Could not save shared image")
        copied.add(target)
        payload.put(JSONObject().put("uri", Uri.fromFile(target).toString()).put("name", image.name)
          .put("mime", image.mime).put("size", image.size))
      }
      manifest.put("text", rawText).put("images", payload)
    } catch (error: Exception) {
      copied.forEach { it.delete() }
      staging.forEach { it.delete() }
      val safeMessage = when (error) {
        is ShareWorkTimeout -> "Reading the shared images took too long. Please try sharing them again."
        is ShareWorkUnavailable -> "The image provider is busy. Please try sharing again shortly."
        else -> error.message?.takeIf { error is IllegalArgumentException && it in SAFE_SHARE_ERRORS }
          ?: "Could not read the shared item. Please try sharing it again."
      }
      manifest.put("text", savedText).put("images", JSONArray()).put("error", safeMessage)
    }
    // The manifest is the commit point. Incomplete copies never appear in the inbox.
    try {
      writeManifest(directory, id, manifest)
    } catch (error: Exception) {
      copied.forEach { it.delete() }
      staging.forEach { it.delete() }
      throw error
    }
    ShareLock.intents[intent] = id
    intent.putExtra(MARKER, "${ShareLock.processNonce}:$id")
  }

  /** This worker may write only unique staging files; it never publishes or renames a share. */
  private fun prepareImages(images:List<Uri>, declared:String?, staging:List<File>, active:AtomicBoolean):List<PreparedImage> {
    var totalBytes = 0L
    return images.mapIndexed { index, uri ->
      requireActive(active)
      require(SharePolicy.contentUri(uri.scheme)) { "Only images shared through Android are supported." }
      val mime = SharePolicy.mime(context().contentResolver.getType(uri), declared)
        ?: throw IllegalArgumentException("This image type is unsupported or does not match the share.")
      requireActive(active)
      val bytes = copyBounded(uri, staging[index], mime, MAX_TOTAL_BYTES - totalBytes, active)
      requireActive(active)
      totalBytes += bytes
      val name = safeName(uri, mime)
      requireActive(active)
      PreparedImage(name, mime, bytes)
    }
  }

  private fun requireActive(active:AtomicBoolean) {
    if (!active.get()) throw IllegalStateException("Share reading was cancelled")
  }

  @Suppress("DEPRECATION")
  private fun readUris(intent: Intent): List<Uri> {
    val uris = linkedSetOf<Uri>()
    fun add(uri: Uri) {
      uris.add(uri)
      require(uris.size <= MAX_IMAGES) { "A share can include up to 10 images." }
    }
    if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
      intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.forEach { add(it) }
    } else {
      intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)?.let { add(it) }
    }
    // Some apps provide ClipData instead of EXTRA_STREAM. Do not duplicate when both are present.
    if (intent.type?.startsWith("image/", ignoreCase = true) == true) {
      intent.clipData?.let { clip ->
        for (index in 0 until clip.itemCount) clip.getItemAt(index).uri?.let { add(it) }
      }
    }
    return uris.toList()
  }

  private fun copyBounded(uri: Uri, target: File, mime: String, remainingTotal: Long, active:AtomicBoolean): Long {
    require(remainingTotal > 0) { "Shared images exceed the total 100 MiB limit." }
    val limit = minOf(MAX_IMAGE_BYTES, remainingTotal)
    var total = 0L
    requireActive(active)
    val input = context().contentResolver.openInputStream(uri) ?: throw IllegalStateException("Image unavailable")
    input.use { stream ->
      requireActive(active)
      FileOutputStream(target).use { output ->
        val buffer = ByteArray(32 * 1024)
        val header = java.io.ByteArrayOutputStream(64)
        var emptyReads = 0
        while (true) {
          requireActive(active)
          val count = stream.read(buffer)
          requireActive(active)
          if (count < 0) break
          if (count == 0) {
            if (++emptyReads > 3) throw IllegalStateException("Image stream stalled")
            continue
          }
          emptyReads = 0
          total += count
          require(total <= limit) { "A shared image exceeds the 25 MiB per-image or 100 MiB total limit." }
          if (header.size() < 64) header.write(buffer, 0, minOf(count, 64 - header.size()))
          output.write(buffer, 0, count)
        }
        require(total > 0) { "A shared image is empty." }
        require(SharePolicy.imageHeaderMatches(mime, header.toByteArray())) { "The shared image contents do not match its type." }
        requireActive(active)
        output.fd.sync()
        requireActive(active)
      }
    }
    return total
  }

  private fun safeName(uri: Uri, mime: String): String {
    val fallback = when (mime) {
      "image/png" -> "image.png"
      "image/gif" -> "image.gif"
      "image/webp" -> "image.webp"
      "image/heic" -> "image.heic"
      "image/heif" -> "image.heif"
      else -> "image.jpg"
    }
    return try {
      context().contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (!cursor.moveToFirst()) return@use fallback
        val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (index < 0) return@use fallback
        val name = cursor.getString(index)?.replace(Regex("[\\\\/\\p{Cntrl}]"), "_")?.take(120)?.trim()
        name?.takeIf { it.isNotBlank() } ?: fallback
      } ?: fallback
    } catch (_: Exception) { fallback }
  }

  private fun writeManifest(directory: File, id: String, manifest: JSONObject) {
    val temporary = owned(directory, "$id.json.tmp")
    val target = owned(directory, "$id.json")
    try {
      FileOutputStream(temporary).use { output ->
        output.write(manifest.toString().toByteArray(Charsets.UTF_8))
        output.fd.sync()
      }
      if (!temporary.renameTo(target)) throw IllegalStateException("Could not save shared item")
    } finally { temporary.delete() }
  }

  private fun manifestFiles(directory: File): List<File> = (directory.listFiles() ?: emptyArray())
    .filter { it.isFile && it.name.endsWith(".json") && SharePolicy.validId(it.name.removeSuffix(".json")) }
    .sortedBy { it.lastModified() }

  /** Remove only abandoned temporary files after a day; in-flight copies hold the global lock. */
  private fun cleanupOrphans(directory: File) {
    val cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1000L
    val live = manifestFiles(directory).map { it.name.removeSuffix(".json") }.toSet()
    for (file in directory.listFiles() ?: emptyArray()) {
      if (!file.isFile || file.lastModified() >= cutoff) continue
      val match = Regex("^([0-9a-f-]{36})(?:-[0-9]\\.(?:bin|part)|\\.json\\.tmp)$").matchEntire(file.name) ?: continue
      val id = match.groupValues[1]
      if (SharePolicy.validId(id) && id !in live) file.delete()
    }
  }

  private fun readShares(): List<Map<String, Any>> {
    val directory = inboxDirectory()
    return manifestFiles(directory).map { file ->
      val id = file.name.removeSuffix(".json")
      try {
        val json = JSONObject(file.readText(Charsets.UTF_8))
        require(json.getString("id") == id)
        val items = json.getJSONArray("images")
        require(items.length() <= MAX_IMAGES)
        val images = (0 until items.length()).map { index ->
          val image = items.getJSONObject(index)
          val expected = owned(directory, "$id-$index.bin")
          require(image.getString("uri") == Uri.fromFile(expected).toString() && expected.isFile)
          mapOf("uri" to image.getString("uri"), "name" to image.getString("name"),
            "mime" to image.getString("mime"), "size" to image.getLong("size"))
        }
        val result = mutableMapOf<String, Any>("id" to id, "text" to json.getString("text"), "images" to images,
          "createdAt" to json.getLong("createdAt"))
        if (json.has("error")) result["error"] = json.getString("error")
        result
      } catch (_: Exception) {
        mapOf("id" to id, "text" to "", "images" to emptyList<Any>(), "createdAt" to file.lastModified(),
          "error" to "Could not read this shared item. Please share it again.")
      }
    }
  }
}
