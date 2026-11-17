/**
 * Menu-focus → French observation. Plugin sends structured Scaleform
 * fields on the fast lane; this module is the only place that turns them
 * into a spoken line (ADR 0003: speech templates live app-side).
 */

export type MenuFocusEvent =
  | "open"
  | "focus"
  | "close"
  // Item-action feedback (plugin collectors/item-events.ts): equip /
  // unequip / consume announcements riding the same fast lane.
  | "equip"
  | "unequip"
  | "use";

export interface MenuFocusData {
  name: string;
  event?: MenuFocusEvent;
  skyui?: boolean;
  category?: string;
  item?: string;
  index?: number;
  count?: number;
  firstRead?: boolean;
  announceCategory?: boolean;
}

const OPEN_LINE: Record<string, string> = {
  InventoryMenu: "Inventaire ouvert.",
  MagicMenu: "Menu magie ouvert.",
  ContainerMenu: "Conteneur ouvert.",
  BarterMenu: "Troc ouvert.",
  GiftMenu: "Menu cadeau ouvert.",
};

const ITEM_ACTION_LINE: Record<"equip" | "unequip" | "use", string> = {
  equip: "Équipé :",
  unequip: "Retiré :",
  use: "Utilisé :",
};

function isItemActionEvent(event: MenuFocusEvent): event is "equip" | "unequip" | "use" {
	return event === "equip" || event === "unequip" || event === "use";
}

function itemLine(menu: MenuFocusData): string {
  const item = menu.item?.trim() ?? "";
  if (!item) return "";
  const index = menu.index ?? -1;
  const count = menu.count ?? -1;
  if (index >= 0 && count > 0) {
    return `${item}, ${index + 1} sur ${count}`;
  }
  return item;
}

/**
 * Null means silence (close, or a payload with nothing speakable).
 */
export function formatMenuSpeech(menu: MenuFocusData | undefined | null): string | null {
  if (!menu || !menu.event || menu.event === "close") return null;

  // Item-action feedback: "Équipé : Hache de fer."
  if (isItemActionEvent(menu.event)) {
    const item = menu.item?.trim() ?? "";
    if (!item) return null;
    return `${ITEM_ACTION_LINE[menu.event]} ${item}.`;
  }

  const parts: string[] = [];
  if (menu.event === "open") {
    parts.push(OPEN_LINE[menu.name] ?? "Menu ouvert.");
  }
  if (menu.announceCategory && menu.category?.trim()) {
    parts.push(`${menu.category.trim()}.`);
  }
  const item = itemLine(menu);
  if (item) parts.push(item.endsWith(".") ? item : `${item}.`);

  if (parts.length === 0) return null;
  return parts.join(" ");
}
