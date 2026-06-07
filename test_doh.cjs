const axios = require('axios');
const https = require('https');

async function test() {
  try {
    // Resolve DNS over HTTPS for image.pollinations.ai
    console.log('Resolving image.pollinations.ai...');
    const dnsRes = await axios.get('https://dns.google/resolve?name=image.pollinations.ai&type=A');
    console.log('DoH Answer:', dnsRes.data.Answer);
    let ip = null;
    for (const ans of dnsRes.data.Answer) {
      if (ans.type === 1) { // Type 1 is A record (IPv4 address)
        ip = ans.data;
        break;
      }
    }
    if (!ip) {
      // If we got a CNAME, query the CNAME to get its A record
      const cname = dnsRes.data.Answer[0].data;
      console.log(`Resolving CNAME: ${cname}...`);
      const cnameRes = await axios.get(`https://dns.google/resolve?name=${cname}&type=A`);
      console.log('CNAME Answer:', cnameRes.data.Answer);
      for (const ans of cnameRes.data.Answer) {
        if (ans.type === 1) {
          ip = ans.data;
          break;
        }
      }
    }
    if (!ip) {
      console.log('Could not find a raw IPv4 address');
      return;
    }
    console.log('Resolved Raw IPv4:', ip);

    // Call Pollinations using the IP directly, setting the Host header
    console.log('Requesting image via IPv4...');
    const response = await axios.get(`https://${ip}/prompt/A%20cat%20in%20space`, {
      headers: {
        'Host': 'image.pollinations.ai',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      responseType: 'arraybuffer',
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      timeout: 20000
    });
    console.log('Pollinations IPv4 success, length:', response.data.length);
  } catch (err) {
    console.log('Error:', err.message, err.response ? err.response.status : "", err.response ? err.response.data.toString().substring(0, 200) : "");
  }
}
test();
