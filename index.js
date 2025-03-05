const express = require('express');
const axios = require('axios');
const xmlJs = require('xml-js');
const { parse } = require('json2csv');
const geoip2 = require('geoip2-node').GeoIP2;
const app = express();
const port = process.env.PORT || 3000;

const MAXMIND_ACCOUNT_ID = process.env.MAXMIND_ACCOUNT_ID || '1131107';
const MAXMIND_LICENSE_KEY = process.env.MAXMIND_LICENSE_KEY; // Must be set in Render
const API_KEY = process.env.API_KEY || 'abc123XYZ!'; // Match your key

app.use(express.json());
app.use(express.static('public'));

const client = new geoip2(MAXMIND_ACCOUNT_ID, MAXMIND_LICENSE_KEY);

const getGeoData = async (ip) => {
  if (!MAXMIND_LICENSE_KEY) {
    throw new Error('MaxMind license key not configured');
  }
  try {
    console.log(`Attempting MaxMind GeoIP2 Insights lookup for IP: ${ip}`);
    const response = await client.insights(ip);
    console.log(`GeoIP2 Insights response for ${ip}:`, JSON.stringify(response, null, 2));

    // Map MaxMind fields to your desired output
    const geo = {
      status: 'success',
      query: ip,
      continent: response.continent?.names?.en || 'Unknown',
      continentCode: response.continent?.code || 'N/A',
      country: response.country?.names?.en || 'Unknown',
      countryCode: response.country?.iso_code || 'N/A',
      euCountry: response.country?.is_in_european_union ? 'Yes' : 'No', // Derived from is_in_european_union
      registeredCountry: response.registered_country?.names?.en || 'Unknown',
      euRegisteredCountry: response.registered_country?.is_in_european_union ? 'Yes' : 'No', // Derived
      representedCountry: response.represented_country?.names?.en || 'Unknown',
      localizedNames: response.country?.names || {}, // Object with localized names
      network: response.traits?.network || 'N/A', // May require GeoIP2 Enterprise or custom mapping
      subdivisions: response.subdivisions?.map(sub => ({
        name: sub.names?.en || 'Unknown',
        iso_code: sub.iso_code || 'N/A'
      })) || [],
      city: response.city?.names?.en || 'Unknown',
      postalCode: response.postal?.code || '',
      lat: response.location?.latitude || 0,
      lon: response.location?.longitude || 0,
      accuracyRadius: response.location?.accuracy_radius || 0, // In kilometers
      timeZone: response.location?.time_zone || 'Unknown',
      connectionType: response.traits?.connection_type || 'Unknown',
      metroCode: response.location?.metro_code || '', // US only, may be empty
      mobileCountryCode: response.traits?.mobile_country_code || '', // May not be available in Insights
      mobileNetworkCode: response.traits?.mobile_network_code || '', // May not be available in Insights
      isp: response.traits?.isp || 'Unknown',
      org: response.traits?.organization || 'Unknown',
      asNumber: response.traits?.autonomous_system_number || 0,
      asOrganization: response.traits?.autonomous_system_organization || 'Unknown',
      domain: response.traits?.domain || 'Unknown',
      anonymizerType: response.traits?.is_anonymous ? 'Anonymous' : 'Not Anonymous', // Simplified
      staticIPScore: 0, // Not directly available, may require custom logic or Enterprise
      userCount: 0, // Not directly available, may require custom logic or Enterprise
      userType: response.traits?.user_type || 'Unknown',
      confidenceFactors: {}, // Not directly available, may require custom logic or Enterprise
      averageIncome: '', // US only, not directly available in Insights, may require Enterprise
      populationDensity: '' // US only, not directly available in Insights, may require Enterprise
    };

    // Fall back to ip-api.com for missing fields if needed (optional, depending on MaxMind data)
    if (!geo.city || !geo.subdivisions.length) {
      console.log(`Falling back to ip-api.com for ${ip} due to missing data`);
      const fallback = await axios.get(`http://ip-api.com/json/${ip}`);
      const fbData = fallback.data;
      if (fbData.status === 'success') {
        geo.continent = fbData.continent || geo.continent;
        geo.continentCode = fbData.continentCode || geo.continentCode;
        geo.country = fbData.country || geo.country;
        geo.countryCode = fbData.countryCode || geo.countryCode;
        geo.region = fbData.region || geo.region;
        geo.regionName = fbData.regionName || geo.regionName;
        geo.city = fbData.city || geo.city;
        geo.district = fbData.district || geo.district;
        geo.zip = fbData.zip || geo.postalCode;
        geo.lat = fbData.lat || geo.lat;
        geo.lon = fbData.lon || geo.lon;
        geo.timezone = fbData.timezone || geo.timeZone;
        geo.offset = fbData.offset || geo.offset || 0;
        geo.currency = fbData.currency || geo.currency;
        geo.isp = fbData.isp || geo.isp;
        geo.org = fbData.org || geo.org;
        geo.as = fbData.as || geo.asNumber;
        geo.asname = fbData.asname || geo.asOrganization;
        geo.mobile = fbData.mobile || false;
        geo.proxy = fbData.proxy || false;
        geo.hosting = fbData.hosting || false;
      }
    }

    return geo;
  } catch (err) {
    console.error(`MaxMind GeoIP2 error for ${ip}: ${err.message}`);
    // Fall back to ip-api.com as a last resort
    console.log(`Falling back to ip-api.com for ${ip}`);
    const fallback = await axios.get(`http://ip-api.com/json/${ip}`);
    const fbData = fallback.data;
    if (fbData.status === 'fail') {
      return null;
    }
    return {
      status: fbData.status,
      query: fbData.query,
      continent: fbData.continent || 'Unknown',
      continentCode: fbData.continentCode || 'N/A',
      country: fbData.country || 'Unknown',
      countryCode: fbData.countryCode || 'N/A',
      euCountry: '', // Derive if possible, but not directly from ip-api
      registeredCountry: fbData.country || 'Unknown', // Simplified assumption
      euRegisteredCountry: '', // Derive if possible, not from ip-api
      representedCountry: fbData.country || 'Unknown', // Simplified assumption
      localizedNames: {}, // Not available from ip-api
      network: 'N/A', // Not available from ip-api
      subdivisions: [{ name: fbData.regionName || 'Unknown', iso_code: fbData.region || 'N/A' }],
      city: fbData.city || 'Unknown',
      postalCode: fbData.zip || '',
      lat: fbData.lat || 0,
      lon: fbData.lon || 0,
      accuracyRadius: 0, // Not available from ip-api
      timeZone: fbData.timezone || 'Unknown',
      connectionType: 'Unknown', // Not available from ip-api
      metroCode: '', // Not available from ip-api
      mobileCountryCode: '', // Not available from ip-api
      mobileNetworkCode: '', // Not available from ip-api
      isp: fbData.isp || 'Unknown',
      org: fbData.org || 'Unknown',
      asNumber: fbData.as || 0,
      asOrganization: fbData.asname || 'Unknown',
      domain: 'Unknown', // Not available from ip-api
      anonymizerType: fbData.proxy ? 'Proxy' : 'Not Anonymous',
      staticIPScore: 0, // Not available from ip-api
      userCount: 0, // Not available from ip-api
      userType: 'Unknown', // Not available from ip-api
      confidenceFactors: {}, // Not available from ip-api
      averageIncome: '', // Not available from ip-api
      populationDensity: '' // Not available from ip-api
    };
  }
};

