const express = require('express');
const axios = require('axios');
const xmlJs = require('xml-js');
const { parse } = require('json2csv');
const NodeCache = require('node-cache');
const app = express();
const port = process.env.PORT || 3000;

const API_KEY = process.env.API_KEY || 'abc123XYZ!'; // Default key for free tier
const cache = new NodeCache({ stdTTL: 0 }); // In-memory cache for user keys, no expiration

// Define tier configurations (set in Render environment variables or hardcode for testing)
const TIER_CONFIG = {
  free: {
    maxRequests: 100, // 100 requests/day (adjust as needed)
    fields: ['query', 'status', 'country', 'city', 'lat', 'lon', 'timezone', 'isp'] // Limited fields
  },
  pro1: {
    maxRequests: 1000, // 1,000 requests/day (adjust as needed)
    fields: null // All fields (no filtering)
  },
  pro2: {
    maxRequests: 10000, // 10,000 requests/day or unlimited (adjust as needed)
    fields: null // All fields (no filtering)
  }
};

// Initialize user-specific keys in cache (or load from database)
cache.set('abc123XYZ!', { tier: 'free' }); // Free tier example
cache.set('pro1-5f4dcc3b5aa765d61d8327deb882cf99', { tier: 'pro1' }); // Pro 1 example
cache.set('pro2-8f14e45fceea167a5a36dedd4bea2543', { tier: 'pro2' }); // Pro 2 example

app.use(express.json());
app.use(express.static('public'));

const getGeoData = async (ip) => {
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

// Rate limit middleware for each tier
const rateLimit = require('express-rate-limit');

const createLimiter = (tier) => {
  return rateLimit({
    windowMs: 24 * 60 * 60 * 1000, // 1 day
    max: TIER_CONFIG[tier].maxRequests, // Requests per day per IP
    message: { status: 'fail', message: `Too many requests for ${tier} tier` },
    keyGenerator: (req) => req.ip // Limit per IP
  });
};

const checkTier = (req, res, next) => {
  const key = req.query.key || req.headers['x-api-key'];
  if (!key) {
    req.tier = 'free'; // Default to free tier if no key
  } else {
    const userTier = cache.get(key);
    if (!userTier) {
      return res.status(401).json({ status: 'fail', message: 'Invalid API key' });
    }
    req.tier = userTier.tier;
  }
  next();
};

// Apply rate limiting and tier checking to API endpoints
app.use('/json/:ip?', checkTier, createLimiter('free')); // Default free tier limit
app.use('/xml/:ip?', checkTier, createLimiter('free'));
app.use('/csv/:ip?', checkTier, createLimiter('free'));

app.get('/', (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

app.get('/json/:ip?', async (req, res) => {
  const ip = req.params.ip || req.ip;
  const data = await getGeoData(ip);
  if (!data) return res.status(404).json({ status: 'fail', message: 'IP not found' });

  // Filter data based on tier
  const tier = req.tier || 'free';
  let filteredData = { ...data };
  if (TIER_CONFIG[tier].fields) {
    filteredData = Object.keys(filteredData)
      .filter(key => TIER_CONFIG[tier].fields.includes(key))
      .reduce((obj, key) => {
        obj[key] = filteredData[key];
        return obj;
      }, {});
  }

  res.json(filteredData);
});

app.get('/xml/:ip?', async (req, res) => {
  const ip = req.params.ip || req.ip;
  const data = await getGeoData(ip);
  if (!data) return res.status(404).send('<response><status>fail</status><message>IP not found</message></response>');

  // Filter data based on tier
  const tier = req.tier || 'free';
  let filteredData = { ...data };
  if (TIER_CONFIG[tier].fields) {
    filteredData = Object.keys(filteredData)
      .filter(key => TIER_CONFIG[tier].fields.includes(key))
      .reduce((obj, key) => {
        obj[key] = filteredData[key];
        return obj;
      }, {});

    // Remove status and message from filtered data for XML
    delete filteredData.status;
    delete filteredData.message;
  }

  const xml = xmlJs.js2xml({ response: filteredData }, { compact: true, spaces: 2 });
  res.set('Content-Type', 'application/xml');
  res.send(xml);
});

app.get('/csv/:ip?', async (req, res) => {
  const ip = req.params.ip || req.ip;
  const data = await getGeoData(ip);
  if (!data) return res.status(404).send('status,message\nfail,IP not found');

  // Filter data based on tier
  const tier = req.tier || 'free';
  let filteredData = { ...data };
  if (TIER_CONFIG[tier].fields) {
    filteredData = Object.keys(filteredData)
      .filter(key => TIER_CONFIG[tier].fields.includes(key))
      .reduce((obj, key) => {
        obj[key] = filteredData[key];
        return obj;
      }, {});
  }

  const csv = parse([filteredData], { fields: Object.keys(filteredData) });
  res.set('Content-Type', 'text/csv');
  res.send(csv);
});

// Endpoint to generate/register a new user API key (optional, for future)
app.post('/register', express.json(), (req, res) => {
  const { email, tier } = req.body;
  if (!email || !tier || !['free', 'pro1', 'pro2'].includes(tier)) {
    return res.status(400).json({ status: 'fail', message: 'Invalid registration data' });
  }
  const newKey = `user-${tier}-${Math.random().toString(36).substr(2, 9)}`;
  cache.set(newKey, { tier, email });
  res.json({ status: 'success', apiKey: newKey, tier });
});

const checkApiKey = (req, res, next) => {
  const key = req.query.key || req.headers['x-api-key'];
  if (!key) {
    req.tier = 'free'; // Default to free tier
    next();
  } else {
    const userTier = cache.get(key);
    if (!userTier) {
      return res.status(401).json({ status: 'fail', message: 'Invalid API key' });
    }
    req.tier = userTier.tier;
    next();
  }
};

// Apply API key check and tier-specific rate limiting
app.get('/json/:ip?', checkApiKey, async (req, res) => {
  const limiter = createLimiter(req.tier);
  limiter(req, res, () => {
    // Already handled in the route above
  });
});

app.get('/xml/:ip?', checkApiKey, async (req, res) => {
  const limiter = createLimiter(req.tier);
  limiter(req, res, () => {
    // Already handled in the route above
  });
});

app.get('/csv/:ip?', checkApiKey, async (req, res) => {
  const limiter = createLimiter(req.tier);
  limiter(req, res, () => {
    // Already handled in the route above
  });
});

app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});