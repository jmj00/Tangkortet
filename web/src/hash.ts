// Shareable links: #pin=<lat>,<lon>&tab=<arter|risiko|guide>&art=<slug>.
// Latitude first, as people read and paste coordinates; [lon, lat] inside the app.

export type Tab = "arter" | "risiko" | "guide";

const TABS: readonly Tab[] = ["arter", "risiko", "guide"];

export interface HashState {
  pin: [number, number] | null;
  tab: Tab | null;
  species: string | null;
}

export function parseHash(hash: string): HashState {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const [lat, lon] = (params.get("pin") ?? "").split(",").map(Number);
  const inDenmark = lat > 54 && lat < 58.5 && lon > 7.5 && lon < 15.5;
  const tab = params.get("tab") as Tab | null;
  return {
    pin: inDenmark ? [lon, lat] : null,
    tab: tab && TABS.includes(tab) ? tab : null,
    species: /^[a-z-]+$/.test(params.get("art") ?? "") ? params.get("art") : null,
  };
}

export function formatHash(
  pin: [number, number] | null,
  tab: Tab,
  species: string | null = null,
): string {
  const parts = pin ? [`pin=${pin[1].toFixed(5)},${pin[0].toFixed(5)}`] : [];
  parts.push(`tab=${tab}`);
  if (species) parts.push(`art=${species}`);
  return `#${parts.join("&")}`;
}
