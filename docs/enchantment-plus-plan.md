# Enchantment Plus Plan

## Objective

Build a Minecraft Bedrock add-on that replaces the default enchanting-table interaction with a custom enchanting flow that:

- shows players the exact enchantment result before they confirm,
- biases rolls toward stronger enchantments and multi-enchant outcomes,
- still spends levels and lapis so the feature feels close to vanilla.

## Working Assumption

I did not find an official Bedrock API for reading the vanilla enchanting table's hidden offer list directly. The official APIs do expose:

- block interaction cancellation through `PlayerInteractWithBlockBeforeEvent`,
- custom UI through `@minecraft/server-ui`,
- enchantment inspection and mutation through `ItemEnchantableComponent`, `EnchantmentType`, and `EnchantmentTypes`.

Because of that, the recommended implementation is a custom enchanting flow layered on top of the enchanting table, not a passive overlay on vanilla offers.

## Recommended Flow

1. Intercept enchanting-table use.
   - Subscribe to `world.beforeEvents.playerInteractWithBlock`.
   - If the interacted block is `minecraft:enchanting_table`, cancel the vanilla interaction and launch the add-on flow.

2. Read the candidate item from the player's selected hotbar slot.
   - Use `player.selectedSlotIndex`.
   - Read the item from the player's inventory container.
   - Reject empty slots or items without `minecraft:enchantable`.

3. Read payment inputs.
   - Check player level.
   - Find lapis in the inventory.
   - Count nearby bookshelves around the table.

4. Roll three exact offers in script before showing UI.
   - Build a compatible enchantment pool using `EnchantmentTypes.getAll()`.
   - Filter by `ItemEnchantableComponent.canAddEnchantment(...)`.
   - Weight higher levels more aggressively than vanilla.
   - Add a controlled chance for a second or third compatible enchantment.

5. Show the offers in a custom form.
   - Use `ActionFormData` first for a stable MVP.
   - Each button should show cost, exact enchantment names, levels, and a short power label.

6. Confirm and apply.
   - Revalidate the held item, slot, lapis count, and player level.
   - Spend lapis and levels.
   - Apply the pre-rolled enchantments with `addEnchantments(...)`.
   - Write the updated stack back into the same slot.

## Stronger-Enchantment Tuning

Use a scripted power score instead of vanilla randomness alone:

- Base power = bookshelf bonus + item enchantability value + offer tier bonus.
- Increase weight for higher enchantment levels as power rises.
- Increase the chance of extra compatible enchantments on tier 2 and tier 3 offers.
- Keep all enchantments capped at their official max levels.
- Keep treasure enchantments disabled for the first milestone unless you explicitly want them.

## MVP Rules

- Only support hotbar items first.
- Support swords, pickaxes, axes, bows, crossbows, armor, fishing rods, and books.
- Preserve existing enchantments unless the selected design says to reroll from scratch.
- Skip grindstone, anvils, villager trading, and loot-table integration in v1.

## Milestones

### Milestone 1: Interaction shell

- Detect enchanting-table interaction.
- Cancel vanilla UI.
- Validate held item, lapis, and level requirements.
- Show a placeholder custom menu.

### Milestone 2: Offer generation

- Add enchantment-pool builder.
- Generate deterministic offers from a seed based on player, table position, and selected slot.
- Display exact previews in the menu.

### Milestone 3: Apply and pay

- Deduct lapis and levels.
- Apply enchantments safely.
- Handle inventory race conditions and revalidation.

### Milestone 4: Better balancing

- Tune powerful-enchant odds.
- Add bookshelf scaling.
- Add support for books and multi-enchant combos.

### Milestone 5: Presentation

- Improve names, colors, and lore text.
- Add feedback sounds/particles.
- Add admin/debug toggles for testing offer weights.

## Proposed File Layout

- `scripts/main.ts`: bootstrap and event registration
- `scripts/enchanting/enchantingTableController.ts`: block interaction entry point
- `scripts/enchanting/inventory.ts`: selected item, lapis, and slot helpers
- `scripts/enchanting/offerGenerator.ts`: weighted roll logic
- `scripts/enchanting/enchantmentCatalog.ts`: compatible enchantment discovery
- `scripts/enchanting/ui.ts`: form rendering and choice handling
- `scripts/enchanting/applyOffer.ts`: payment, validation, and item mutation
- `scripts/enchanting/types.ts`: shared types for offers and config

## Risks To Expect

- Vanilla enchanting-table offers will not stay in sync if the add-on lets the vanilla UI open anywhere.
- Inventory revalidation matters because the player can change hotbar slots between preview and confirm.
- Balance tuning will need live playtests; stronger rolls can become overpowered quickly.
- Bookshelf detection rules need to be defined explicitly so players understand why offers improve.

## Sources

- https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/playerinteractwithblockbeforeevent?view=minecraft-bedrock-stable
- https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server-ui/minecraft-server-ui?view=minecraft-bedrock-stable
- https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server-ui/actionformdata?view=minecraft-bedrock-stable
- https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/itemenchantablecomponent?view=minecraft-bedrock-stable
- https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/enchantmenttype?view=minecraft-bedrock-stable
- https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/enchantmenttypes?view=minecraft-bedrock-stable
- https://learn.microsoft.com/en-us/minecraft/creator/reference/content/itemreference/examples/itemcomponents/minecraft_enchantable?view=minecraft-bedrock-experimental
- https://learn.microsoft.com/en-us/minecraft/creator/reference/content/loottablereference/examples/loottabledefinitions/enchantingtables?view=minecraft-bedrock-stable
- https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/player?view=minecraft-bedrock-stable
