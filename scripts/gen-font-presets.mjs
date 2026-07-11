// Regenerates root/usr/share/aurora/font-presets.conf from the curated
// manifest below. Downloads every woff2 from jsDelivr to compute its sha256,
// so the router can verify integrity offline. Run: npm run gen-font-presets
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(
  new URL("../root/usr/share/aurora/font-presets.conf", import.meta.url),
);

const SANS_TAIL = '"Lato", ui-sans-serif, system-ui, sans-serif';
const MONO_TAIL = 'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace';

// slot, name, label, source, family, stack, [pkg id, version, weights]
const MANIFEST = [
  ["sans", "default", "Lato", "Built-in", "Lato", `"Lato", ui-sans-serif, system-ui, sans-serif`],
  ["sans", "system", "System UI", "System", "", `system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`],
  ["sans", "inter", "Inter", "Fontsource", "Inter", `"Inter", ${SANS_TAIL}`, "inter", "5.2.8", [400, 500, 600, 700]],
  ["sans", "geist-sans", "Geist Sans", "Fontsource", "Geist Sans", `"Geist Sans", ${SANS_TAIL}`, "geist-sans", "5.2.5", [400, 500, 600, 700]],
  ["sans", "ibm-plex-sans", "IBM Plex Sans", "Fontsource", "IBM Plex Sans", `"IBM Plex Sans", ${SANS_TAIL}`, "ibm-plex-sans", "5.2.8", [400, 500, 600, 700]],
  ["mono", "default", "System Mono", "Built-in", "", MONO_TAIL],
  ["mono", "jetbrains-mono", "JetBrains Mono", "Fontsource", "JetBrains Mono", `"JetBrains Mono", ${MONO_TAIL}`, "jetbrains-mono", "5.2.8", [400, 700]],
  ["mono", "maple-mono", "Maple Mono", "Fontsource", "Maple Mono", `"Maple Mono", ${MONO_TAIL}`, "maple-mono", "5.2.6", [400, 700]],
  ["mono", "fira-code", "Fira Code", "Fontsource", "Fira Code", `"Fira Code", ${MONO_TAIL}`, "fira-code", "5.2.7", [400, 700]],
  ["mono", "cascadia-code", "Cascadia Code", "Fontsource", "Cascadia Code", `"Cascadia Code", ${MONO_TAIL}`, "cascadia-code", "5.2.3", [400, 700]],
];

const jsdelivr = (id, ver, w) =>
  `https://cdn.jsdelivr.net/npm/@fontsource/${id}@${ver}/files/${id}-latin-${w}-normal.woff2`;
const npmmirror = (id, ver, w) =>
  `https://registry.npmmirror.com/@fontsource/${id}/${ver}/files/files/${id}-latin-${w}-normal.woff2`;

const lines = ["v2|generated-by-gen-font-presets|do-not-edit"];
let total = 0;

for (const [slot, name, label, source, family, stack, id, ver, weights] of MANIFEST) {
  lines.push(`font|${slot}|${name}|${label}|${source}|${family}|${stack}`);
  if (!id) continue;
  let presetBytes = 0;
  for (const w of weights) {
    const url = jsdelivr(id, ver, w);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    presetBytes += buf.length;
    const sha256 = createHash("sha256").update(buf).digest("hex");
    lines.push(`file|${slot}|${name}|${w}|${sha256}|${url}|${npmmirror(id, ver, w)}`);
    total += 1;
  }
  if (presetBytes > 200 * 1024)
    throw new Error(`${slot}/${name} exceeds 200KB budget: ${presetBytes} bytes`);
  console.log(`${slot}/${name}: ${weights.length} files, ${(presetBytes / 1024).toFixed(1)}KB`);
}

writeFileSync(OUT, lines.join("\n") + "\n");
console.log(`Wrote ${OUT} (${total} file entries)`);
