const { exec } = require("child_process");

let lastUid = null;
let polling = false;

function readRfidCard() {
  if (polling) return; // Prevent overlapping reads
  polling = true;

  exec("python3 read_rfid.py", (error, stdout, stderr) => {
    polling = false;

    if (error) {
        if (lastUid !== null) {
          console.log("Card removed!");
          stopPlayback();
          lastUid = null;
        }
        return;
      }

    const output = stdout.trim();
    const [uid, spotifyUri] = output.split("|");

    if (uid !== lastUid) {
      console.log("🎵 New card detected!");
      console.log("UID:", uid);
      console.log("Spotify URI:", spotifyUri);

      lastUid = uid;

      if (spotifyUri && spotifyUri.startsWith("spotify:track:")) {
        playSpotifyTrack(spotifyUri);
      }
    }
  });
}

// Dummy function — replace with your Spotify player logic
function playSpotifyTrack(uri) {
  console.log("Playing track:", uri);
  // Add your Spotify API/Web Playback SDK call here
}

// Dummy function — replace with your Spotify player logic
function stopPlayback() {
  console.log("Stopping playback...");
  // Add your Spotify API/Web Playback SDK call here
}

// Call the function every second
setInterval(readRfidCard, 1000);
