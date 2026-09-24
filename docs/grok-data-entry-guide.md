# StoneDesk — Browser-Agent Data Entry Guide (Deforest Yards Bldg I)

> **Who this is for:** an automated browser agent (e.g. Grok) that will open StoneDesk,
> create the project, and enter **every part from every page** of the attached
> drawing PDF (`Deforest_Yards_Bldg_I_Drawings.pdf`, 44 pages) into **Source Data → Manual Entry**.
> **The agent stops after the last page is saved.** No human steps.

---

## 0. Rules for the agent (read first)

1. **Scope:** Only do Steps 1–6 below. **Do NOT** click *Approve for Packing*, *Planning Workspace*,
   *Drawing Generator*, *Cut List*, *Export*, *Delete*, or *Mirror Existing*.
2. **One PDF page = one "Drawing" in the app.** Enter pages 1 → 44 in order. Never merge two pages.
3. **Browser pop-ups:** after every *Save Drawing* the browser shows an `alert` like
   `"12 pieces saved successfully!"`. Click **OK**. If it says `"Error adding pieces"`, click OK,
   wait 5 s, click *Save Drawing* again once. If it fails again, log the page number and continue with the next page.
4. **Never type fractions.** Convert inches to decimals (table in §7). Example `25 3/8"` → `25.375`.
5. **After typing in any field, press `Tab`** (some fields only save on blur).
6. Keep a running log: `page, drawing #, parts entered, pcs saved`. The final report is this log.

---

## 1. Open the app

1. Go to the StoneDesk frontend URL:
   `https://stonedesk-frontend-149130710868.asia-south1.run.app` *(replace if your deployed URL differs)*.
2. Wait until the dark top bar with the StoneDesk logo and a left sidebar (**Projects**, **Cut List**,
   **Drawing Generator**, **Configuration**) is visible.
3. Make sure **Projects** is selected in the left sidebar.

## 2. Create the project

1. Click **`+ Create New Project`** (yellow/blue button, top-right of the dark header bar).
2. A **New Project** card appears. Fill:
   | Field | Value |
   |---|---|
   | Project Name | `Deforest Yards Bldg I` |
   | Customer | *(leave blank or use customer name if known)* |
   | Job # | *(blank — title block shows none)* |
   | Date | `2026-01-27` (issue date on the title block) |
3. Click **`Save Project`**. The app opens the project automatically
   (header shows *Project — Deforest Yards Bldg I* with a **Draft** badge).
   - If the project already exists (re-run), instead type `Deforest Yards` in the search box, click **Open** on it,
     and scroll down to the saved-parts table to see which pages are already done; resume from the next page.
4. In the project's left sidebar confirm step **1 Source Data** is active, and the sub-tab **Manual Entry** is
   underlined (click it if not). **Do not use "Automated Upload".**

## 3. Project Details card (one time only)

At the top of Manual Entry is the **Project Details** card.

1. **Material** dropdown → select `Quartz`, then press `Tab` (it saves on blur).
2. **Stone Color** → click the input, type `Carrara Classic`.
   - If `Carrara Classic` appears in the dropdown, click it.
   - If not, click **`+ Add "Carrara Classic" as new color`**, type density `2400` in *Density (kg/m³)*,
     click **Save color**.
3. Leave *Crate Wood*, *Wood Thick.*, *Density Override*, *Weight Multiplying Factor* as-is.
4. **Default Thickness per Part Type** (grid of 11 labels each with `2CM` / `3CM` buttons):
   The spec block on every page says **3CM QUARTZ**, so click **`3CM`** for **every** row, including
   `Kitchen - Back Splash`, `Kitchen - Side Splash`, `Vanity - Back Splash`, `Vanity - Side Splash`,
   `Misc - Full Height Splash`, `Misc - Window Sill` (these default to 2CM).

---

## 4. How to read one PDF page

Each page has:

| Drawing element | Meaning | Where it goes in app |
|---|---|---|
| Big text top-left, e.g. `A`, `B / B1`, `E / E1-MIR`, `F3-SIM` | Unit type | **Unit Name** |
| `QTY= 6` | Number of units using this page | Check only — must equal number of flats entered |
| `UNITS: 101, 201, 301, 122, 222, 322` | Flats that get these parts | **Destination matrix** |
| Circled number ①②③④⑤ | A countertop part | One grid row, *Part Type* = a Top |
| Letter inside a 4" strip (A, B, C…) | A splash part | One grid row, *Part Type* = a Splash |
| Two dimensions on a part | Length × width | **Length** = larger, **Width** = smaller |
| Dimension inside a **rectangle box** | Oversized part | Add `OVERSIZED` to Notes |
| `PL-VS3018`, `PL-3088` etc. inside a rounded rectangle | Sink cut-out (model) | Part Details → Sink |
| Small circles next to sink (`o`, `⊙`) | Faucet/tap holes | Part Details → Tap Holes |
| Tiny dots around sink | Sink clip marks | **Ignore** |
| `⊗` on an edge | Finished edge ("XXX") | Edge side = **Pencil Round** |
| `×` on an edge | Flat edge (stove polish) | Edge side = **Manual** + note |
| `RAW` or no symbol on an edge | Raw / unfinished | Edge side = **—** (none) |
| `TR` pointing at a corner | 1/8" radius corner | Radius `0.125` + tick that corner |

