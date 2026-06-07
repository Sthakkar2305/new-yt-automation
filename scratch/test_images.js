import axios from 'axios';
import fs from 'fs/promises';
import dns from 'dns';

// Force IPv4 resolution first
dns.setDefaultResultOrder('ipv4first');

const prompt = "A clean minimalist illustration of fusion energy reactor, high tech";
const encodedPrompt = encodeURIComponent(prompt);

async function testPollinationsIPv4() {
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?nologo=true&private=true&safe=true&width=768&height=1344`;
  console.log('Testing Pollinations with IPv4 first...');
  try {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    await fs.writeFile('scratch/test_pollinations_ipv4.png', res.data);
    console.log('Pollinations IPv4 Success!');
  } catch (err) {
    console.error('Pollinations failed:', err.response ? err.response.status : err.message);
    if (err.response && err.response.data) {
      try {
        console.error('Data:', Buffer.from(err.response.data).toString());
      } catch (e) {}
    }
  }
}

(async () => {
  await testPollinationsIPv4();
})();
