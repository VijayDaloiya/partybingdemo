# Party Bing design constraints

Use the supplied Party Bing artwork in public/logo.jpeg. The compact header arranges its original symbol and wordmark horizontally, with 5–6px vertical padding and 3% side padding. Service visibility is reversible: disabled services disappear from customer browsing and ordering while all products, photos, offers and history remain stored and editable in admin.

Extend the existing celebration storefront and practical admin workspace. Preserve the white surfaces, navy readable text, and purple brand accents; seasonal themes may remap storefront accents only. Admin controls use existing fields, dialogs, tables and navigation.

The public navbar and layered hero precede the service catalog. Hero artwork remains beneath text on mobile and desktop. Preserve hero margin 2px 2% 2px and padding 15px 7% 15px. No public team login button or demonstration banners. Homepage shows at most six featured packages; service pages paginate the full collection.

Merchandising: a visible Edit action on every product, explicit discount inheritance, accessible native theme radio buttons, inclusion disclosures, and textual wall/stand setup badges. Forms must show errors and preserve entered values on failed saves. Do not use color as the only indicator.

Seasonal palette tokens in public/theme.css map blue, rose, teal and amber primitives to --season-accent and --season-tint. Existing typography and layout tokens stay authoritative. Existing nav active indicator remains the admin signature; no extra motion is needed for these forms.

Product management now uses independent services and a required service dropdown. Product forms group identity/details, pricing and photos. IDs are immutable after creation; service and store-wide percentages override the fixed product discount price. Up to six uploaded images use the first as cover; retain a fallback illustration for products without photos. Customer-submitted reviews are moderated, and no ratings are fabricated.

User correction: product pricing contains original price and discount price only. Service offers override store offers; both calculate from original prices without stacking. Product cards show Trending at top-right and rating at top-left. Display the selected score as a simple star rating without a source label on product cards.

Public ordering now uses a short enquiry panel: phone, autofilled/editable occasion, fixed selected product, optional poster add-ons, and a custom request. Save the same details to CRM before opening the WhatsApp draft. No long public booking form or required name/address/date. Add-ons have no invented prices. Keep draft handoff distinct from message delivery and order confirmation.

Product cards should be compact: remove the public review link and repeated service eyebrow; keep name, mount tag, price and Order. Move description into the expandable inclusions section. Use a one-line star score without Admin rating or Customer rating labels.
