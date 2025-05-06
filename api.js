/*
########### SETUP ############
*/

import express from "express";
import cors from "cors";
import SpotifyWebApi from "spotify-web-api-node";
import dotenv from "dotenv";
import { exec } from 'child_process';
dotenv.config();

const apiPort = 8888
const apiUrl = process.env.API_URL || `http://localhost:${apiPort}`;
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5500';

const app = express();
app.use(cors()); 
app.use(express.json());

const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: `${apiUrl}/callback`
});

/*
########### ROUTES ############
*/

// ## LOGIN ##
app.get('/login', (req, res) => {
    const scopes = ['user-read-private', 'user-read-email', 'user-read-playback-state', 'user-modify-playback-state', 'streaming'];
    res.redirect(spotifyApi.createAuthorizeURL(scopes));
});

// ## CALLBACK ##
app.get('/callback', (req, res) => {
    const error = req.query.error;
    const code = req.query.code;
    if (error) {
        console.error('Callback Error:', error);
        res.send(`Callback Error: ${error}`);
        return;
    }

    // Exchange the code for an access token and a refresh token.
    spotifyApi.authorizationCodeGrant(code)
    .then(data => {
        const accessToken = data.body['access_token'];
        const refreshToken = data.body['refresh_token'];
        const expiresIn = data.body['expires_in'];

        // Set the access token and refresh token on the Spotify API object.
        spotifyApi.setAccessToken(accessToken);
        spotifyApi.setRefreshToken(refreshToken);

        res.redirect(`${clientUrl}?access_token=${accessToken}`);

        // Keep refreshing the access token periodically before it expires.
        setInterval(async () => {
            const data = await spotifyApi.refreshAccessToken();
            const accessTokenRefreshed = data.body['access_token'];
            spotifyApi.setAccessToken(accessTokenRefreshed);
            console.log('The access token has been refreshed at ' + new Date());
        }, expiresIn / 2 * 1000); // Refresh halfway before expiration.
    }).catch(error => {
        console.error('Error getting Tokens:', error);
        res.send('Error getting tokens');
    });
});

// ## SONG INFO ##
app.get('/song', (req, res) => {
    const uri = req.query.uri;
    spotifyApi.getTrack(uri)
    .then(songData => {
        const { name, artists, album, duration_ms, external_urls } = songData.body;
        const imgUrl = album.images[0].url;
        const songInfo = { name, artists, album, duration_ms, imgUrl, external_urls };
        res.send({songInfo: songInfo});
    }).catch(err => {
        console.error('Song Info Error:', err);
        res.send('Error occurred during song info retrieval');
    });
});

// ## PLAY ##
app.get('/play', async (req, res) => {
    const { uri, device_id } = req.query;

    if (!uri || !device_id) {
        return res.status(400).json({ error: 'Missing uri or device_id' });
    }

    try {
        // Start playback of the track
        await spotifyApi.play({
            device_id: device_id,
            uris: [uri],
            position_ms: 0 // Start from the beginning
        });
        res.sendStatus(200);
    } catch (err) {
        console.error("Failed to play track:", err.body || err);
        res.status(500).json({ error: 'Playback failed' });
    }
});


// ## RFID ##
app.get('/rfid', (req, res) => {
    exec('python3 read_rfid.py', (error, stdout, stderr) => {
      if (error) {
        // No card or read error
        return res.json({});
      }
  
      const output = stdout.trim().split('\n');
      const uid = output[0];
      const spotifyUri = output[1];
      //console.log(`Card UID: ${uid}, Spotify URI: ${spotifyUri}`);
  
      // Return UID and URI
      res.json({ uid, spotifyUri });
    });
  });

/*
########### RUN ############
*/

console.log(`API listening at ${apiUrl}`);
app.listen(apiPort)

// source: https://www.youtube.com/watch?v=TN1uvgAyxE0 
// https://github.com/adanzweig/nodejs-spotify