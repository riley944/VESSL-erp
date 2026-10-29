# Freight RFQs: a guide for ops

How to ask forwarders for freight prices in VESSL, record what they send back,
and pick a winner. Everything happens on the **Shipments** page, under the
**Freight Quotes** tab. Words in **bold** are exactly what you see on screen.

---

## 1. Create the RFQ

1. Open **Shipments** in the left-hand menu and click **+ Freight Quote** (top right).
2. Choose **Generate from PO** or **Generate from Product**, then search and click **Select →**.
3. Check the details: **Client \***, **Cargo Ready Date**, **Origin**, **Destination**, **Incoterm**.
   Leave **Freight Forwarder** empty. It fills in by itself when you send.
4. Under **Container to fill**, pick the container size, or **LCL** (less than a container).
5. In **Carton / CBM breakdown**, check each line: **Pcs/ctn**, **Cartons**, **CBM/ctn**, **Kg/ctn**.
   **⚡ Auto-fill container** fills the container to capacity; **+ Add line** adds a product.
6. Add anything the forwarder must know in **Notes for forwarder**. It prints on the sheet and in the email.
7. Click **Save draft**. The quote appears as a card with its own number (the **Quote #**).

> **Generate & Send** does *not* email anyone. It saves the quote as sent and
> opens the printable freight sheet. To email forwarders, use **RFQ** (step 2).

`[Screenshot: New Freight Quote form]`

## 2. Pick contacts and send

1. On the quote's card, click **RFQ**. The **Request forwarder quotes** window opens.
2. Under **Send to**, tick one or more contacts **at one forwarder**. Ticking someone
   at a second forwarder clears the first: forwarders never see who else was asked.
   (**PRIMARY** marks the main contact.)
3. Someone not in Companies? Type their address in **Or type an address…** and click **Use**.
   No forwarder is recorded on the quote in that case.
4. Click **Send to [name]**, or **Send to N contacts**. A green note says **RFQ sent to …**.
5. To ask a second forwarder, click **Duplicate** on the card, then **RFQ** on the copy.
   One quote = one forwarder. Duplicates are grouped, so picking a winner later
   closes the others.

The window's own description still says the email "opens" for you to attach the
file. That is out of date: **Send** emails it, with the sheet attached.

**What the forwarder receives:** an email from *King Universal Freight
<rfq@vessl.io>*, subject *Freight quote request — [Quote #] ([origin] → [destination])*.
It has the route, equipment, cargo, incoterm, ready date and your notes. The
fillable Excel sheet is attached.

**Where replies go:** when the forwarder clicks Reply, it goes to **Kristy and Monica**
(the email also names you both). Both of you also get a hidden copy of every RFQ sent.
Nothing goes to rfq@vessl.io: that address cannot receive mail.

**Download sheet** gives you the same Excel file without sending anything.

`[Screenshot: Request forwarder quotes window, two contacts ticked]`

## 3. When a reply arrives

Every bid ends up under the quote's **Forwarder quotes** window: click the
middle of the card (it reads **… bids in — compare & select**).

### A. Import the filled Excel sheet (preferred)

1. Save the attachment from the email.
2. On **Freight Quotes**, click **Import reply** (next to the search bar).
3. Click **Tap to choose the returned .xlsx file** and pick the file.
4. Check the preview: forwarder, rates per container size, destination
   charges, **Effective per [size]**, **Valid until**.
5. Tick **All-in price (no additional fees)** only if the forwarder quoted one total (see section 4).
6. Click **Save bid**. Use **Different file** for the next one, then **Done**.

**What the sheet must look like:**
- It must be *our* sheet, sent back. Cell **B2** holds the RFQ ID (marked "do not edit"). If it is changed or deleted, the import cannot match the quote.
- **Your company name** and **Contact email** filled in.
- Container quotes: one row per size (**20' Standard**, **40' Standard**, **40' High-Cube**, **45' High-Cube**). The size you asked for is marked **← requested**.
- LCL: one number in **LCL all-in total for this shipment (USD)**, row 22.
- Destination charges in their section (counted in the total). If-needed fees in theirs (recorded, **not** counted).
- **Rate valid until (YYYY-MM-DD)** and **Forwarder notes** as needed.
- Only .xlsx files can be imported. A PDF or a different spreadsheet has to be entered by hand.

### B. Enter a bid by hand

Use this when the forwarder replied in the email body, sent a PDF, or the import refuses the file.

1. Open the card's **Forwarder quotes** window and click **+ Add bid by hand**.
2. Fill **Forwarder \*** and **Ocean per [size], USD \*** (plus origin and destination charges if given),
   or tick **All-in price (no additional fees)** and fill the one total.
3. Add **Carrier**, **Transit days**, **Valid until**, **Notes** if known. Click **Save bid**.

Type money as one number, e.g. *1850* or *$1,850.00*.

`[Screenshot: Import forwarder reply, preview of a parsed sheet]`

## 4. What's new (23 Oct)

- **All-in bids.** For a forwarder quoting one price with no extra fees, tick
  **All-in price (no additional fees)**, either on import or by hand. The bid shows an
  **ALL-IN** tag, and only that one total is kept (no breakdown).
- **Several contacts per RFQ.** Tick as many people at one forwarder as you like. One email goes to all of them.
- **Searchable Apply-bid picker.** In **Forwarder quotes**, **Apply to quote →** opens
  **Apply bid to quote**. Under **Product quote**, type a quote ID, SKU, product or client and
  pick from the list. Nothing is pre-chosen. The quote this RFQ came from is listed first, tagged **LINKED**.
  **Apply to quote** spreads the bid over each unit, onto every pricing tier of that
  product quote. Not available for LCL bids.
- **Landed-cost panel.** Under each bid: **Landed freight + fees ≈ $X · $Y/unit**.
  Click **Breakdown** to see:

  | Line | What it means |
  |---|---|
  | **Goods value (fee base)** | Quantity × unit cost of the goods. Used only to work out the fees; **not in the total**. |
  | **Freight** | This bid's freight for the whole shipment. |
  | **MPF** | US Customs merchandise processing fee: a % of goods value, held between a set minimum and maximum. |
  | **HMF** | Harbor maintenance fee: a % of goods value. |
  | **Duty** | Each product's value × its duty %. |
  | **DIS** | A % of MPF + HMF + duty. |
  | **Insurance** | Insurance % on the insured value (goods + freight + fees, raised by the "insured value" %). |
  | **Landed freight + fees** | Freight + MPF + HMF + duty + DIS + insurance: what getting the goods here adds on top of their cost. |
  | **Freight + fees per unit** | That total ÷ the number of units. |

  **Landed — incomplete** means something is missing; the panel says what (a unit cost
  or duty % to type in, or no freight on the bid). Anything you type here is not saved.
  For an all-in bid, the fees show as **included**. It is an estimate.

  The rates are edited on **KUI Banking** in the left-hand menu (admin and staff),
  section **Landed cost rates** → **Save rates**. (The panel's note says "Settings";
  KUI Banking is where they are.)

`[Screenshot: Forwarder quotes window with an ALL-IN bid and the landed-cost breakdown open]`
`[Screenshot: KUI Banking → Landed cost rates]`

## 5. Duplicate, edit, choose the winner, and the Monday reminder

- **Duplicate** (copy icon on the card) makes a new draft with the same cargo and no forwarder, for the next forwarder.
- **Edit** (pencil icon) opens **Edit Freight Quote**. Fix details and click **Save changes**.
  The **Quote #** never changes, because forwarders quote against it.
- **Sheet** (page icon) opens the printable freight quote.
- **Choosing the winner:**
  - In **Forwarder quotes**, click **Select winner** on the best bid (**BEST** marks the cheapest).
  - Or click **Mark winner** on the card. The other RFQs for the same shipment become **Not selected**.
  - **Undo award** and **Reopen** reverse these.
- **Archive and delete:** a sent quote, or one with bids, can only be archived (box icon). It stays readable under the **Archived** filter. Only an unsent draft with no bids can be deleted.

**Monday reminder.** Every Monday morning, Kristy and Monica (Matt copied) get an
email listing RFQs that were **sent 2 or more days ago and still have no bid recorded**:

- **Awaiting reply**: 2 to 7 days.
- **Worth chasing**: 8 to 21 days.
- **Stale — needs a decision, not a chase**: 22 days or more.
- **No forwarder recorded — assign one**: sent to a typed address, so nobody to chase.

No email is sent when nothing is outstanding. To clear an RFQ from the list, record its bid,
or mark it **Not selected** or archive it.

`[Screenshot: Freight Quotes card with RFQ, Edit, Sheet, Duplicate, Mark winner]`

## 6. Errors and what they mean

| Message | What to do |
|---|---|
| **Pick a contact to send this RFQ to.** | Tick a contact, or type an address and click **Use**. |
| **No contact on file — add one under Companies to send here.** | Add a contact with an email to that forwarder in **Companies**. |
| **This quote is recorded as sent to [forwarder]…** | You are sending to a different forwarder. Cancel and use **Duplicate** instead. |
| **The RFQ was NOT sent. …** | Nothing went out and the quote is unchanged. Read the reason, then try again. |
| **Your session has expired — sign in again before sending.** | Sign out and back in, then send. |
| **The RFQ was sent to …, but recording it failed** | The email went. The card still says draft: tell Matt. Do not resend. |
| **This file does not match any freight quote — the RFQ ID cell (B1) is missing or was edited.** | The RFQ ID was changed or the file is not our sheet. The ID is actually in **B2**, not B1. Enter the bid by hand. |
| **This is an LCL RFQ, and row 22 … does not hold one clear all-in total** | Use **+ Add bid by hand** with the total. |
| **This sheet has no total for a [size], so it cannot be saved as an all-in price.** | Untick all-in, or enter the bid by hand. |
| **Could not read that file: …** | Not a readable .xlsx. Ask for the sheet again, or enter by hand. |
| **Enter the ocean freight per [size] as one amount…** / **Enter the all-in total as one amount…** | Type one number, no words or ranges. |
| **That quote has no pricing tiers yet — add a tier first, then apply.** | Add a quantity tier to the product quote, then **Apply to quote** again. |
| **This RFQ cannot be deleted.** | It was sent or has bids. Use **Archive** instead. |
