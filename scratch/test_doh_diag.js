import axios from 'axios';

async function queryGoogle() {
  console.log('Querying Google DoH...');
  try {
    const res = await axios.get('https://dns.google/resolve?name=api-inference.huggingface.co&type=A');
    console.log('Google response:', JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error('Google failed:', err.message);
  }
}

async function queryCloudflare() {
  console.log('Querying Cloudflare DoH...');
  try {
    const res = await axios.get('https://cloudflare-dns.com/dns-query?name=api-inference.huggingface.co&type=A', {
      headers: { 'Accept': 'application/dns-json' }
    });
    console.log('Cloudflare response:', JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error('Cloudflare failed:', err.message);
  }
}

(async () => {
  await queryGoogle();
  await queryCloudflare();
})();
