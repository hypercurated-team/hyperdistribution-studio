import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

private let hjBlue = Color(red: 0.30, green: 0.36, blue: 1.0)

@main
struct HyperJudgeWidgets: WidgetBundle {
  var body: some Widget {
    HJLiveActivity()
  }
}

/// The round in the Dynamic Island (and on the Lock Screen on iPhones without one).
struct HJLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: HJAttributes.self) { context in
      HJRoundView(state: context.state)
        .padding(16)
        .activityBackgroundTint(Color.black.opacity(0.85))
        .activitySystemActionForegroundColor(.white)
        .widgetURL(URL(string: "hyperjudge://wheel"))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image(systemName: "wand.and.stars").foregroundStyle(hjBlue).font(.title3)
        }
        DynamicIslandExpandedRegion(.trailing) {
          if context.state.phase == "guess" {
            Button(intent: CloseRoundIntent()) {
              Image(systemName: "xmark").font(.headline).foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          HJRoundView(state: context.state)
        }
      } compactLeading: {
        Image(systemName: "wand.and.stars").foregroundStyle(hjBlue)
      } compactTrailing: {
        Text(compact(context.state)).font(.caption.bold()).monospacedDigit()
      } minimal: {
        Image(systemName: "wand.and.stars").foregroundStyle(hjBlue)
      }
      .widgetURL(URL(string: "hyperjudge://wheel"))
    }
  }

  private func compact(_ s: HJAttributes.ContentState) -> String {
    switch s.phase {
    case "guess": return hjSteps[s.guess]
    case "judging": return "…"
    case "result": return String(s.title.split(separator: " ").last ?? "")
    default: return "!"
    }
  }
}

struct HJRoundView: View {
  let state: HJAttributes.ContentState

  var body: some View {
    switch state.phase {
    case "guess":
      VStack(spacing: 10) {
        Text("How many followers?").font(.subheadline).foregroundStyle(.secondary)
        HStack(spacing: 14) {
          Button(intent: StepGuessIntent(delta: -1)) {
            Image(systemName: "chevron.left.circle.fill").font(.system(size: 34))
          }
          .buttonStyle(.plain)
          .disabled(state.guess == 0)

          Text(hjSteps[state.guess])
            .font(.system(size: 36, weight: .bold, design: .rounded))
            .monospacedDigit()
            .frame(minWidth: 96)
            .contentTransition(.numericText())

          Button(intent: StepGuessIntent(delta: 1)) {
            Image(systemName: "chevron.right.circle.fill").font(.system(size: 34))
          }
          .buttonStyle(.plain)
          .disabled(state.guess == hjSteps.count - 1)
        }
        .foregroundStyle(.white)
        Button(intent: LockInIntent()) {
          Text("Lock in").font(.headline).frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .tint(hjBlue)
      }
    case "judging":
      HStack(spacing: 10) {
        ProgressView()
        Text("Judging \(hjSteps[state.guess])…").font(.headline)
      }
      .frame(maxWidth: .infinity, minHeight: 60)
    default:
      VStack(alignment: .leading, spacing: 4) {
        Text(state.title).font(.title3.bold())
        Text(state.detail).font(.subheadline)
        if !state.score.isEmpty {
          Text(state.score).font(.subheadline).foregroundStyle(.secondary)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}
