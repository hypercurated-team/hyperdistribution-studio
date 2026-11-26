import CoreGraphics
import ExpoModulesCore
import Photos
import UIKit
import Vision

/// On-device photo understanding for HyperMixer, like the Photos app does it:
/// scene labels, how many faces, and a quality score, from a small preview
/// of each photo (videos use their poster frame). Nothing leaves the phone.
public final class HmVisionModule: Module {
  private let queue = DispatchQueue(label: "hypermixer.vision", qos: .utility)

  public func definition() -> ModuleDefinition {
    Name("HmVision")

    AsyncFunction("analyze") { (ids: [String], promise: Promise) in
      self.queue.async {
        promise.resolve(ids.map { self.analyzeOne($0) })
      }
    }
  }

  private func analyzeOne(_ id: String) -> [String: Any] {
    var out: [String: Any] = ["id": id, "labels": [], "faces": 0, "quality": 0.5, "isScreenshot": false, "isBlurry": false]
    let local = id.hasPrefix("ph://") ? String(id.dropFirst(5)) : id
    guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [local], options: nil).firstObject else {
      out["error"] = "not found"
      return out
    }
    out["isScreenshot"] = asset.mediaSubtypes.contains(.photoScreenshot)

    let options = PHImageRequestOptions()
    options.isSynchronous = true
    options.deliveryMode = .highQualityFormat
    options.resizeMode = .fast
    options.isNetworkAccessAllowed = false
    var cg: CGImage?
    PHImageManager.default().requestImage(for: asset, targetSize: CGSize(width: 512, height: 512), contentMode: .aspectFit, options: options) { image, _ in
      cg = image?.cgImage
    }
    guard let image = cg else {
      out["error"] = "no preview on this phone"
      return out
    }

    let classify = VNClassifyImageRequest()
    let faces = VNDetectFaceRectanglesRequest()
    var requests: [VNRequest] = [classify, faces]
    var aesthetics: VNRequest?
    if #available(iOS 18.0, *) {
      let a = VNCalculateImageAestheticsScoresRequest()
      aesthetics = a
      requests.append(a)
    }
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try? handler.perform(requests)

    let labels = (classify.results ?? [])
      .filter { $0.confidence > 0.3 }
      .sorted { $0.confidence > $1.confidence }
      .prefix(8)
      .map { ["name": $0.identifier, "conf": Double($0.confidence)] as [String: Any] }
    out["labels"] = Array(labels)
    out["faces"] = faces.results?.count ?? 0

    let (sharpness, exposure) = Self.sharpnessAndExposure(image)
    var quality = 0.6 * sharpness + 0.4 * exposure
    if #available(iOS 18.0, *), let a = aesthetics as? VNCalculateImageAestheticsScoresRequest, let score = a.results?.first {
      quality = 0.5 * quality + 0.5 * ((Double(score.overallScore) + 1) / 2)
      out["isUtility"] = score.isUtility
    }
    out["quality"] = max(0, min(1, quality))
    out["isBlurry"] = sharpness < 0.15
    return out
  }

  /// Sharpness from the variance of a Laplacian over a 256 px grey copy, and
  /// exposure from how far the average brightness sits from mid-grey. Both 0...1.
  private static func sharpnessAndExposure(_ image: CGImage) -> (Double, Double) {
    let side = 256
    let scale = Double(side) / Double(max(image.width, image.height))
    let w = max(8, Int(Double(image.width) * scale)), h = max(8, Int(Double(image.height) * scale))
    var px = [UInt8](repeating: 0, count: w * h)
    let drawn = px.withUnsafeMutableBytes { buf -> Bool in
      guard let ctx = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                                space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return false }
      ctx.interpolationQuality = .low
      ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
      return true
    }
    if !drawn { return (0.5, 0.5) }

    var sum = 0.0, sumSq = 0.0, n = 0.0, total = 0.0
    for y in 1..<(h - 1) {
      for x in 1..<(w - 1) {
        let c = Double(px[y * w + x])
        let lap = Double(px[(y - 1) * w + x]) + Double(px[(y + 1) * w + x]) + Double(px[y * w + x - 1]) + Double(px[y * w + x + 1]) - 4 * c
        sum += lap; sumSq += lap * lap; n += 1
      }
    }
    for v in px { total += Double(v) }
    let mean = sum / max(n, 1)
    let variance = sumSq / max(n, 1) - mean * mean
    let sharpness = min(1, variance / 600)
    let brightness = total / Double(px.count)
    let exposure = max(0, 1 - abs(brightness - 128) / 128)
    return (sharpness, exposure)
  }
}
