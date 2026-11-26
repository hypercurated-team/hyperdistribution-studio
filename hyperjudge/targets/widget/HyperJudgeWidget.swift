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
      // The expanded island is only ~160pt tall: one line of prompt, then one row of controls.
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image(systemName: "wand.and.stars").foregroundStyle(hjBlue).font(.title3)
        }
        DynamicIslandExpandedRegion(.trailing) {
          if context.state.phase == "guess" {
            Button(intent: CloseRoundIntent()) {
              Image(systemName: "xmark.circle.fill").font(.title3).foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
          }
        }
        DynamicIslandExpandedRegion(.center) {
          Text(context.state.phase == "guess" ? "How many followers?" : context.state.phase == "judging" ? "Judging…" : "HyperJudge")
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
        DynamicIslandExpandedRegion(.bottom) {
          HJRoundView(state: context.state, island: true)
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
  /// In the island the prompt sits in the center region, so leave it out here.
  var island = false

  var body: some View {
    switch state.phase {
    case "guess":
      VStack(spacing: 8) {
        if !island {
          Text("How many followers?").font(.subheadline).foregroundStyle(.secondary)
        }
        HStack(spacing: 10) {
          Button(intent: StepGuessIntent(delta: -1)) {
            Image(systemName: "chevron.left.circle.fill").font(.system(size: 30))
          }
          .buttonStyle(.plain)
          .disabled(state.guess == 0)

          Text(hjSteps[state.guess])
            .font(.system(size: 30, weight: .bold, design: .rounded))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .frame(width: 84)
            .contentTransition(.numericText())

          Button(intent: StepGuessIntent(delta: 1)) {
            Image(systemName: "chevron.right.circle.fill").font(.system(size: 30))
          }
          .buttonStyle(.plain)
          .disabled(state.guess == hjSteps.count - 1)

          Spacer(minLength: 4)

          Button(intent: LockInIntent()) {
            Text("Lock in")
              .font(.headline)
              .foregroundStyle(.white)
              .padding(.horizontal, 16)
              .padding(.vertical, 9)
              .background(Capsule().fill(hjBlue))
          }
          .buttonStyle(.plain)
        }
        .foregroundStyle(.white)
      }
    case "judging":
      HStack(spacing: 10) {
        ProgressView().tint(.white)
        Text("Checking \(hjSteps[state.guess])…").font(.headline)
      }
      .frame(maxWidth: .infinity, minHeight: 44)
    default:
      VStack(alignment: .leading, spacing: 2) {
        Text(state.title).font(.headline)
        Text(state.detail).font(.subheadline).lineLimit(2)
        if !state.score.isEmpty {
          Text(state.score).font(.subheadline).foregroundStyle(.secondary)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}
