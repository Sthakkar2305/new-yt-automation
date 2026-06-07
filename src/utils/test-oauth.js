import { google } from 'googleapis';
import dotenv from 'dotenv';
dotenv.config();

console.log("Client ID:", process.env.YOUTUBE_CLIENT_ID);
console.log("Client Secret:", process.env.YOUTUBE_CLIENT_SECRET ? "PRESENT" : "MISSING");
console.log("Redirect URI:", process.env.YOUTUBE_REDIRECT_URI);
console.log("Refresh Token:", process.env.YOUTUBE_REFRESH_TOKEN ? "PRESENT" : "MISSING");

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI
);

oauth2Client.setCredentials({
  refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
});

async function testRefresh() {
  try {
    console.log("Attempting to refresh access token...");
    const { credentials } = await oauth2Client.refreshAccessToken();
    console.log("Refresh successful!");
    console.log("New Access Token:", credentials.access_token);
  } catch (err) {
    console.error("Refresh failed!");
    console.error("Error details:", err);
  }
}

testRefresh();
