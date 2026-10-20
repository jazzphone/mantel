import MantelKit
import SwiftUI

/// The person's favorites as the dashboard draws them, two to a row: the room above the name, what it is now below,
/// white while on (as Home's pills). A click switches it (the gateway, as the screens); Edit Favorites chooses them.
struct FavoritesGrid: View {
    @EnvironmentObject private var model: SessionModel
    var edit: () -> Void

    var body: some View {
        let favs = model.summary?.favorites ?? []
        VStack(alignment: .leading, spacing: 12) {
            if favs.isEmpty {
                Spacer()
                VStack(spacing: 10) {
                    Image(systemName: "star.circle.fill").font(.system(size: 40)).foregroundStyle(.white.opacity(0.5))
                    Text("No Favorites Yet").font(.system(size: 15, weight: .bold))
                    Text("Add the accessories you use most. They show here, and in the widgets, Control Center and Siri.")
                        .font(.system(size: 12)).foregroundStyle(.white.opacity(0.6)).multilineTextAlignment(.center)
                    Button("Add Favorites…", action: edit).buttonStyle(GlassButton(prominent: true))
                }
                .frame(maxWidth: .infinity)
                Spacer()
            } else {
                PaneScroll {
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                        ForEach(favs) { e in FavoriteTile(entity: e) }
                    }
                }
            }
        }
        .foregroundStyle(.white)
        .task { await model.refresh() }
    }
}

struct FavoriteTile: View {
    @EnvironmentObject private var model: SessionModel
    let entity: EntityState
    @State private var hover = false
    @State private var pressedOn: Bool?

    var body: some View {
        let on = pressedOn ?? entity.isOn
        Button {
            guard entity.isToggleable || entity.isAction else { return }
            if entity.isToggleable { pressedOn = !on }
            Task {
                await model.toggle(entity)
                pressedOn = nil
            }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: Self.symbol(entity, on: on)).font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(on ? Self.tint(entity) : .white.opacity(0.85))
                    .frame(width: 34, height: 34)
                    .background(on ? Self.tint(entity).opacity(0.18) : .white.opacity(0.12), in: Circle())
                    .contentTransition(.symbolEffect(.replace))
                VStack(alignment: .leading, spacing: 0) {
                    if let a = entity.area, !a.isEmpty, a != entity.name {
                        Text(a).font(.system(size: 11)).foregroundStyle(on ? .black.opacity(0.5) : .white.opacity(0.55)).lineLimit(1)
                    }
                    Text(entity.name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                    Text(entity.detail).font(.system(size: 11)).foregroundStyle(on ? .black.opacity(0.55) : .white.opacity(0.6)).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10).padding(.vertical, 9)
            .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
            .background(on ? AnyShapeStyle(.white) : AnyShapeStyle(.white.opacity(hover ? 0.16 : 0.1)),
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .foregroundStyle(on ? .black : .white)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressScale())
        .onHover { hover = $0 }
        .animation(.easeOut(duration: 0.2), value: on)
        .help(entity.isToggleable ? (on ? "Turn Off" : "Turn On") : entity.isAction ? "Run" : entity.name)
    }

    static func symbol(_ e: EntityState, on: Bool) -> String {
        switch e.domain {
        case "light": return on ? "lightbulb.fill" : "lightbulb"
        case "switch", "input_boolean": return on ? "powerplug.fill" : "powerplug"
        case "fan": return "fan.fill"
        case "lock": return on ? "lock.open.fill" : "lock.fill"
        case "cover", "valve": return on ? "blinds.vertical.open" : "blinds.vertical.closed"
        case "climate", "water_heater": return "thermometer.medium"
        case "media_player": return "hifispeaker.fill"
        case "scene": return "theatermasks.fill"
        case "script", "button", "input_button": return "play.circle.fill"
        case "vacuum": return "fan.floor.fill"
        case "camera": return "video.fill"
        case "alarm_control_panel": return "shield.lefthalf.filled"
        case "humidifier": return "humidifier.fill"
        default: return "circle.grid.2x2.fill"
        }
    }

    static func tint(_ e: EntityState) -> Color {
        switch e.domain {
        case "light": return Color(red: 0.98, green: 0.72, blue: 0.10)
        case "lock", "cover", "valve": return Color(red: 0.20, green: 0.70, blue: 0.62)
        case "climate", "water_heater", "fan", "humidifier": return Color(red: 0.95, green: 0.50, blue: 0.15)
        case "media_player": return Color(red: 0.95, green: 0.25, blue: 0.45)
        default: return Color(red: 0.25, green: 0.50, blue: 0.95)
        }
    }
}
