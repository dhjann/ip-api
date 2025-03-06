const express = require('express');
const axios = require('axios');
const xmlJs = require('xml-js');
const { parse } = require('json2csv');
const maxmind = require('maxmind');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');

const app = express();
const port = process.env.PORT || 3000;

// Environment variables
const API_KEY = process.env.API_KEY || 'abc123XYZ!';
const PRO1_KEY = process.env.PRO1_KEY || 'pro1-5f4dcc3b5aa765d61d8327deb882cf99';
const PRO2_KEY = process.env.PRO2_KEY || 'pro2-8f14e45fceea167a5a36dedd4bea2543';
const MAXMIND_USER_ID = process.env.MAXMIND_USER_ID || 'your-user-id';
const MAXMIND_LICENSE_KEY = process.env.MAXMIND_LICENSE_KEY || 'your-license-key';

// Initialize cache for key management
const cache = new NodeCache({ stdTTL: 0, checkperiod: 120 });
cache.set(API_KEY, { tier: 'free', email: 'free-user@example.com' });
cache.set(PRO1_KEY, { tier: 'pro1', email: 'pro1-user@example.com' });
cache.set(PRO2_KEY, { tier: 'pro2', email: 'pro2-user@example.com' });

// MaxMind database initialization
let maxmindDb;
(async () => {
  try {
    maxmindDb = await maxmind.open('./GeoIP2-City.mmdb', {
      userId: MAXMIND_USER_ID,
      licenseKey: MAXMIND_LICENSE_KEY
    });
    console.log('MaxMind database loaded successfully');
  } catch (err) {
    console.error('Error loading MaxMind database:', err.message);
  }
})();

// Tier configurations
const TIER_CONFIG = {
  free: {
    maxRequests: 100,
    fields: ['status', 'query', 'country', 'city', 'lat', 'lon', 'timezone', 'isp']
  },
  pro1: {
    maxRequests: 1000,
    fields: null // All fields
  },
  pro2: {
    maxRequests: 10000,
    fields: null // All fields
  }
};

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Rate limiting per tier
const rateLimiters = {
  free: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: TIER_CONFIG.free.maxRequests,
    message: { status: 'fail', message: 'Too many requests from this IP for free tier' }
  }),
  pro1: rateLimit({
    windowMs: 15 * 60 * 1000,
    max: TIER_CONFIG.pro1.maxRequests,
    message: { status: 'fail', message: 'Too many requests from this IP for Pro Tier 1' }
  }),
  pro2: rateLimit({
    windowMs: 15 * 60 * 1000,
    max: TIER_CONFIG.pro2.maxRequests,
    message: { status: 'fail', message: 'Too many requests from this IP for Pro Tier 2' }
  })
};

// Check API key and apply rate limiting
const checkApiKey = (req, res, next) => {
  const key = req.query.key || req.headers['x-api-key'];
  const user = cache.get(key);
  if (!user) {
    return res.status(401).json({ status: 'fail', message: 'Invalid API key' });
  }
  req.user = user;
  const limiter = rateLimiters[user.tier] || rateLimiters.free;
  limiter(req, res, next);
};

// Get geolocation data from ip-api.com (free tier)
const getGeoDataIpApi = async (ip) => {
  try {
    console.log(`Attempting ip-api.com lookup for IP: ${ip}`);
    const response = await axios.get(`http://ip-api.com/json/${ip}`);
    const data = response.data;
    if (data.status === 'fail') {
      console.error(`ip-api.com error for ${ip}: ${data.message}`);
      return null;
    }
    console.log(`ip-api response for ${ip}:`, JSON.stringify(data, null, 2));
    return {
      status: data.status,
      query: data.query,
      continent: data.continent || 'Unknown',
      continentCode: data.continentCode || 'N/A',
      country: data.country || 'Unknown',
      countryCode: data.countryCode || 'N/A',
      region: data.region || 'Unknown',
      regionName: data.regionName || 'Unknown',
      city: data.city || 'Unknown',
      district: data.district || '',
      zip: data.zip || '',
      lat: data.lat || 0,
      lon: data.lon || 0,
      timezone: data.timezone || 'Unknown',
      offset: data.offset || 0,
      currency: data.currency || 'Unknown',
      isp: data.isp || 'Unknown',
      org: data.org || 'Unknown',
      as: data.as || 'Unknown',
      asname: data.asname || 'Unknown',
      mobile: data.mobile || false,
      proxy: data.proxy || false,
      hosting: data.hosting || false
    };
  } catch (err) {
    console.error(`ip-api.com error for ${ip}: ${err.message}`);
    return null;
  }
};

