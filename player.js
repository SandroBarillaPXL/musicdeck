import config from '../config.js';
const apiUrl = config.apiUrl;

// Global variables
let lastUid = null;
let polling = false;
let trackDuration = 0;
let playerInfoHidden = false;
let volumeTimeout = null;
let currentTrackUri = null;
let nextUpTracks = [];
let nextUpContextUri = '';
let nextUpCurrentTrackIndex = 0;
const startVolume = 0.5;

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
const volumeLabel = document.getElementById('volume-label');
const nextUpOpenBtn = document.getElementById('next-up-open-btn');
const nextUpCloseBtn = document.getElementById('next-up-close-btn');
const nextUpList = document.getElementById('next-up-list');
const nextUpTitle = document.getElementById('next-up-title');
const nextUpPopup = document.getElementById('next-up-popup');
const logoPlaceholder = document.getElementById('logo-placeholder');
const albumArtwork = document.getElementById('album-artwork');

// Auth: Clear any old token and extract new one from URL
localStorage.removeItem('spotifyAccessToken');
const params = new URLSearchParams(window.location.search);
const token = params.get('access_token');

if (token) {
    localStorage.setItem('spotifyAccessToken', token);
    window.history.replaceState({}, document.title, "/")
}

window.onload = () => {
    const storedToken = localStorage.getItem('spotifyAccessToken');
    if (!storedToken) window.location = `${apiUrl}/login`;
    togglePLayerUi(false);
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
        volume: startVolume
    });

    player.addListener('ready', ({ device_id }) => {
        console.log('Ready with Device ID', device_id);
        localStorage.setItem('device_id', device_id);
        setInterval(() => readRfidCard(player, device_id), 500);
        togglePlayerUi(false);
        let percent = Math.round(startVolume * 100);
        volumeSlider.style.background = `linear-gradient(to right, #9000FF ${percent}%, #b3b3b3 ${percent}%)`;
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
        const newTrackUri = currentTrack.uri;
        const trackChanged = newTrackUri !== currentTrackUri;
        currentTrackUri = newTrackUri;
        playerAlbum.classList.remove('visible');
        playerSong.classList.remove('visible');
        playerArtist.classList.remove('visible');
        albumArtwork.classList.add('hidden');
        setTimeout(() => {
            playerAlbum.innerText = currentTrack.album.name;
            playerSong.innerText = currentTrack.name;
            playerArtist.innerText = currentTrack.artists.map(artist => artist.name).join(', ');
            playerImage.src = currentTrack.album.images[0]?.url || 'imgs/icon.png'; // Fallback to placeholder
            fullscreenImage.src = currentTrack.album.images[0]?.url || 'imgs/icon.png';
            playerAlbum.classList.add('visible');
            playerSong.classList.add('visible');
            playerArtist.classList.add('visible');
            albumArtwork.classList.remove('hidden');
        }, trackChanged ? 300 : 0); // Skip animation if track hasn't changed
        durationTime.innerText = formatTime(trackDuration);
        updateSeekBar(state.position, trackDuration);
        updatePlayButton(state.paused);
        // Pre-fetch Next Up queue
        player.getCurrentState().then(state => {
            if (!state || !state.context?.uri) return;
            const currentTrackUri = state.track_window.current_track.uri;
            const contextUri = state.context.uri;
            fetch(`${apiUrl}/rfid`)
                .then(res => res.json())
                .then(rfidData => {
                    const currentAlbumUri = rfidData.spotifyUri;
                    return fetch(`${apiUrl}/nextUp?uri=${encodeURIComponent(currentAlbumUri)}`);
                })
                .then(res => res.json())
                .then(data => {
                    const allTracks = data.albumInfo;
                    const index = allTracks.findIndex(track => track.uri === currentTrackUri);
                    nextUpTracks = index >= 0 ? allTracks.slice(index + 1) : [];
                    nextUpContextUri = contextUri;
                    nextUpCurrentTrackIndex = index;
                })
                .catch(err => {
                    console.warn("Failed to prefetch next-up list. Falling back to Spotify state.", err);
                    if (state?.track_window?.next_tracks) {
                        nextUpTracks = state.track_window.next_tracks.map(track => ({
                            name: track.name,
                            artists: track.artists.map(a => a.name),
                            imgUrl: track.album.images?.[0]?.url || 'imgs/icon.png',
                            uri: track.uri
                        }));
                        nextUpContextUri = contextUri;
                        nextUpCurrentTrackIndex = 0;
                    }
                });
        });
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
        const percent = Math.round(volume * 100);
        player.setVolume(volume).catch(err => console.error('Failed to set volume:', err));
        volumeSlider.style.background = `linear-gradient(to right, #9000FF ${percent}%, #b3b3b3 ${percent}%)`;
        volumeLabel.textContent = `${percent}%`;
        volumeLabel.style.opacity = '1';
        const thumbWidth = 40;
        const sliderWidth = volumeSlider.offsetWidth - thumbWidth;
        const thumbPosition = (percent / 100) * sliderWidth;
        volumeLabel.style.left = `${thumbPosition + thumbWidth / 2}px`;
        clearTimeout(volumeTimeout);
        volumeTimeout = setTimeout(() => {
            toggleVolumeSlider(false);
        }, 3000);
    });

    nextUpOpenBtn.addEventListener('click', () => {
        renderNextUp(nextUpTracks, nextUpContextUri, nextUpCurrentTrackIndex);
    });

};


