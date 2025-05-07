import config from '../config.js';
const apiUrl = config.apiUrl;

let lastUid = null;
let polling = false;
let trackDuration = 0;
let playerInfoHidden = false;

// DOM elements
const seekBar = document.getElementById('progress-bar');
const currentTime = document.getElementById('current-time');
const durationTime = document.getElementById('duration');
const playerSong = document.getElementById('player-song');
const playerArtist = document.getElementById('player-artist');
const playerAlbum = document.getElementById('player-album');
const playerImage = document.getElementById('player-image');
const togglePlayBtn = document.getElementById('togglePlay');
const nextBtn = document.getElementById('next');
const previousBtn = document.getElementById('previous');
const openFullscreenBtn = document.getElementById('open-fullscreen');
const closeFullscreenBtn = document.getElementById('close-fullscreen');
const fullscreenOverlay = document.getElementById('fullscreen-overlay');
const fullscreenImage = document.getElementById('fullscreen-image');

// Auth: Clear any old token and extract new one from URL
localStorage.removeItem('spotifyAccessToken');
const params = new URLSearchParams(window.location.search);
const token = params.get('access_token');

if (token) {
    localStorage.setItem('spotifyAccessToken', token);
    window.history.replaceState({}, document.title, "/"); // Clean URL
}

window.onload = () => {
    const storedToken = localStorage.getItem('spotifyAccessToken');
    if (!storedToken) window.location = `${apiUrl}/login`;
};

window.onSpotifyWebPlaybackSDKReady = () => {
    const storedToken = localStorage.getItem('spotifyAccessToken');
    if (!storedToken) {
        console.error("No access token found.");
        return;
    }

    const player = new Spotify.Player({
        name: 'Music Deck',
        getOAuthToken: cb => cb(storedToken),
        volume: 0.5
    });

    player.addListener('ready', ({ device_id }) => {
        console.log('Ready with Device ID', device_id);
        localStorage.setItem('device_id', device_id);

        // Start polling for RFID card after player is ready
        setInterval(() => readRfidCard(player, device_id), 500);
        hidePlayerUi();
    });

    player.addListener('not_ready', ({ device_id }) => {
        console.log('Device ID has gone offline', device_id);
    });

    player.addListener('initialization_error', ({ message }) => console.error(message));
    player.addListener('authentication_error', ({ message }) => console.error(message));
    player.addListener('account_error', ({ message }) => console.error(message));

    player.addListener('player_state_changed', (state) => {
        if (!state || playerInfoHidden) return;

        const currentTrack = state.track_window.current_track;
        trackDuration = currentTrack.duration_ms;
        playerAlbum.innerText = currentTrack.album.name;
        playerSong.innerText = currentTrack.name;
        playerArtist.innerText = currentTrack.artists.map(artist => artist.name).join(', ');
        playerImage.src = currentTrack.album.images[0].url;
        durationTime.innerText = formatTime(trackDuration);
        fullscreenImage.src = currentTrack.album.images[0].url;
        updateSeekBar(state.position, trackDuration);
        updatePlayButton(state.paused);
    });

    togglePlayBtn.onclick = () => player.togglePlay();
    nextBtn.onclick = () => player.nextTrack();
    previousBtn.onclick = () => player.previousTrack();
    player.connect();

    setInterval(() => {
        if (playerInfoHidden) return;
        player.getCurrentState().then(state => {
            if (state) updateSeekBar(state.position, trackDuration);
        });
    }, 1000);

    seekBar.addEventListener('input', (e) => {
        const newPosition = (e.target.value / 100) * trackDuration;
        player.seek(newPosition);
    });
};

function updateSeekBar(position, duration) {
    const percentage = (position / duration) * 100;
    seekBar.value = percentage;
    currentTime.innerText = formatTime(position);
    seekBar.style.background = `linear-gradient(to right, #9000FF ${percentage}%, #b3b3b3 ${percentage}%)`;
}

function updatePlayButton(paused) {
    togglePlayBtn.className = paused ? "play-button control-button" : "pause-button control-button";
}

function formatTime(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
}

// Calls your backend to read RFID card (replace with your own endpoint)
function readRfidCard(player, deviceId) {
    if (polling) return;
    polling = true;

    fetch(`${apiUrl}/rfid`)
        .then(res => res.json())
        .then(data => {
            polling = false;
            const { uid, spotifyUri } = data;

            if (!uid && lastUid !== null) {
                console.log("Card removed");
                lastUid = null;
                playerInfoHidden = true; // Prevent future UI updates
                player.pause();
                hidePlayerUi();
                return;
            }

            if (uid !== lastUid && spotifyUri?.startsWith('spotify:')) {
                console.log("New card detected!", uid);
                lastUid = uid;
                playerInfoHidden = false; // Re-enable UI updates
                fetch(`${apiUrl}/play?uri=${encodeURIComponent(spotifyUri)}&device_id=${deviceId}`);
                showPlayerUi();
            }
        })
        .catch(err => {
            polling = false;
            console.error("RFID polling failed:", err);
        });
}

function hidePlayerUi() {
    playerSong.innerText = "No song playing";
    playerArtist.innerText = "Insert a card to play";
    playerAlbum.innerText = "";
    nextBtn.style.display = "none";
    previousBtn.style.display = "none";
    togglePlayBtn.style.display = "none";
    seekBar.style.display = "none";
    currentTime.style.display = "none";
    durationTime.style.display = "none";
    playerImage.src = "imgs/icon.png";
    fullscreenImage.src = 'imgs/icon.png';
}

function showPlayerUi() {
    nextBtn.style.display = "block";
    previousBtn.style.display = "block";
    togglePlayBtn.style.display = "block";
    seekBar.style.display = "block";
    currentTime.style.display = "block";
    durationTime.style.display = "block";
}

openFullscreenBtn.addEventListener('click', () => {
    fullscreenOverlay.style.display = 'flex';
    fullscreenImage.src = playerImage.src;
    openFullscreenBtn.style.display = 'none';
});

closeFullscreenBtn.addEventListener('click', () => {
    fullscreenOverlay.style.display = 'none';
    openFullscreenBtn.style.display = 'block';
});
