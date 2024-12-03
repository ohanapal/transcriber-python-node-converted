const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const screenshot = require("screenshot-desktop");
const sharp = require("sharp");
const mic = require("mic");
const FormData = require("form-data");
const cors = require("cors")
// Constants
const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";
const SCREENSHOT_INTERVAL = parseInt(process.env.SCREENSHOT_INTERVAL, 10) || 10000; // 10 seconds

let sessionFolder = "";
let monitors = [];
let maxSpeakers = 1;
let botId = "";
let screenshotIntervalId = null;
let audioFilename = "";
let micInstance = null;

// Helper function to format timestamp as YYYYMMDD_HHMMSS
function formatTimestamp(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "_",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join("");
}

const now = new Date();
const timestamp = formatTimestamp(now);

// Create session folder
function createSessionFolder() {
  sessionFolder = `session_${timestamp}`;
  fs.mkdirSync(sessionFolder, { recursive: true });
  console.log(`Created session folder: ${sessionFolder}`);
}

// Capture screenshot
async function captureScreenshot() {
  try {
    const availableMonitors = await screenshot.listDisplays();
    for (const monitorIndex of monitors) {
      if (monitorIndex < 0 || monitorIndex >= availableMonitors.length) {
        console.error(`Monitor ${monitorIndex + 1} is not available.`);
        continue;
      }
      const time = new Date();
      const pictureTimestamp = formatTimestamp(time);
      const monitor = availableMonitors[monitorIndex];
      const screenshotPath = path.join(
        sessionFolder,
        `screenshot_monitor_${monitorIndex + 1}_${pictureTimestamp}.jpg`,
      );

      const image = await screenshot({ screen: monitor.id });
      const compressedImage = await sharp(image)
        .resize(800) // Resize for compression
        .jpeg({ quality: 80 })
        .toBuffer();

      fs.writeFileSync(screenshotPath, compressedImage);
      console.log(`Screenshot saved: ${screenshotPath}`);
    }
  } catch (err) {
    console.error(`Failed to capture screenshot: ${err.message}`);
  }
}

// Start audio recording
function recordAudio() {
  micInstance = mic({
    rate: "44100",
    channels: "1",
    fileType: "wav",
  });

  const micInputStream = micInstance.getAudioStream();

  audioFilename = path.join(sessionFolder, `audio_${timestamp}.wav`);
  const outputFileStream = fs.createWriteStream(audioFilename);

  micInputStream.pipe(outputFileStream);

  micInputStream.on("error", (err) => {
    console.error(`Audio stream error: ${err.message}`);
  });

  micInstance.start();
  console.log("Audio recording started.");
}

// Upload captured audio and screenshots
async function uploadCapturedFiles() {
  try {
    const screenshotFormData = new FormData();

    // Append common data for both screenshots and audio
    screenshotFormData.append("bot_id", botId);
    screenshotFormData.append("current_time", timestamp);
    screenshotFormData.append("session_id", timestamp);

    // Loop through all .jpg files and append them to the FormData
    const files = fs.readdirSync(sessionFolder);
    files.forEach(file => {
      if (file.endsWith(".jpg")) {
        screenshotFormData.append("file", fs.createReadStream(path.join(sessionFolder, file)), file);
      }
    });
    // Send a single request with both images and audio
    const uploadResponse = await axios.post(
      `${SERVER_URL}/upload/image`,
      screenshotFormData,
      { headers: screenshotFormData.getHeaders() }
    );

    console.log(`Files uploaded successfully: ${uploadResponse.statusText}`);
    if (audioFilename) {
      const audioFormData = new FormData();
      audioFormData.append("session_id", timestamp);
      audioFormData.append("max_speakers", maxSpeakers);
      audioFormData.append("bot_id", botId);
      audioFormData.append("file", fs.createReadStream(audioFilename));

      const audioResponse = await axios.post(
        `${SERVER_URL}/upload/audio`,
        audioFormData,
        { headers: audioFormData.getHeaders() },
      );
      console.log(`Audio uploaded: ${audioResponse.statusText}`);
    }
  } catch (err) {
    console.error(`Error uploading files: ${err.message}`);
  }
}

// Graceful shutdown
async function stopProcess() {
  if (screenshotIntervalId) {
    clearInterval(screenshotIntervalId);
    console.log("Stopped screenshot capture.");
  }
  if (micInstance) {
    console.log("Stopping audio recording...");
    micInstance.stop();
  }
  try {
    console.log("Uploading captured files...");
    await uploadCapturedFiles();
  } catch (err) {
    console.error(`Error during shutdown: ${err.message}`);
  }
  console.log("Process stopped.");
}

// Express App
const app = express();
app.use(express.json());
app.use(cors())
// Start API
app.post("/start", async (req, res) => {
  try {
    const { selectedMonitors, speakers, botId: bot } = req.body;

    const availableMonitors = await screenshot.listDisplays();
    monitors =
      selectedMonitors.toLowerCase() === "all"
        ? availableMonitors.map((_, index) => index)
        : selectedMonitors.split(",").map((num) => parseInt(num.trim(), 10) - 1);

    maxSpeakers = speakers;
    botId = bot;

    createSessionFolder();
    console.log("Starting audio recording...");
    recordAudio();

    console.log("Starting screenshot capture...");
    screenshotIntervalId = setInterval(() => captureScreenshot(), SCREENSHOT_INTERVAL);

    res.status(200).json({ message: "Process started successfully." });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Failed to start the process." });
  }
});

// Stop API
app.post("/stop", async (req, res) => {
  try {
    await stopProcess();
    res.status(200).json({ message: "Process stopped successfully." });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Failed to stop the process." });
  }
});

// Start server
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
