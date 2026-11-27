const THEME = Object.freeze({
  accent: 0xEF4444,
  primary: 0xDC2626,
  background: "#1C0B0E",
  surface: "#2B1217",
  text: "#FFF1F2",
  muted: "#F3B4BC",
});

function resolveBotColor(value) {
  const color = typeof value === "string" ? value.trim() : "";
  // Migrate the old shipped neutral/purple defaults to the red bot theme without overwriting custom .env colors.
  if (!/^#[0-9a-f]{6}$/i.test(color) || color.toLowerCase() === "#3f4652" || color.toLowerCase() === "#a78bfa") {
    return "#EF4444";
  }
  return color;
}

module.exports = { THEME, resolveBotColor };