**Orientation rule (important for edges & corners):** Rotate the page so the title-block text is
readable. Then look at each part with its **longest dimension horizontal**. If a part is drawn with the long
side vertical, rotate it 90° **clockwise** in your head: what was the left edge becomes **Top**,
right becomes **Bottom**, top becomes **Right**, bottom becomes **Left**.
In the app: **Top/Bottom = Length sides, Left/Right = Width sides.**

**Part Type rule** (pick from the Part Type dropdown — exact text):

| What it is on the page | Part Type |
|---|---|
| Top with a big sink (PL-VS…) and depth ≥ 30" | `Kitchen - Island Tops` |
| Top ~25"–26" deep, no sink, or kitchen sink on a 25½" deep top | `Kitchen - Perimeter Tops` |
| Top next to the range / cooktop (marked stove, `×` flat edge on the range side) | `Kitchen - Perimeter Tops` *(use `Kitchen - Range Tops` only if the page literally says RANGE)* |
| Top ~19"–23" deep with PL-3088 (bath) sink | `Vanity - Top` |
| 4" strip on a **kitchen** page, length ≈ depth of a kitchen top (e.g. 23¼, 25⅜) | `Kitchen - Side Splash` |
| 4" strip on a kitchen page, longer, along the back wall | `Kitchen - Back Splash` |
| 4" strip on a **vanity** page, length ≈ vanity depth (e.g. 21¼) | `Vanity - Side Splash` |
| 4" strip on a vanity page, along the back wall | `Vanity - Back Splash` |

**Category rule** (Drawing Workspace → Category): page containing any `Kitchen - …` part → `Kitchen`;
page with only `Vanity - …` parts → `Vanity`.

---

## 5. Enter one page (repeat for pages 1 → 44)

All of this happens in the **Drawing Workspace** card, below Project Details.

### 5.1 Reset
Click **`Clear All`** (small underlined grey text at the right end of the button row
*Duplicate · Copy Parts · Paste Parts · Copy Matrix · Paste Matrix · Clear Matrix · Mirror Existing · Clear All*).
This must be done **before every page** — after a save the Drawing #, Category and Matrix are kept, and
the next page would inherit them.

### 5.2 Drawing header fields
| Field | Value |
|---|---|
| **Drawing #** | `DY-I-P` + 2-digit page number → page 1 = `DY-I-P01`, page 17 = `DY-I-P17` |
| **Unit Name** | Unit type exactly as printed, e.g. `A`, `A-MIR`, `B / B1_L`, `E / E1_21-MIR`, `F3-SIM` |
| **Category** | `Kitchen` or `Vanity` (rule in §4) |
| **Fragility** | `Standard` |
| **Orientation** | `Auto` |
| **Priority** | `Standard` |
| **Stacking** | `Auto` |
| Checkbox *Use project material & color for this drawing* | leave **checked** |
| **Wt Override (kg)** | leave blank |

### 5.3 Destination (flats)
1. In the **Destination** row click the pill **`Matrix Grid`** (not *Single / Comma-List*).
2. **Buildings (comma-separated)** → `I`
3. **Floors (comma-separated)** → the distinct **first digits** of the unit numbers, ascending.
   Example `UNITS: 101, 201, 301, 122, 222, 322` → `1,2,3`.
   Example `UNITS: 111, 211, 311, 120, 220, 320, 207, 314` → `1,2,3`.
4. A table appears: rows `Floor 1`, `Floor 2`… and one column `Bldg I`. In each floor's cell there is a text
   box (placeholder `101,102,103`) and a small qty box (leave `1`).
   Type the flats that start with that floor digit, comma-separated, then press **Enter**:
   - Floor 1 cell → `101,122` ⏎
   - Floor 2 cell → `201,222` ⏎
   - Floor 3 cell → `301,322` ⏎
   Each flat becomes a blue chip `101 × 1`. If a chip is wrong, click its small `×` to remove it.
5. **Check:** total chips must equal the page's `QTY=`. If not, fix before continuing.

> Why matrix and not comma-list: the comma-list mode multiplies Building × Floor × Flat and would create wrong
> duplicates. The matrix keeps each flat on its correct floor.

