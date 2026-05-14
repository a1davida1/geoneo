/**
 * Programmatic Page Generator
 *
 * Deterministic, no-LLM page template generation for location + service pages.
 * Designed for high-volume programmatic SEO (city + service, neighborhood + service, etc.).
 *
 * Output is clean, schema-rich HTML + metadata ready for static generation or CMS injection.
 */

function normalize(input) {
  return String(input || '').trim();
}

function slugify(str) {
  return normalize(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function titleCase(str) {
  return normalize(str).replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generate a location + service page template.
 */
function generateLocationServicePage({
  businessName,
  city,
  state,
  service,
  industry,
  phone = '',
  address = '',
  yearsInBusiness = '',
  schemaType = 'LocalBusiness',
  baseUrl = 'https://example.com'
}) {
  const formattedCity = titleCase(city);
  const formattedState = state.toUpperCase();
  const formattedService = titleCase(service);
  const formattedIndustry = titleCase(industry || service);
  const formattedName = normalize(businessName) || `${formattedService} in ${formattedCity}`;
  const safeName = escapeHtml(formattedName);
  const safeCity = escapeHtml(formattedCity);
  const safeState = escapeHtml(formattedState);
  const safeService = escapeHtml(formattedService);

  const slug = slugify(`${formattedService} ${formattedCity} ${formattedState}`);
  const title = `${formattedService} in ${formattedCity}, ${formattedState} | ${formattedName}`;
  const metaDesc = `Expert ${formattedService.toLowerCase()} in ${formattedCity}, ${formattedState}. ${yearsInBusiness ? `${yearsInBusiness} years serving the area. ` : ''}Call ${phone || 'today'} for fast, reliable service.`;

  const schema = {
    '@context': 'https://schema.org',
    '@type': schemaType,
    name: formattedName,
    address: address ? {
      '@type': 'PostalAddress',
      streetAddress: address,
      addressLocality: formattedCity,
      addressRegion: formattedState
    } : undefined,
    telephone: phone || undefined,
    areaServed: {
      '@type': 'City',
      name: formattedCity
    },
    description: metaDesc
  };

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${metaDesc}">
  <link rel="canonical" href="${escapeHtml(baseUrl)}/${escapeHtml(slug)}">
  <script type="application/ld+json">${JSON.stringify(schema, null, 2)}</script>
</head>
<body>
  <header>
    <h1>${escapeHtml(formattedService)} in ${escapeHtml(formattedCity)}, ${escapeHtml(formattedState)}</h1>
    ${phone ? `<a href="tel:${escapeHtml(phone.replace(/[^\d+]/g, ''))}" class="cta-phone">${escapeHtml(phone)}</a>` : ''}
  </header>

  <main>
    <section>
      <h2>Professional ${escapeHtml(formattedService)} Services in ${escapeHtml(formattedCity)}</h2>
      <p>${escapeHtml(formattedName)} has been providing trusted ${escapeHtml(formattedService.toLowerCase())} throughout ${escapeHtml(formattedCity)} and the surrounding ${escapeHtml(formattedState)} area${yearsInBusiness ? ` for ${escapeHtml(yearsInBusiness)}` : ''}.</p>
    </section>

    <section>
      <h2>Why Choose Us for ${safeService} in ${safeCity}?</h2>
      <ul>
        <li>Local experts who know ${safeCity} inside and out</li>
        <li>Fast response times across the ${formattedCity} metro</li>
        <li>Transparent pricing with no hidden fees</li>
        <li>Fully licensed, bonded, and insured</li>
      </ul>
    </section>

    <section>
      <h2>Service Areas</h2>
      <p>We proudly serve all neighborhoods in ${formattedCity} and nearby communities in ${formattedState}.</p>
    </section>
  </main>

  <footer>
    <p>&copy; ${new Date().getFullYear()} ${safeName}. All rights reserved.</p>
  </footer>
</body>
</html>`;

  return {
    slug,
    title,
    metaDescription: metaDesc,
    html,
    schema,
    url: `https://example.com/${slug}`
  };
}

module.exports = {
  generateLocationServicePage,
  slugify,
  titleCase
};