const express = require('express');
const maxmind = require('maxmind');
const app = express();
const port = process.env.PORT || 3000;

// Load the GeoLite2 database
let lookup;
maxmind.open('./GeoLite2-City.mmdb').then((cityLookup) => {
  lookup = cityLookup;
  console.log('GeoLite2 database loaded');
}).catch(err => console.error('Error loading database:', err));

// Middleware to parse JSON
app.use(express.json());

// Root endpoint
app.get('/', (req, res) => {
  res.send('Welcome to My IP Geolocation API!');
});

// IP lookup endpoint (e.g., /json/8.8.8.8 or /json/)
app.get('/json/:ip?', (req, res) => {
    const ip = req.params.ip || req.ip === '::1' ? '127.0.0.1' : req.ip;
    console.log(`Processing IP: ${ip}`);
    if (!ip.match(/^(\d{1,3}\.){3}\d{1,3}$/) && !ip.match(/^([0-9a-fA-F]{0,4}:){7}[0-9a-fA-F]{0,4}$/)) {
      return res.status(400).json({ status: 'fail', message: 'Invalid IP address' });
    }
    const geo = lookup.get(ip);
    console.log(`Lookup result for ${ip}:`, geo);
    if (!geo) {
      return res.status(404).json({ status: 'fail', message: 'IP not found in database' });
    }
    const response = {
      status: 'success',
      query: ip,
      country: geo.country?.names?.en || 'Unknown',
      countryCode: geo.country?.iso_code || 'N/A',
      region: geo.subdivisions?.[0]?.names?.en || 'Unknown',
      regionName: geo.subdivisions?.[0]?.names?.en || 'Unknown',
      city: geo.city?.names?.en || 'Unknown',
      lat: geo.location?.latitude || 0,
      lon: geo.location?.longitude || 0,
      timezone: geo.location?.time_zone || 'Unknown',
    };
    res.json(response);
  });

// Start server
app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});