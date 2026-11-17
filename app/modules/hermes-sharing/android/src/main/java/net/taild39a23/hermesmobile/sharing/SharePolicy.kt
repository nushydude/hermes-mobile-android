package net.taild39a23.hermesmobile.sharing

import java.util.Locale
import java.util.UUID

/** Pure input checks used before accepting external Android content. */
internal object SharePolicy {
  val allowedMimes = setOf("image/png", "image/jpeg", "image/gif", "image/webp", "image/heic", "image/heif")
  private val heifBrands = setOf("heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1")

  fun validId(id: String): Boolean = try { UUID.fromString(id).toString() == id } catch (_: Exception) { false }
  fun contentUri(scheme: String?): Boolean = scheme == "content"

  fun mime(resolved: String?, declared: String?): String? {
    val actual = resolved?.lowercase(Locale.ROOT) ?: return null
    val requested = declared?.lowercase(Locale.ROOT) ?: return null
    if (actual !in allowedMimes || (requested != "image/*" && requested != actual)) return null
    return actual
  }

  fun imageHeaderMatches(mime: String, header: ByteArray): Boolean {
    fun ascii(start: Int, end: Int): String = if (header.size >= end) header.copyOfRange(start, end).toString(Charsets.US_ASCII) else ""
    return when (mime) {
      "image/png" -> header.size >= 8 && header.copyOfRange(0, 8).contentEquals(byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
      "image/jpeg" -> header.size >= 3 && header[0] == 0xff.toByte() && header[1] == 0xd8.toByte() && header[2] == 0xff.toByte()
      "image/gif" -> ascii(0, 6) in setOf("GIF87a", "GIF89a")
      "image/webp" -> ascii(0, 4) == "RIFF" && ascii(8, 12) == "WEBP"
      "image/heic", "image/heif" -> ascii(4, 8) == "ftyp" &&
        (ascii(8, 12) in heifBrands || (16 until header.size - 3 step 4).any { ascii(it, it + 4) in heifBrands })
      else -> false
    }
  }
}
