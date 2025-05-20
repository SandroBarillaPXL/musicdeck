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
    hidePlayerUi();
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
        setInterval(() => readRfidCard(player, device_id), 100);
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
        const newTrackUri = currentTrack.uri;
        if (newTrackUri !== currentTrackUri) {
            currentTrackUri = newTrackUri;
            playerAlbum.classList.remove('visible');
            playerSong.classList.remove('visible');
            playerArtist.classList.remove('visible');
            setTimeout(() => {
                playerAlbum.innerText = currentTrack.album.name;
                playerSong.innerText = currentTrack.name;
                playerArtist.innerText = currentTrack.artists.map(artist => artist.name).join(', ');
                playerAlbum.classList.add('visible');
                playerSong.classList.add('visible');
                playerArtist.classList.add('visible');
            }, 300);
            const albumArtwork = document.getElementById('album-artwork');
            if (playerImage.src !== currentTrack.album.images[0].url) {
                albumArtwork.classList.add('hidden');
                setTimeout(() => {
                    playerImage.src = currentTrack.album.images[0].url;
                    albumArtwork.classList.remove('hidden');
                }, 300);
            }
            durationTime.innerText = formatTime(trackDuration);
            fullscreenImage.src = currentTrack.album.images[0].url;
            // ✅ Pre-fetch Next Up queue
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
                                imgUrl: track.album.images?.[0]?.url || '',
                                uri: track.uri
                            }));
                            nextUpContextUri = contextUri;
                            nextUpCurrentTrackIndex = 0;
                        }
                    });
                });
            }
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
            hideSlider();
        }, 3000);
    });

    nextUpOpenBtn.addEventListener('click', () => {
        renderNextUp(nextUpTracks, nextUpContextUri, nextUpCurrentTrackIndex);
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
                playerInfoHidden = true;
                player.pause();
                hidePlayerUi();
                return;
            }

            if (uid !== lastUid && spotifyUri?.startsWith('spotify:')) {
                console.log("New card detected!", uid);
                lastUid = uid;
                playerInfoHidden = false;
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
function hidePlayerUi() {
    playerAlbum.classList.remove('visible');
    playerSong.classList.remove('visible');
    playerArtist.classList.remove('visible');
    setTimeout(() => {
        playerSong.innerText = "No song playing";
        playerArtist.innerText = "Insert a coin to play";
        playerAlbum.innerText = "";
        playerSong.classList.add('visible');
        playerArtist.classList.add('visible');
    }, 300);
    nextBtn.style.display = "none";
    previousBtn.style.display = "none";
    togglePlayBtn.style.display = "none";
    volumeBtn.style.display = "none";
    seekBar.style.display = "none";
    currentTime.style.display = "none";
    durationTime.style.display = "none";
    const albumArtwork = document.getElementById('album-artwork');
    albumArtwork.classList.add('hidden');
    setTimeout(() => {
        playerImage.src = "imgs/icon.png";
        albumArtwork.classList.remove('hidden');
    }, 300);
    
    fullscreenImage.src = 'imgs/icon.png';
    nextUpPopup.style.opacity = '0';
    nextUpPopup.style.pointerEvents = 'none';
    nextUpOpenBtn.style.display = 'none';
    fullscreenOverlay.style.opacity = '0';
    fullscreenOverlay.style.pointerEvents = 'none';
    openFullscreenBtn.style.opacity = '1';
    openFullscreenBtn.style.pointerEvents = 'auto';
    currentTrackUri = null;
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
    fullscreenOverlay.style.opacity = '1';
    fullscreenOverlay.style.pointerEvents = 'auto';
    fullscreenImage.src = playerImage.src;
    openFullscreenBtn.style.opacity = '0';
    openFullscreenBtn.style.pointerEvents = 'none';
}

function closeFullScreen() {
    fullscreenOverlay.style.opacity = '0';
    fullscreenOverlay.style.pointerEvents = 'none';
    openFullscreenBtn.style.opacity = '1';
    openFullscreenBtn.style.pointerEvents = 'auto';
}

function showSlider() {
    volumeSlider.style.opacity = '1';
    volumeSlider.style.pointerEvents = 'auto';
    volumeBtn.style.opacity = '0';
    volumeBtn.style.pointerEvents = 'none';
    volumeLabel.style.opacity = '1';
    const percent = volumeSlider.value;
    const thumbWidth = 40;
    const sliderWidth = volumeSlider.offsetWidth - thumbWidth;
    const thumbPosition = (percent / 100) * sliderWidth;
    volumeLabel.style.left = `${thumbPosition + thumbWidth / 2}px`;
    resetVolumeTimeout();
}

function hideSlider() {
    volumeSlider.style.opacity = '0';
    volumeSlider.style.pointerEvents = 'none';
    volumeBtn.style.opacity = '1';
    volumeBtn.style.pointerEvents = 'auto';
    volumeLabel.style.opacity = '0';
}

function hideNextUp() {
    nextUpPopup.style.opacity = '0';
    nextUpPopup.style.pointerEvents = 'none';
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
nextUpCloseBtn.addEventListener('click', hideNextUp);