// Get geolocation data from MaxMind (Pro tiers)
const getGeoDataMaxMind = async (ip) => {
  try {
    if (!maxmindDb) throw new Error('MaxMind database not initialized');
    console.log(`Attempting MaxMind lookup for IP: ${ip}`);
    const lookup = await maxmindDb.city(ip);
    console.log(`MaxMind response for ${ip}:`, JSON.stringify(lookup, null, 2));
    return {
      status: 'success',
      query: ip,
      continent: lookup.continent?.names?.en || 'Unknown',
      continentCode: lookup.continent?.code || 'N/A',
      country: lookup.country?.names?.en || 'Unknown',
      countryCode: lookup.country?.iso_code || 'N/A',
      region: lookup.subdivisions?.[0]?.iso_code || 'Unknown',
      regionName: lookup.subdivisions?.[0]?.names?.en || 'Unknown',
      city: lookup.city?.names?.en || 'Unknown',
      district: '',
      zip: lookup.postal?.code || '',
      lat: lookup.location?.latitude || 0,
      lon: lookup.location?.longitude || 0,
      timezone: lookup.location?.time_zone || 'Unknown',
      offset: lookup.location?.time_zone ? new Date().getTimezoneOffset() * -60 : 0,
      currency: lookup.country?.iso_code ? 'USD' : 'Unknown', // Simplified
      isp: lookup.traits?.isp || 'Unknown',
      org: lookup.traits?.organization || 'Unknown',
      as: lookup.traits?.autonomous_system_number || '',
      asname: lookup.traits?.autonomous_system_organization || '',
      mobile: lookup.traits?.connection_type === 'Cellular' || false,
      proxy: lookup.traits?.is_anonymous_proxy || false,
      hosting: lookup.traits?.is_hosting_provider || false,
      accuracyRadius: lookup.location?.accuracy_radius || 0,
      isAnonymous: lookup.traits?.is_anonymous || false,
      isAnonymousVpn: lookup.traits?.is_anonymous_vpn || false,
      isHostingProvider: lookup.traits?.is_hosting_provider || false,
      isPublicProxy: lookup.traits?.is_public_proxy || false,
      isTorExitNode: lookup.traits?.is_tor_exit_node || false,
      mobileCountryCode: lookup.traits?.mobile_country_code || 'N/A',
      mobileNetworkCode: lookup.traits?.mobile_network_code || 'N/A',
      userType: lookup.traits?.user_type || 'unknown'
    };
  } catch (err) {
    console.error(`MaxMind error for ${ip}: ${err.message}`);
    return null;
  }
};

// Unified geolocation data fetch based on tier
const getGeoData = async (ip, tier) => {
  if (tier === 'pro1' || tier === 'pro2') {
    return await getGeoDataMaxMind(ip);
  } else {
    return await getGeoDataIpApi(ip);
  }
};

// Filter fields based on tier
const filterFields = (data, tier) => {
  if (!TIER_CONFIG[tier].fields) return data;
  const filtered = {};
  TIER_CONFIG[tier].fields.forEach(field => {
    filtered[field] = data[field];
  });
  return filtered;
};

// Routes
app.get('/', (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

app.get('/json/:ip?', checkApiKey, async (req, res) => {
  const ip = req.params.ip || req.ip;
  const data = await getGeoData(ip, req.user.tier);
  if (!data) return res.status(404).json({ status: 'fail', message: 'IP not found' });
  const filteredData = filterFields(data, req.user.tier);
  if (Object.keys(filteredData).length <= TIER_CONFIG.free.fields.length) {
    filteredData.message = 'Upgrade to Pro for full geolocation data and higher request limits.';
  }
  res.json(filteredData);
});

app.get('/xml/:ip?', checkApiKey, async (req, res) => {
  const ip = req.params.ip || req.ip;
  const data = await getGeoData(ip, req.user.tier);
  if (!data) return res.status(404).send('<response><status>fail</status><message>IP not found</message></response>');
  const filteredData = filterFields(data, req.user.tier);
  if (Object.keys(filteredData).length <= TIER_CONFIG.free.fields.length) {
    filteredData.message = 'Upgrade to Pro for full geolocation data and higher request limits.';
  }
  const xml = xmlJs.js2xml({ response: filteredData }, { compact: true, spaces: 2 });
  res.set('Content-Type', 'application/xml');
  res.send(xml);
});

app.get('/csv/:ip?', checkApiKey, async (req, res) => {
  const ip = req.params.ip || req.ip;
  const data = await getGeoData(ip, req.user.tier);
  if (!data) return res.status(404).send('status,message\nfail,IP not found');
  const filteredData = filterFields(data, req.user.tier);
  if (Object.keys(filteredData).length <= TIER_CONFIG.free.fields.length) {
    filteredData.message = 'Upgrade to Pro for full geolocation data and higher request limits.';
  }
  const csv = parse([filteredData], { fields: Object.keys(filteredData) });
  res.set('Content-Type', 'text/csv');
  res.send(csv);
});

app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});