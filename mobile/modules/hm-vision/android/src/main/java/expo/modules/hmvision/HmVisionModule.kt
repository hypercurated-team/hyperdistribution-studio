package expo.modules.hmvision

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Size
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.label.ImageLabeling
import com.google.mlkit.vision.label.defaults.ImageLabelerOptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * On-device photo understanding for HyperMixer: scene labels (ML Kit), how
 * many faces, and a quality score, from a small preview of each photo or
 * video. Nothing leaves the phone.
 */
class HmVisionModule : Module() {
  private val labeler by lazy { ImageLabeling.getClient(ImageLabelerOptions.Builder().setConfidenceThreshold(0.3f).build()) }
  private val faces by lazy {
    FaceDetection.getClient(FaceDetectorOptions.Builder().setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST).build())
  }

  override fun definition() = ModuleDefinition {
    Name("HmVision")

    AsyncFunction("analyze") { ids: List<String> ->
      ids.map { analyzeOne(it) }
    }
  }

  private fun analyzeOne(id: String): Map<String, Any?> {
    val out = mutableMapOf<String, Any?>(
      "id" to id, "labels" to emptyList<Map<String, Any>>(), "faces" to 0,
      "quality" to 0.5, "isScreenshot" to false, "isBlurry" to false
    )
    val context = appContext.reactContext ?: return out.apply { put("error", "no context") }
    val uri = Uri.parse(id)
    out["isScreenshot"] = isScreenshot(uri)
    val bitmap = try {
      if (Build.VERSION.SDK_INT >= 29) context.contentResolver.loadThumbnail(uri, Size(512, 512), null)
      else context.contentResolver.openInputStream(uri)?.use { s ->
        BitmapFactory.decodeStream(s, null, BitmapFactory.Options().apply { inSampleSize = 4 })
      }
    } catch (e: Exception) { null } ?: return out.apply { put("error", "no preview on this phone") }

    try {
      val image = InputImage.fromBitmap(bitmap, 0)
      val labels = Tasks.await(labeler.process(image))
        .sortedByDescending { it.confidence }
        .take(8)
        .map { mapOf("name" to it.text, "conf" to it.confidence.toDouble()) }
      out["labels"] = labels
      out["faces"] = Tasks.await(faces.process(image)).size
    } catch (e: Exception) {
      out["error"] = e.message
    }
    val (sharpness, exposure) = sharpnessAndExposure(bitmap)
    out["quality"] = max(0.0, min(1.0, 0.6 * sharpness + 0.4 * exposure))
    out["isBlurry"] = sharpness < 0.15
    return out
  }

  private fun isScreenshot(uri: Uri): Boolean {
    val context = appContext.reactContext ?: return false
    val cols = if (Build.VERSION.SDK_INT >= 29) arrayOf(MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.RELATIVE_PATH)
      else arrayOf(MediaStore.MediaColumns.DISPLAY_NAME)
    return try {
      context.contentResolver.query(uri, cols, null, null, null)?.use { c ->
        if (!c.moveToFirst()) return false
        (0 until c.columnCount).any { (c.getString(it) ?: "").contains("screenshot", ignoreCase = true) }
      } ?: false
    } catch (e: Exception) { false }
  }

  /** Sharpness from the variance of a Laplacian over a small grey copy; exposure from average brightness. Both 0..1. */
  private fun sharpnessAndExposure(src: Bitmap): Pair<Double, Double> {
    val scale = 256.0 / max(src.width, src.height)
    val w = max(8, (src.width * scale).toInt())
    val h = max(8, (src.height * scale).toInt())
    val small = Bitmap.createScaledBitmap(src, w, h, false)
    val px = IntArray(w * h)
    small.getPixels(px, 0, w, 0, 0, w, h)
    val g = DoubleArray(w * h) { i ->
      val c = px[i]
      0.299 * ((c shr 16) and 255) + 0.587 * ((c shr 8) and 255) + 0.114 * (c and 255)
    }
    var sum = 0.0; var sumSq = 0.0; var n = 0.0
    for (y in 1 until h - 1) for (x in 1 until w - 1) {
      val i = y * w + x
      val lap = g[i - w] + g[i + w] + g[i - 1] + g[i + 1] - 4 * g[i]
      sum += lap; sumSq += lap * lap; n += 1
    }
    val mean = sum / max(n, 1.0)
    val variance = sumSq / max(n, 1.0) - mean * mean
    val brightness = g.average()
    return Pair(min(1.0, variance / 600), max(0.0, 1 - abs(brightness - 128) / 128))
  }
}