// Functions -- MAIN
let debounceTimeout = null;
function readRfidCard(player, deviceId) {
    if (polling) return;
    polling = true;
    const timeout = setTimeout(() => {
        polling = false;
        console.warn("RFID polling timed out");
    }, 2000);
    fetch(`${apiUrl}/rfid`)
        .then(res => res.json())
        .then(data => {
            clearTimeout(timeout);
            polling = false;
            const { uid, spotifyUri } = data;
            const normalizedUid = uid && typeof uid === 'string' && uid.trim() ? uid : null;
            // Debounce state changes
            if (debounceTimeout) clearTimeout(debounceTimeout);
            debounceTimeout = setTimeout(() => {
                if (!normalizedUid && lastUid !== null) {
                    console.log("Card removed, pausing playback");
                    lastUid = null;
                    playerInfoHidden = true;
                    player.pause().catch(err => console.error("Pause failed:", err));
                    togglePlayerUi(false);
                    toggleFullScreen(false)
                    currentTrackUri = null;
                    nextUpTracks = [];
                    nextUpContextUri = '';
                    nextUpCurrentTrackIndex = 0;
                    return;
                }
                if (normalizedUid && normalizedUid !== lastUid && spotifyUri?.startsWith('spotify:')) {
                    console.log("New card detected:", normalizedUid);
                    lastUid = normalizedUid;
                    playerInfoHidden = false;
                    togglePlayerUi(true);
                    fetch(`${apiUrl}/play?uri=${encodeURIComponent(spotifyUri)}&device_id=${deviceId}`)
                        .then(res => res.json())
                        .then(data => {
                            if (data.status !== "Playback started") {
                                console.error("Playback failed:", data.error);
                            }
                        })
                        .catch(err => console.error("Playback request failed:", err));
                }
            }, 200); // 200ms debounce
        })
        .catch(err => {
            clearTimeout(timeout);
            polling = false;
            console.error("RFID polling failed:", err);
        });
}

function renderNextUp(nextTracks, contextUri, currentTrackIndex) {
    if (!nextTracks.length) {
        nextUpList.innerHTML = "<li>No upcoming tracks</li>";
        nextUpPopup.style.opacity = '1';
        nextUpPopup.style.pointerEvents = 'auto';
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
            nextUpPopup.style.opacity = '0';
            nextUpPopup.style.pointerEvents = 'none';
        });
    });
    nextUpPopup.style.opacity = '1';
    nextUpPopup.style.pointerEvents = 'auto';
    const titleSpan = nextUpTitle.querySelector('span');
    if (titleSpan) {
        titleSpan.innerText = "Next Up";
    }
}

// Functions -- UI
function togglePlayerUi(show) {
    const visible = show ? 'block' : 'none';
    nextBtn.style.display = visible;
    previousBtn.style.display = visible;
    togglePlayBtn.style.display = visible;
    volumeBtn.style.display = visible;
    seekBar.style.display = visible;
    currentTime.style.display = visible;
    durationTime.style.display = visible;
    nextUpOpenBtn.style.display = visible;
    if (show) {
        logoPlaceholder.classList.remove('visible');
        albumArtwork.classList.remove('hidden');
    } else {
        // Hide song text for fade-out effect
        playerAlbum.classList.remove('visible');
        playerSong.classList.remove('visible');
        playerArtist.classList.remove('visible');
        // Reset placeholder content and images immediately
        playerSong.innerText = "No song playing";
        playerArtist.innerText = "Insert a coin above to play";
        playerAlbum.innerText = "";
        playerImage.src = "imgs/icon.png";
        // Fade text back in
        playerSong.classList.add('visible');
        playerArtist.classList.add('visible');
        albumArtwork.classList.remove('hidden');
        logoPlaceholder.classList.add('visible');
    }
}

function toggleFullScreen(open) {
    fullscreenOverlay.style.opacity = open ? '1' : '0';
    fullscreenOverlay.style.pointerEvents = open ? 'auto' : 'none';
    openFullscreenBtn.style.opacity = open ? '0' : '1';
    openFullscreenBtn.style.pointerEvents = open ? 'none' : 'auto';
    if (open) {
        fullscreenImage.src = playerImage.src;
    }
}

function toggleVolumeSlider(show) {
    volumeSlider.style.opacity = show ? '1' : '0';
    volumeSlider.style.pointerEvents = show ? 'auto' : 'none';
    volumeBtn.style.opacity = show ? '0' : '1';
    volumeBtn.style.pointerEvents = show ? 'none' : 'auto';
    volumeLabel.style.opacity = show ? '1' : '0';

    if (show) {
        const percent = volumeSlider.value;
        const thumbWidth = 40;
        const sliderWidth = volumeSlider.offsetWidth - thumbWidth;
        const thumbPosition = (percent / 100) * sliderWidth;
        volumeLabel.style.left = `${thumbPosition + thumbWidth / 2}px`;
        resetVolumeTimeout();
    }
}

function toggleNextUp(show) {
    nextUpPopup.style.opacity = show ? '1' : '0';
    nextUpPopup.style.pointerEvents = show ? 'auto' : 'none';
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
        toggleVolumeSlider(false);
    }, 3000);
}

// Add event listeners
openFullscreenBtn.addEventListener('click', () => toggleFullScreen(true));
closeFullscreenBtn.addEventListener('click', () => toggleFullScreen(false));
volumeBtn.addEventListener('click', () => toggleVolumeSlider(true));
volumeSlider.addEventListener('input', resetVolumeTimeout);
volumeSlider.addEventListener('pointerdown', resetVolumeTimeout);
volumeSlider.addEventListener('pointerup', resetVolumeTimeout);
nextUpCloseBtn.addEventListener('click', () => toggleNextUp(false));