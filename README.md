# Party Bing

A runnable booking website and administrator CRM built with Node.js 24, SQLite, and a responsive browser UI. This repository was empty when implementation began; there was no pre-existing application or database to migrate. The new booking flow and CRM share one SQLite database.

## Run locally

Requires Node.js 24 or later. There are no third-party runtime dependencies and no package installation is required.

```powershell
npm run setup
# Optional, only with an empty customer database:
npm run demo
npm start
```

Open `http://127.0.0.1:3000`. Admin sign-in is at `/admin/login`, with CRM at `/admin/crm`. Setup generates a random owner password and saves sign-in details to `data/local-access.txt`, ignored by Git. Move the password to a password manager and remove that file when no longer needed. Re-running setup does not overwrite accounts.

The seeded database is marked as demonstration data internally; public banners have been removed for development. It adds three sample decoration packages and Vijay (Demo)'s September 3, 2026 booking. These are demonstration records, not actual bookings or approved catalog prices. Never contact the sample number. To start a separate real workspace, set `DATABASE_PATH` to a new file; run setup and add your actual products in admin. Do not seed demo data into a real database.

To configure the application, copy `.env.example` to `.env` and edit it. `.env` is ignored by Git. `DATABASE_PATH` defaults to `./data/party-bing.sqlite`; use persistent local storage, not an ephemeral serverless filesystem or a network-shared SQLite file.

