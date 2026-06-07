const axios = require('axios');
const https = require('https');
const dns = require('dns');

// Use Google DNS
dns.setServers(['8.8.8.8']);

const customHttpsAgent = new https.Agent({
  lookup: (hostname, options, callback) => {
    dns.resolve4(hostname, (err, addresses) => {
      if (err) {
        // Fallback to default lookup if custom fails
        return dns.lookup(hostname, options, callback);
      }
      callback(null, addresses[0], 4);
    });
  }
});

axios.get('https://api-inference.huggingface.co/status', { httpsAgent: customHttpsAgent })
  .then(res => console.log('Success:', res.status))
  .catch(err => console.log('Error:', err.message));
