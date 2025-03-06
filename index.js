const express = require('express');
const axios = require('axios');
const xmlJs = require('xml-js');
const { parse } = require('json2csv');
const app = express();
const port = process.env.PORT || 3000;

const API_KEY = process.env.API_KEY || 'abc123XYZ!'; // Default free key

app.use(express.json());
app.use(express.static('public'));

// In-memory user store (temporary)
const users = {};
let keyCounter = 0;

// Generate a unique API key
const generateApiKey = () => {
  return `key_${Date.now()}_${keyCounter++}`;
};

// Sign-up endpoint
app.post('/signup', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }
  if (users[email]) {
    return res.status(400).json({ message: 'Email already registered' });
  }

  const apiKey = generateApiKey();
  users[email] = { password, apiKey, tier: 'free' }; // Default to free tier
  res.status(201).json({ message: 'User created', apiKey });
});

// Get geolocation data from ip-api.com
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

app.get('/', (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

app.get('/json/:ip?', async (req, res) => {
  const ip = req.params.ip || req.ip;
  const data = await getGeoData(ip);
  if (!data) return res.status(404).json({ status: 'fail', message: 'IP not found' });
  res.json(data); // Homepage demo shows full data
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

app.get('/json/:ip?', checkApiKey, async (req, res) => {
  const ip = req.params.ip || req.ip;
  const data = await getGeoData(ip);
  if (!data) return res.status(404).json({ status: 'fail', message: 'IP not found' });
  res.json(data);
});

app.get('/xml/:ip?', checkApiKey, async (req, res) => {
  const ip = req.params.ip || req.ip;
  const data = await getGeoData(ip);
  if (!data) return res.status(404).send('<response><status>fail</status><message>IP not found</message></response>');
  const xml = xmlJs.js2xml({ response: data }, { compact: true, spaces: 2 });
  res.set('Content-Type', 'application/xml');
  res.send(xml);
});

app.get('/csv/:ip?', checkApiKey, async (req, res) => {
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