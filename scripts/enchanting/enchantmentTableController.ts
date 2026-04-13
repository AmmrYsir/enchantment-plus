import {
  Block,
  Enchantment,
  EntityInventoryComponent,
  ItemEnchantableComponent,
  ItemStack,
  Player,
  system,
  Vector3,
  world,
} from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { buildEnchantingOffers } from "./offerGenerator";
import { EnchantingContext, EnchantingFailure, EnchantmentOffer, TableContext } from "./types";

const ENCHANTING_TABLE_TYPE_ID = "minecraft:enchanting_table";
const LAPIS_TYPE_ID = "minecraft:lapis_lazuli";
const MAX_BOOKSHELVES = 15;
const activePlayers = new Set<string>();

export function registerEnchantmentTableController(): void {
  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (!event.isFirstEvent || event.block.typeId !== ENCHANTING_TABLE_TYPE_ID) {
      return;
    }

    event.cancel = true;

    const tableLocation = cloneLocation(event.block.location);
    system.run(() => {
      void openEnchantingFlow(event.player, tableLocation);
    });
  });
}

async function openEnchantingFlow(player: Player, tableLocation: Vector3): Promise<void> {
  if (activePlayers.has(player.id)) {
    return;
  }

  activePlayers.add(player.id);

  try {
    const context = getEnchantingContext(player);
    if ("message" in context) {
      player.sendMessage(context.message);
      return;
    }

    const table = getEnchantingTable(player, tableLocation);
    if (!table) {
      player.sendMessage("§cThe enchanting table is no longer available.");
      return;
    }

    const tableContext: TableContext = {
      location: tableLocation,
      bookshelfCount: countBookshelves(table),
    };
    const offers = buildEnchantingOffers(context.item, player.id, tableLocation, tableContext.bookshelfCount);

    if (offers.length === 0) {
      player.sendMessage("§cThat item cannot receive any new enchantments here.");
      return;
    }

    const selectedOffer = await promptForOffer(player, context.item, tableContext, offers);
    if (!selectedOffer) {
      return;
    }

    const latestContext = getEnchantingContext(player);
    if ("message" in latestContext) {
      player.sendMessage("§cThe held item changed before the enchantment was applied.");
      return;
    }

    if (latestContext.slot !== context.slot || getItemFingerprint(latestContext.item) !== context.fingerprint) {
      player.sendMessage("§cKeep the same item in the same slot while enchanting.");
      return;
    }

    const applyResult = applyOffer(player, latestContext, selectedOffer);
    player.sendMessage(applyResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    player.sendMessage(`§cEnchantment Plus failed: ${message}`);
  } finally {
    activePlayers.delete(player.id);
  }
}

function getEnchantingContext(player: Player): EnchantingContext | EnchantingFailure {
  const inventory = player.getComponent("minecraft:inventory") as EntityInventoryComponent | undefined;
  const container = inventory?.container;
  if (!container) {
    return { message: "§cYour inventory is not available right now." };
  }

  const slot = player.selectedSlotIndex;
  const item = container.getItem(slot);
  if (!item) {
    return { message: "§cHold the item you want to enchant in your selected hotbar slot." };
  }

  if (item.amount !== 1) {
    return { message: "§cUse a single item stack when enchanting." };
  }

  const enchantable = item.getComponent("minecraft:enchantable") as ItemEnchantableComponent | undefined;
  if (!enchantable) {
    return { message: "§cThat item is not enchantable." };
  }

  return {
    slot,
    item,
    fingerprint: getItemFingerprint(item),
  };
}

function getEnchantingTable(player: Player, location: Vector3): Block | undefined {
  const block = player.dimension.getBlock(location);
  if (!block || block.typeId !== ENCHANTING_TABLE_TYPE_ID) {
    return undefined;
  }

  return block;
}

async function promptForOffer(
  player: Player,
  item: ItemStack,
  tableContext: TableContext,
  offers: EnchantmentOffer[]
): Promise<EnchantmentOffer | undefined> {
  const lapisCount = countItem(player, LAPIS_TYPE_ID);
  const form = new ActionFormData()
    .title("Enchantment Plus")
    .body(
      [
        `Item: ${getDisplayName(item)}`,
        `Bookshelves: ${tableContext.bookshelfCount}/${MAX_BOOKSHELVES}`,
        `Lapis: ${lapisCount}`,
        `Levels: ${player.level}`,
        "",
        "Previewed results are exact. The selected offer is the enchantment that will be applied.",
      ].join("\n")
    );

  for (const offer of offers) {
    const affordable = lapisCount >= offer.lapisCost && player.level >= offer.levelCost;
    const enchantmentLines = offer.enchantments.map((enchantment) => formatEnchantment(enchantment)).join(", ");
    form.button(
      [
        `${affordable ? "§a" : "§7"}${offer.label}`,
        `§r${enchantmentLines}`,
        `§7Cost: ${offer.lapisCost} lapis, ${offer.levelCost} levels`,
      ].join("\n")
    );
  }

  const response = await form.show(player);
  if (response.canceled || response.selection === undefined) {
    return undefined;
  }

  return offers[response.selection];
}

function applyOffer(player: Player, context: EnchantingContext, offer: EnchantmentOffer): string {
  const inventory = player.getComponent("minecraft:inventory") as EntityInventoryComponent | undefined;
  const container = inventory?.container;
  if (!container) {
    return "§cYour inventory is not available right now.";
  }

  if (player.level < offer.levelCost) {
    return `§cYou need ${offer.levelCost} levels for that offer.`;
  }

  const lapisCount = countItem(player, LAPIS_TYPE_ID);
  if (lapisCount < offer.lapisCost) {
    return `§cYou need ${offer.lapisCost} lapis lazuli for that offer.`;
  }

  const item = container.getItem(context.slot);
  if (!item || getItemFingerprint(item) !== context.fingerprint) {
    return "§cThe item changed before the enchantment could be applied.";
  }

  const enchantedItem = item.clone();
  const enchantable = enchantedItem.getComponent("minecraft:enchantable") as ItemEnchantableComponent | undefined;
  if (!enchantable) {
    return "§cThat item can no longer be enchanted.";
  }

  try {
    enchantable.addEnchantments(offer.enchantments);
    consumeItem(container, LAPIS_TYPE_ID, offer.lapisCost);
    player.addLevels(-offer.levelCost);
    container.setItem(context.slot, enchantedItem);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown enchantment error";
    return `§cFailed to apply the selected offer: ${message}`;
  }

  return `§aApplied ${offer.enchantments.map((entry) => formatEnchantment(entry)).join(", ")}.`;
}

function countItem(player: Player, itemTypeId: string): number {
  const inventory = player.getComponent("minecraft:inventory") as EntityInventoryComponent | undefined;
  const container = inventory?.container;
  if (!container) {
    return 0;
  }

  let total = 0;
  for (let slot = 0; slot < container.size; slot += 1) {
    const item = container.getItem(slot);
    if (item?.typeId === itemTypeId) {
      total += item.amount;
    }
  }

  return total;
}

function consumeItem(container: EntityInventoryComponent["container"], itemTypeId: string, amount: number): void {
  let remaining = amount;

  for (let slot = 0; slot < container.size && remaining > 0; slot += 1) {
    const item = container.getItem(slot);
    if (!item || item.typeId !== itemTypeId) {
      continue;
    }

    if (item.amount <= remaining) {
      remaining -= item.amount;
      container.setItem(slot);
      continue;
    }

    const updatedItem = item.clone();
    updatedItem.amount -= remaining;
    container.setItem(slot, updatedItem);
    remaining = 0;
  }
}

function countBookshelves(table: Block): number {
  let count = 0;

  for (const offset of getBookshelfOffsets()) {
    try {
      const bookshelf = table.dimension.getBlock({
        x: table.location.x + offset.x,
        y: table.location.y + offset.y,
        z: table.location.z + offset.z,
      });
      const gap = table.dimension.getBlock({
        x: table.location.x + offset.gapX,
        y: table.location.y + offset.y,
        z: table.location.z + offset.gapZ,
      });

      if (bookshelf?.typeId === "minecraft:bookshelf" && gap?.isAir) {
        count += 1;
      }
    } catch {
      // Ignore unloaded/out-of-bounds blocks during bookshelf checks.
    }
  }

  return Math.min(count, MAX_BOOKSHELVES);
}

function getBookshelfOffsets(): Array<{ x: number; y: number; z: number; gapX: number; gapZ: number }> {
  const offsets: Array<{ x: number; y: number; z: number; gapX: number; gapZ: number }> = [];

  for (const y of [0, 1]) {
    for (let x = -2; x <= 2; x += 1) {
      for (let z = -2; z <= 2; z += 1) {
        const edgeDistance = Math.max(Math.abs(x), Math.abs(z));
        if (edgeDistance !== 2 || (Math.abs(x) === 2 && Math.abs(z) === 2)) {
          continue;
        }

        offsets.push({
          x,
          y,
          z,
          gapX: Math.sign(x),
          gapZ: Math.sign(z),
        });
      }
    }
  }

  return offsets;
}

function getItemFingerprint(item: ItemStack): string {
  const enchantable = item.getComponent("minecraft:enchantable") as ItemEnchantableComponent | undefined;
  const enchantments = enchantable?.getEnchantments() ?? [];
  const enchantmentKey = enchantments
    .map((entry) => `${entry.type.id}:${entry.level}`)
    .sort()
    .join(",");

  return `${item.typeId}|${item.amount}|${item.nameTag ?? ""}|${enchantmentKey}`;
}

function formatEnchantment(enchantment: Enchantment): string {
  return `${formatEnchantmentName(enchantment.type.id)} ${toRoman(enchantment.level)}`;
}

function formatEnchantmentName(enchantmentId: string): string {
  const cleanId = enchantmentId.replace("minecraft:", "");
  return cleanId
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function getDisplayName(item: ItemStack): string {
  if (item.nameTag) {
    return item.nameTag;
  }

  return item.typeId.replace("minecraft:", "").split("_").join(" ");
}

function toRoman(value: number): string {
  const numerals: Array<[number, string]> = [
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];

  let remaining = value;
  let result = "";

  for (const [amount, numeral] of numerals) {
    while (remaining >= amount) {
      result += numeral;
      remaining -= amount;
    }
  }

  return result;
}

function cloneLocation(location: Vector3): Vector3 {
  return { x: location.x, y: location.y, z: location.z };
}
