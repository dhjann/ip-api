const express = require('express');
const axios = require('axios');
const xmlJs = require('xml-js');
const { parse } = require('json2csv');
const NodeCache = require('node-cache');
const maxmind = require('maxmind');
const app = express();
const port = process.env.PORT || 3000;

const API_KEY = process.env.API_KEY || 'abc123XYZ!'; // Default key for free tier
const MAXMIND_USER_ID = process.env.MAXMIND_USER_ID || 'your-user-id'; // Set in Render
const MAXMIND_LICENSE_KEY = process.env.MAXMIND_LICENSE_KEY || 'your-license-key'; // Set in Render
const cache = new NodeCache({ stdTTL: 0 }); // In-memory cache for user keys, no expiration

// Define tier configurations
const TIER_CONFIG = {
  free: {
    maxRequests: 100, // 100 requests/day
    fields: ['ipAddress', 'status', 'countryName', 'cityName', 'latitude', 'longitude', 'timeZone', 'ispName'] // Branded limited fields
  },
  pro1: {
    maxRequests: 1000, // 1,000 requests/day
    fields: null // All MaxMind fields
  },
  pro2: {
    maxRequests: 10000, // 10,000 requests/day
    fields: null // All MaxMind fields
  }
};

// Initialize user-specific keys in cache
cache.set('abc123XYZ!', { tier: 'free', email: 'default@example.com' }); // Free tier example
cache.set('pro1-5f4dcc3b5aa765d61d8327deb882cf99', { tier: 'pro1', email: 'pro1@example.com' }); // Pro 1 example
cache.set('pro2-8f14e45fceea167a5a36dedd4bea2543', { tier: 'pro2', email: 'pro2@example.com' }); // Pro 2 example

app.use(express.json());
app.use(express.static('public'));

const getGeoData = async (ip, tier) => {
  if (tier === 'free') {
    try {
      console.log(`Attempting geolocation lookup for IP: ${ip} (Free Tier)`);
      const response = await axios.get(`http://ip-api.com/json/${ip}`);
      const data = response.data;
      if (data.status === 'fail') {
        console.error(`Geolocation error for ${ip}: ${data.message}`);
        return null;
      }
      console.log(`Geolocation response for ${ip}:`, JSON.stringify(data, null, 2));
      // Map ip-api.com fields to branded names for Free Tier
      return {
        status: 'success',
        ipAddress: data.query,
        geoContinent: data.continent || 'Unknown',
        continentCode: data.continentCode || 'N/A',
        countryName: data.country || 'Unknown',
        countryCode: data.countryCode || 'N/A',
        regionCode: data.region || 'Unknown',
        regionName: data.regionName || 'Unknown',
        cityName: data.city || 'Unknown',
        districtName: data.district || '',
        postalCode: data.zip || '',
        latitude: data.lat || 0,
        longitude: data.lon || 0,
        timeZone: data.timezone || 'Unknown',
        timeOffset: data.offset || 0,
        currencyCode: data.currency || 'Unknown',
        ispName: data.isp || 'Unknown',
        orgName: data.org || 'Unknown',
        asNumber: data.as || 'Unknown',
        asOrganization: data.asname || 'Unknown',
        isMobile: data.mobile || false,
        isProxy: data.proxy || false,
        isHosting: data.hosting || false
      };
    } catch (err) {
      console.error(`Geolocation error for ${ip}: ${err.message}`);
      return null;
    }
  } else {
    try {
      console.log(`Attempting MaxMind Insights API lookup for IP: ${ip} (Pro Tier)`);
      const client = new maxmind({
        userId: MAXMIND_USER_ID,
        licenseKey: MAXMIND_LICENSE_KEY,
        host: 'geolite.info'
      });
      const response = await client.insights(ip);
      return {
        status: 'success',
        ipAddress: ip,
        continent: response.continent?.names?.en || 'Unknown',
        continentCode: response.continent?.code || 'N/A',
        countryName: response.country?.names?.en || 'Unknown',
        countryCode: response.country?.isoCode || 'N/A',
        regionCode: response.subdivisions?.[0]?.isoCode || 'Unknown',
        regionName: response.subdivisions?.[0]?.names?.en || 'Unknown',
        cityName: response.city?.names?.en || 'Unknown',
        postalCode: response.postal?.code || '',
        latitude: response.location?.latitude || 0,
        longitude: response.location?.longitude || 0,
        timeZone: response.location?.timeZone || 'Unknown',
        accuracyRadius: response.location?.accuracyRadius || 0,
        ispName: response.traits?.isp || 'Unknown',
        orgName: response.traits?.organization || 'Unknown',
        asNumber: response.traits?.autonomousSystemNumber || 'Unknown',
        asOrganization: response.traits?.autonomousSystemOrganization || 'Unknown',
        isAnonymous: response.traits?.isAnonymous || false,
        isAnonymousVpn: response.traits?.isAnonymousVpn || false,
        isHostingProvider: response.traits?.isHostingProvider || false,
        isPublicProxy: response.traits?.isPublicProxy || false,
        isTorExitNode: response.traits?.isTorExitNode || false,
        mobileCountryCode: response.traits?.mobileCountryCode || 'N/A',
        mobileNetworkCode: response.traits?.mobileNetworkCode || 'N/A',
        userType: response.traits?.userType || 'Unknown'
      };
    } catch (err) {
      console.error(`MaxMind Insights API error for ${ip}: ${err.message}`);
      return null;
    }
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
  const tier = req.tier || 'free';
  const data = await getGeoData(ip, tier);
  if (!data) return res.status(404).json({ status: 'fail', message: 'IP not found' });

  // Filter data based on tier
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
  const tier = req.tier || 'free';
  const data = await getGeoData(ip, tier);
  if (!data) return res.status(404).send('<response><status>fail</status><message>IP not found</message></response>');

  // Filter data based on tier
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
  const tier = req.tier || 'free';
  const data = await getGeoData(ip, tier);
  if (!data) return res.status(404).send('status,message\nfail,IP not found');

  // Filter data based on tier
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
  limiter(res, res, () => {
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