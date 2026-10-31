# ADR-0129: A card moves one stage at a time; the final stages stand out; a special right jumps stages and boards

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-31 |
| Deciders | Owner (the request of 2026-10-31: «Шат алгасах үйлдэл хийх хориотой. Зөвхөн онцгой эрхтэй хүн дурын самбарын шат руу шууд картыг зөөдөг»; the sale and transfer stages coloured apart from the plain ones), Claude (the direct-mode session) |
| Amends | ADR-0056 #3 (a card moved to any stage the role may move into), ADR-0057 #2 (the stage rights) |

## Context

The owner's pipelines have many plain stages between the reservation, the picking and the sale («Бэлдэх захиалга», «Бэлдэх падаан хэвлэх», «Бэлдэж буй захиалга» …). Until now any role with the MOVE right on a stage could drop a card there from anywhere, skipping the steps in between; nothing on the board told a user which column sells or transfers the goods.

## Decision

1. **One stage at a time.** A card moves only into the stage just before or just after its own one, among the pipeline's live stages in their order. A CANCEL stage takes a card from anywhere. The server refuses a jump with `STAGE_SKIP` (403, `params.from` and `params.to` name the stages); the board offers only the neighbours in the card's «Зөөх» menu and accepts a drag only onto them; the order panel's stage select and steps are disabled alike.
2. **The special right** `sales.orders.moveAny` (the admin always holds it; a custom role may) moves a card into any stage of its pipeline, and into a stage of another pipeline of any board («Зөөх» → «Өөр дамжлага руу…» → the pipeline → its stage). The order then belongs to that pipeline; the target stage's action runs as on any move. A customer-app order never leaves the sales pipelines.
3. **The final stages stand out.** A column whose stage sells (SALE) or transfers (TRANSFER) is drawn in the success tint with a green border and title; the plain, CONFIRM, PICK and CANCEL columns keep the grey board.
4. Shift + mouse wheel scrolls the board sideways from anywhere on it (the columns no longer swallow the horizontal scroll).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Forward only (no step back) | A card sent to the next stage by mistake must come back; the owner asked for no skipping, not for no return. |
| The stage's MOVE right alone, as before | It names who may enter a stage, not from where; the skipping happened with the right in hand. |
| A per-stage setting «may be skipped» | More configuration for a rule the owner stated as general. |

## Consequences

- `sales-boards` integration suite: the office is refused a jump over «Бэлдэх» with `STAGE_SKIP`; the admin jumps and meets the picking gate (`PICK_INCOMPLETE`, ADR-0126).
- No migration: the right is a code constant stored on roles like every other permission.
- `docs/modules/sales.md` describes the rule and the right.
