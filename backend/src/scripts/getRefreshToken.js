import { google } from 'googleapis';
import { createRequire } from 'module';
import readline from 'readline';

const require = createRequire(import.meta.url);
const { installed } = require('../../google-credentials.json');

const oAuth2Client = new google.auth.OAuth2(
  installed.client_id,
  installed.client_secret,
  installed.redirect_uris[0]
);

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/spreadsheets',
  ],
});

console.log('\n✅ Open this URL in your browser:\n');
console.log(authUrl);
console.log('\nAfter granting permission, paste the code from the URL here:\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Enter the code: ', async (code) => {
  rl.close();
  const { tokens } = await oAuth2Client.getToken(code);
  console.log('\n✅ Your refresh token:\n');
  console.log(tokens.refresh_token);
  console.log('\nAdd this to your backend/.env file as:\nGOOGLE_REFRESH_TOKEN=<the token above>\n');
});