Additional admins can be created with `npm run admin:create` after supplying `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (at least 12 characters), and `ADMIN_ROLE=admin` in the environment. Use `owner` only for staff authorized to merge records, erase data and change workspace settings. No default shared password is shipped.

## What is implemented

- Silent, 2.5-second celebration intro with balloons, confetti, sparkles, logo reveal, Skip Intro, session storage and reduced-motion handling. No audio APIs, files or permission prompts.
- Decoration catalog and booking request form, optional celebration information and separately optional marketing/reminder permissions. No birth-year or age fields.
- Stable customer IDs, normalized Indian/international phone numbers, duplicate detection, owner-only transactional merges and phone aliases for merged records.
- Booking snapshots preserve decoration names, themes, service and price when catalog products change or are archived. Confirmed/completed totals are computed from real records.
- CRM dashboard with all seven metrics, due-date filters, customer search, previous decoration, assignment and follow-up status.
- Customer profiles with preferences, private notes, booking history, contact permissions, annual occasions and actual activity timelines.
- Annual recurrence engine, unique occasion/year constraint, custom notice intervals, explicit leap-day policy, pause/disable, historical backfill and future reminder dates.
- Manual, editable WhatsApp messages; opening the link does not record contact. Confirmed contact, outcomes, notes, completion, snooze and assignment are persisted. “Asked to opt out” revokes consent in the same transaction.
- Private bearer opt-out links; old links remain valid across repeat bookings and merges. Links allow revocation only, never reading customer data.
- Admin authentication using salted scrypt hashes, random expiring HttpOnly/SameSite cookies, CSRF tokens, origin checks, write validation, request limits, CSP, owner permissions, consent records and audit entries.
- Retention review queue and owner-only erasure of direct identifiers and free-text customer notes. Financial booking snapshots remain. Review backups separately for erasure and expiry.

The sidebar includes every requested destination. Dashboard routes to the live CRM overview, and Services lists the catalog service categories. Media Library and Website Content are explicitly identified as unimplemented modules because no original CMS or media system was present. Optional email notifications and an automated WhatsApp integration are not configured; this implementation never sends messages automatically.

## Service catalog and featured packages

The homepage requests only featured packages (up to six) and a summary of available services. Service cards open dedicated URLs such as `/services/birthday-decoration`, `/services/anniversary-decoration`, and `/services/baby-shower-decoration`. Each service page fetches 12 active packages at a time, with shareable `?page=2` pagination and a link back to the other services. Archived products are excluded.

In **Admin → Products**, use **☆ Feature** or **★ Featured** to choose which packages appear on the homepage. The initial migration selects three existing packages; subsequent selections remain under admin control. Archiving a featured product removes its feature selection without changing booking history. Tests include a service with 105 packages.

## Scheduled reminders

The server runs a catch-up pass on startup and a server-side check every hour, which includes daily processing without depending on any browser or admin login. For unattended deployments, run the separate scheduler service with a process supervisor. It is safe for both processes to run: SQLite transactions and the `(customer_occasion_id, occasion_year)` unique constraint prevent duplicate tasks.

```powershell
npm run scheduler
```

For an external daily scheduler, invoke `node scripts/reminders.js` at least daily with the application's working directory and environment. On Windows, configure Task Scheduler to run the absolute Node executable with `scripts/reminders.js`, **Start in** this repository, **Run whether user is logged on or not**, and **Run task as soon as possible after a scheduled start is missed**. Keep the machine powered on. Task installation is not performed automatically.

On a Linux host, an example crontab entry is:

```cron
0 * * * * cd /srv/party-bing && /usr/bin/node scripts/reminders.js >> /var/log/party-bing-reminders.log 2>&1
```

The hourly invocation avoids scheduler-host timezone differences. Date calculations always use the business timezone, default `Asia/Kolkata`, configurable by the owner. A missed execution backfills every missing annual reminder after the occasion's capture year and retains due/overdue tasks for review. Old overdue tasks are not auto-completed or auto-contacted. New occasions begin reminding in the following year. The engine creates through the following calendar year and extends that horizon as time advances.

Reminder filters use the **effective follow-up date** (snooze date when set, otherwise scheduled date). The upcoming-celebration metric counts occasions in the next 30 days. “Due this week” means today plus the next six days. Completed history remains visible, even after an opt-out.

February 29 can map to February 28, March 1, or be skipped in non-leap years. The default is copied onto each new occasion. Changing a specific occasion's policy/interval recalculates outstanding tasks while preserving completed records. Pauses suppress new generation and dashboard tasks until their end date. Disabling an occasion retains its history but stops future reminders.

### Test the September example locally

Use a demonstration database, never a production database, for simulated future runs:

```powershell
npm run reminders -- 2027-08-20
npm run reminders -- 2028-08-20
npm run reminders -- 2028-08-20
```

The first command creates the August 20, 2027 reminder for September 3, 2027. The second extends future-year records; the third creates zero duplicates. The UI always uses the real business date, so select **All occasions** to inspect a simulated future reminder. The automated tests inject dates directly to verify the due-today dashboard metric.

## Verification

```powershell
npm run check
npm test
```

Tests use isolated in-memory databases. Fourteen tests cover all 13 requested acceptance scenarios plus timezone boundaries, leap policies, missed execution recovery, merges, erasure, request validation, paused/custom reminders, session security, CSRF, and owner authorization. The HTTP test starts an ephemeral localhost server and needs loopback network permission in restricted environments.

## Deployment

Docker Compose supplies a web process and a separate, restartable scheduler sharing a durable volume:

```sh
docker compose up -d --build
docker compose exec web node scripts/setup.js
docker compose exec web cat data/local-access.txt
```

For public use, put an HTTPS reverse proxy in front of the loopback-bound port and set `COOKIE_SECURE=true`. Keep the database volume private, encrypted at the host/storage layer, backed up and access-controlled. Set a real owner email, reviewed catalog, retention period, privacy contact channel and operational policies before collecting real customer data. The initial notice and controls support consent and privacy workflows but do not constitute a legal compliance certification.

No hosting account was supplied and no public deployment or OS-level scheduled task was created. The included Docker configuration must be launched on an always-on host for reminders to keep running when this development machine is off. Verify backups, logs, HTTPS and your organization's applicable Indian privacy/communication obligations for the actual deployment.

## Offers, themes, and product details

- **Admin → Offers & themes** sets a store-wide whole percentage (0–100) and one seasonal theme: Everyday, New Year, Wedding season, Janmashtami, or Diwali. Save applies both settings. Use Everyday to disable a seasonal theme and 0 to disable the store-wide offer.
- **Admin → Products → Edit** updates the name, service, base price, artwork palette, description, inclusions (one per line), installation (wall, stand, or both), and optional product discount.
- Product pricing has an original price and optional discount price. An active service percentage overrides the store-wide percentage, and either overrides the product discount price. Percentages apply to original prices and never stack. Use 0 to disable an override.
- Booking requests calculate prices on the server. Stale prices shown in an open form are rejected with instructions to refresh. Existing booking prices, names, inclusions, and setup types remain saved when catalog details change.
- `node scripts/sample-product-details.js` fills missing inclusion lists and setup tags for the seven existing sample products only. It does not overwrite edited details. Other legacy products display “Setup to be confirmed” until edited.
- New metadata lives in `product_details` and `booking_product_details`; opening an existing database creates these tables without replacing products or bookings.

## Service management, photos, and customer reviews

- **Admin → Services → Add service** creates a named service and optional description. Empty services have their own public page. Existing service names are retained during database migration.
- **Admin → Products → Add product / Edit** uses a dropdown of available services. Product IDs can be supplied on creation (3–64 letters, digits, hyphens or underscores), or generated automatically. IDs stay fixed after creation.
- Original prices and optional discount prices use whole rupees. Discount price cannot exceed original price. Product percentage inputs are retired; old percentage offers are migrated to fixed discount prices.
- Upload up to six JPG, PNG or WebP images (2 MB each). Preview, remove, and choose a cover before saving. Uploads are stored in SQLite, so database backups include photos. Image writes require an authenticated admin and CSRF token; invalid image types, oversized uploads, and references to another product’s images are rejected.
- Customers can submit a display name, 1–5 rating and review from product cards. Submissions start pending. **Admin → Reviews** can approve or hide them. Only approved reviews appear publicly or contribute to the average; no example reviews or ratings are generated. Submission is rate limited, but is not restricted to verified purchasers.

- **Product badges:** Edit a product to toggle Trending (top-right) and set an optional 1–5 admin rating (top-left, labelled Admin rating). With no admin rating, the approved customer average appears, or Not rated. Admin scores do not change customer reviews or review counts.
- **Category offers:** Admin → Services → Edit offer sets the service-wide percentage. Pricing priority is service offer, store-wide offer, product discount price, then original price. Existing booking snapshots remain unchanged.

## Short WhatsApp order enquiries

Each public product has **Add-ons & order**. The short panel needs only a phone number and occasion; product and current decoration price are filled automatically. Customers can select any of the 18 add-ons from the supplied Party Bing poster and enter a custom request. Add-on prices are not invented or included in the decoration quote.

**Send on WhatsApp** first saves an enquiry and customer activity, then opens a prepared message addressed to +91 7385622113 (the poster's business number). The customer still presses Send in WhatsApp. A visible fallback link is provided if the browser blocks the new tab. This is a draft handoff, not a WhatsApp delivery integration; the CRM never assumes delivery.

The matching record is in **Admin → Orders & enquiries** and the customer’s activity history. Admins can mark new, contacted, confirmed or cancelled. No event dates, names or marketing consent are invented, and no annual reminders are created. Retrying the same request does not duplicate it. Customer merge and erasure cover enquiry data. Previous bookings and reminders retain their existing workflows.
