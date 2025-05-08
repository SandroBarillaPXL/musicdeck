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

// ## GET NEXT SONGS ##
app.get('/nextUp', async (req, res) => {
    const uri = req.query.uri;
    if (!uri || !uri.startsWith('spotify:')) {
        return res.status(400).json({ error: 'Invalid Spotify URI' });
    }
    const [type, id] = uri.split(':').slice(1);
    try {
        let songs = [];
        let imgUrl = '';
        if (type === 'album') {
            const albumTracks = await spotifyApi.getAlbumTracks(id, { limit: 50 });
            const albumData = await spotifyApi.getAlbum(id);
            imgUrl = albumData.body.images?.[0]?.url || '';
            songs = albumTracks.body.items.map(track => ({
                name: track.name,
                uri: track.uri,
                artists: track.artists.map(artist => artist.name),
                imgUrl
            }));
        } else if (type === 'playlist') {
            let playlistTracks = [];
            let offset = 0;
            let totalTracks = 0;
            while (true) {
                const response = await spotifyApi.getPlaylistTracks(id, {
                    limit: 50,
                    offset: offset
                }); 
                const data = response.body;
                playlistTracks = playlistTracks.concat(data.items);  // Append new tracks
                totalTracks = data.total;
                offset += 50;
                if (offset >= totalTracks) break; // Stop if we've fetched all the tracks
            }
            // Handle the playlist data
            imgUrl = playlistTracks.length ? playlistTracks[0].track.album.images?.[0]?.url || '' : '';
            songs = playlistTracks
                .filter(item => item.track && item.track.uri)  // Filter out missing tracks
                .map(item => ({
                    name: item.track.name,
                    uri: item.track.uri,
                    artists: item.track.artists.map(artist => artist.name),
                    imgUrl: item.track.album.images?.[0]?.url || ''
                }));
        } else {
            return res.status(400).json({ error: 'Unsupported URI type' });
        }
        res.json({ albumInfo: songs });
    } catch (error) {
        console.error('Error fetching tracks:', error);
        res.status(500).json({ error: 'Failed to fetch tracks' });
    }
});

// ## PLAY ##
app.get('/play', async (req, res) => {
    const { uri, device_id } = req.query;

    if (!uri || !device_id) {
        return res.status(400).json({ error: 'Missing uri or device_id' });
    }
  
    try {
        const [type, id] = uri.split(':').slice(1);
  
      if (type === "track") {
        await spotifyApi.play({
            device_id: device_id,
            uris: [uri],
            position_ms: 0
        });
      } else if (type === "album") {
          const albumTracks = await spotifyApi.getAlbumTracks(id, { limit: 50 });
          const uris = albumTracks.body.items.map(track => track.uri);
          await spotifyApi.play({
              device_id: device_id,
              uris,
              position_ms: 0
        });
      } else if (type === "playlist") {
          await spotifyApi.play({
              device_id: device_id,
              context_uri: uri,
              position_ms: 0
          });
      } else {
          return res.status(400).json({ error: "Unsupported Spotify URI type" });
      }
  
      res.json({ status: "Playback started" });
  
    } catch (err) {
      console.error("Playback error:", err);
      res.status(500).json({ error: "Playback failed", details: err.message });
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