### 5.4 Pieces grid — one row per part
Section **"Pieces in this Drawing"**. Columns:
`# | Part # | Part Type | Qty | Length | Width | Thick. | Sq Ft | Wt kg | Sink | Edge | Radius | Notes | Copy Edit ✕`

- Enter parts in this order: circled numbers ascending (①, ②, ③…), then splash letters (A, B, C…).
- Need another row → click **`+ Add Row`** (top-right of the grid).
- Row wrong → **`✕`** at the row's end (the last remaining row cannot be deleted; just overwrite it).

For each row:
1. **Part Type** — click the cell, type part of the name (e.g. `perim`, `island`, `vanity - top`,
   `kitchen - side`), then **click** the matching item in the dropdown list. (The app then auto-fills
   thickness and auto-numbers Part #.)
2. **Part #** — click the cell, select all (`Ctrl+A`), type `<Drawing #>-<label on drawing>`:
   circle ③ on page 1 → `DY-I-P01-3`; splash C on page 2 → `DY-I-P02-C`.
   (Do this **after** choosing Part Type, so the manual number is kept.)
3. **Qty** — shows a grey read-only number (= flats count). Nothing to type.
4. **Length** — larger dimension in decimal inches (e.g. `110.75`).
5. **Width** — smaller dimension (e.g. `43.5`). Splash strips: width `4`.
6. **Thick.** — read-only, should show `3CM`. If it shows `2CM`, redo §3 step 4.
7. **Radius** — if the part has any `TR` corner, type `0.125` in the small `R` box. (Corners are ticked in 5.5.)
8. **Notes** — optional: `OVERSIZED` if a dimension is boxed; anything else printed next to the part.
9. Check **Sq Ft** and **Wt kg** now show numbers (means Length/Width were accepted).

### 5.5 Part Details drawer (edges, sink, taps, corners) — do for EVERY row
Click the row's **`Edit`** button. A panel slides in from the right titled **Part Details** showing the Part #.
Sections are collapsible (click the title to open/close). Fill top-to-bottom:

**A. Sink** (open by default)
- No sink on this part → leave `Sink Type = No Sink`, `Sink Cutouts # = -`.
- Sink shown → `Sink Type = Single Bowl` (use `Double Bowl` only if drawing shows two bowls / "DBL").
  - **Sink Number** → sink model as printed, e.g. `PL-VS3018` or `PL-3088`.
  - **Sink Cutouts #** → `1` (count of sink outlines on this part).
  - **Distance from left (in)** → the dimension from the part's left end to the sink centreline
    (after orientation rule). Page 1 part ③: `67.25`.
  - **Distance from right (in)** → from the right end to sink centreline. Page 1 part ③: `43.5`.
  - **Sink length / width** → leave blank unless a sink size is printed.
  - If a dimension from the back edge to the sink is shown (e.g. `4"`), write it in Notes: `Sink 4" from back edge`.

**B. Tap Holes** (collapsed — click the title to open)
- Count the small hole circles next to the sink (ignore tiny dots).
  - Page 1 part ③: 3 holes (centre + 8" left + 8" right) → `Tap Holes # = 3`.
  - PL-3088 vanity sinks with one `o` → `Tap Holes # = 1`.
- **Hole Diameter** → leave blank unless printed.
- Per-hole **X offset** (along length, from sink centre; left = negative) and **Y offset** (leave blank unless printed):
  3-hole 8" spread → Hole 1 `X=-8`, Hole 2 `X=0`, Hole 3 `X=8`. Single hole → Hole 1 `X=0`.
- No sink → leave `-`.

**C. Sink Grooves** — leave `-` (drawings show none).

**D. Shape** — `Rectangle (default)` unless the part is drawn L- or U-shaped → pick `L-Shape` / `U-Shape`.

**E. Edge Dimensions** — four buttons around a dashed box: **Top**, **Left**, **Right**, **Bottom**.
Each click cycles: `—` → `Pencil Round` → `Flat Chamfer 1mm` → `Cut` → `Manual` → `—`.
Click each side until it shows the target (read the bold text on the button to confirm):

| Drawing symbol on that edge | Target | Clicks from `—` |
|---|---|---|
| `⊗` | Pencil Round | 1 |
| `×` | Manual | 4 |
| none / RAW | — | 0 |

Example page 1 part ③ (⊗ on all four sides) → Top, Bottom, Left, Right each clicked once.
Example page 1 part ② (⊗ left + bottom, × right, top plain) → Left 1, Bottom 1, Right 4, Top 0.

**F. Edge Polish** (above Edge Dimensions)
- **Edge Type** → `Machine` if any side is Pencil Round; `Manual` if only Manual sides; `Both` if both; else `None`.
- **Sides** is filled automatically from the side buttons — don't change it.
- **Manual Polish Note** → if any side is Manual: `Flat edge (stove polish)`.

**G. Radius / Corners**
- **Radius (inches)** → `0.125` if any `TR`, else blank.
- Tick the corner checkboxes (`↖ Top Left`, `↗ Top Right`, `↙ Bottom Left`, `↘ Bottom Right`) for each corner
  marked `TR`, using the orientation rule. Page 1 part ③ → all four.

**H. Matrix Family / Destination Review** — leave blank (all flats get qty 1).

**I. Notes** — same as grid notes; leave or add.

Click **`Save`** (bottom-right of the drawer). **If you close with ✕ / Cancel / clicking outside, everything
typed in the drawer is lost.** After saving, the row's *Sink / Edge / Radius* badges should show values
(e.g. `Single`, `Machine · 4s`, `×4`).

### 5.6 Save the page
1. Footer of Drawing Workspace shows: `N piece types × M flats = T total records`.
   **Check:** N = number of parts on the page, M = page `QTY=`, T = N × M.
2. Click **`Save Drawing (T pcs)`** (blue, bottom-right).
3. Browser alert `T pieces saved successfully!` → click **OK**.
4. Scroll down: the saved-parts table under the form now lists these pieces; the header card
   **Total Parts** increases by T.
5. Log the page and go to §5.1 for the next page.

---

## 6. Finish — STOP here

After page 44 is saved:
1. Scroll to the saved-parts table and confirm there are 44 distinct Drawing #s `DY-I-P01` … `DY-I-P44`.
2. Read **Total Parts** from the project header and add it to the log.
3. **Stop.** Do not approve, plan, export or change status. Leave the browser on the project page.
4. Output the log: one line per page (`page, drawing #, unit name, flats, part count, pcs saved, errors`).

---

## 7. Fraction → decimal

| Fraction | Decimal | Fraction | Decimal |
|---|---|---|---|
| 1/16 | .0625 | 9/16 | .5625 |
| 1/8 | .125 | 5/8 | .625 |
| 3/16 | .1875 | 11/16 | .6875 |
| 1/4 | .25 | 3/4 | .75 |
| 5/16 | .3125 | 13/16 | .8125 |
| 3/8 | .375 | 7/8 | .875 |
| 7/16 | .4375 | 15/16 | .9375 |
| 1/2 | .5 | | |

`22½"` = `22.5`, `21¼"` = `21.25`, `110 3/4"` = `110.75`.

---

## 8. Worked example — PDF page 1 (type A, QTY 6)

Header: Drawing # `DY-I-P01`, Unit Name `A`, Category `Kitchen`.
Matrix: Buildings `I`, Floors `1,2,3`; Floor 1 `101,122`, Floor 2 `201,222`, Floor 3 `301,322` (6 chips).

| Part # | Part Type | L | W | Sink | Taps | Edges (T/B/L/R) | Corners |
|---|---|---|---|---|---|---|---|
| DY-I-P01-1 | Kitchen - Perimeter Tops | 33 | 25.5 | — | — | T —, B Pencil, L Manual, R — | — |
| DY-I-P01-2 | Kitchen - Perimeter Tops | 30 | 25.5 | — | — | T —, B Pencil, L Pencil, R Manual | — |
| DY-I-P01-3 | Kitchen - Island Tops | 110.75 | 43.5 | Single, `PL-VS3018`, cut 1, left 67.25, right 43.5 | 3: X −8, 0, 8 | all Pencil Round | R 0.125, all 4 |
| DY-I-P01-A | Kitchen - Side Splash | 25.375 | 4 | — | — | per ⊗ marks | — |
| DY-I-P01-B | Kitchen - Side Splash | 23.25 | 4 | — | — | per ⊗ marks | — |

Footer should read `5 piece types × 6 flats = 30 total records` → **Save Drawing (30 pcs)**.

*(Edges for parts 1/2/A/B above are illustrative of the method — the agent must read each edge symbol from the PDF.)*

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| Part Type dropdown didn't take | Click the cell again, type fewer letters, **click** the option (don't press Enter). |
| Sq Ft shows `—` | Length/Width empty or has a fraction — retype as decimal. |
| Qty column editable instead of grey | Matrix has no chips — redo §5.3. |
| Footer total ≠ parts × QTY | A flat chip is missing/duplicate, or an extra blank row has a Part Type — fix before saving. |
| "Editing existing drawing …" amber banner appears | You clicked a saved row's load action. Click `Clear All`, redo the page. |
| Saved a page with mistakes | Don't delete. Log it as `NEEDS REVIEW <page>` and continue; a human will fix later. |
| Page spinner "Loading project..." for > 30 s | Refresh the browser, reopen the project from Projects list, resume at next unlogged page. |
