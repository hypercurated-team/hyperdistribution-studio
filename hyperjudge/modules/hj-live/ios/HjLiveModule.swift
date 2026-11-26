import ExpoModulesCore

/// Thin bridge to HJBridge (targets/widget/_shared/HJShared.swift), which lives in the app
/// target, not in this pod, so it is looked up by its Objective-C name at runtime.
public class HjLiveModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HjLive")

    Function("start") { (text: String) -> Bool in
      Self.call("start:", text as NSString)
    }
    Function("lockIn") { (index: Int) -> Bool in
      Self.call("lockIn:", NSNumber(value: index))
    }
    Function("close") { () -> Bool in
      Self.call("close:", NSNumber(value: 0))
    }
  }

  private static func call(_ name: String, _ arg: AnyObject) -> Bool {
    // Class methods are answered by the class object itself, so talk to it as an object.
    guard let cls = NSClassFromString("HJBridge"), let bridge = (cls as AnyObject) as? NSObjectProtocol else { return false }
    let selector = NSSelectorFromString(name)
    guard bridge.responds(to: selector) else { return false }
    _ = bridge.perform(selector, with: arg)
    return true
  }
}