app.get('/', (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

app.get('/json/:ip?', async (req, res) => {
  const ip = req.params.ip || req.ip;
  const data = await getGeoData(ip);
  if (!data) return res.status(404).json({ status: 'fail', message: 'IP not found' });
  res.json(data);
});

app.get('/xml/:ip?', async (req, res) => {
  const ip = req.params.ip || req.ip;
  const data = await getGeoData(ip);
  if (!data) return res.status(404).send('<response><status>fail</status><message>IP not found</message></response>');
  const xml = xmlJs.js2xml({ response: data }, { compact: true, spaces: 2 });
  res.set('Content-Type', 'application/xml');
  res.send(xml);
});

app.get('/csv/:ip?', async (req, res) => {
  const ip = req.params.ip || req.ip;
  const data = await getGeoData(ip);
  if (!data) return res.status(404).send('status,message\nfail,IP not found');
  const csv = parse([data], { fields: Object.keys(data) });
  res.set('Content-Type', 'text/csv');
  res.send(csv);
});

const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  message: { status: 'fail', message: 'Too many requests from this IP' }
});

app.use(limiter);

const checkApiKey = (req, res, next) => {
  const key = req.query.key || req.headers['x-api-key'];
  if (!key || key !== API_KEY) {
    return res.status(401).json({ status: 'fail', message: 'Invalid API key' });
  }
  next();
};

app.get('/json/:ip?', checkApiKey, async (req, res) => { /* ... */ });
app.get('/xml/:ip?', checkApiKey, async (req, res) => { /* ... */ });
app.get('/csv/:ip?', checkApiKey, async (req, res) => { /* ... */ });

app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});