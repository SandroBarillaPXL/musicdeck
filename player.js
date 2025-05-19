import config from '../config.js';
const apiUrl = config.apiUrl;

// Global variables
let lastUid = null;
let polling = false;
let trackDuration = 0;
let playerInfoHidden = false;
let volumeTimeout = null;

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
const volumeBtn = document.getElementById('volume-btn');
const volumeSlider = document.getElementById('volume-slider');
const nextUpOpenBtn = document.getElementById('next-up-open-btn');
const nextUpCloseBtn = document.getElementById('next-up-close-btn');
const nextUpList = document.getElementById('next-up-list');
const nextUpTitle = document.getElementById('next-up-title');
const nextUpPopup = document.getElementById('next-up-popup');

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
        setInterval(() => readRfidCard(player, device_id), 250);
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

    volumeSlider.addEventListener('input', (e) => {
        const volume = e.target.value / 100;
        const percent = volume * 100;
        player.setVolume(volume).catch(err => console.error('Failed to set volume:', err));
        volumeSlider.style.background = `linear-gradient(to right, #9000FF ${percent}%, #b3b3b3 ${percent}%)`;

        // Reset hide timeout
        clearTimeout(volumeTimeout);
        volumeTimeout = setTimeout(() => {
            volumeSlider.style.display = 'none';
        }, 3000);
    });

    nextUpOpenBtn.addEventListener('click', () => {
        player.getCurrentState().then(state => {
            if (!state) {
                console.error("No player state available.");
                return;
            }
            const currentTrackUri = state.track_window.current_track.uri;
            const currentContextUri = state.context.uri;
            fetch(`${apiUrl}/rfid`)
            .then(res => res.json())
            .then(rfidData => {
                const currentAlbumUri = rfidData.spotifyUri;
                
                fetch(`${apiUrl}/nextUp?uri=${encodeURIComponent(currentAlbumUri)}`)
                    .then(res => res.json())
                    .then(data => {
                    const allTracks = data.albumInfo;
                    const currentTrackIndex = allTracks.findIndex(track => track.uri === currentTrackUri);
                    const index = allTracks.findIndex(track => track.uri === currentTrackUri);
                    const nextTracks = index >= 0 ? allTracks.slice(index + 1) : [];
                    renderNextUp(nextTracks, currentContextUri, currentTrackIndex);
                    })
                    .catch(err => console.error("Failed to fetch album info:", err));
                })
            .catch(err => {
                console.warn("RFID fetch failed, falling back to next_tracks.");
                const nextTracks = state.track_window.next_tracks.map(track => ({
                    name: track.name,
                    artists: track.artists.map(artist => artist.name),
                    imgUrl: track.album.images?.[0]?.url || '',
                    uri: track.uri
                }));
                renderNextUp(nextTracks, currentContextUri, currentTrackIndex);
            });
        }).catch(err => {
            console.error("Failed to fetch player state:", err);
        });
    });   
};


// Functions -- MAIN
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

function renderNextUp(nextTracks, contextUri, currentTrackIndex) {
    if (!nextTracks.length) {
        nextUpList.innerHTML = "<li>No upcoming tracks</li>";
        return;
    }
    let deviceId = localStorage.getItem('device_id');
    nextUpList.innerHTML = nextTracks.map((track, index) => `
        <li>
            <img src="${track.imgUrl}" alt="${track.name}" class="next-up-image">
            <div class="next-up-info">
                <span class="next-up-title">${track.name}</span> - 
                <span class="next-up-artist">${track.artists.join(', ')}</span>
            </div>
            <img src="imgs/play.png" alt="Play" class="next-up-play-icon control-button" 
                data-uri="${contextUri}" data-offset="${index + currentTrackIndex + 1}">
        </li>
    `).join('');
    // Add click event listeners to play buttons
    document.querySelectorAll('.next-up-play-icon').forEach(button => {
        button.addEventListener('click', () => {
            const uri = button.getAttribute('data-uri');
            const offset = button.getAttribute('data-offset');
            fetch(`${apiUrl}/play?uri=${encodeURIComponent(uri)}&device_id=${deviceId}&offset=${offset}`)
                .then(res => res.json())
                .then(data => {
                    if (data.status === "Playback started") {
                        console.log(`Started playback from track at index ${offset}`);
                    } else {
                        console.error("Playback failed:", data.error);
                    }
                })
                .catch(err => console.error("Failed to start playback:", err));
            nextUpPopup.style.display = 'none';
        });
    });
    nextUpPopup.style.display = 'flex';
    const titleSpan = nextUpTitle.querySelector('span');
    if (titleSpan) {
        titleSpan.innerText = "Next Up";
    }
}

// Functions -- UI
function hidePlayerUi() {
    playerSong.innerText = "No song playing";
    playerArtist.innerText = "Insert a card to play";
    playerAlbum.innerText = "";
    nextBtn.style.display = "none";
    previousBtn.style.display = "none";
    togglePlayBtn.style.display = "none";
    volumeBtn.style.display = "none";
    seekBar.style.display = "none";
    currentTime.style.display = "none";
    durationTime.style.display = "none";
    playerImage.src = "imgs/icon.png";
    fullscreenImage.src = 'imgs/icon.png';
    nextUpPopup.style.display = 'none';
    nextUpOpenBtn.style.display = 'none';
}

function showPlayerUi() {
    nextBtn.style.display = "block";
    previousBtn.style.display = "block";
    togglePlayBtn.style.display = "block";
    volumeBtn.style.display = "block";
    seekBar.style.display = "block";
    currentTime.style.display = "block";
    durationTime.style.display = "block";
    nextUpOpenBtn.style.display = "block";
}

function openFullScreen() {
    fullscreenOverlay.style.display = 'flex';
    fullscreenImage.src = playerImage.src;
    openFullscreenBtn.style.display = 'none';
}

function closeFullScreen() {
    fullscreenOverlay.style.display = 'none';
    openFullscreenBtn.style.display = 'block';
}

function showSlider() {
    volumeSlider.style.opacity = '1';
    volumeSlider.style.pointerEvents = 'auto';
    volumeBtn.style.opacity = '0';
    volumeBtn.style.pointerEvents = 'none';
    resetVolumeTimeout();
}

function hideSlider() {
    volumeSlider.style.opacity = '0';
    volumeSlider.style.pointerEvents = 'none';
    volumeBtn.style.opacity = '1';
    volumeBtn.style.pointerEvents = 'auto';
}

// FUNCTIONS -- UX
function updateSeekBar(position, duration) {
    const percentage = (position / duration) * 100;
    seekBar.value = percentage;
    currentTime.innerText = formatTime(position);
    seekBar.style.background = `linear-gradient(to right, #9000FF ${percentage}%, #b3b3b3 ${percentage}%)`;
}

function updatePlayButton(paused) {
    togglePlayBtn.className = paused ? "play-button control-button" : "pause-button control-button";
}

// FUNCTIONS -- HELPERS
function formatTime(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function resetVolumeTimeout() {
    clearTimeout(volumeTimeout);
    volumeTimeout = setTimeout(() => {
        hideSlider();
    }, 3000);
}

// Add event listeners
openFullscreenBtn.addEventListener('click', openFullScreen);
closeFullscreenBtn.addEventListener('click', closeFullScreen);
volumeBtn.addEventListener('click', showSlider);
volumeSlider.addEventListener('input', resetVolumeTimeout);
volumeSlider.addEventListener('pointerdown', resetVolumeTimeout);
volumeSlider.addEventListener('pointerup', resetVolumeTimeout);
nextUpCloseBtn.addEventListener('click', () => {nextUpPopup.style.display = 'none';});