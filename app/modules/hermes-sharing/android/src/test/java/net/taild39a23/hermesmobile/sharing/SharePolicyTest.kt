package net.taild39a23.hermesmobile.sharing

import org.junit.Assert.*
import org.junit.Test

class SharePolicyTest {
  @Test fun rejectsPathsAndNonCanonicalIds() {
    assertTrue(SharePolicy.validId("01234567-89ab-4def-8123-456789abcdef"))
    assertFalse(SharePolicy.validId("../../secret"))
    assertFalse(SharePolicy.validId("1-1-1-1-1"))
    assertTrue(SharePolicy.contentUri("content"))
    assertFalse(SharePolicy.contentUri("file"))
    assertFalse(SharePolicy.contentUri("https"))
  }

  @Test fun verifiesResolverAndAdvertisedMimeWithoutAllowingOtherFiles() {
    assertEquals("image/png", SharePolicy.mime("image/png", "image/*"))
    assertEquals("image/heic", SharePolicy.mime("IMAGE/HEIC", "image/heic"))
    assertNull(SharePolicy.mime("application/pdf", "image/*"))
    assertNull(SharePolicy.mime("image/png", "image/jpeg"))
    assertNull(SharePolicy.mime(null, "image/*"))
    assertNull(SharePolicy.mime("image/png", "text/plain"))
  }

  @Test fun rejectsWrongBinaryTypesAndAcceptsSupportedImageSignatures() {
    fun ascii(value: String) = value.toByteArray(Charsets.US_ASCII)
    val png = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    assertTrue(SharePolicy.imageHeaderMatches("image/png", png))
    assertTrue(SharePolicy.imageHeaderMatches("image/jpeg", byteArrayOf(0xff.toByte(),0xd8.toByte(),0xff.toByte())))
    assertTrue(SharePolicy.imageHeaderMatches("image/gif", ascii("GIF89a")))
    assertTrue(SharePolicy.imageHeaderMatches("image/webp", ascii("RIFF0000WEBP")))
    assertTrue(SharePolicy.imageHeaderMatches("image/heic", ascii("0000ftypheic0000")))
    assertTrue(SharePolicy.imageHeaderMatches("image/heif", ascii("0000ftypmif10000")))
    assertFalse(SharePolicy.imageHeaderMatches("image/png", ascii("%PDF-1.7")))
    assertFalse(SharePolicy.imageHeaderMatches("image/jpeg", png))
    assertFalse(SharePolicy.imageHeaderMatches("image/heic", ascii("0000ftypavif0000")))
    assertFalse(SharePolicy.imageHeaderMatches("image/png", byteArrayOf()))
  }
}
