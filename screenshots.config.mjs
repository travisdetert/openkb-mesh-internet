// Canonical screenshots for openkb-mesh-internet.
// Authentic no-radio states: the app lands on Home with no device, and the
// learning surfaces render fully offline. The Mesh-Routing "Demo" is a
// self-contained animated packet-flood simulation — no hardware, no captured
// data. Live node list / map genuinely need a LoRa radio and are not captured.
// See ../openkb-claude-harness/docs/adr/0001-canonical-screenshots.md.
export default {
  app: 'mesh-internet',
  mode: 'electron',
  // launch via app dir (package.json main = dist-electron/main.js)
  outDir: 'docs/screenshots',
  windowSize: { width: 1280, height: 860 },
  shots: [
    {
      // Landing / connect screen with no radio attached.
      name: 'home',
      settle: 3500,
    },
    {
      // The Mesh-Routing learning panel → its animated flood "Demo" (the visual
      // for managed flooding + the hop limit).
      name: 'mesh-routing-demo',
      // The diagnose nav group is hidden with no radio, but the Home "Learn the
      // physics" cards navigate — click that card (exact text avoids dupes).
      steps: [{ click: 'text="Mesh Routing"' }, { wait: 2500 }],
      settle: 3500,
    },
    {
      // The Link Budget explainer — offline, from local LoRa presets.
      name: 'link-budget',
      steps: [{ click: 'text="Link Budget"' }, { wait: 1200 }],
      settle: 2500,
    },
  ],
};
