# Archie — Security & Anti-Sharing Guide (for operators)

> Plain-language guide to the features that detect VPN-key sharing and let you act
> on it. No engineering knowledge needed.

## The problem these features solve

A VPN key is meant for one customer. People share or resell keys. Archie's job is to
tell you **when a key is probably being shared** and give you a **one-click way to deal
with it** — without you having to read raw logs.

**What Archie can see:** the **public IP** of each connection, and from that IP its
country/region, the network/ISP it belongs to, and whether it's mobile, fixed-line, or
a datacenter. **What it cannot see:** the actual device, the person, or a cell tower —
those don't exist in the data. So everything below reasons about *networks*, not devices.

All of this lives on the **Devices** page.

---

## 1. Connection identity — what we know about each IP

Every IP a key connects from is grouped by its **network** (its ISP), and tagged with
**why it's trusted**:

| Tag | Meaning |
|---|---|
| **known** | Imported from the key's normal history when tracking started — an established IP. |
| **vouched** | You manually approved (Kept) it. |
| **trusted ISP** | Auto-approved because it's the same network as one already approved. |
| **auto** | First-seen, not yet verified. |

This is why the page can say "this is a *new* network" with confidence — it knows which
networks are part of the key's established baseline and which just appeared.

---

## 2. Security Posture — the protection level, per key

Each key has a **posture**: a setting that decides what counts as "normal" for it. You
pick one of three levels from the **dropdown on every key row** (Devices page):

| Posture | Allows | Use it for |
|---|---|---|
| **Strict** | 1 network, home country only, blocks new ISPs and datacenter IPs | a key you know is a single device |
| **Balanced** *(default)* | up to 2 networks at once, warns on a new ISP/country | most keys |
| **Open** | no limits — nothing is flagged | your own key, or power users |

New keys start at **Balanced**, so every key is protected out of the box. Setting a key
to **Open turns its protection off** — only do that deliberately.

---

## 3. How the defense works — the Devices page

The page is built around **exceptions**, not inventory. It sorts every key into:

- **Needs review** (top) — keys breaking their posture, shown in plain English
  ("Live from US and RU at the same time", "New network — posture blocks new ISPs").
  Each gives you the action that fixes it:
  - **Keep** the network (you vouch for it — it stops flagging), or
  - **Block** the network (drops it), or
  - change the **posture**, or
  - **Investigate** → drill into the networks, IPs, and the connection log.
- **In posture** (collapsed) — everything that's fine. You never have to look at it.

So the answer to "what do I do here?" is always: *handle the keys in Needs review.*

> **Today this is detection + one click.** Archie shows you what's wrong and you press
> the button. Automatic blocking (the system acting on its own) is a later step.

---

## 4. Location intelligence — where a connection is from

For each IP, Archie shows an **area** (city + region, e.g. "West Palm Beach, Florida"),
whether it's **mobile or fixed-line**, and — importantly — whether it's a
**datacenter / proxy** IP.

A real customer connects from home or their phone. A key connecting from a **datacenter**
almost always means someone is **reselling it through a server** — the strongest sharing
signal we have. Under **Strict** this is a hard flag; under **Balanced** it's a review.

> Accuracy note: this is IP-based location — good to the **region/metro**, not a precise
> address. For mobile it reflects the carrier's gateway, not the exact spot.

---

## 5. Impossible travel — one key, two places at once

If a key is **live from two places too far apart to be one person at the same moment**
(e.g. London and Florida in the same minute), Archie flags **impossible travel**. This is
physically impossible for one user, so it's a clear sign two people share the key. It's
**always on**, regardless of posture.

---

## What Archie honestly cannot catch

So you know the limits:

- **Same-network sharing** — handing the key to a neighbour on the same ISP looks
  identical to your own second device.
- **Time-shifted sharing** — you in the morning, a friend at night, never at the same time.
- **Cell-tower / exact GPS location** — only the phone carrier has that.
- **Per-connection data usage** — the VPN logs connections, not bytes per connection.

The robust defence against the uncatchable cases is the **concurrent-network limit**
(the Max-networks posture rule): a shared key throttles itself whether or not we detect it.
