const express = require('express');
const axios = require('axios');
const xmlJs = require('xml-js');
const { parse } = require('json2csv');
const app = express();
const port = process.env.PORT || 3000;

const MAXMIND_ACCOUNT_ID = process.env.MAXMIND_ACCOUNT_ID || '1131107';
const MAXMIND_LICENSE_KEY = process.env.MAXMIND_LICENSE_KEY; // No default—must be set

app.use(express.json());
app.use(express.static('public'));

const getGeoData = async (ip) => {
  if (!MAXMIND_LICENSE_KEY) {
    throw new Error('MaxMind license key not configured');
  }
  try {
    const response = await axios.get(`https://geoip.maxmind.com/geoip/v2.1/insights/${ip}`, {
      auth: { username: MAXMIND_ACCOUNT_ID, password: MAXMIND_LICENSE_KEY }
    });
    const data = response.data;
    console.log(`GeoIP2 Insights response for ${ip}:`, JSON.stringify(data, null, 2));
    const geo = {
      status: 'success',
      query: ip,
      country: data.country?.names?.en || 'Unknown',
      countryCode: data.country?.iso_code || 'N/A',
      region: data.subdivisions?.[0]?.iso_code || 'Unknown',
      regionName: data.subdivisions?.[0]?.names?.en || 'Unknown',
      city: data.city?.names?.en || 'Unknown',
      lat: data.location?.latitude || 0,
      lon: data.location?.longitude || 0,
      timezone: data.location?.time_zone || 'Unknown',
      isp: data.traits?.isp || 'Unknown',
      organization: data.traits?.organization || 'Unknown',
      userType: data.traits?.user_type || 'Unknown',
      isAnonymous: data.traits?.is_anonymous || false
    };
    if (!data.city?.names?.en || !data.subdivisions?.[0]?.iso_code) {
      console.log(`Falling back to ip-api.com for ${ip}`);
      const fallback = await axios.get(`http://ip-api.com/json/${ip}`);
      const fbData = fallback.data;
      if (fbData.status === 'success') {
        geo.region = fbData.region || geo.region;
        geo.regionName = fbData.regionName || geo.regionName;
        geo.city = fbData.city || geo.city;
        geo.lat = fbData.lat || geo.lat;
        geo.lon = fbData.lon || geo.lon;
        geo.timezone = fbData.timezone || geo.timezone;
      }
    }
    return geo;
  } catch (err) {
    console.error(`GeoIP2 error for ${ip}: ${err.message}`);
    return null;
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

app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});

const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  message: { status: 'fail', message: 'Too many requests from this IP' }
});

app.use(limiter);

const API_KEY = process.env.API_KEY || 'abc123XYZ!';

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